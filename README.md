# Compliance Radar

广告文案合规扫描 + 合同条款预审，基于 Cloudflare Workers + D1 部署。

线上地址：
- [https://radar.dssxhydwp.shop](https://radar.dssxhydwp.shop)

## 当前能力

- 公开文本扫描：`POST /api/v1/scan/text`
- 公开文件扫描：`POST /api/v1/scan/file`
- 站点元信息：`GET /api/v1/meta`
- 健康检查：`GET /health`
- OpenAPI：`GET /openapi.json`
- 交互文档：`GET /docs`
- ReDoc：`GET /redoc`
- 法律页面：`GET /privacy`、`GET /terms`
- 管理员历史任务：`GET /api/v1/jobs`、`GET /api/v1/jobs/:job_id`

## 接口规则

- 扫描接口默认公开，不要求 `X-API-Key`
- 历史任务接口只有在配置 `ADMIN_API_KEY` 后才启用
- 历史任务接口启用后，必须携带请求头 `X-API-Key`
- 上传文件当前仅支持 `.txt`、`.md`
- 所有 API 响应都带 `Cache-Control: no-store`

## 隐私与保留策略

- 默认不保存扫描原文：`STORE_RAW_INPUT=false`
- 默认任务保留期：`JOB_RETENTION_DAYS=7`
- 过期任务会在后续请求中自动清理
- 如果启用 Cloudflare Turnstile，扫描请求必须附带有效 token

## 本地开发

```bash
npm install
cp .env.example .env
npm run db:migrate:local
npm run dev
```

本地默认地址：
- 网站首页：`http://127.0.0.1:8787`
- Swagger 文档：`http://127.0.0.1:8787/docs`
- ReDoc：`http://127.0.0.1:8787/redoc`

## 部署

```bash
npx wrangler login
npx wrangler whoami
npm run db:migrate:remote
npm run deploy
```

`npm run deploy` 当前会使用 `wrangler deploy --keep-vars`，避免覆盖控制台中已有的公共变量。

## 环境变量

可通过 `.env`、`.dev.vars`、Wrangler vars 或 Wrangler secrets 配置：

```bash
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put LLM_API_KEY
npx wrangler secret put LLM_BASE_URL
npx wrangler secret put LLM_MODEL
npx wrangler secret put TURNSTILE_SECRET_KEY
```

非 secret 的公共配置建议写在 `wrangler.toml` 或 Cloudflare Dashboard：

- `APP_NAME`
- `APP_VERSION`
- `APP_DEPLOYED_AT`
- `MAX_UPLOAD_MB`
- `DEFAULT_USE_LLM`
- `STORE_RAW_INPUT`
- `JOB_RETENTION_DAYS`
- `TURNSTILE_SITE_KEY`

说明：

- `ADMIN_API_KEY`：启用管理员历史任务接口
- `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`：启用公开扫描的人机校验
- `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL`：启用 OpenAI-compatible `/chat/completions`

## GitHub Actions 自动部署

仓库包含 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)：

- push 到 `main` 后自动执行
- `npm ci`
- `npm run typecheck`
- `npm test`
- `npm run db:migrate:remote`
- `wrangler deploy`
- 部署后 smoke test

需要在 GitHub 仓库 secrets 中配置：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

建议同时在 Cloudflare 控制台补充：

- 对 `/api/v1/scan/*` 的 Rate Limiting
- Turnstile 小部件配置

## 规则包

规则 JSON 位于 [`data/rules`](data/rules)。

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
