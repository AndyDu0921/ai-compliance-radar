from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from app.db import get_db
from app.models import JobStatus, RiskItem, ScanMode, ScanReport, Severity
from app.services.llm_client import LLMClient
from app.services.parser import parse_text_from_path
from app.services.rule_engine import RuleEngine, SEVERITY_ORDER


class AnalyzerService:
    def __init__(self) -> None:
        self.db = get_db()
        self.rule_engine = RuleEngine()
        self.llm_client = LLMClient()

    async def run_text_scan(
        self,
        *,
        job_id: str,
        mode: ScanMode,
        text: str,
        title: str | None,
        use_llm: bool,
    ) -> ScanReport:
        self.db.update_job_status(job_id, JobStatus.processing)
        report = await self._generate_report(
            job_id=job_id,
            mode=mode,
            text=text,
            title=title,
            use_llm=use_llm,
            source_name=None,
        )
        self.db.complete_job(job_id, report)
        return report

    async def run_saved_job(self, job_id: str, use_llm: bool) -> ScanReport:
        payload = self.db.fetch_input(job_id)
        if not payload:
            raise ValueError("job not found")
        self.db.update_job_status(job_id, JobStatus.processing)
        text = payload["input_text"] or ""
        if payload["input_method"] == "file":
            text = parse_text_from_path(Path(payload["file_path"]))
        report = await self._generate_report(
            job_id=job_id,
            mode=ScanMode(payload["mode"]),
            text=text,
            title=payload.get("title"),
            use_llm=use_llm,
            source_name=payload.get("file_name"),
        )
        self.db.complete_job(job_id, report)
        return report

    async def fail_job(self, job_id: str, exc: Exception) -> None:
        self.db.update_job_status(job_id, JobStatus.failed, error_message=str(exc))

    async def _generate_report(
        self,
        *,
        job_id: str,
        mode: ScanMode,
        text: str,
        title: str | None,
        use_llm: bool,
        source_name: str | None,
    ) -> ScanReport:
        normalized = text.strip()
        hits = self.rule_engine.scan(mode=mode, text=normalized)
        llm_payload: dict[str, Any] | None = None
        llm_items: list[RiskItem] = []
        llm_used = False
        if use_llm and self.llm_client.enabled:
            llm_payload = await self.llm_client.analyze(mode=mode, text=normalized, deterministic_hits=hits)
            llm_items = self._normalize_llm_risks(llm_payload)
            llm_used = bool(llm_payload)
        combined = merge_findings(hits, llm_items)
        score = min(100, self.rule_engine.score(hits) + int((llm_payload or {}).get("risk_score_adjustment", 0)))
        if llm_items:
            score = min(100, max(score, self.rule_engine.score(combined)))
        summary = (
            (llm_payload or {}).get("summary")
            or build_summary(mode=mode, findings=combined)
        )
        rewrite_suggestions = list(dict.fromkeys((llm_payload or {}).get("rewrite_suggestions", [])))
        human_review = list(dict.fromkeys((llm_payload or {}).get("needs_human_review", [])))
        recommended = recommend_actions(mode=mode, findings=combined, rewrite_suggestions=rewrite_suggestions)
        warnings = [
            "This tool provides a risk triage report, not a formal legal opinion.",
            "High-risk or mission-critical documents should still be reviewed by a qualified professional.",
        ]
        if human_review:
            warnings.extend([f"Human review suggested: {item}" for item in human_review[:3]])
        metadata = {
            "source_name": source_name,
            "content_length": len(normalized),
            "severity_breakdown": dict(Counter(item.severity.value for item in combined)),
        }
        return ScanReport(
            job_id=job_id,
            title=title or source_name,
            mode=mode,
            risk_score=score,
            summary=summary,
            recommended_actions=recommended,
            risk_items=combined,
            warnings=warnings,
            llm_used=llm_used,
            deterministic_hit_count=len(hits),
            metadata=metadata,
        )

    def _normalize_llm_risks(self, payload: dict[str, Any] | None) -> list[RiskItem]:
        if not payload:
            return []
        items: list[RiskItem] = []
        for index, raw in enumerate(payload.get("risks", [])[:8], start=1):
            severity_value = str(raw.get("severity", "medium")).lower()
            if severity_value not in Severity._value2member_map_:
                severity_value = "medium"
            items.append(
                RiskItem(
                    id=f"llm-{index}",
                    title=str(raw.get("title", "Potential issue")).strip() or "Potential issue",
                    severity=Severity(severity_value),
                    category=str(raw.get("category", "llm_review")),
                    excerpt=str(raw.get("excerpt", "")),
                    explanation=str(raw.get("explanation", "")),
                    suggestion=str(raw.get("suggestion", "")),
                    source="llm",
                    confidence=float(raw.get("confidence", 0.65) or 0.65),
                    references=["LLM assisted review"],
                )
            )
        return items


def merge_findings(rule_items: list[RiskItem], llm_items: list[RiskItem]) -> list[RiskItem]:
    output = list(rule_items)
    existing = {(item.title, item.excerpt) for item in output}
    for item in llm_items:
        key = (item.title, item.excerpt)
        if key not in existing:
            output.append(item)
            existing.add(key)
    output.sort(key=lambda item: (SEVERITY_ORDER[item.severity], item.confidence), reverse=True)
    return output


def build_summary(*, mode: ScanMode, findings: list[RiskItem]) -> str:
    if not findings:
        return (
            "No obvious rule-based issues were detected. This usually means the content passed the first-pass screen, "
            "not that it is legally risk-free."
        )
    severity_counts = Counter(item.severity.value for item in findings)
    top_categories = Counter(item.category for item in findings).most_common(3)
    category_label = ", ".join(cat for cat, _ in top_categories)
    return (
        f"Detected {len(findings)} potential issues for {mode.value}. "
        f"Severity mix: {dict(severity_counts)}. "
        f"Main risk clusters: {category_label}."
    )


def recommend_actions(*, mode: ScanMode, findings: list[RiskItem], rewrite_suggestions: list[str]) -> list[str]:
    actions: list[str] = []
    if mode == ScanMode.ad_copy:
        actions.extend(
            [
                "Remove absolute claims, guaranteed outcomes, or authority endorsements that cannot be substantiated.",
                "Replace risky language with factual, measurable, and reviewable descriptions.",
                "For medical, financial, education, or live-commerce copy, run a manual compliance review before publishing.",
            ]
        )
    else:
        actions.extend(
            [
                "Review one-sided termination, refund, liability, and jurisdiction clauses with a human reviewer.",
                "Clarify payment, acceptance, delivery, confidentiality, and IP ownership terms in plain language.",
                "Add negotiation notes for any clause that gives one side broad unilateral control.",
            ]
        )
    for item in findings[:5]:
        if item.suggestion and item.suggestion not in actions:
            actions.append(item.suggestion)
    for suggestion in rewrite_suggestions[:3]:
        if suggestion not in actions:
            actions.append(suggestion)
    return actions[:8]
