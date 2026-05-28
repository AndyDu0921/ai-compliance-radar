import { Hono } from "hono";
import packageJson from "../package.json";
import { analyzeWithLlm, isLlmEnabled } from "./llm";
import { buildRuleBasedReport, scanRules, type RiskItem, type ScanReport, type MissingProtection, type CompletenessScore, type PoisonPill } from "./rule-engine";
import { isScanMode, listRulepacks } from "./rules";
import type { Bindings, JobRow, ScanMode, TextScanPayload } from "./types";
import {
  applyNoStoreHeaders,
  htmlPage,
  requireJobHistoryEnabled,
  requireApiKey,
  verifyTurnstileIfEnabled,
  isTurnstileEnabled,
  adminJobsEnabled,
  scanRateLimiter
} from "./middleware";
import { buildOpenApiSpec } from "./schemas";
import {
  renderSwaggerUi,
  renderRedoc,
  renderPrivacyPage,
  renderTermsPage,
  shouldStoreRaw,
  retentionDays,
  ALLOWED_UPLOADS_LIST
} from "./ui";

const ALLOWED_UPLOADS = ALLOWED_UPLOADS_LIST;
const DEFAULT_APP_VERSION = packageJson.version;

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(purgeExpiredJobs(env.DB, retentionDays(env)));
  }
};

export function createApp() {
  const app = new Hono<{ Bindings: Bindings }>();

  // Global middleware
  app.use("/health", applyNoStoreHeaders);
  app.use("/openapi.json", applyNoStoreHeaders);
  app.use("/api/*", applyNoStoreHeaders);
  app.use("/api/v1/scan/*", scanRateLimiter);

  // System
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      version: appVersion(c.env),
      deployed_at: deployedAt(c.env)
    })
  );

  app.get("/openapi.json", (c) => c.json(buildOpenApiSpec(c.env)));

  app.get("/api/v1/meta", (c) =>
    c.json({
      app_name: c.env.APP_NAME || "Compliance Radar",
      version: appVersion(c.env),
      deployed_at: deployedAt(c.env),
      llm_enabled: isLlmEnabled(c.env),
      max_upload_mb: maxUploadMb(c.env),
      allowed_uploads: ALLOWED_UPLOADS,
      captcha_enabled: isTurnstileEnabled(c.env),
      turnstile_enabled: isTurnstileEnabled(c.env),
      turnstile_site_key: c.env.TURNSTILE_SITE_KEY || null,
      rulepacks: listRulepacks(),
      admin_features: { jobs: adminJobsEnabled(c.env) }
    })
  );

  // Docs & pages
  app.get("/docs", (c) => htmlPage(c, renderSwaggerUi()));
  app.get("/redoc", (c) => htmlPage(c, renderRedoc()));
  app.get("/privacy", (c) => htmlPage(c, renderPrivacyPage(c.env)));
  app.get("/terms", (c) => htmlPage(c, renderTermsPage(c.env)));

  // Admin (gated)
  app.use("/api/v1/jobs", requireJobHistoryEnabled);
  app.use("/api/v1/jobs/*", requireJobHistoryEnabled);
  app.use("/api/v1/jobs", requireApiKey);
  app.use("/api/v1/jobs/*", requireApiKey);

  app.get("/api/v1/jobs", async (c) => {
    const limit = clamp(Number(c.req.query("limit") || 15), 1, 100);
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?"
    ).bind(limit).all<JobRow>();
    return c.json(results.map(serializeJob));
  });

  app.get("/api/v1/jobs/:job_id", async (c) => {
    const job = await findJob(c.env.DB, c.req.param("job_id"));
    if (!job) return c.json({ detail: "Job not found" }, 404);
    return c.json(serializeJob(job));
  });

  // Public polling endpoint for async LLM enrichment (no API key required)
  app.get("/api/v1/poll/:job_id", async (c) => {
    const job = await findJob(c.env.DB, c.req.param("job_id"));
    if (!job) return c.json({ detail: "Job not found" }, 404);
    const parsed = parseStoredReport(job.result_json);
    return c.json({
      status: job.status,
      result: parsed.result,
      error: parsed.errorMessage || job.error_message
    });
  });

  // Scan endpoints — async: rule engine returns immediately, LLM runs in background
  app.post("/api/v1/scan/text", async (c) => {
    const payload = await readJsonPayload(c.req.raw);
    const validation = validateTextPayload(payload);
    if ("error" in validation) return c.json({ detail: validation.error }, validation.status);

    const turnstileResponse = await verifyTurnstileIfEnabled(c, validation.payload.turnstile_token);
    if (turnstileResponse) return turnstileResponse;

    const jobId = crypto.randomUUID();
    const { mode, text: content, title } = validation.payload;
    const useLlm = resolveUseLlm(c.env, validation.payload.use_llm);

    // Step 1: Rule engine report (instant, <100ms)
    const ruleReport = buildRuleBasedReport({
      jobId, mode, text: content, deterministicHits: scanRules({ mode, text: content }),
      title, sourceName: null
    });

    // Step 2: Save rule report to D1
    await insertJob(c.env, { jobId, mode, inputMethod: "text", inputText: content, title, fileName: null, report: ruleReport, llmPending: useLlm });

    // Step 3: If LLM enabled, run in background via waitUntil
    if (useLlm && isLlmEnabled(c.env)) {
      c.executionCtx.waitUntil(
        enrichWithLlm(c.env, jobId, mode, content, ruleReport).catch(err => {
          console.error("LLM enrichment failed:", err?.message || err);
        })
      );
    }

    return c.json({ job_id: jobId, status: useLlm ? "processing" : "completed", llm_pending: useLlm, result: ruleReport });
  });

  app.post("/api/v1/scan/file", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ detail: "file is required" }, 400);

    const turnstileResponse = await verifyTurnstileIfEnabled(c, form.get("turnstile_token"));
    if (turnstileResponse) return turnstileResponse;

    const suffix = fileSuffix(file.name);
    if (!ALLOWED_UPLOADS.includes(suffix)) return c.json({ detail: "Only .txt and .md uploads supported" }, 400);
    if (file.size > maxUploadMb(c.env) * 1024 * 1024) return c.json({ detail: `File too large. Max: ${maxUploadMb(c.env)}MB` }, 413);

    const modeValue = form.get("mode");
    if (!isScanMode(modeValue)) return c.json({ detail: "mode must be ad_copy or contract_review" }, 400);

    const title = normalizeOptionalString(form.get("title"), 255);
    const text = (await file.text()).trim();
    if (!text) return c.json({ detail: "file text cannot be blank" }, 400);
    if (text.length > 120000) return c.json({ detail: "file text is too long" }, 413);

    const jobId = crypto.randomUUID();
    const useLlm = resolveUseLlm(c.env, form.get("use_llm"));

    const ruleReport = buildRuleBasedReport({
      jobId, mode: modeValue, text, deterministicHits: scanRules({ mode: modeValue, text }),
      title, sourceName: file.name
    });

    await insertJob(c.env, { jobId, mode: modeValue, inputMethod: "file", inputText: text, title, fileName: file.name, report: ruleReport, llmPending: useLlm });

    if (useLlm && isLlmEnabled(c.env)) {
      c.executionCtx.waitUntil(
        enrichWithLlm(c.env, jobId, modeValue, text, ruleReport).catch(err => {
          console.error("LLM enrichment failed:", err?.message || err);
        })
      );
    }

    return c.json({ job_id: jobId, status: useLlm ? "processing" : "completed", llm_pending: useLlm, result: ruleReport });
  });

  app.onError((error, c) => {
    console.error(error);
    return c.json(
      { detail: error instanceof Error ? error.message : "Internal server error" },
      500
    );
  });

  app.notFound((c) => {
    if (new URL(c.req.url).pathname.startsWith("/api/")) {
      return c.json({ detail: "Not found" }, 404);
    }
    return c.env.ASSETS.fetch(c.req.raw);
  });

  return app;
}

// ── Report generation ──

async function generateReport({
  env,
  jobId,
  mode,
  text,
  title,
  sourceName,
  useLlm
}: {
  env: Bindings;
  jobId: string;
  mode: ScanMode;
  text: string;
  title: string | null;
  sourceName: string | null;
  useLlm: boolean;
}): Promise<ScanReport> {
  const deterministicHits = scanRules({ mode, text });
  let llmWarning: string | undefined;
  let llmItems: RiskItem[] = [];
  let llmUsed = false;
  let riskScoreAdjustment = 0;
  let llmSummary: string | undefined;
  let rewriteSuggestions: string[] = [];
  let humanReview: string[] = [];
  let missingProtections: MissingProtection[] = [];
  let completenessScores: CompletenessScore[] = [];
  let poisonPills: PoisonPill[] = [];
  let signingRecommendation: string | undefined;

  if (useLlm && isLlmEnabled(env)) {
    try {
      const llm = await analyzeWithLlm({ env, mode, text, deterministicHits });
      llmItems = llm.llmItems;
      llmUsed = llm.llmUsed;
      riskScoreAdjustment = llm.riskScoreAdjustment;
      llmSummary = llm.llmSummary;
      rewriteSuggestions = llm.rewriteSuggestions;
      humanReview = llm.humanReview;
      missingProtections = llm.missingProtections;
      completenessScores = llm.completenessScores;
      poisonPills = llm.poisonPills;
      signingRecommendation = llm.signingRecommendation;
    } catch (error) {
      llmWarning = `LLM 分析失败，已回退到规则引擎报告: ${
        error instanceof Error ? error.message : "未知错误"
      }`;
    }
  }

  return buildRuleBasedReport({
    jobId,
    mode, text, deterministicHits, title, sourceName,
    llmItems, llmUsed, riskScoreAdjustment, llmSummary,
    rewriteSuggestions, humanReview, llmWarning,
    missingProtections, completenessScores, poisonPills,
    signingRecommendation
  });
}

// ── Database helpers ──

async function insertJob(
  env: Bindings,
  input: {
    jobId: string; mode: ScanMode; inputMethod: "text" | "file";
    inputText: string; title: string | null; fileName: string | null;
    report: ScanReport; llmPending: boolean;
  }
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO jobs (id, title, mode, status, input_method, input_text, file_name, created_at, updated_at, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    input.jobId, input.title, input.mode,
    input.llmPending ? "processing" : "completed",
    input.inputMethod,
    shouldStoreRaw(env) ? input.inputText : null,
    input.fileName, now, now,
    JSON.stringify(input.report)
  ).run();
}

async function enrichWithLlm(
  env: Bindings, jobId: string, mode: ScanMode, text: string, ruleReport: ScanReport
) {
  try {
    const deterministicHits = ruleReport.risk_items.filter(r => r.source === "rule");
    const llm = await analyzeWithLlm({ env, mode, text, deterministicHits });

    const enriched = buildRuleBasedReport({
      jobId, mode, text, deterministicHits,
      title: ruleReport.title, sourceName: ruleReport.metadata.source_name as string | null,
      llmItems: llm.llmItems, llmUsed: true,
      riskScoreAdjustment: llm.riskScoreAdjustment,
      llmSummary: llm.llmSummary,
      rewriteSuggestions: llm.rewriteSuggestions,
      humanReview: llm.humanReview,
      missingProtections: llm.missingProtections,
      completenessScores: llm.completenessScores,
      poisonPills: llm.poisonPills,
      signingRecommendation: llm.signingRecommendation
    });

    const now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE jobs SET status='completed', result_json=?, updated_at=?, llm_completed_at=? WHERE id=?"
    ).bind(JSON.stringify(enriched), now, now, jobId).run();
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "unknown";
    await env.DB.prepare(
      "UPDATE jobs SET status='completed', llm_error=?, updated_at=? WHERE id=?"
    ).bind(errMsg, new Date().toISOString(), jobId).run();
  }
}

async function findJob(db: D1Database, jobId: string): Promise<JobRow | null> {
  return await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
}

async function purgeExpiredJobs(db: D1Database, days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("DELETE FROM jobs WHERE created_at < ?").bind(cutoff).run();
}

function serializeJob(row: JobRow) {
  const parsed = parseStoredReport(row.result_json);
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    file_name: row.file_name,
    error_message: parsed.errorMessage || row.error_message,
    input_method: row.input_method,
    result: parsed.result
  };
}

function parseStoredReport(resultJson: string | null): { result: ScanReport | null; errorMessage: string | null } {
  if (!resultJson) return { result: null, errorMessage: null };
  try {
    return { result: JSON.parse(resultJson) as ScanReport, errorMessage: null };
  } catch {
    return { result: null, errorMessage: "Stored report payload is invalid and could not be parsed." };
  }
}

// ── Validation ──

async function readJsonPayload(request: Request): Promise<TextScanPayload> {
  try {
    const payload = (await request.json()) as unknown;
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as TextScanPayload)
      : {};
  } catch {
    return {};
  }
}

function validateTextPayload(payload: TextScanPayload):
  | { payload: { mode: ScanMode; text: string; title: string | null; use_llm?: unknown; turnstile_token?: unknown } }
  | { error: string; status: 400 | 413 } {
  if (!isScanMode(payload.mode)) {
    return { error: "mode must be ad_copy or contract_review", status: 400 };
  }
  if (typeof payload.text !== "string" || !payload.text.trim()) {
    return { error: "text cannot be blank", status: 400 };
  }
  const text = payload.text.trim();
  if (text.length > 120000) {
    return { error: "text is too long", status: 413 };
  }
  return {
    payload: {
      mode: payload.mode,
      text,
      title: normalizeOptionalString(payload.title, 255),
      use_llm: payload.use_llm,
      turnstile_token: payload.turnstile_token
    }
  };
}

// ── Utilities ──

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function resolveUseLlm(env: Bindings, value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return env.DEFAULT_USE_LLM?.toLowerCase() === "true";
}

function maxUploadMb(env: Bindings): number {
  const parsed = Number(env.MAX_UPLOAD_MB || 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

function appVersion(env: Bindings): string {
  return env.APP_VERSION?.trim() || DEFAULT_APP_VERSION;
}

function deployedAt(env: Bindings): string | null {
  return env.APP_DEPLOYED_AT?.trim() || null;
}

function fileSuffix(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
