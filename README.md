# Compliance Radar

线上展示版：
- https://ai-compliance-radar.pages.dev

说明：旧 Cloudflare Pages 地址可能只托管前端。完整可用版本建议使用本仓库新增的 Cloudflare Workers + D1 部署方式。

广告文案合规扫描 + 合同条款预审，面向中小企业的 AI 风险识别工具。

前后端已合并，启动后浏览器会直接打开可用的网站工作台；技术团队仍可继续使用同一套 API。

---

## 快速启动（本地 Python）

```bash
# 1. 配置环境变量
cp .env.example .env
# 按需编辑 .env（最简配置保持默认即可）

# 2. 安装依赖
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 3. 启动
uvicorn app.main:app --reload
```

浏览器访问 http://127.0.0.1:8000

- 网站首页: `http://127.0.0.1:8000`
- Swagger: `http://127.0.0.1:8000/docs`
- ReDoc: `http://127.0.0.1:8000/redoc`

---

## Docker 一键启动

```bash
cp .env.example .env
docker compose up --build
```

访问 http://localhost:8000

---

## Cloudflare Workers 免费部署

仓库已适配 Cloudflare 原生结构：

- 静态网站：`app/frontend`
- 云函数 API：`src/worker.ts`
- 数据库：Cloudflare D1，绑定名 `DB`
- 规则引擎：`src/rule-engine.ts` + `src/rules.ts`

Cloudflare 版保留核心能力：文本扫描、任务记录、规则命中、txt/md 文件上传。为了优先保证免费层可运行，Cloudflare 版暂不做 docx/pdf 服务端解析；上传 docx/pdf 会返回清晰错误。

### 1. 安装 Node 依赖

```bash
npm install
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
npx wrangler whoami
```

如果浏览器 OAuth 没完成，先不要继续部署。

### 3. 创建 D1 数据库

```bash
npx wrangler d1 create ai_compliance_radar_db
```

把命令返回的 `database_id` 填入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "ai_compliance_radar_db"
database_id = "这里替换成 Cloudflare 返回的 ID"
```

### 4. 初始化远程数据库

```bash
npm run db:migrate:remote
```

本地开发可先跑：

```bash
npm run db:migrate:local
npm run dev
```

### 5. 部署

```bash
npm run deploy
```

部署成功后访问 Wrangler 输出的 `https://<worker>.workers.dev/`。

验证重点：

- `/` 返回网站首页。
- `/health` 返回 `{"status":"ok"}`。
- `/api/v1/meta` 返回 JSON，并包含 `allowed_uploads: [".txt", ".md"]`。
- 提交示例文案后，结果面板可显示风险分值和风险条目。

如果 Cloudflare 后台要求付款信息或信用卡验证，可以停止在 Cloudflare 继续创建付费资源。

### 可选环境变量

Cloudflare Worker 可配置以下 secrets/vars：

```bash
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put LLM_API_KEY
npx wrangler secret put LLM_BASE_URL
npx wrangler secret put LLM_MODEL
```

- `ADMIN_API_KEY`：配置后，任务和扫描接口要求请求头 `X-API-Key`。
- `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`：三者都配置后，Cloudflare 版允许使用 OpenAI-compatible `/chat/completions` 增强分析。

---

## 启用 LLM 增强分析

在 .env 中填写（兼容 OpenAI 格式，支持 Claude / OpenAI / DeepSeek）：

```
DEFAULT_USE_LLM=false
LLM_API_KEY=sk-ant-xxx
LLM_BASE_URL=https://api.anthropic.com/v1
LLM_MODEL=claude-sonnet-4-20250514
```

---

## 产品形态

- 业务用户：直接访问首页网站，粘贴文本或上传文件完成扫描。
- 技术团队：使用 `/docs` 或 `/redoc` 查看接口文档，接入内部系统、审批流或 agent。

---

## 目录结构

```
compliance-radar/
├── app/
│   ├── data/rules/       规则包 JSON
│   ├── frontend/         网站首页 + 在线扫描工作台
│   ├── routers/          FastAPI 路由
│   ├── services/         规则引擎 / LLM / 文件解析
│   ├── config.py
│   ├── db.py
│   ├── main.py           应用入口
│   └── models.py
├── sample_data/          示例广告文案 / 合同
├── src/                  Cloudflare Worker API + TypeScript 规则引擎
├── migrations/           Cloudflare D1 数据库迁移
├── storage/              运行时数据库 + 上传文件
├── wrangler.toml         Cloudflare Workers 配置
├── package.json          Worker 开发、测试、部署脚本
├── .env.example
├── docker-compose.yml
└── requirements.txt
```

---

## Render 部署

仓库已包含 `render.yaml` 和 `Dockerfile`，可通过 Render Blueprint 创建完整 Web Service。

- 服务类型：Docker Web Service
- 健康检查：`/health`
- 运行端口：使用平台提供的 `PORT`
- 默认不启用 LLM，部署后可在 Render Dashboard 中补充 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`

---

## 添加新规则

编辑 app/data/rules/ 下的 JSON，格式：

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

无需重启，规则动态加载。
