"""Redaction helpers for evidence and test artifacts."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import urlsplit

from .sentinels import ALL_SENTINELS, REDACTED_SENTINEL

SECRET_SHAPE_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{3,}\b", re.IGNORECASE),
    re.compile(r"https?://[^/\s:@]+:[^/\s@]+@"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"(?i)\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+"),
    re.compile(r"(?i)\b(?:auth|credential)s?\s*[:=]\s*\S+"),
)


def redact_text(value: object) -> str:
    text = str(value)
    for sentinel in ALL_SENTINELS:
        text = text.replace(sentinel, REDACTED_SENTINEL)
    return text


def has_url_userinfo(value: object) -> bool:
    text = str(value)
    try:
        parsed = urlsplit(text)
    except ValueError:
        return False
    return bool(parsed.scheme and parsed.netloc and parsed.username)


def has_secret_shape(value: object) -> bool:
    text = str(value)
    if "\n" in text and ("BEGIN" in text and "KEY" in text):
        return True
    if has_url_userinfo(text):
        return True
    return any(pattern.search(text) for pattern in SECRET_SHAPE_PATTERNS)


def redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, Mapping):
        return {str(key): redact_value(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return tuple(redact_value(item) for item in value)
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [redact_value(item) for item in value]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, (bytes, bytearray)):
        return redact_text(value.decode("utf-8", errors="replace"))
    return redact_text(value)


def sanitize_for_evidence(value: Any) -> Any:
    redacted = redact_value(value)
    assert_no_sentinel(redacted)
    assert_no_secret_shape(redacted)
    return redacted


def render_raw_for_validation(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(
        value,
        sort_keys=True,
        ensure_ascii=True,
        default=str,
    )


def sanitized_json(value: Any) -> str:
    return json.dumps(redact_value(value), sort_keys=True, ensure_ascii=True)


def assert_no_sentinel(value: Any) -> None:
    rendered = render_raw_for_validation(value)
    leaked = [sentinel for sentinel in ALL_SENTINELS if sentinel in rendered]
    if leaked:
        raise AssertionError(f"unredacted sentinel leaked: {leaked[0]}")


def assert_no_secret_shape(value: Any) -> None:
    rendered = render_raw_for_validation(value)
    if has_secret_shape(rendered):
        raise AssertionError("secret-shaped value leaked")
