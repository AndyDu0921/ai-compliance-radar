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
  severity_breakdown?: unknown;
}

export interface LlmPayload {
  summary?: unknown;
  risk_score_adjustment?: unknown;
  risks?: unknown;
  rewrite_suggestions?: unknown;
  needs_human_review?: unknown;
  missing_protections?: unknown;
  completeness_scores?: unknown;
  poison_pills?: unknown;
  signing_recommendation?: unknown;
}

export interface MissingProtection {
  title: string;
  urgency: "critical" | "important" | "recommended";
  explanation: string;
  suggested_clause: string;
}

export interface CompletenessScore {
  category: string;
  score: number; // 0-5
  note: string;
}

export interface PoisonPill {
  location: string;
  technique: string;
  description: string;
}

export interface LlmResult {
  llmItems: RiskItem[];
  llmUsed: boolean;
  riskScoreAdjustment: number;
  llmSummary?: string;
  rewriteSuggestions: string[];
  humanReview: string[];
  missingProtections: MissingProtection[];
  completenessScores: CompletenessScore[];
  poisonPills: PoisonPill[];
  signingRecommendation?: string;
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
}): Promise<LlmResult> {
  const empty = { llmItems: [], llmUsed: false, riskScoreAdjustment: 0, rewriteSuggestions: [], humanReview: [], missingProtections: [], completenessScores: [], poisonPills: [] };

  if (!isLlmEnabled(env)) return empty;

  const endpoint = `${env.LLM_BASE_URL!.replace(/\/+$/, "")}/chat/completions`;
  const timeoutSeconds = 120;
  const timeoutMs = timeoutSeconds * 1000;

  const systemPrompt = `你是中国法律合规顾问。任务：分析合同或广告文案的法律合规风险。你必须以严格的JSON格式返回分析结果。禁止输出markdown代码块、解释文字或任何非JSON内容。`;

  const apiKey = env.LLM_API_KEY!;
  const llmModel = env.LLM_MODEL!;

  // Retry wrapper for DeepSeek empty-content bug
  const maxRetries = 2;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await callLlm({
        endpoint, apiKey, timeoutMs, systemPrompt, model: llmModel, mode, text, deterministicHits
      });
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.message.includes("未返回消息内容") && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError!;
}

async function callLlm({
  endpoint, apiKey, timeoutMs, systemPrompt, model, mode, text, deterministicHits
}: {
  endpoint: string; apiKey: string; timeoutMs: number; systemPrompt: string; model: string;
  mode: ScanMode; text: string; deterministicHits: RiskItem[];
}): Promise<LlmResult> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 1.0,
        top_p: 1.0,
        max_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildPrompt({ mode, text, deterministicHits }) }
        ]
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("LLM 请求超时（120秒）");
    }
    throw new Error(`LLM 请求失败: ${error instanceof Error ? error.message : "网络错误"}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LLM 返回错误 ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }, finish_reason?: string }>
  };
  const choice = data.choices?.[0];

  if (choice?.finish_reason === "length") {
    throw new Error("LLM 输出被截断（finish_reason=length），已回退到规则引擎");
  }
  if (choice?.finish_reason === "insufficient_system_resource") {
    throw new Error("DeepSeek 服务器资源不足，已回退到规则引擎");
  }

  const content = choice?.message?.content;
  if (!content) throw new Error("LLM 未返回消息内容");

  let payload: LlmPayload;
  try {
    payload = parseJsonObject(content);
  } catch (firstError) {
    try {
      const cleaned = content.replace(/,\s*([}\]])/g, "$1").replace(/,\s*,/g, ",");
      payload = parseJsonObject(cleaned);
    } catch {
      throw firstError;
    }
  }

  return {
    llmItems: normalizeLlmRisks(payload),
    llmUsed: true,
    riskScoreAdjustment: normalizeNumber(payload.risk_score_adjustment, 0, -10, 20),
    llmSummary: typeof payload.summary === "string" ? payload.summary : undefined,
    rewriteSuggestions: normalizeStringArray(payload.rewrite_suggestions, 3),
    humanReview: normalizeStringArray(payload.needs_human_review, 3),
    missingProtections: normalizeMissingProtections(payload.missing_protections),
    completenessScores: normalizeCompletenessScores(payload.completeness_scores),
    poisonPills: normalizePoisonPills(payload.poison_pills),
    signingRecommendation: typeof payload.signing_recommendation === "string" ? payload.signing_recommendation : undefined
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
  const modeName = mode === "ad_copy" ? "广告文案" : "合同条款";
  // Only pass rule IDs to save tokens
  const hitIds = deterministicHits.map(r => r.id).join(", ") || "无";

  const guide = mode === "ad_copy"
    ? "审查重点：绝对化用语、保证性承诺、虚假背书、医疗/金融/教育敏感宣称、价格欺诈、虚假紧迫感、AI虚假人设、缺广告标识"
    : "审查重点：单方控制、赔偿责任失衡、IP归属、退款条款、管辖不公、保密缺失。检查缺失条款：验收标准、赔偿上限、不可抗力、争议解决、数据保护、解约通知等";

  return `分析以下${modeName}，按schema输出JSON:
${guide}
已检出风险ID（勿重复）：${hitIds}
内容：${text.slice(0, 4000)}
JSON schema：
{"summary":"100-150字总评","risk_score_adjustment":-10~20,"risks":[{"title":"","severity":"","category":"","excerpt":"","explanation":"","suggestion":"","confidence":0.5~1}],"missing_protections":[{"title":"","urgency":"critical/important/recommended","explanation":"","suggested_clause":""}],"rewrite_suggestions":[],"needs_human_review":[],"signing_recommendation":"可签署/谈判修改/升级法务/建议拒绝"}
risks和missing_protections各最多3条。`.trim();
}

function normalizeLlmRisks(payload: LlmPayload): RiskItem[] {
  if (!Array.isArray(payload.risks)) return [];
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
      source: "llm" as const,
      confidence: normalizeNumber(item.confidence, 0.65, 0, 1),
      references: ["AI 辅助审查"]
    };
  });
}

function normalizeMissingProtections(value: unknown): MissingProtection[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((raw: unknown) => {
    const item = raw as Record<string, unknown> || {};
    const urgency = String(item.urgency || "important");
    return {
      title: normalizeString(item.title, "未命名"),
      urgency: (urgency === "critical" || urgency === "important" || urgency === "recommended" ? urgency : "important") as MissingProtection["urgency"],
      explanation: normalizeString(item.explanation, ""),
      suggested_clause: normalizeString(item.suggested_clause, "")
    };
  });
}

function normalizeCompletenessScores(value: unknown): CompletenessScore[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((raw: unknown) => {
    const item = raw as Record<string, unknown> || {};
    const score = normalizeNumber(item.score, 0, 0, 5);
    return {
      category: normalizeString(item.category, "未知"),
      score,
      note: normalizeString(item.note, "")
    };
  });
}

function normalizePoisonPills(value: unknown): PoisonPill[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((raw: unknown) => {
    const item = raw as Record<string, unknown> || {};
    return {
      location: normalizeString(item.location, ""),
      technique: normalizeString(item.technique, ""),
      description: normalizeString(item.description, "")
    };
  });
}

// ── JSON parsing (unchanged) ──

function parseJsonObject(raw: string): LlmPayload {
  let candidate = raw.trim();
  if (candidate.startsWith("```")) {
    candidate = candidate.replace(/^```[a-zA-Z]*/, "").trim().replace(/```$/, "").trim();
  }
  if (!candidate.startsWith("{")) {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (match) candidate = match[0];
  }
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as LlmPayload;
  } catch { /* fall through */ }
  const recovered = recoverTruncatedJson(candidate);
  const parsed = JSON.parse(recovered) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM 返回的不是有效的 JSON 对象");
  }
  return parsed as LlmPayload;
}

function recoverTruncatedJson(raw: string): string {
  let s = raw;

  // 1. Close unterminated strings
  let inString = false, i = 0;
  while (i < s.length) {
    if (s[i] === "\\") { i += 2; continue; }
    if (s[i] === '"') inString = !inString;
    i++;
  }
  if (inString) s = s + '"';

  // 2. Remove trailing commas (before ] or })
  s = s.replace(/,\s*\]/g, "]").replace(/,\s*\}/g, "}");

  // 3. Trim incomplete trailing element after last comma
  const lastBrace = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  const lastComma = s.lastIndexOf(",");
  if (lastComma > lastBrace) {
    s = s.slice(0, lastComma);
  }

  // 4. Count and close unmatched brackets
  let depth = 0;
  for (const ch of s) {
    if (ch === "{" || ch === "[") depth++;
    if (ch === "}" || ch === "]") depth--;
  }
  // Close arrays before objects if the last open was an array
  const lastOpen = Math.max(s.lastIndexOf("["), s.lastIndexOf("{"));
  while (depth > 0) {
    if (lastOpen === s.lastIndexOf("[") && depth > 0) {
      s = s + "]"; depth--;
    } else {
      s = s + "}"; depth--;
    }
  }

  return s;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim()).slice(0, limit);
}

function normalizeSeverity(value: unknown): Severity {
  const candidate = String(value || "medium").toLowerCase();
  return candidate === "critical" || candidate === "high" || candidate === "medium" || candidate === "low" || candidate === "info"
    ? candidate : "medium";
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}
