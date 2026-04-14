from __future__ import annotations

import json
import re
from typing import Any

import httpx

from app.config import settings
from app.models import RiskItem, ScanMode, Severity


class LLMClient:
    def __init__(self) -> None:
        self.enabled = settings.llm_enabled

    async def analyze(self, *, mode: ScanMode, text: str, deterministic_hits: list[RiskItem]) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        prompt = build_prompt(mode=mode, text=text, deterministic_hits=deterministic_hits)
        headers = {
            "Authorization": f"Bearer {settings.llm_api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": settings.llm_model,
            "temperature": 0.1,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a careful compliance analyst. Respond with valid JSON only. "
                        "Do not use markdown fences. Never claim legal certainty."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        }
        endpoint = settings.llm_base_url.rstrip("/") + "/chat/completions"
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            response = await client.post(endpoint, headers=headers, json=body)
            response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        return parse_json_object(content)


def build_prompt(*, mode: ScanMode, text: str, deterministic_hits: list[RiskItem]) -> str:
    serialized_hits = [
        {
            "title": item.title,
            "severity": item.severity.value,
            "category": item.category,
            "excerpt": item.excerpt,
            "explanation": item.explanation,
            "suggestion": item.suggestion,
        }
        for item in deterministic_hits[:12]
    ]
    return f"""
Task:
Review the following content and return a strict JSON object with these keys:
- summary: string
- risk_score_adjustment: integer between 0 and 20
- risks: array of objects with keys title, severity, category, excerpt, explanation, suggestion, confidence
- rewrite_suggestions: array of short strings
- needs_human_review: array of short strings

Constraints:
- mode = {mode.value}
- Keep 3 to 8 risks maximum.
- Severity must be one of critical/high/medium/low/info.
- Never cite article numbers unless you are certain; generic compliance references are allowed.
- This is an assistant, not a law firm. Be cautious.

Deterministic findings already detected:
{json.dumps(serialized_hits, ensure_ascii=False)}

Content to review:
{text[:14000]}
""".strip()


def parse_json_object(raw: str) -> dict[str, Any]:
    candidate = raw.strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```[a-zA-Z]*", "", candidate).strip()
        candidate = candidate.rstrip("`").strip()
    if not candidate.startswith("{"):
        match = re.search(r"\{.*\}", candidate, flags=re.DOTALL)
        if match:
            candidate = match.group(0)
    parsed = json.loads(candidate)
    if not isinstance(parsed, dict):
        raise ValueError("LLM payload is not an object")
    return parsed
