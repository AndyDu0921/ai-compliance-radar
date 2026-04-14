# Architecture

```mermaid
flowchart LR
    A[Browser UI / API client] --> B[FastAPI routes]
    B --> C[Input validation]
    C --> D[File parser]
    C --> E[Rule engine]
    D --> E
    E --> F[Optional OpenAI-compatible LLM]
    E --> G[Risk scoring + recommendations]
    F --> G
    G --> H[SQLite job store]
    H --> I[History / polling / result retrieval]
```

## Current implementation

- **Presentation layer**: server-rendered HTML + vanilla JS
- **API layer**: FastAPI routers
- **File parsing**: TXT, MD, DOCX, PDF
- **Risk engine**: deterministic regex rule packs for ad copy and contracts
- **AI enrichment**: optional OpenAI-compatible chat completions endpoint
- **Persistence**: SQLite for single-tenant or early production use

## Upgrade path

1. Replace SQLite with PostgreSQL.
2. Move file storage to S3-compatible object storage.
3. Add a background queue (Celery / Dramatiq / RQ).
4. Add auth, organizations, and tenant isolation.
5. Add export, reviewer workflows, and audit logs.
