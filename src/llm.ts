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
        max_tokens: 3072,
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
    excerpt: item.excerpt, explanation: item.explanation, suggestion: item.suggestion
  }));

  const contractSection = `
## 合同审查框架

### 风险评分体系（每条风险用4因子打分）
- severity（危害严重度）：1-10分。该风险一旦触发，对乙方的影响程度。1=轻微不便，10=公司存亡级别威胁
- likelihood（触发可能性）：1-10分。该风险实际发生的概率。1=极小概率，10=近乎必然
- financial（财务敞口）：1-10分。该风险一旦触发带来的财务损失。1=<1万元，10=>100万元或无上限
- asymmetry（不对称程度）：1-10分。条款偏向甲方的程度。1=完全对等，10=完全单方
- composite（综合分）= severity×0.40 + likelihood×0.25 + financial×0.20 + asymmetry×0.15，四舍五入取整

### 缺失条款检测（17项通用保护检查清单）
逐一检查以下条款是否存在、是否完整：
| 保护条款 | 检查要点 |
| 赔偿上限 | 是否约定了最高赔偿金额？ |
| 间接损失排除 | 是否排除了间接/附带/结果性损失？ |
| 不可抗力 | 是否定义了不可抗力及后果？ |
| 争议解决 | 是否约定了协商/仲裁/诉讼路径？ |
| 通知条款 | 是否约定了通知方式/送达标准？ |
| 可分割性 | 是否有可分割性条款？ |
| 完整协议 | 是否有整合/完整协议条款？ |
| 转让限制 | 是否限制未经同意的合同转让？ |
| 管辖法律 | 是否明确了适用法律？ |
| 弃权条款 | 是否约定了不弃权声明？ |
| 保密义务 | 是否约定了保密范围和期限？ |
| 存续条款 | 是否约定了终止后存续的义务？ |
| 修改程序 | 是否约定了合同修改需书面双方确认？ |
| 赔偿上限 | 赔偿是否有明确数额上限？ |
| 解约通知期 | 是否有合理的解约通知期限？ |
| 数据保护 | 涉及用户数据时是否有DPA条款？ |
| 验收标准 | 是否有客观的交付验收标准？ |
若缺失，列为 missing_protections，urgency=critical(核心条款)/important(重要)/recommended(最佳实践)。

### 毒丸条款检测
识别以下三类隐蔽风险：
- 结构性隐藏：重要条款藏在附录/定义中而非正文
- 语言红旗："无论前述任何相反规定""单方完全自主决定""包括但不限于""随时修改无需通知"
- 行为模式：伪互惠条款（看似公平实则不对等）；赔偿例外条款架空赔偿上限；以引用方式纳入可单方变更的外部文件

### 完整度评分
对以下类别逐项给出0-5分（0=完全缺失，3=存在但模糊，5=详细且含具体救济措施）：
保密条款、知识产权归属、赔偿责任、合同解除、争议解决、交付与验收、付款条款
`;

  const adSection = `
## 广告文案审查框架

### 风险评分体系（每条风险用4因子打分）
- severity（危害严重度）：1-10分。违反后可能面临的处罚力度。1=轻微不合规，10=可能面临100万+罚款或停业
- likelihood（触发可能性）：1-10分。被监管/平台发现的概率。1=极小概率，10=高风险领域近乎必然
- financial（财务敞口）：1-10分。罚款+赔偿+商誉损失的金额级别。1=<1万，10=>100万
- asymmetry（不对称程度）：1-10分。宣称与事实的差距。1=可证实，10=完全虚假

### 缺失要素检测
检查广告文案是否缺少：
- 广告标识（是否为软文但未标注"广告"）
- 风险提示（金融/投资类是否附带风险声明）
- 数据来源（引用的数据是否有出处）
- 免责声明（效果类宣称是否有"因人而异"提示）

### 文案分类判断（每条风险输出一个判定）
- needs_substantiation（需要证明）：宣称需要数据/第三方报告支撑
- needs_reframing（需要改写）：措辞有误导风险但可修改
- needs_cutting（需要删除）：完全不能用的表述，必须删除
`;

  const framework = mode === "ad_copy" ? adSection : contractSection;

  return `你是一位资深中国法律合规顾问。深度审查以下${modeName}内容，输出专业风险分析报告。

${framework}

=== 已由规则引擎检出（请勿重复这些项） ===
${JSON.stringify(serializedHits)}

=== 待审内容 ===
${text.slice(0, 8000)}

=== 输出JSON结构 ===
{
  "summary": "150-250字综合评估。包含：(1)整体风险等级 (2)最突出的2-3个问题 (3)对内容发布方/乙方的核心建议",
  "risk_score_adjustment": 整数-10到20,
  "risks": [
    {
      "title": "风险标题（15字内）",
      "severity": "critical/high/medium/low/info",
      "category": "风险类别",
      "excerpt": "原文摘录（30字内）",
      "explanation": "风险分析（50-80字）",
      "suggestion": "修改建议（50-80字）",
      "confidence": 0.5-1.0,
      "severity_breakdown": {"severity": 1-10, "likelihood": 1-10, "financial": 1-10, "asymmetry": 1-10}
    }
  ],
  "missing_protections": [
    {"title": "缺失条款名称", "urgency": "critical/important/recommended", "explanation": "为什么需要", "suggested_clause": "建议条款文本（可直接插入合同）"}
  ],
  "completeness_scores": [
    {"category": "类别名", "score": 0-5, "note": "评分说明"}
  ],
  "poison_pills": [
    {"location": "条款位置", "technique": "隐藏手法", "description": "为什么是毒丸"}
  ],
  "rewrite_suggestions": ["改写建议1", "改写建议2", "改写建议3"],
  "needs_human_review": ["人工复核要点1", "要点2", "要点3"],
  "signing_recommendation": "可签署/谈判修改/升级法务/建议拒绝"
}

=== 重要提醒 ===
- 每条风险必须给出 severity_breakdown 四个维度分
- missing_protections 只列真正缺失的，不要列已存在的
- poison_pills 只列隐蔽的高危项，不要列明显的规则匹配项
- severity_breakdown 中 composite>=7 的风险项，severity 应标记为 critical
- signing_recommendation 要结合缺失条款、毒丸、风险综合判断
- 如果内容本身风险较低，诚实打低分，不要硬凑
- 不给具体法条编号，可提及法规领域
`.trim();
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
