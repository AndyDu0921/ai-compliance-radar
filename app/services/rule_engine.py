from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.config import RULES_DIR
from app.models import RiskItem, ScanMode, Severity


SEVERITY_ORDER = {
    Severity.critical: 5,
    Severity.high: 4,
    Severity.medium: 3,
    Severity.low: 2,
    Severity.info: 1,
}

SEVERITY_WEIGHTS = {
    Severity.critical: 24,
    Severity.high: 15,
    Severity.medium: 8,
    Severity.low: 3,
    Severity.info: 1,
}


@dataclass(slots=True)
class Rule:
    id: str
    title: str
    pattern: str
    severity: Severity
    category: str
    explanation: str
    suggestion: str
    references: list[str]


@lru_cache(maxsize=8)
def load_rulepack(mode: ScanMode) -> list[Rule]:
    file_path = Path(RULES_DIR) / f"{mode.value}.json"
    raw = json.loads(file_path.read_text(encoding="utf-8"))
    rules = []
    for item in raw["rules"]:
        rules.append(
            Rule(
                id=item["id"],
                title=item["title"],
                pattern=item["pattern"],
                severity=Severity(item["severity"]),
                category=item["category"],
                explanation=item["explanation"],
                suggestion=item["suggestion"],
                references=item.get("references", []),
            )
        )
    return rules


def list_rulepacks() -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for mode in ScanMode:
        rules = load_rulepack(mode)
        output.append(
            {
                "mode": mode.value,
                "rule_count": len(rules),
                "critical_rules": sum(1 for rule in rules if rule.severity == Severity.critical),
                "high_rules": sum(1 for rule in rules if rule.severity == Severity.high),
            }
        )
    return output


class RuleEngine:
    def scan(self, *, mode: ScanMode, text: str) -> list[RiskItem]:
        findings: list[RiskItem] = []
        seen: set[tuple[str, str]] = set()
        for rule in load_rulepack(mode):
            for match in re.finditer(rule.pattern, text, flags=re.IGNORECASE | re.MULTILINE):
                excerpt = build_excerpt(text, match.start(), match.end())
                dedupe_key = (rule.id, excerpt)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                findings.append(
                    RiskItem(
                        id=rule.id,
                        title=rule.title,
                        severity=rule.severity,
                        category=rule.category,
                        excerpt=excerpt,
                        explanation=rule.explanation,
                        suggestion=rule.suggestion,
                        source="rule",
                        confidence=0.92,
                        references=rule.references,
                    )
                )
        findings.sort(key=lambda item: SEVERITY_ORDER[item.severity], reverse=True)
        return findings

    def score(self, findings: list[RiskItem]) -> int:
        total = sum(SEVERITY_WEIGHTS[item.severity] for item in findings)
        return min(100, total)


def build_excerpt(text: str, start: int, end: int, radius: int = 32) -> str:
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    excerpt = text[left:right].replace("\n", " ").strip()
    return excerpt
