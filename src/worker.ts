import { Hono, type Context, type Next } from "hono";
import { analyzeWithLlm, isLlmEnabled, type LlmEnv } from "./llm";
import { buildRuleBasedReport, scanRules, type RiskItem, type ScanReport } from "./rule-engine";
import { isScanMode, listRulepacks, type ScanMode } from "./rules";

type Bindings = LlmEnv & {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME?: string;
  MAX_UPLOAD_MB?: string;
  DEFAULT_USE_LLM?: string;
  ADMIN_API_KEY?: string;
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
}

const ALLOWED_UPLOADS = [".txt", ".md"];
const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/api/v1/meta", (c) =>
  c.json({
    app_name: c.env.APP_NAME || "Compliance Radar",
    llm_enabled: isLlmEnabled(c.env),
    max_upload_mb: maxUploadMb(c.env),
    allowed_uploads: ALLOWED_UPLOADS,
    rulepacks: listRulepacks()
  })
);

app.get("/docs", (c) => c.html(renderDocs()));
app.get("/redoc", (c) => c.html(renderDocs()));

app.use("/api/v1/jobs/*", requireApiKey);
app.use("/api/v1/jobs", requireApiKey);
app.use("/api/v1/scan/*", requireApiKey);

app.get("/api/v1/jobs", async (c) => {
  const limit = clamp(Number(c.req.query("limit") || 15), 1, 100);
  const { results } = await c.env.DB.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").bind(limit).all<JobRow>();
  return c.json(results.map(serializeJob));
});

app.get("/api/v1/jobs/:job_id", async (c) => {
  const job = await findJob(c.env.DB, c.req.param("job_id"));
  if (!job) {
    return c.json({ detail: "Job not found" }, 404);
  }
  return c.json(serializeJob(job));
});

app.post("/api/v1/scan/text", async (c) => {
  const payload = await readJsonPayload(c.req.raw);
  const validation = validateTextPayload(payload);
  if ("error" in validation) {
    return c.json({ detail: validation.error }, validation.status);
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
  await insertCompletedJob(c.env.DB, {
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
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ detail: "file is required" }, 400);
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
  await insertCompletedJob(c.env.DB, {
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

export default app;

async function requireApiKey(c: Context<{ Bindings: Bindings }>, next: Next) {
  const expected = c.env.ADMIN_API_KEY?.trim();
  if (expected && c.req.header("X-API-Key") !== expected) {
    return c.json({ detail: "Invalid or missing API key" }, 401);
  }
  await next();
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
  db: D1Database,
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
  await db
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
      input.inputText,
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
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    file_name: row.file_name,
    error_message: row.error_message,
    input_method: row.input_method,
    result: row.result_json ? (JSON.parse(row.result_json) as ScanReport) : null
  };
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
  | { payload: { mode: ScanMode; text: string; title: string | null; use_llm?: unknown } }
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
      use_llm: payload.use_llm
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

function renderDocs(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Compliance Radar API</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f5f0e8;color:#122321}
    main{max-width:920px;margin:0 auto;padding:48px 24px}
    h1{font-size:40px;margin:0 0 12px}
    code{background:#fff;border:1px solid #ded6c8;border-radius:8px;padding:2px 6px}
    section{background:#fff;border:1px solid #ded6c8;border-radius:20px;padding:24px;margin:18px 0}
    li{margin:10px 0}
    a{color:#1f6f62}
  </style>
</head>
<body>
  <main>
    <h1>Compliance Radar API</h1>
    <p>Cloudflare Worker 版本保留核心扫描接口，适合网站和 agent 调用。</p>
    <section>
      <h2>Endpoints</h2>
      <ul>
        <li><code>GET /health</code> 健康检查。</li>
        <li><code>GET /api/v1/meta</code> 站点配置、规则包、上传类型。</li>
        <li><code>GET /api/v1/jobs?limit=15</code> 最近任务。</li>
        <li><code>GET /api/v1/jobs/:job_id</code> 单个任务详情。</li>
        <li><code>POST /api/v1/scan/text</code> 文本扫描，JSON: <code>{ mode, text, title?, use_llm? }</code>。</li>
        <li><code>POST /api/v1/scan/file</code> txt/md 文件扫描，FormData: <code>file, mode, title?, use_llm?</code>。</li>
      </ul>
    </section>
    <section>
      <h2>Auth</h2>
      <p>如果配置了 <code>ADMIN_API_KEY</code>，任务和扫描接口需要请求头 <code>X-API-Key</code>。</p>
    </section>
    <p><a href="/">返回网站首页</a></p>
  </main>
</body>
</html>`;
}
