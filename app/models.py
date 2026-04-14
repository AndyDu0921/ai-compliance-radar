from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class ScanMode(str, Enum):
    ad_copy = "ad_copy"
    contract_review = "contract_review"


class JobStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class Severity(str, Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"
    info = "info"


class TextScanRequest(BaseModel):
    mode: ScanMode
    text: str = Field(min_length=1, max_length=120_000)
    title: str | None = Field(default=None, max_length=255)
    use_llm: bool | None = None

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("text cannot be blank")
        return stripped


class RiskItem(BaseModel):
    id: str
    title: str
    severity: Severity
    category: str
    excerpt: str = ""
    explanation: str = ""
    suggestion: str = ""
    source: str = Field(default="rule")
    confidence: float = 0.7
    references: list[str] = Field(default_factory=list)


class ScanReport(BaseModel):
    job_id: str
    title: str | None = None
    mode: ScanMode
    risk_score: int = 0
    summary: str
    recommended_actions: list[str] = Field(default_factory=list)
    risk_items: list[RiskItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    llm_used: bool = False
    deterministic_hit_count: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class JobRecord(BaseModel):
    id: str
    title: str | None = None
    mode: ScanMode
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    file_name: str | None = None
    error_message: str | None = None
    result: ScanReport | None = None
    input_method: str = "text"


class MetaResponse(BaseModel):
    app_name: str
    llm_enabled: bool
    max_upload_mb: int
    rulepacks: list[dict[str, Any]]
