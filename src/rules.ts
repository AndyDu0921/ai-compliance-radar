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
  references: string[];
}

export const RULEPACKS: Record<ScanMode, Rule[]> = {
  ad_copy: [
    {
      id: "ad-absolute-claims",
      title: "Absolute or superlative claim",
      pattern: "(国家级|最高级|最佳|第一|唯一|首个|顶级|极品|史上最强|全网第一|永久有效|100%有效|绝对)",
      severity: "high",
      category: "advertising_claims",
      explanation:
        "Absolute or superlative language often creates advertising law risk when it cannot be fully substantiated.",
      suggestion: "Replace with measurable, source-backed wording, such as scope, date range, or test conditions.",
      references: ["Advertising law risk: absolute wording", "SMB copy review"]
    },
    {
      id: "ad-guaranteed-outcome",
      title: "Guaranteed outcome or certainty",
      pattern: "(包过|保证通过|无效退款|立刻见效|立即见效|治愈|根治|稳赚|保本|零风险|百分百成功)",
      severity: "critical",
      category: "false_or_misleading",
      explanation: "Guarantees about outcomes, returns, or treatment effects are a common source of enforcement risk.",
      suggestion: "Remove guaranteed language and use conditional or evidence-based descriptions only.",
      references: ["Advertising law risk: guaranteed outcomes"]
    },
    {
      id: "ad-medical-effect",
      title: "Medical or treatment effect claim",
      pattern: "(修复视力|抗癌|降三高|消炎杀菌|治脱发|快速减肥|医学验证治好|改善近视|治疗效果)",
      severity: "critical",
      category: "medical_sensitive",
      explanation:
        "Medical-style efficacy claims can trigger higher-risk review, especially in healthcare, beauty, or supplement scenarios.",
      suggestion:
        "Use compliant product descriptions and require specialized review for medical or health-related promotions.",
      references: ["Medical or health advertising risk"]
    },
    {
      id: "ad-finance-return",
      title: "Financial return promise",
      pattern: "(年化收益|高收益|稳赔?不赚|保本保收益|低风险高回报|稳赚不赔)",
      severity: "critical",
      category: "financial_sensitive",
      explanation: "Investment or finance copy that implies assured return or low/no risk has elevated compliance risk.",
      suggestion: "Remove return promises and add clear risk disclosures reviewed by compliance staff.",
      references: ["Financial promotion risk"]
    },
    {
      id: "ad-fake-authority",
      title: "Authority or endorsement risk",
      pattern: "(权威专家推荐|央视推荐|国家认证推荐|官方唯一推荐|院长亲荐|名医同款|博士团队背书)",
      severity: "high",
      category: "endorsement",
      explanation: "Authority endorsements are risky when identity, authorization, or evidence cannot be verified.",
      suggestion: "Use verifiable endorsements only, with documented authorization and context.",
      references: ["Endorsement and authority risk"]
    },
    {
      id: "ad-price-lowest",
      title: "Lowest-price or exclusivity claim",
      pattern: "(全网最低|最低价|底价|独家|仅此一家|别无分店|唯一渠道)",
      severity: "high",
      category: "pricing_and_positioning",
      explanation: "Lowest-price or exclusivity claims are risky if they cannot be continuously verified.",
      suggestion: "Replace with specific time-bound offers or clearly documented campaign terms.",
      references: ["Pricing claim risk"]
    },
    {
      id: "ad-education-promise",
      title: "Education or exam guarantee",
      pattern: "(包录取|包过|保过|签约保分|提分保证|保上岸)",
      severity: "critical",
      category: "education_sensitive",
      explanation:
        "Education and exam advertising often draws enforcement when it promises admission or guaranteed score improvement.",
      suggestion: "Remove result guarantees and keep only objective course, teacher, and service descriptions.",
      references: ["Education training ad risk"]
    },
    {
      id: "ad-urgency-pressure",
      title: "Artificial urgency or pressure wording",
      pattern: "(最后一天|马上恢复原价|错过再等一年|只剩最后[一二三四五六七八九十0-9]+份|今天不买就没了)",
      severity: "medium",
      category: "sales_pressure",
      explanation: "Urgency language is not always unlawful, but it is worth reviewing when scarcity cannot be verified.",
      suggestion: "Keep urgency claims traceable to real inventory, timing, and campaign records.",
      references: ["Sales pressure review"]
    },
    {
      id: "ad-ai-persona",
      title: "AI-generated persona or identity risk",
      pattern: "(AI医生|AI专家|AI院长|虚拟名医|仿真医生形象|AI生成主播)",
      severity: "high",
      category: "ai_generated_content",
      explanation: "AI-generated experts or people in sensitive sectors can create deception and disclosure risk.",
      suggestion: "Disclose synthetic content clearly and avoid fictitious authority figures in sensitive promotions.",
      references: ["AI-generated advertising risk"]
    },
    {
      id: "ad-no-ad-label",
      title: "Possible missing ad disclosure",
      pattern: "(合作推荐|种草|真实分享|亲测好用)",
      severity: "medium",
      category: "disclosure",
      explanation:
        "Influencer-style or soft-selling copy may require clear ad or promotion disclosure depending on context.",
      suggestion: "Review whether the publishing channel requires an explicit advertising or commercial cooperation label.",
      references: ["Platform disclosure review"]
    }
  ],
  contract_review: [
    {
      id: "ctr-final-interpretation",
      title: "Final interpretation right",
      pattern: "(最终解释权归.{0,20}(甲方|本公司|乙方|平台).{0,10}所有)",
      severity: "high",
      category: "one_sided_control",
      explanation: "A unilateral final-interpretation clause can create imbalance and should be reviewed carefully.",
      suggestion: "Replace with a dispute-resolution or amendment mechanism rather than unilateral interpretation rights.",
      references: ["Contract fairness review"]
    },
    {
      id: "ctr-unilateral-change",
      title: "Unilateral modification power",
      pattern: "(甲方有权单方(修改|变更|调整|决定)|平台有权单方(修改|变更|调整|决定))",
      severity: "critical",
      category: "one_sided_control",
      explanation: "Broad unilateral change authority is a common red flag in commercial contracts.",
      suggestion: "Add notice period, negotiation rights, and written confirmation requirements before changes take effect.",
      references: ["Contract fairness review"]
    },
    {
      id: "ctr-auto-renewal",
      title: "Automatic renewal",
      pattern: "(自动续期|自动续约|默认续费|到期后自动延长)",
      severity: "medium",
      category: "renewal_and_term",
      explanation: "Auto-renewal clauses should be explicit, understandable, and operationally controllable.",
      suggestion: "Add reminder timing, cancellation path, and renewal notice language.",
      references: ["Renewal clause review"]
    },
    {
      id: "ctr-no-refund",
      title: "No-refund clause",
      pattern: "(已付款项概不退还|不予退还|一律不退款|已支付费用不退)",
      severity: "high",
      category: "payment_and_refund",
      explanation:
        "Flat no-refund language can be risky when the contract lacks balanced service, breach, or cancellation logic.",
      suggestion: "Define refund triggers, service milestones, and mutual breach handling more precisely.",
      references: ["Refund and breach review"]
    },
    {
      id: "ctr-unlimited-liability",
      title: "Unlimited or total liability shift",
      pattern: "(承担全部损失|无限责任|全部赔偿责任|对一切损失负责)",
      severity: "critical",
      category: "liability",
      explanation: "Unlimited or blanket liability is a major negotiation point and often needs specialist review.",
      suggestion: "Cap liability and define scope, exclusions, and direct-vs-indirect damages clearly.",
      references: ["Liability cap review"]
    },
    {
      id: "ctr-broad-exemption",
      title: "Broad exemption from responsibility",
      pattern: "(甲方不承担任何责任|平台不承担任何责任|概不负责|免责)",
      severity: "high",
      category: "liability",
      explanation: "Broad免责 language can be overreaching if it is not narrowed by scenario and legal limits.",
      suggestion: "Narrow the exemption to specific events and add each party's baseline obligations.",
      references: ["Liability fairness review"]
    },
    {
      id: "ctr-unilateral-termination",
      title: "Unilateral termination right",
      pattern: "(甲方可随时解除|平台可随时终止|乙方不得解除|未经甲方同意不得解除)",
      severity: "high",
      category: "termination",
      explanation: "One-sided termination rights can materially change commercial risk allocation.",
      suggestion: "Define reciprocal termination triggers, cure periods, and post-termination settlement rules.",
      references: ["Termination clause review"]
    },
    {
      id: "ctr-jurisdiction",
      title: "Unfavorable jurisdiction clause",
      pattern: "(由甲方所在地法院管辖|由平台所在地法院管辖|提交.{0,10}(仲裁委员会|法院)处理)",
      severity: "medium",
      category: "dispute_resolution",
      explanation:
        "Jurisdiction clauses may be valid, but they should be reviewed for cost, convenience, and bargaining balance.",
      suggestion: "Review venue, governing law, and evidence rules before signing.",
      references: ["Jurisdiction review"]
    },
    {
      id: "ctr-acceptance-control",
      title: "Acceptance controlled by one side",
      pattern: "(以甲方最终验收为准|验收标准以甲方要求为准|是否合格由甲方决定)",
      severity: "high",
      category: "delivery_and_acceptance",
      explanation: "If one side fully controls acceptance, payment and delivery disputes become more likely.",
      suggestion: "Define objective acceptance criteria, timelines, and deemed-acceptance rules.",
      references: ["Acceptance clause review"]
    },
    {
      id: "ctr-ip-transfer",
      title: "Broad IP ownership transfer",
      pattern: "(所有成果及知识产权归甲方所有|全部知识产权永久归甲方|乙方无权保留任何知识产权)",
      severity: "medium",
      category: "intellectual_property",
      explanation:
        "IP ownership can be commercially acceptable, but broad transfer language should be reviewed against price and scope.",
      suggestion: "Separate pre-existing IP, deliverable IP, usage license, and derivative rights.",
      references: ["IP ownership review"]
    },
    {
      id: "ctr-penalty-asymmetry",
      title: "Asymmetric breach penalty",
      pattern: "(乙方应支付违约金|乙方承担违约责任).{0,40}(甲方无需承担|甲方不承担)",
      severity: "high",
      category: "breach_and_damages",
      explanation: "Highly asymmetric breach language can indicate an unfair risk split.",
      suggestion: "Make breach remedies reciprocal or justify differences with clear business logic.",
      references: ["Breach remedy review"]
    }
  ]
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
