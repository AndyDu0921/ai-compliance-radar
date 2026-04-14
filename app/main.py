from __future__ import annotations

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import FRONTEND_DIR, STATIC_DIR, settings
from app.routers.health import router as health_router
from app.routers.scans import router as scan_router
from app.services.analyzer import AnalyzerService


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description="Production-ready MVP for SMB ad-copy and contract risk screening.",
    )
    app.state.analyzer = AnalyzerService()

    # Legacy static assets (kept for compatibility)
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    # API routers — must be registered BEFORE the SPA catch-all below
    app.include_router(health_router)
    app.include_router(scan_router)

    # React SPA — html=True means unknown paths serve index.html (client-side routing)
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

    return app


app = create_app()
