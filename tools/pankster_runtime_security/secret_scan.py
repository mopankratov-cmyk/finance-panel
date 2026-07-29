"""Pure secret-shape scanner for Phase 1E runtime-security contracts."""

from __future__ import annotations

from dataclasses import dataclass
from fnmatch import fnmatchcase
import re
from typing import Any, Mapping, Sequence


SENSITIVE_FIELD_NAMES = frozenset(
    {
        "api_key",
        "access_token",
        "refresh_token",
        "authorization",
        "authorization_header",
        "raw_request_headers",
        "raw_response_headers",
        "provider_secret_value",
        "root_auth_json_content",
        "credential_pool",
        "root_credential_pool",
        "plaintext_credential",
        "environment_value",
        "environment_secret_value",
        "private_key",
        "password",
    }
)

SENSITIVE_KEY_PATTERNS = (
    "*_KEY",
    "*_TOKEN",
    "*_SECRET",
    "*_PASSWORD",
    "ANTHROPIC_*",
    "OPENAI_*",
    "GLM_*",
    "GITEA_*",
    "SUPABASE_*",
    "TELEGRAM_*",
    "E2B_API_KEY",
)

SECRET_VALUE_PATTERNS = (
    ("OPENAI_PROJECT_KEY_SHAPE", re.compile(r"sk-proj-[A-Za-z0-9_-]{20,}")),
    ("PRIVATE_KEY_BLOCK_SHAPE", re.compile(r"BEGIN [A-Z ]*PRIVATE KEY")),
    ("BEARER_AUTHORIZATION_SHAPE", re.compile(r"\bBearer\s+[A-Za-z0-9._-]{12,}", re.IGNORECASE)),
    ("AWS_ACCESS_KEY_SHAPE", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("JWT_SHAPE", re.compile(r"\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b")),
)


@dataclass(frozen=True)
class SecretFinding:
    """Secret-shaped finding without the sensitive value."""

    path: str
    reason: str


@dataclass(frozen=True)
class SecretScanResult:
    """Secret-free scan result."""

    allowed: bool
    findings: tuple[SecretFinding, ...]


def scan_secret_shapes(payload: Any) -> SecretScanResult:
    """Detect secret-shaped fields and values without returning values.

    The scanner is intentionally pure. It does not read files, process
    environment, auth stores, Keychain, network, or provider SDKs.
    """

    findings = tuple(_scan(payload, "$"))
    return SecretScanResult(not findings, findings)


def is_secret_field_name(name: object) -> bool:
    key = str(name)
    normalized = key.lower()
    if normalized in SENSITIVE_FIELD_NAMES:
        return True
    upper_key = key.upper()
    return any(fnmatchcase(upper_key, pattern) for pattern in SENSITIVE_KEY_PATTERNS)


def _scan(value: Any, path: str) -> tuple[SecretFinding, ...]:
    findings: list[SecretFinding] = []
    if isinstance(value, Mapping):
        for raw_key, nested in value.items():
            key = str(raw_key)
            nested_path = f"{path}.{key}"
            if is_secret_field_name(key):
                findings.append(SecretFinding(nested_path, "SENSITIVE_FIELD_NAME"))
            findings.extend(_scan(nested, nested_path))
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for index, nested in enumerate(value):
            findings.extend(_scan(nested, f"{path}[{index}]"))
    elif isinstance(value, str):
        for reason, pattern in SECRET_VALUE_PATTERNS:
            if pattern.search(value):
                findings.append(SecretFinding(path, reason))
                break
    return tuple(findings)
