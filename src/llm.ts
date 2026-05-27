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
  const modeName = mode === "ad_copy" ? "广告文案" : "合同条款";
  const modeGuidance = mode === "ad_copy"
    ? `广告文案审查要点：
- 绝对化用语（第一、唯一、最好、国家级、100%等）
- 保证性承诺（包过、保证、无效退款、稳赚等）
- 虚假权威背书（专家推荐、央视认证、博士团队等）
- 医疗/金融/教育敏感宣称
- 价格欺诈（全网最低、底价、独家等）
- 虚假紧迫感（最后一天、马上恢复原价等）
- 缺乏广告标识（种草、推荐、分享等软文未标注）`
    : `合同审查要点：
- 单方控制权（单方修改、单方解约、最终解释权归属）
- 责任失衡（无限责任、宽泛免责、违约金不对等）
- 知识产权归属（全额转让、背景技术权属不清）
- 付款与交付（不可退款、验收标准由单方决定）
- 争议解决（管辖地不公、无仲裁条款）
- 保密与数据保护（缺失或过于单薄）
- 条款缺失（验收标准、违约责任上限、保密期限等空白）`;

  return `你是一位资深中国法律合规顾问，拥有10年以上广告法与合同法的实务经验。你的任务是深度审查以下${modeName}内容，输出一份专业的风险分析报告。

=== 审查框架 ===
${modeGuidance}

=== 已由规则引擎检出（勿重复） ===
${JSON.stringify(serializedHits)}

=== 待审内容 ===
${text.slice(0, 8000)}

=== 输出要求 ===
请严格输出以下 JSON 结构（全部字段用中文）：

{
  "summary": "100-200字的综合评估，内容包括：(1)整体风险等级判断 (2)最突出的2-3个问题 (3)对乙方的总体建议。语气专业但易懂。",
  "risk_score_adjustment": 整数（-10到20），基于你发现的额外风险程度打分,
  "risks": [
    {
      "title": "简明扼要的风险标题（15字以内）",
      "severity": "critical/high/medium/low/info",
      "category": "风险类别（如：单方控制、赔偿责任、知识产权、缺失条款等）",
      "excerpt": "从原文中截取的具体风险语句（30字以内）",
      "explanation": "为什么这是风险，对哪一方不利，可能的法律后果（50-80字）",
      "suggestion": "具体的修改建议，最好给出改写范例（50-80字）",
      "confidence": 0.5到1.0之间的置信度
    }
  ],
  "rewrite_suggestions": ["具体改写建议1", "具体改写建议2", "具体改写建议3"],
  "needs_human_review": ["必须由人工法务确认的要点1", "要点2", "要点3"]
}

=== 重要提醒 ===
- risks 控制在3-6条，只列出最关键的，不要凑数
- summary 和 suggestion 要具体，不要用"需注意""可能存在风险"这种空话
- 如果内容本身风险较低，可以打低分，不要硬凑高风险
- 不给具体法条编号，但可提及相关法规领域（如"广告法""民法典"等）
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
