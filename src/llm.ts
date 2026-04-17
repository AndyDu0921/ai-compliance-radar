import type { RiskItem, ScanReport } from "./rule-engine";
import type { ScanMode, Severity } from "./rules";

export interface LlmEnv {
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_TIMEOUT_SECONDS?: string;
}

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
  const timeoutMs = Math.max(5, Number(env.LLM_TIMEOUT_SECONDS || 60)) * 1000;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LLM_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You are a careful compliance analyst. Respond with valid JSON only. Do not use markdown fences. Never claim legal certainty."
        },
        {
          role: "user",
          content: buildPrompt({ mode, text, deterministicHits })
        }
      ]
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`LLM request failed with status ${response.status}`);
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
    riskScoreAdjustment: normalizeNumber(payload.risk_score_adjustment, 0, 0, 20),
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
Task:
Review the following content and return a strict JSON object with these keys:
- summary: string
- risk_score_adjustment: integer between 0 and 20
- risks: array of objects with keys title, severity, category, excerpt, explanation, suggestion, confidence
- rewrite_suggestions: array of short strings
- needs_human_review: array of short strings

Constraints:
- mode = ${mode}
- Keep 3 to 8 risks maximum.
- Severity must be one of critical/high/medium/low/info.
- Never cite article numbers unless you are certain; generic compliance references are allowed.
- This is an assistant, not a law firm. Be cautious.

Deterministic findings already detected:
${JSON.stringify(serializedHits)}

Content to review:
${text.slice(0, 14000)}
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
      title: normalizeString(item.title, "Potential issue"),
      severity: normalizeSeverity(item.severity),
      category: normalizeString(item.category, "llm_review"),
      excerpt: normalizeString(item.excerpt, ""),
      explanation: normalizeString(item.explanation, ""),
      suggestion: normalizeString(item.suggestion, ""),
      source: "llm",
      confidence: normalizeNumber(item.confidence, 0.65, 0, 1),
      references: ["LLM assisted review"]
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
  const parsed = JSON.parse(candidate) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM payload is not an object");
  }
  return parsed as LlmPayload;
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
