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
              "你是一位拥有10年实务经验的中国法律合规顾问。请仅输出合法JSON，不使用markdown代码块。不声称具有法律确定性。"
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
      throw new Error(`LLM 请求超时（${timeoutSeconds}秒）`);
    }
    throw new Error(`LLM 请求失败: ${error instanceof Error ? error.message : "网络错误"}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LLM 返回错误 ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM 未返回消息内容");

  const payload = parseJsonObject(content);
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
  const serializedHits = deterministicHits.slice(0, 12).map((item) => ({
    title: item.title, severity: item.severity, category: item.category,
    excerpt: item.excerpt
  }));

  const contractGuide = `合同审查要点：单方控制权、赔偿责任失衡、知识产权归属、付款与退款、争议解决、保密与数据保护、条款缺失（验收标准/赔偿上限/不可抗力/争议解决/保密/数据保护/解约通知/转让限制等17项通用保护）。检测毒丸条款（结构性隐藏/语言红旗/伪互惠模式）。`;

  const adGuide = `广告审查要点：绝对化用语、保证性承诺、虚假权威背书、医疗/金融/教育敏感宣称、价格欺诈、虚假紧迫感、AI虚假人设、缺乏广告标识。每条风险给出判定（需证明/需改写/需删除）。`;

  const guide = mode === "ad_copy" ? adGuide : contractGuide;

  return `你是中国法律合规顾问。审查以下${modeName}，只返回JSON（不带markdown代码块）。

审查框架：${guide}
每条LLM发现的风险需包含四维评分：severity(危害度1-10)、likelihood(概率1-10)、financial(财务敞口1-10)、asymmetry(偏袒度1-10)。

已检出（勿重复）：${JSON.stringify(serializedHits)}

内容：${text.slice(0, 6000)}

返回JSON：
{"summary":"100-200字中文总评","risk_score_adjustment":-10~20,"risks":[{"title":"","severity":"","category":"","excerpt":"","explanation":"","suggestion":"","confidence":0.5~1,"severity_breakdown":{"severity":1,"likelihood":1,"financial":1,"asymmetry":1}}],"missing_protections":[{"title":"","urgency":"critical/important/recommended","explanation":"","suggested_clause":""}],"completeness_scores":[{"category":"","score":0~5,"note":""}],"poison_pills":[{"location":"","technique":"","description":""}],"rewrite_suggestions":[],"needs_human_review":[],"signing_recommendation":"可签署/谈判修改/升级法务/建议拒绝"}

risks控制3~5条，不凑数。缺失保护只列真正缺失的。毒丸只列隐蔽高危项。内容低风险就诚实打低分。`.trim();
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
  let inString = false, i = 0;
  while (i < s.length) {
    if (s[i] === "\\") { i += 2; continue; }
    if (s[i] === '"') inString = !inString;
    i++;
  }
  if (inString) s = s + '"';
  let depth = 0;
  for (const ch of s) {
    if (ch === "{" || ch === "[") depth++;
    if (ch === "}" || ch === "]") depth--;
  }
  while (depth > 0) { s = s + "}"; depth--; }
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
