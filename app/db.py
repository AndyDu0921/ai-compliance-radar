from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from app.config import settings
from app.models import JobRecord, JobStatus, ScanMode, ScanReport


_DB_LOCK = threading.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_db(self) -> None:
        with _DB_LOCK:
            with self.connection() as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS jobs (
                        id TEXT PRIMARY KEY,
                        title TEXT,
                        mode TEXT NOT NULL,
                        status TEXT NOT NULL,
                        input_method TEXT NOT NULL,
                        input_text TEXT,
                        file_name TEXT,
                        file_path TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        error_message TEXT,
                        result_json TEXT
                    )
                    """
                )

    def create_job(
        self,
        *,
        job_id: str,
        mode: ScanMode,
        input_method: str,
        input_text: str | None = None,
        file_name: str | None = None,
        file_path: str | None = None,
        title: str | None = None,
    ) -> None:
        now = _utc_now()
        with self.connection() as conn:
            conn.execute(
                """
                INSERT INTO jobs (
                    id, title, mode, status, input_method, input_text, file_name, file_path,
                    created_at, updated_at, error_message, result_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    title,
                    mode.value,
                    JobStatus.pending.value,
                    input_method,
                    input_text,
                    file_name,
                    file_path,
                    now,
                    now,
                    None,
                    None,
                ),
            )

    def update_job_status(self, job_id: str, status: JobStatus, error_message: str | None = None) -> None:
        with self.connection() as conn:
            conn.execute(
                "UPDATE jobs SET status = ?, updated_at = ?, error_message = ? WHERE id = ?",
                (status.value, _utc_now(), error_message, job_id),
            )

    def complete_job(self, job_id: str, report: ScanReport) -> None:
        with self.connection() as conn:
            conn.execute(
                "UPDATE jobs SET status = ?, updated_at = ?, result_json = ?, error_message = NULL WHERE id = ?",
                (JobStatus.completed.value, _utc_now(), report.model_dump_json(), job_id),
            )

    def get_job_row(self, job_id: str) -> sqlite3.Row | None:
        with self.connection() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return row

    def list_recent_rows(self, limit: int = 20) -> list[sqlite3.Row]:
        with self.connection() as conn:
            rows = conn.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return rows

    def fetch_input(self, job_id: str) -> dict[str, Any] | None:
        row = self.get_job_row(job_id)
        if row is None:
            return None
        return {
            "id": row["id"],
            "title": row["title"],
            "mode": row["mode"],
            "input_method": row["input_method"],
            "input_text": row["input_text"],
            "file_name": row["file_name"],
            "file_path": row["file_path"],
            "status": row["status"],
        }

    def hydrate_job(self, row: sqlite3.Row) -> JobRecord:
        payload = dict(row)
        result = None
        if payload.get("result_json"):
            result = ScanReport.model_validate_json(payload["result_json"])
        return JobRecord(
            id=payload["id"],
            title=payload.get("title"),
            mode=ScanMode(payload["mode"]),
            status=JobStatus(payload["status"]),
            created_at=datetime.fromisoformat(payload["created_at"]),
            updated_at=datetime.fromisoformat(payload["updated_at"]),
            file_name=payload.get("file_name"),
            error_message=payload.get("error_message"),
            result=result,
            input_method=payload.get("input_method") or "text",
        )

    def get_job(self, job_id: str) -> JobRecord | None:
        row = self.get_job_row(job_id)
        return self.hydrate_job(row) if row else None

    def list_jobs(self, limit: int = 20) -> list[JobRecord]:
        return [self.hydrate_job(row) for row in self.list_recent_rows(limit=limit)]


_db = Database(settings.db_path)


def get_db() -> Database:
    return _db
