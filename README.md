# Compliance Radar

广告文案合规扫描 + 合同条款预审，使用 Cloudflare Workers + D1 部署。

线上地址：
- [https://radar.dssxhydwp.shop](https://radar.dssxhydwp.shop)

## 当前结构

```text
compliance-radar/
├── data/rules/           规则包 JSON
├── public/               网站静态资源
├── src/                  Worker API、规则引擎、LLM 接口
├── migrations/           D1 migration
├── wrangler.toml         Cloudflare Workers 配置
├── package.json          开发、测试、部署脚本
└── .env.example          本地开发环境变量示例
```

## 本地开发

```bash
npm install
cp .env.example .env
npm run db:migrate:local
npm run dev
```

本地默认地址：
- 网站首页: `http://127.0.0.1:8787`
- API 文档: `http://127.0.0.1:8787/docs`
- 接口说明: `http://127.0.0.1:8787/redoc`

## 部署

```bash
npx wrangler login
npx wrangler whoami
npm run db:migrate:remote
npm run deploy
```

## 环境变量

可通过 `.env`、`.dev.vars` 或 Wrangler secrets 配置：

```bash
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put LLM_API_KEY
npx wrangler secret put LLM_BASE_URL
npx wrangler secret put LLM_MODEL
```

- `ADMIN_API_KEY`：配置后，`/api/*` 接口要求请求头 `X-API-Key`
- `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`：全部存在时启用 OpenAI-compatible `/chat/completions`

## 规则包

规则 JSON 位于 [`data/rules`](E:\AI合规扫描仪\compliance-radar\data\rules)。

格式：

```json
{
  "rules": [
    {
      "id": "unique-id",
      "title": "规则名称",
      "pattern": "(正则表达式)",
      "severity": "critical|high|medium|low|info",
      "category": "分类",
      "explanation": "风险说明",
      "suggestion": "修改建议",
      "references": []
    }
  ]
}
```
