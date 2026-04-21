import { Hono, type Context, type Next } from "hono";
import packageJson from "../package.json";
import { analyzeWithLlm, isLlmEnabled, type LlmEnv } from "./llm";
import { buildRuleBasedReport, scanRules, type RiskItem, type ScanReport } from "./rule-engine";
import { isScanMode, listRulepacks, type ScanMode } from "./rules";

export type Bindings = LlmEnv & {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME?: string;
  APP_VERSION?: string;
  APP_DEPLOYED_AT?: string;
  MAX_UPLOAD_MB?: string;
  DEFAULT_USE_LLM?: string;
  ADMIN_API_KEY?: string;
  STORE_RAW_INPUT?: string;
  JOB_RETENTION_DAYS?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
};

interface JobRow {
  id: string;
  title: string | null;
  mode: ScanMode;
  status: "pending" | "processing" | "completed" | "failed";
  input_method: "text" | "file";
  input_text: string | null;
  file_name: string | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  result_json: string | null;
}

interface TextScanPayload {
  mode?: unknown;
  text?: unknown;
  title?: unknown;
  use_llm?: unknown;
  turnstile_token?: unknown;
}

interface TurnstileResponse {
  success?: boolean;
  "error-codes"?: string[];
}

const ALLOWED_UPLOADS = [".txt", ".md"];
const DEFAULT_APP_VERSION = packageJson.version;

export const app = createApp();
export default app;

export function createApp() {
  const app = new Hono<{ Bindings: Bindings }>();

  app.use("/health", applyNoStoreHeaders);
  app.use("/openapi.json", applyNoStoreHeaders);
  app.use("/api/*", applyNoStoreHeaders);

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
      admin_features: {
        jobs: adminJobsEnabled(c.env)
      }
    })
  );

  app.get("/docs", (c) => htmlPage(c, renderSwaggerUi()));
  app.get("/redoc", (c) => htmlPage(c, renderRedoc()));
  app.get("/privacy", (c) => htmlPage(c, renderPrivacyPage(c.env)));
  app.get("/terms", (c) => htmlPage(c, renderTermsPage(c.env)));

  app.use("/api/v1/jobs", requireJobHistoryEnabled);
  app.use("/api/v1/jobs/*", requireJobHistoryEnabled);
  app.use("/api/v1/jobs", requireApiKey);
  app.use("/api/v1/jobs/*", requireApiKey);

  app.get("/api/v1/jobs", async (c) => {
    await purgeExpiredJobs(c.env.DB, retentionDays(c.env));
    const limit = clamp(Number(c.req.query("limit") || 15), 1, 100);
    const { results } = await c.env.DB.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").bind(limit).all<JobRow>();
    return c.json(results.map(serializeJob));
  });

  app.get("/api/v1/jobs/:job_id", async (c) => {
    await purgeExpiredJobs(c.env.DB, retentionDays(c.env));
    const job = await findJob(c.env.DB, c.req.param("job_id"));
    if (!job) {
      return c.json({ detail: "Job not found" }, 404);
    }
    return c.json(serializeJob(job));
  });

  app.post("/api/v1/scan/text", async (c) => {
    await purgeExpiredJobs(c.env.DB, retentionDays(c.env));
    const payload = await readJsonPayload(c.req.raw);
    const validation = validateTextPayload(payload);
    if ("error" in validation) {
      return c.json({ detail: validation.error }, validation.status);
    }

    const turnstileResponse = await verifyTurnstileIfEnabled(c, validation.payload.turnstile_token);
    if (turnstileResponse) {
      return turnstileResponse;
    }

    const jobId = crypto.randomUUID();
    const useLlm = resolveUseLlm(c.env, validation.payload.use_llm);
    const report = await generateReport({
      env: c.env,
      jobId,
      mode: validation.payload.mode,
      text: validation.payload.text,
      title: validation.payload.title,
      sourceName: null,
      useLlm
    });
    await insertCompletedJob(c.env, {
      jobId,
      mode: validation.payload.mode,
      inputMethod: "text",
      inputText: validation.payload.text,
      title: validation.payload.title,
      fileName: null,
      report
    });

    return c.json({ job_id: jobId, status: "completed", result: report });
  });

  app.post("/api/v1/scan/file", async (c) => {
    await purgeExpiredJobs(c.env.DB, retentionDays(c.env));
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ detail: "file is required" }, 400);
    }

    const turnstileResponse = await verifyTurnstileIfEnabled(c, form.get("turnstile_token"));
    if (turnstileResponse) {
      return turnstileResponse;
    }

    const suffix = fileSuffix(file.name);
    if (!ALLOWED_UPLOADS.includes(suffix)) {
      return c.json({ detail: "Cloudflare version currently supports .txt and .md uploads only" }, 400);
    }
    if (file.size > maxUploadMb(c.env) * 1024 * 1024) {
      return c.json({ detail: `File too large. Max size: ${maxUploadMb(c.env)}MB` }, 413);
    }

    const modeValue = form.get("mode");
    if (!isScanMode(modeValue)) {
      return c.json({ detail: "mode must be ad_copy or contract_review" }, 400);
    }

    const title = normalizeOptionalString(form.get("title"), 255);
    const text = (await file.text()).trim();
    if (!text) {
      return c.json({ detail: "file text cannot be blank" }, 400);
    }
    if (text.length > 120000) {
      return c.json({ detail: "file text is too long" }, 413);
    }

    const jobId = crypto.randomUUID();
    const useLlm = resolveUseLlm(c.env, form.get("use_llm"));
    const report = await generateReport({
      env: c.env,
      jobId,
      mode: modeValue,
      text,
      title,
      sourceName: file.name,
      useLlm
    });
    await insertCompletedJob(c.env, {
      jobId,
      mode: modeValue,
      inputMethod: "file",
      inputText: text,
      title,
      fileName: file.name,
      report
    });

    return c.json({ job_id: jobId, status: "completed", result: report });
  });

  app.onError((error, c) => {
    console.error(error);
    return c.json({ detail: error instanceof Error ? error.message : "Internal server error" }, 500);
  });

  app.notFound((c) => {
    if (new URL(c.req.url).pathname.startsWith("/api/")) {
      return c.json({ detail: "Not found" }, 404);
    }
    return c.env.ASSETS.fetch(c.req.raw);
  });

  return app;
}

async function applyNoStoreHeaders(c: Context<{ Bindings: Bindings }>, next: Next) {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  c.header("X-Content-Type-Options", "nosniff");
}

async function requireJobHistoryEnabled(c: Context<{ Bindings: Bindings }>, next: Next) {
  if (!adminJobsEnabled(c.env)) {
    return c.json({ detail: "Not found" }, 404);
  }
  await next();
}

async function requireApiKey(c: Context<{ Bindings: Bindings }>, next: Next) {
  const expected = c.env.ADMIN_API_KEY?.trim();
  if (!expected || c.req.header("X-API-Key") !== expected) {
    return c.json({ detail: "Invalid or missing API key" }, 401);
  }
  await next();
}

async function verifyTurnstileIfEnabled(c: Context<{ Bindings: Bindings }>, token: unknown): Promise<Response | null> {
  if (!isTurnstileEnabled(c.env)) {
    return null;
  }
  if (typeof token !== "string" || !token.trim()) {
    return c.json({ detail: "Turnstile verification is required" }, 400);
  }

  const form = new FormData();
  form.set("secret", c.env.TURNSTILE_SECRET_KEY!.trim());
  form.set("response", token.trim());

  const ip = c.req.header("CF-Connecting-IP");
  if (ip) {
    form.set("remoteip", ip);
  }

  let response: Response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form
    });
  } catch (error) {
    console.error("Turnstile verification failed", error);
    return c.json({ detail: "Unable to verify Turnstile token" }, 502);
  }

  if (!response.ok) {
    return c.json({ detail: "Unable to verify Turnstile token" }, 502);
  }

  const payload = (await response.json()) as TurnstileResponse;
  if (!payload.success) {
    return c.json(
      {
        detail: "Turnstile verification failed",
        error_codes: payload["error-codes"] || []
      },
      400
    );
  }

  return null;
}

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

  if (useLlm && isLlmEnabled(env)) {
    try {
      const llm = await analyzeWithLlm({ env, mode, text, deterministicHits });
      llmItems = llm.llmItems;
      llmUsed = llm.llmUsed;
      riskScoreAdjustment = llm.riskScoreAdjustment;
      llmSummary = llm.llmSummary;
      rewriteSuggestions = llm.rewriteSuggestions;
      humanReview = llm.humanReview;
    } catch (error) {
      llmWarning = `LLM analysis failed, rule-based report returned instead: ${
        error instanceof Error ? error.message : "unknown error"
      }`;
    }
  }

  return buildRuleBasedReport({
    jobId,
    mode,
    text,
    deterministicHits,
    title,
    sourceName,
    llmItems,
    llmUsed,
    riskScoreAdjustment,
    llmSummary,
    rewriteSuggestions,
    humanReview,
    llmWarning
  });
}

async function insertCompletedJob(
  env: Bindings,
  input: {
    jobId: string;
    mode: ScanMode;
    inputMethod: "text" | "file";
    inputText: string;
    title: string | null;
    fileName: string | null;
    report: ScanReport;
  }
) {
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO jobs (
        id, title, mode, status, input_method, input_text, file_name,
        created_at, updated_at, error_message, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.jobId,
      input.title,
      input.mode,
      "completed",
      input.inputMethod,
      shouldStoreRawInput(env) ? input.inputText : null,
      input.fileName,
      now,
      now,
      null,
      JSON.stringify(input.report)
    )
    .run();
}

async function findJob(db: D1Database, jobId: string): Promise<JobRow | null> {
  return await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
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
  if (!resultJson) {
    return { result: null, errorMessage: null };
  }
  try {
    return {
      result: JSON.parse(resultJson) as ScanReport,
      errorMessage: null
    };
  } catch {
    return {
      result: null,
      errorMessage: "Stored report payload is invalid and could not be parsed."
    };
  }
}

async function readJsonPayload(request: Request): Promise<TextScanPayload> {
  try {
    const payload = (await request.json()) as unknown;
    return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as TextScanPayload) : {};
  } catch {
    return {};
  }
}

function validateTextPayload(
  payload: TextScanPayload
):
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

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function resolveUseLlm(env: Bindings, value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return env.DEFAULT_USE_LLM?.toLowerCase() === "true";
}

function maxUploadMb(env: Bindings): number {
  const parsed = Number(env.MAX_UPLOAD_MB || 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

function retentionDays(env: Bindings): number {
  const parsed = Number(env.JOB_RETENTION_DAYS || 7);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 7;
}

function shouldStoreRawInput(env: Bindings): boolean {
  return String(env.STORE_RAW_INPUT || "false").toLowerCase() === "true";
}

function adminJobsEnabled(env: Bindings): boolean {
  return Boolean(env.ADMIN_API_KEY?.trim());
}

function isTurnstileEnabled(env: Bindings): boolean {
  return Boolean(env.TURNSTILE_SITE_KEY?.trim() && env.TURNSTILE_SECRET_KEY?.trim());
}

function appVersion(env: Bindings): string {
  return env.APP_VERSION?.trim() || DEFAULT_APP_VERSION;
}

function deployedAt(env: Bindings): string | null {
  return env.APP_DEPLOYED_AT?.trim() || null;
}

async function purgeExpiredJobs(db: D1Database, days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("DELETE FROM jobs WHERE created_at < ?").bind(cutoff).run();
}

function fileSuffix(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function htmlPage(c: Context<{ Bindings: Bindings }>, markup: string) {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Content-Type-Options", "nosniff");
  return c.html(markup);
}

function buildOpenApiSpec(env: Bindings) {
  const version = appVersion(env);
  return {
    openapi: "3.1.0",
    info: {
      title: "Compliance Radar API",
      version,
      description: "Cloudflare Worker 版本的 AI 合规扫描接口。公开扫描接口可直接调用，任务历史仅管理员可见。"
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "system", description: "健康检查与站点元信息" },
      { name: "scan", description: "文本与文件扫描" },
      { name: "admin", description: "管理员任务历史" }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "管理员任务历史接口使用的 API Key。"
        }
      },
      schemas: {
        MetaResponse: {
          type: "object",
          properties: {
            app_name: { type: "string" },
            version: { type: "string" },
            deployed_at: { type: ["string", "null"], format: "date-time" },
            llm_enabled: { type: "boolean" },
            max_upload_mb: { type: "number" },
            allowed_uploads: { type: "array", items: { type: "string" } },
            captcha_enabled: { type: "boolean" },
            turnstile_enabled: { type: "boolean" },
            turnstile_site_key: { type: ["string", "null"] },
            admin_features: {
              type: "object",
              properties: {
                jobs: { type: "boolean" }
              }
            }
          }
        },
        TextScanRequest: {
          type: "object",
          required: ["mode", "text"],
          properties: {
            mode: { type: "string", enum: ["ad_copy", "contract_review"] },
            text: { type: "string" },
            title: { type: ["string", "null"] },
            use_llm: { type: "boolean" },
            turnstile_token: {
              type: "string",
              description: "启用 Cloudflare Turnstile 时必填。"
            }
          }
        },
        ScanResponse: {
          type: "object",
          properties: {
            job_id: { type: "string" },
            status: { type: "string", enum: ["completed"] },
            result: { type: "object" }
          }
        }
      }
    },
    paths: {
      "/health": {
        get: {
          tags: ["system"],
          summary: "Health check",
          responses: {
            "200": {
              description: "Service is healthy"
            }
          }
        }
      },
      "/api/v1/meta": {
        get: {
          tags: ["system"],
          summary: "Get site metadata",
          responses: {
            "200": {
              description: "Current public configuration",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/MetaResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/scan/text": {
        post: {
          tags: ["scan"],
          summary: "Submit text for compliance scan",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TextScanRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Scan completed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ScanResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/scan/file": {
        post: {
          tags: ["scan"],
          summary: "Upload a text or markdown file for scanning",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file", "mode"],
                  properties: {
                    file: { type: "string", format: "binary" },
                    mode: { type: "string", enum: ["ad_copy", "contract_review"] },
                    title: { type: "string" },
                    use_llm: { type: "boolean" },
                    turnstile_token: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Scan completed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ScanResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/jobs": {
        get: {
          tags: ["admin"],
          summary: "List recent jobs",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 100, default: 15 }
            }
          ],
          responses: {
            "200": { description: "Recent jobs" },
            "401": { description: "Invalid API key" },
            "404": { description: "Admin history disabled" }
          }
        }
      },
      "/api/v1/jobs/{job_id}": {
        get: {
          tags: ["admin"],
          summary: "Get a single job",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "job_id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": { description: "Job detail" },
            "401": { description: "Invalid API key" },
            "404": { description: "Admin history disabled or job not found" }
          }
        }
      }
    }
  };
}

function renderSwaggerUi(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Compliance Radar API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; background: #0a0a0a; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        docExpansion: "list",
        defaultModelsExpandDepth: 1
      });
    };
  </script>
</body>
</html>`;
}

function renderRedoc(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Compliance Radar ReDoc</title>
  <style>
    body { margin: 0; background: #ffffff; }
  </style>
</head>
<body>
  <redoc spec-url="/openapi.json"></redoc>
  <script src="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js"></script>
</body>
</html>`;
}

function renderPrivacyPage(env: Bindings): string {
  return renderLegalPage({
    title: "数据隐私保护政策",
    intro: "本页面描述公开 MVP 当前如何处理输入文本、任务记录与管理员访问。",
    sections: [
      {
        heading: "收集内容",
        body: [
          "系统会处理你提交的文本内容或上传文件中的文本内容，以生成风险分析报告。",
          shouldStoreRawInput(env)
            ? "当前部署已启用原文存储，扫描原文可能会被写入数据库。"
            : "当前部署默认不存储扫描原文，只保留任务元信息、文件名和结构化报告结果。"
        ]
      },
      {
        heading: "保存期限",
        body: [`任务记录默认保留 ${retentionDays(env)} 天，过期记录会在后续请求中自动清理。`]
      },
      {
        heading: "管理员访问",
        body: [
          adminJobsEnabled(env)
            ? "管理员历史接口已启用，仅持有有效 X-API-Key 的管理员可以读取任务历史。"
            : "管理员历史接口当前未公开启用，普通访问者无法读取历史任务。"
        ]
      },
      {
        heading: "使用建议",
        body: [
          "不要提交身份证号、银行卡、医疗病历、源代码密钥等高敏感信息。",
          "对于高风险合同、广告发布或正式法律结论，仍需由人工法务进行最终审核。"
        ]
      }
    ]
  });
}

function renderTermsPage(env: Bindings): string {
  return renderLegalPage({
    title: "服务条款",
    intro: "本工具当前以公开 MVP 形式提供，主要用于合规风险预筛和内部演示。",
    sections: [
      {
        heading: "服务性质",
        body: [
          "系统输出的是风险分诊与整改建议，不构成正式法律意见或律师服务。",
          "你应对提交内容及其后续使用自行负责。"
        ]
      },
      {
        heading: "支持范围",
        body: [
          `当前公开版本仅支持 ${ALLOWED_UPLOADS.join("、")} 文件上传。`,
          "LLM 增强为可选能力，未启用时系统仅提供规则引擎报告。"
        ]
      },
      {
        heading: "访问控制",
        body: [
          adminJobsEnabled(env)
            ? "历史任务接口属于管理员能力，必须使用有效 X-API-Key 访问。"
            : "历史任务接口当前未启用。"
        ]
      },
      {
        heading: "免责声明",
        body: [
          "服务按现状提供，不保证对所有业务场景、司法口径或监管变更都完全覆盖。",
          "正式发布、签约、投放、采购或争议处理前，应由具备资质的专业人员复核。"
        ]
      }
    ]
  });
}

function renderLegalPage({
  title,
  intro,
  sections
}: {
  title: string;
  intro: string;
  sections: Array<{ heading: string; body: string[] }>;
}): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | Compliance Radar</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #070707;
      --panel: #131313;
      --text: #f5f5f7;
      --muted: #b4b4ba;
      --line: rgba(255,255,255,0.08);
      --accent: #2997ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(41,151,255,0.16), transparent 30%),
        var(--bg);
      color: var(--text);
    }
    main {
      max-width: 900px;
      margin: 0 auto;
      padding: 72px 24px 96px;
    }
    h1 {
      font-size: clamp(36px, 6vw, 56px);
      margin: 0 0 18px;
      letter-spacing: -0.03em;
    }
    p {
      color: var(--muted);
      line-height: 1.7;
      font-size: 16px;
    }
    section {
      margin-top: 28px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 28px;
    }
    h2 {
      margin: 0 0 14px;
      font-size: 22px;
    }
    ul {
      margin: 0;
      padding-left: 20px;
      color: var(--muted);
      line-height: 1.8;
    }
    a {
      color: var(--accent);
      text-decoration: none;
    }
  </style>
</head>
<body>
  <main>
    <p><a href="/">返回首页</a></p>
    <h1>${title}</h1>
    <p>${intro}</p>
    ${sections
      .map(
        (section) => `
      <section>
        <h2>${section.heading}</h2>
        <ul>${section.body.map((item) => `<li>${item}</li>`).join("")}</ul>
      </section>`
      )
      .join("")}
  </main>
</body>
</html>`;
}
