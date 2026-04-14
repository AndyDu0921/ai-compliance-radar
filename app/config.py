from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = BASE_DIR / "storage"
UPLOAD_DIR = STORAGE_DIR / "uploads"
REPORT_DIR = STORAGE_DIR / "reports"
RULES_DIR = BASE_DIR / "app" / "data" / "rules"
TEMPLATES_DIR = BASE_DIR / "app" / "templates"
STATIC_DIR = BASE_DIR / "app" / "static"
FRONTEND_DIR = BASE_DIR / "app" / "frontend"


@dataclass(slots=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "Compliance Radar")
    app_env: str = os.getenv("APP_ENV", "development")
    database_path: str = os.getenv("DATABASE_PATH", str(STORAGE_DIR / "app.db"))
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "10"))
    admin_api_key: str = os.getenv("ADMIN_API_KEY", "")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_base_url: str = os.getenv("LLM_BASE_URL", "")
    llm_model: str = os.getenv("LLM_MODEL", "")
    llm_timeout_seconds: int = int(os.getenv("LLM_TIMEOUT_SECONDS", "60"))
    default_use_llm: bool = os.getenv("DEFAULT_USE_LLM", "false").lower() == "true"

    @property
    def db_path(self) -> Path:
        raw = Path(self.database_path)
        return raw if raw.is_absolute() else BASE_DIR / raw

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key and self.llm_base_url and self.llm_model)


settings = Settings()

for directory in (STORAGE_DIR, UPLOAD_DIR, REPORT_DIR, RULES_DIR, TEMPLATES_DIR, STATIC_DIR, FRONTEND_DIR):
    directory.mkdir(parents=True, exist_ok=True)
