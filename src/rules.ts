import adCopy from "../data/rules/ad_copy.json";
import contractReview from "../data/rules/contract_review.json";

export type ScanMode = "ad_copy" | "contract_review";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Rule {
  id: string;
  title: string;
  pattern: string;
  severity: Severity;
  category: string;
  explanation: string;
  suggestion: string;
  threshold?: string;
  references: string[];
}

interface RuleFile {
  rules: Rule[];
}

export const RULEPACKS: Record<ScanMode, Rule[]> = {
  ad_copy: (adCopy as RuleFile).rules,
  contract_review: (contractReview as RuleFile).rules
};

export function listRulepacks() {
  return (Object.entries(RULEPACKS) as Array<[ScanMode, Rule[]]>).map(([mode, rules]) => ({
    mode,
    rule_count: rules.length,
    critical_rules: rules.filter((rule) => rule.severity === "critical").length,
    high_rules: rules.filter((rule) => rule.severity === "high").length
  }));
}

export function isScanMode(value: unknown): value is ScanMode {
  return value === "ad_copy" || value === "contract_review";
}
