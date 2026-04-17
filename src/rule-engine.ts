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

export interface ScanReport {
  job_id: string;
  title: string | null;
  mode: ScanMode;
  risk_score: number;
  summary: string;
  recommended_actions: string[];
  risk_items: RiskItem[];
  warnings: string[];
  llm_used: boolean;
  deterministic_hit_count: number;
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
  const total = findings.reduce((sum, item) => sum + SEVERITY_WEIGHTS[item.severity], 0);
  return Math.min(100, total);
}

export function buildRuleBasedReport({
  jobId,
  mode,
  text,
  title,
  sourceName,
  llmItems = [],
  llmUsed = false,
  riskScoreAdjustment = 0,
  llmSummary,
  rewriteSuggestions = [],
  humanReview = [],
  llmWarning
}: {
  jobId: string;
  mode: ScanMode;
  text: string;
  title: string | null;
  sourceName?: string | null;
  llmItems?: RiskItem[];
  llmUsed?: boolean;
  riskScoreAdjustment?: number;
  llmSummary?: string;
  rewriteSuggestions?: string[];
  humanReview?: string[];
  llmWarning?: string;
}): ScanReport {
  const normalized = text.trim();
  const deterministicHits = scanRules({ mode, text: normalized });
  const combined = mergeFindings(deterministicHits, llmItems);
  let riskScore = Math.min(100, scoreFindings(deterministicHits) + Math.max(0, riskScoreAdjustment));
  if (llmItems.length) {
    riskScore = Math.min(100, Math.max(riskScore, scoreFindings(combined)));
  }

  const warnings = [
    "This tool provides a risk triage report, not a formal legal opinion.",
    "High-risk or mission-critical documents should still be reviewed by a qualified professional."
  ];
  if (llmWarning) {
    warnings.push(llmWarning);
  }
  for (const item of humanReview.slice(0, 3)) {
    warnings.push(`Human review suggested: ${item}`);
  }

  return {
    job_id: jobId,
    title: title || sourceName || null,
    mode,
    risk_score: riskScore,
    summary: llmSummary || buildSummary({ mode, findings: combined }),
    recommended_actions: recommendActions({ mode, findings: combined, rewriteSuggestions }),
    risk_items: combined,
    warnings,
    llm_used: llmUsed,
    deterministic_hit_count: deterministicHits.length,
    metadata: {
      source_name: sourceName ?? null,
      content_length: normalized.length,
      severity_breakdown: severityBreakdown(combined)
    }
  };
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
  if (!findings.length) {
    return (
      "No obvious rule-based issues were detected. This usually means the content passed the first-pass screen, " +
      "not that it is legally risk-free."
    );
  }
  const severity = severityBreakdown(findings);
  const categories = topCategories(findings)
    .map(([category]) => category)
    .join(", ");
  return `Detected ${findings.length} potential issues for ${mode}. Severity mix: ${JSON.stringify(
    severity
  )}. Main risk clusters: ${categories}.`;
}

function recommendActions({
  mode,
  findings,
  rewriteSuggestions
}: {
  mode: ScanMode;
  findings: RiskItem[];
  rewriteSuggestions: string[];
}): string[] {
  const actions =
    mode === "ad_copy"
      ? [
          "Remove absolute claims, guaranteed outcomes, or authority endorsements that cannot be substantiated.",
          "Replace risky language with factual, measurable, and reviewable descriptions.",
          "For medical, financial, education, or live-commerce copy, run a manual compliance review before publishing."
        ]
      : [
          "Review one-sided termination, refund, liability, and jurisdiction clauses with a human reviewer.",
          "Clarify payment, acceptance, delivery, confidentiality, and IP ownership terms in plain language.",
          "Add negotiation notes for any clause that gives one side broad unilateral control."
        ];

  for (const item of findings.slice(0, 5)) {
    if (item.suggestion && !actions.includes(item.suggestion)) {
      actions.push(item.suggestion);
    }
  }
  for (const suggestion of rewriteSuggestions.slice(0, 3)) {
    if (suggestion && !actions.includes(suggestion)) {
      actions.push(suggestion);
    }
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
