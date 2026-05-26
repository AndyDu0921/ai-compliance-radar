import type { RiskItem } from "./rule-engine";
import type { ScanMode, Severity } from "./rules";
import type { LlmEnv } from "./types";

interface LlmRiskPayload {
  title?: unknown;
  severity?: unknown;
  category?: unknown;
  excerpt?: unknown;
  explanation?: unknown;
  suggestion?: unknown;
  confidence?: unknown;
}

interface LlmPayload {
  summary?: unknown;
  risk_score_adjustment?: unknown;
  risks?: unknown;
  rewrite_suggestions?: unknown;
  needs_human_review?: unknown;
}

export function isLlmEnabled(env: LlmEnv): boolean {
  return Boolean(env.LLM_API_KEY && env.LLM_BASE_URL && env.LLM_MODEL);
}

export async function analyzeWithLlm({
  env,
  mode,
  text,
  deterministicHits
}: {
  env: LlmEnv;
  mode: ScanMode;
  text: string;
  deterministicHits: RiskItem[];
}): Promise<{
  llmItems: RiskItem[];
  llmUsed: boolean;
  riskScoreAdjustment: number;
  llmSummary?: string;
  rewriteSuggestions: string[];
  humanReview: string[];
}> {
  if (!isLlmEnabled(env)) {
    return { llmItems: [], llmUsed: false, riskScoreAdjustment: 0, rewriteSuggestions: [], humanReview: [] };
  }

  const endpoint = `${env.LLM_BASE_URL!.replace(/\/+$/, "")}/chat/completions`;
  // Workers paid plan: 30s CPU wall time, but fetch I/O is not CPU-bound. 60s is safe.
  const timeoutSeconds = Math.max(5, Math.min(Number(env.LLM_TIMEOUT_SECONDS || 50), 60));
  const timeoutMs = timeoutSeconds * 1000;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.LLM_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        temperature: 0,
        max_tokens: 2048,
        messages: [
          {
            role: "system",
            content:
              "你是一位严谨的合规分析师。请仅输出合法 JSON，不要使用 markdown 代码块。永远不要声称具有法律确定性。"
          },
          {
            role: "user",
            content: buildPrompt({ mode, text, deterministicHits })
          }
        ]
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`LLM request timed out after ${timeoutSeconds}s`);
    }
    throw new Error(
      `LLM request failed: ${error instanceof Error ? error.message : "network error"}`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `LLM request failed with status ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`
    );
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM response did not include message content");
  }

  const payload = parseJsonObject(content);
  return {
    llmItems: normalizeLlmRisks(payload),
    llmUsed: true,
    riskScoreAdjustment: normalizeNumber(payload.risk_score_adjustment, 0, -10, 20),
    llmSummary: typeof payload.summary === "string" ? payload.summary : undefined,
    rewriteSuggestions: normalizeStringArray(payload.rewrite_suggestions, 3),
    humanReview: normalizeStringArray(payload.needs_human_review, 3)
  };
}

function buildPrompt({
  mode,
  text,
  deterministicHits
}: {
  mode: ScanMode;
  text: string;
  deterministicHits: RiskItem[];
}): string {
  const serializedHits = deterministicHits.slice(0, 12).map((item) => ({
    title: item.title,
    severity: item.severity,
    category: item.category,
    excerpt: item.excerpt,
    explanation: item.explanation,
    suggestion: item.suggestion
  }));
  return `
任务：
审查以下内容，返回严格的 JSON 对象，包含以下字段：
- summary: 字符串，用中文总结风险概况
- risk_score_adjustment: -10 到 20 的整数
- risks: 数组，每项含 title/severity/category/excerpt/explanation/suggestion/confidence（全部用中文）
- rewrite_suggestions: 短字符串数组，用中文给出改写建议
- needs_human_review: 短字符串数组，列出需要人工复核的要点

要求：
- mode = ${mode}
- 风险项控制在 3 到 8 条。
- severity 必须是 critical/high/medium/low/info 之一。
- 除非百分百确定，否则不要引用具体法律条文编号。
- 这是辅助工具，不是律师事务所，保持审慎。

已检出的规则匹配项：
${JSON.stringify(serializedHits)}

待审内容：
${text.slice(0, 8000)}
`.trim();
}

function normalizeLlmRisks(payload: LlmPayload): RiskItem[] {
  if (!Array.isArray(payload.risks)) {
    return [];
  }
  return payload.risks.slice(0, 8).map((raw, index) => {
    const item = raw as LlmRiskPayload;
    return {
      id: `llm-${index + 1}`,
      title: normalizeString(item.title, "潜在风险"),
      severity: normalizeSeverity(item.severity),
      category: normalizeString(item.category, "AI审查"),
      excerpt: normalizeString(item.excerpt, ""),
      explanation: normalizeString(item.explanation, ""),
      suggestion: normalizeString(item.suggestion, ""),
      source: "llm",
      confidence: normalizeNumber(item.confidence, 0.65, 0, 1),
      references: ["AI 辅助审查"]
    };
  });
}

function parseJsonObject(raw: string): LlmPayload {
  let candidate = raw.trim();
  if (candidate.startsWith("```")) {
    candidate = candidate.replace(/^```[a-zA-Z]*/, "").trim().replace(/```$/, "").trim();
  }
  if (!candidate.startsWith("{")) {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (match) {
      candidate = match[0];
    }
  }

  // Try parsing directly first
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as LlmPayload;
    }
  } catch {
    // fall through to recovery
  }

  // Attempt recovery: close unterminated strings and structures
  const recovered = recoverTruncatedJson(candidate);
  const parsed = JSON.parse(recovered) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM 返回的不是有效的 JSON 对象");
  }
  return parsed as LlmPayload;
}

function recoverTruncatedJson(raw: string): string {
  let s = raw;
  // Close unterminated string: find last unescaped quote
  let inString = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
    }
    i++;
  }
  if (inString) {
    s = s + '"'; // Safe: this may create a valid string end
  }

  // Count brackets and close them
  let depth = 0;
  for (const ch of s) {
    if (ch === "{" || ch === "[") depth++;
    if (ch === "}" || ch === "]") depth--;
  }
  while (depth > 0) {
    if (s.lastIndexOf('"') > s.lastIndexOf("}") && s.lastIndexOf('"') > s.lastIndexOf("]")) {
      s = s + "}"; // best guess
    } else {
      s = s + "}";
    }
    depth--;
  }

  return s;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim())
    .slice(0, limit);
}

function normalizeSeverity(value: unknown): Severity {
  const candidate = String(value || "medium").toLowerCase();
  return candidate === "critical" ||
    candidate === "high" ||
    candidate === "medium" ||
    candidate === "low" ||
    candidate === "info"
    ? candidate
    : "medium";
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}
