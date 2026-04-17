import { describe, expect, it } from "vitest";
import { scanRules, scoreFindings } from "./rule-engine";

describe("Cloudflare rule engine", () => {
  it("detects high-risk advertising copy", () => {
    const findings = scanRules({
      mode: "ad_copy",
      text: "全网第一的瘦身方案，7天立刻见效！博士团队背书，保证通过体脂管理挑战。"
    });

    expect(findings.map((item) => item.id)).toContain("ad-absolute-claims");
    expect(findings.map((item) => item.id)).toContain("ad-guaranteed-outcome");
    expect(scoreFindings(findings)).toBeGreaterThanOrEqual(50);
  });

  it("detects one-sided contract terms", () => {
    const findings = scanRules({
      mode: "contract_review",
      text: "甲方有权单方修改本合同。已付款项概不退还，乙方承担全部损失。"
    });

    expect(findings.map((item) => item.id)).toContain("ctr-unilateral-change");
    expect(findings.map((item) => item.id)).toContain("ctr-no-refund");
    expect(findings.map((item) => item.id)).toContain("ctr-unlimited-liability");
  });
});
