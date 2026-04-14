from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile, status

from app.config import UPLOAD_DIR, settings
from app.db import get_db
from app.models import JobRecord, MetaResponse, ScanMode, TextScanRequest
from app.services.analyzer import AnalyzerService
from app.services.auth import require_api_key
from app.services.rule_engine import list_rulepacks

router = APIRouter(tags=["scan"])
ALLOWED_SUFFIXES = {".txt", ".md", ".docx", ".pdf"}


def get_analyzer(request: Request) -> AnalyzerService:
    return request.app.state.analyzer




@router.get("/api/v1/meta", response_model=MetaResponse)
def meta() -> MetaResponse:
    return MetaResponse(
        app_name=settings.app_name,
        llm_enabled=settings.llm_enabled,
        max_upload_mb=settings.max_upload_mb,
        rulepacks=list_rulepacks(),
    )


@router.get("/api/v1/jobs", response_model=list[JobRecord], dependencies=[Depends(require_api_key)])
def list_jobs(limit: int = Query(default=15, ge=1, le=100)) -> list[JobRecord]:
    return get_db().list_jobs(limit=limit)


@router.get("/api/v1/jobs/{job_id}", response_model=JobRecord, dependencies=[Depends(require_api_key)])
def get_job(job_id: str) -> JobRecord:
    job = get_db().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/api/v1/scan/text", dependencies=[Depends(require_api_key)])
async def create_text_scan(
    payload: TextScanRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    wait: bool = Query(default=False),
) -> dict[str, object]:
    analyzer = get_analyzer(request)
    db = get_db()
    job_id = str(uuid.uuid4())
    use_llm = payload.use_llm if payload.use_llm is not None else settings.default_use_llm
    db.create_job(
        job_id=job_id,
        mode=payload.mode,
        input_method="text",
        input_text=payload.text,
        title=payload.title,
    )
    if wait:
        try:
            report = await analyzer.run_text_scan(
                job_id=job_id,
                mode=payload.mode,
                text=payload.text,
                title=payload.title,
                use_llm=use_llm,
            )
        except Exception as exc:
            await analyzer.fail_job(job_id, exc)
            raise
        return {"job_id": job_id, "status": "completed", "result": report.model_dump()}

    background_tasks.add_task(_safe_process_text_job, analyzer, job_id, payload.mode, payload.text, payload.title, use_llm)
    return {"job_id": job_id, "status": "queued"}


@router.post("/api/v1/scan/file", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(require_api_key)])
async def create_file_scan(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    mode: ScanMode = Form(...),
    title: str | None = Form(default=None),
    use_llm: bool | None = Form(default=None),
    wait: bool = Query(default=False),
) -> dict[str, object]:
    analyzer = get_analyzer(request)
    db = get_db()
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {sorted(ALLOWED_SUFFIXES)}")
    raw = await file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File too large. Max size: {settings.max_upload_mb}MB")
    job_id = str(uuid.uuid4())
    stored_name = f"{job_id}{suffix}"
    stored_path = UPLOAD_DIR / stored_name
    stored_path.write_bytes(raw)
    resolved_use_llm = use_llm if use_llm is not None else settings.default_use_llm
    db.create_job(
        job_id=job_id,
        mode=mode,
        input_method="file",
        file_name=file.filename,
        file_path=str(stored_path),
        title=title,
    )
    if wait:
        try:
            report = await analyzer.run_saved_job(job_id=job_id, use_llm=resolved_use_llm)
        except Exception as exc:
            await analyzer.fail_job(job_id, exc)
            raise
        return {"job_id": job_id, "status": "completed", "result": report.model_dump()}

    background_tasks.add_task(_safe_process_saved_job, analyzer, job_id, resolved_use_llm)
    return {"job_id": job_id, "status": "queued"}


async def _safe_process_text_job(
    analyzer: AnalyzerService,
    job_id: str,
    mode: ScanMode,
    text: str,
    title: str | None,
    use_llm: bool,
) -> None:
    try:
        await analyzer.run_text_scan(job_id=job_id, mode=mode, text=text, title=title, use_llm=use_llm)
    except Exception as exc:
        await analyzer.fail_job(job_id, exc)


async def _safe_process_saved_job(analyzer: AnalyzerService, job_id: str, use_llm: bool) -> None:
    try:
        await analyzer.run_saved_job(job_id=job_id, use_llm=use_llm)
    except Exception as exc:
        await analyzer.fail_job(job_id, exc)
