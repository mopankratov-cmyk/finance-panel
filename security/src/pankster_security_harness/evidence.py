"""Sanitized evidence events for the Phase 1A harness."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .redaction import assert_no_secret_shape, assert_no_sentinel, sanitize_for_evidence, sanitized_json


@dataclass(frozen=True)
class EvidenceEvent:
    event_type: str
    payload: dict[str, Any]

    def sanitized(self) -> dict[str, Any]:
        event = {
            "event_type": sanitize_for_evidence(self.event_type),
            "payload": sanitize_for_evidence(self.payload),
        }
        assert_no_sentinel(event)
        assert_no_secret_shape(event)
        return event

    def to_json(self) -> str:
        rendered = sanitized_json(self.sanitized())
        assert_no_sentinel(rendered)
        assert_no_secret_shape(rendered)
        return rendered


def argv_snapshot(argv: list[str]) -> dict[str, Any]:
    event = {"argv": sanitize_for_evidence(argv), "argv_count": len(argv)}
    assert_no_sentinel(event)
    assert_no_secret_shape(event)
    return event


def write_sanitized_evidence(path: Path, event: EvidenceEvent) -> None:
    rendered = event.to_json()
    assert_no_sentinel(rendered)
    assert_no_secret_shape(rendered)
    path.write_text(rendered + "\n", encoding="utf-8")
