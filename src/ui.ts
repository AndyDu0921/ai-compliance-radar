import type { Bindings } from "./types";
import { adminJobsEnabled } from "./middleware";

const ALLOWED_UPLOADS = [".txt", ".md"];

export function renderSwaggerUi(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Compliance Radar API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; background: #0a0a0a; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        docExpansion: "list",
        defaultModelsExpandDepth: 1
      });
    };
  </script>
</body>
</html>`;
}

export function renderRedoc(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Compliance Radar ReDoc</title>
  <style>
    body { margin: 0; background: #ffffff; }
  </style>
</head>
<body>
  <redoc spec-url="/openapi.json"></redoc>
  <script src="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js"></script>
</body>
</html>`;
}

export function renderPrivacyPage(env: Bindings): string {
  return renderLegalPage({
    title: "数据隐私保护政策",
    intro: "本页面描述公开 MVP 当前如何处理输入文本、任务记录与管理员访问。",
    sections: [
      {
        heading: "收集内容",
        body: [
          "系统会处理你提交的文本内容或上传文件中的文本内容，以生成风险分析报告。",
          shouldStoreRaw(env)
            ? "当前部署已启用原文存储，扫描原文可能会被写入数据库。"
            : "当前部署默认不存储扫描原文，只保留任务元信息、文件名和结构化报告结果。"
        ]
      },
      {
        heading: "保存期限",
        body: [`任务记录默认保留 ${retentionDays(env)} 天，过期记录会在后续请求中自动清理。`]
      },
      {
        heading: "管理员访问",
        body: [
          adminJobsEnabled(env)
            ? "管理员历史接口已启用，仅持有有效 X-API-Key 的管理员可以读取任务历史。"
            : "管理员历史接口当前未公开启用，普通访问者无法读取历史任务。"
        ]
      },
      {
        heading: "使用建议",
        body: [
          "不要提交身份证号、银行卡、医疗病历、源代码密钥等高敏感信息。",
          "对于高风险合同、广告发布或正式法律结论，仍需由人工法务进行最终审核。"
        ]
      }
    ]
  });
}

export function renderTermsPage(env: Bindings): string {
  return renderLegalPage({
    title: "服务条款",
    intro: "本工具当前以公开 MVP 形式提供，主要用于合规风险预筛和内部演示。",
    sections: [
      {
        heading: "服务性质",
        body: [
          "系统输出的是风险分诊与整改建议，不构成正式法律意见或律师服务。",
          "你应对提交内容及其后续使用自行负责。"
        ]
      },
      {
        heading: "支持范围",
        body: [
          `当前公开版本仅支持 ${ALLOWED_UPLOADS.join("、")} 文件上传。`,
          "LLM 增强为可选能力，未启用时系统仅提供规则引擎报告。"
        ]
      },
      {
        heading: "访问控制",
        body: [
          adminJobsEnabled(env)
            ? "历史任务接口属于管理员能力，必须使用有效 X-API-Key 访问。"
            : "历史任务接口当前未启用。"
        ]
      },
      {
        heading: "免责声明",
        body: [
          "服务按现状提供，不保证对所有业务场景、司法口径或监管变更都完全覆盖。",
          "正式发布、签约、投放、采购或争议处理前，应由具备资质的专业人员复核。"
        ]
      }
    ]
  });
}

export function shouldStoreRaw(env: Bindings): boolean {
  return String(env.STORE_RAW_INPUT || "false").toLowerCase() === "true";
}

export function retentionDays(env: Bindings): number {
  const parsed = Number(env.JOB_RETENTION_DAYS || 7);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 7;
}

export const ALLOWED_UPLOADS_LIST = ALLOWED_UPLOADS;

function renderLegalPage({
  title,
  intro,
  sections
}: {
  title: string;
  intro: string;
  sections: Array<{ heading: string; body: string[] }>;
}): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | Compliance Radar</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #070707;
      --panel: #131313;
      --text: #f5f5f7;
      --muted: #b4b4ba;
      --line: rgba(255,255,255,0.08);
      --accent: #2997ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(41,151,255,0.16), transparent 30%),
        var(--bg);
      color: var(--text);
    }
    main {
      max-width: 900px;
      margin: 0 auto;
      padding: 72px 24px 96px;
    }
    h1 {
      font-size: clamp(36px, 6vw, 56px);
      margin: 0 0 18px;
      letter-spacing: -0.03em;
    }
    p {
      color: var(--muted);
      line-height: 1.7;
      font-size: 16px;
    }
    section {
      margin-top: 28px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 28px;
    }
    h2 {
      margin: 0 0 14px;
      font-size: 22px;
    }
    ul {
      margin: 0;
      padding-left: 20px;
      color: var(--muted);
      line-height: 1.8;
    }
    a {
      color: var(--accent);
      text-decoration: none;
    }
  </style>
</head>
<body>
  <main>
    <p><a href="/">返回首页</a></p>
    <h1>${title}</h1>
    <p>${intro}</p>
    ${sections
      .map(
        (section) => `
      <section>
        <h2>${section.heading}</h2>
        <ul>${section.body.map((item) => `<li>${item}</li>`).join("")}</ul>
      </section>`
      )
      .join("")}
  </main>
</body>
</html>`;
}
