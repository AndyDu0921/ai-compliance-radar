# Compliance Radar

广告文案合规扫描 + 合同条款预审，面向中小企业的 AI 风险识别工具。

前后端已合并，开箱即用。

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

---

## Docker 一键启动

```bash
cp .env.example .env
docker compose up --build
```

访问 http://localhost:8000

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

## 接口文档

- Swagger: http://127.0.0.1:8000/docs
- ReDoc:   http://127.0.0.1:8000/redoc

---

## 目录结构

```
compliance-radar/
├── app/
│   ├── data/rules/       规则包 JSON
│   ├── frontend/         React 前端构建产物（已内嵌）
│   ├── routers/          FastAPI 路由
│   ├── services/         规则引擎 / LLM / 文件解析
│   ├── config.py
│   ├── db.py
│   ├── main.py           应用入口
│   └── models.py
├── sample_data/          示例广告文案 / 合同
├── storage/              运行时数据库 + 上传文件
├── .env.example
├── docker-compose.yml
└── requirements.txt
```

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
