// public/js/utils.js
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatMode(mode) {
  return mode === "contract_review" ? "合同条款" : "广告文案";
}

export function formatSeverity(severity) {
  const map = {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
    info: "Info"
  };
  return map[severity] || severity;
}

export function scoreLabel(score) {
  if (score >= 80) return "高风险";
  if (score >= 50) return "中高风险";
  if (score >= 25) return "中风险";
  return "低风险";
}

export const sampleTexts = {
  ad_copy: `全网第一的瘦身方案，7天立刻见效！\n博士团队背书，保证通过体脂管理挑战。\n今天不买就没了，最后一天，错过再等一年！`,
  contract_review: `甲方有权单方修改本合同并最终解释本协议全部条款。\n乙方已付款项概不退还，乙方承担全部损失。\n是否验收合格由甲方决定，争议由甲方所在地法院管辖。`
};
