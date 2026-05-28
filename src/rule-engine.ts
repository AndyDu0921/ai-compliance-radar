import { RULEPACKS, type ScanMode, type Severity } from "./rules";

export interface RiskItem {
  id: string;
  title: string;
  severity: Severity;
  category: string;
  excerpt: string;
  explanation: string;
  suggestion: string;
  source: "rule" | "llm";
  confidence: number;
  references: string[];
}

export interface MissingProtection {
  title: string;
  urgency: "critical" | "important" | "recommended";
  explanation: string;
  suggested_clause: string;
}

export interface CompletenessScore {
  category: string;
  score: number;
  note: string;
}

export interface PoisonPill {
  location: string;
  technique: string;
  description: string;
}

export interface ScanReport {
  job_id: string;
  title: string | null;
  mode: ScanMode;
  risk_score: number;
  risk_grade: string;
  summary: string;
  signing_recommendation: string;
  recommended_actions: string[];
  risk_items: RiskItem[];
  warnings: string[];
  llm_used: boolean;
  deterministic_hit_count: number;
  missing_protections: MissingProtection[];
  completeness_scores: CompletenessScore[];
  poison_pills: PoisonPill[];
  metadata: Record<string, unknown>;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 24,
  high: 15,
  medium: 8,
  low: 3,
  info: 1
};

export function scanRules({ mode, text }: { mode: ScanMode; text: string }): RiskItem[] {
  const findings: RiskItem[] = [];
  const seen = new Set<string>();

  for (const rule of RULEPACKS[mode]) {
    const expression = new RegExp(rule.pattern, "gimu");
    for (const match of text.matchAll(expression)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const excerpt = buildExcerpt(text, start, end);
      const dedupeKey = `${rule.id}:${excerpt}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      findings.push({
        id: rule.id,
        title: rule.title,
        severity: rule.severity,
        category: rule.category,
        excerpt,
        explanation: rule.explanation,
        suggestion: rule.suggestion,
        source: "rule",
        confidence: 0.92,
        references: rule.references
      });
    }
  }

  return findings.sort((left, right) => SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity]);
}

export function scoreFindings(findings: RiskItem[]): number {
  const baseScore = findings.reduce((sum, item) => sum + SEVERITY_WEIGHTS[item.severity], 0);

  // Compound risk: multiple critical/high findings in the same category
  const categoryCounts = new Map<string, number>();
  for (const item of findings) {
    if (item.severity === "critical" || item.severity === "high") {
      categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
    }
  }
  let compoundBonus = 0;
  for (const [, count] of categoryCounts) {
    if (count >= 3) compoundBonus += 10; // 3+ findings in same category = systemic risk
    else if (count >= 2) compoundBonus += 5; // 2 findings = related risk
  }

  // Composite risk patterns
  const categories = new Set(findings.map((f) => f.category));
  if (categories.has("单方控制") && categories.has("赔偿责任")) compoundBonus += 8;
  if (categories.has("赔偿责任") && categories.has("付款与退款")) compoundBonus += 5;
  if (categories.has("知识产权") && categories.has("保密与数据")) compoundBonus += 5;
  if (categories.has("虚假或误导") && categories.has("医疗敏感")) compoundBonus += 10;
  if (categories.has("虚假或误导") && categories.has("金融敏感")) compoundBonus += 10;

  return Math.min(100, baseScore + compoundBonus);
}

export function buildRuleBasedReport({
  jobId, mode, text, deterministicHits, title, sourceName,
  llmItems = [], llmUsed = false, riskScoreAdjustment = 0,
  llmSummary, rewriteSuggestions = [], humanReview = [], llmWarning,
  missingProtections = [], completenessScores = [], poisonPills = [],
  signingRecommendation
}: {
  jobId: string; mode: ScanMode; text: string;
  deterministicHits?: RiskItem[]; title: string | null; sourceName?: string | null;
  llmItems?: RiskItem[]; llmUsed?: boolean; riskScoreAdjustment?: number;
  llmSummary?: string; rewriteSuggestions?: string[]; humanReview?: string[];
  llmWarning?: string;
  missingProtections?: MissingProtection[];
  completenessScores?: CompletenessScore[];
  poisonPills?: PoisonPill[];
  signingRecommendation?: string;
}): ScanReport {
  const normalized = text.trim();
  const ruleHits = deterministicHits ?? scanRules({ mode, text: normalized });
  const combined = mergeFindings(ruleHits, llmItems);
  let riskScore = Math.min(100, scoreFindings(ruleHits) + Math.max(0, riskScoreAdjustment));
  if (llmItems.length) {
    riskScore = Math.min(100, Math.max(riskScore, scoreFindings(combined)));
  }

  const riskGrade = computeRiskGrade(riskScore);
  const recommendation = signingRecommendation || computeSigningRecommendation(riskScore, missingProtections, poisonPills);

  const warnings = [
    "本工具提供的是风险初筛报告，不构成正式法律意见。",
    "高风险或关键业务文档仍需由具备资质的专业人士复核。"
  ];
  if (llmWarning) warnings.push(llmWarning);
  for (const item of humanReview.slice(0, 3)) warnings.push(`建议人工复核：${item}`);

  return {
    job_id: jobId, title: title || sourceName || null, mode,
    risk_score: riskScore,
    risk_grade: riskGrade,
    summary: llmSummary || buildSummary({ mode, findings: combined }),
    signing_recommendation: recommendation,
    recommended_actions: recommendActions({ mode, findings: combined, rewriteSuggestions, missingProtections }),
    risk_items: combined, warnings, llm_used: llmUsed,
    deterministic_hit_count: ruleHits.length,
    missing_protections: missingProtections,
    completeness_scores: completenessScores,
    poison_pills: poisonPills,
    metadata: {
      source_name: sourceName ?? null,
      content_length: normalized.length,
      severity_breakdown: severityBreakdown(combined)
    }
  };
}

function computeRiskGrade(score: number): string {
  if (score >= 90) return "F — 严重风险";
  if (score >= 70) return "D — 高风险";
  if (score >= 50) return "C — 中高风险";
  if (score >= 30) return "B — 中等风险";
  return "A — 低风险";
}

function computeSigningRecommendation(
  score: number,
  missing: MissingProtection[],
  pills: PoisonPill[]
): string {
  const criticalMissing = missing.filter(m => m.urgency === "critical").length;
  if (score >= 90 || pills.length >= 2) return "建议拒绝签署";
  if (score >= 70 || criticalMissing >= 3) return "升级法务深度审查";
  if (score >= 40 || criticalMissing >= 1) return "谈判修改后签署";
  return "风险较低，可签署";
}

function buildExcerpt(text: string, start: number, end: number, radius = 32): string {
  const left = Math.max(0, start - radius);
  const right = Math.min(text.length, end + radius);
  return text.slice(left, right).replace(/\n/g, " ").trim();
}

function mergeFindings(ruleItems: RiskItem[], llmItems: RiskItem[]): RiskItem[] {
  const output = [...ruleItems];
  const existing = new Set(output.map((item) => `${item.title}:${item.excerpt}`));
  for (const item of llmItems) {
    const key = `${item.title}:${item.excerpt}`;
    if (!existing.has(key)) {
      output.push(item);
      existing.add(key);
    }
  }
  return output.sort((left, right) => {
    const severityDelta = SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity];
    return severityDelta || right.confidence - left.confidence;
  });
}

function buildSummary({ mode, findings }: { mode: ScanMode; findings: RiskItem[] }): string {
  const modeLabel = mode === "ad_copy" ? "广告文案" : "合同条款";
  if (!findings.length) {
    return (
      "未检测到明显的规则违规项。这通常意味着内容通过了第一轮筛查，但并不意味着完全没有法律风险，建议仍需人工复核。"
    );
  }
  const severity = severityBreakdown(findings);
  const categories = topCategories(findings)
    .map(([category]) => category)
    .join("、");
  const severityCN = Object.entries(severity)
    .map(([k, v]) => `${severityLabel(k)}${v}条`)
    .join("，");
  return `在${modeLabel}模式下检测到 ${findings.length} 个潜在风险项。严重程度分布：${severityCN}。主要风险类别：${categories}。`;
}

function severityLabel(s: string): string {
  const map: Record<string, string> = { critical: "严重", high: "高", medium: "中", low: "低", info: "提示" };
  return map[s] || s;
}

function recommendActions({
  mode, findings, rewriteSuggestions, missingProtections = []
}: {
  mode: ScanMode; findings: RiskItem[]; rewriteSuggestions: string[];
  missingProtections?: MissingProtection[];
}): string[] {
  const actions =
    mode === "ad_copy"
      ? [
          "删除无法证实的绝对化承诺、保证性用语或权威背书。",
          "将风险性措辞替换为可量化、可验证的客观描述。",
          "涉及医疗、金融、教育、直播带货等内容，发布前需进行人工合规复核。"
        ]
      : [
          "对单方解约、退款、赔偿、管辖权等条款进行人工复核。",
          "以清晰易懂的语言明确付款、交付、保密及知识产权归属条款。",
          "对赋予单方宽泛控制权的条款，添加谈判备注或修改建议。"
        ];

  for (const item of findings.slice(0, 5)) {
    if (item.suggestion && !actions.includes(item.suggestion)) {
      actions.push(item.suggestion);
    }
  }
  for (const suggestion of rewriteSuggestions.slice(0, 3)) {
    if (suggestion && !actions.includes(suggestion)) actions.push(suggestion);
  }
  for (const mp of missingProtections.filter(m => m.urgency === "critical").slice(0, 3)) {
    const action = `缺失条款：${mp.title} — ${mp.explanation}`;
    if (!actions.includes(action)) actions.push(action);
  }
  return actions.slice(0, 8);
}

function severityBreakdown(findings: RiskItem[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((counts, item) => {
    counts[item.severity] = (counts[item.severity] || 0) + 1;
    return counts;
  }, {});
}

function topCategories(findings: RiskItem[]): Array<[string, number]> {
  const counts = findings.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);
}
