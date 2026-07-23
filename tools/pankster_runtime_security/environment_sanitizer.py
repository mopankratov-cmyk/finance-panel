"""Pure environment sanitizer for Phase 1D runtime-security gates."""

from __future__ import annotations

from dataclasses import dataclass
from fnmatch import fnmatchcase
from typing import Mapping


PRESERVE_KEYS = frozenset({"PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "SHELL", "NO_PROXY", "no_proxy"})
PANKSTER_RUNTIME_KEYS = frozenset(
    {
        "PANKSTER_PROFILE_ID",
        "PANKSTER_WORKFLOW_ID",
        "PANKSTER_TASK_ID",
        "PANKSTER_ATTEMPT_ID",
        "PANKSTER_POLICY_VERSION",
        "PANKSTER_GRANT_IDS",
        "PANKSTER_BROKER_MODE",
        "PANKSTER_NETWORK_POLICY",
    }
)
MANDATORY_DENYLIST = (
    "*_KEY",
    "*_TOKEN",
    "*_SECRET",
    "*_PASSWORD",
    "AUTHORIZATION",
    "ANTHROPIC_*",
    "OPENAI_*",
    "GLM_*",
    "GITEA_*",
    "SUPABASE_*",
    "TELEGRAM_*",
    "E2B_API_KEY",
)


@dataclass(frozen=True)
class SanitizedEnvironment:
    """Secret-free sanitizer result."""

    env: dict[str, str]
    denied_keys: tuple[str, ...]
    ignored_keys: tuple[str, ...]


def sanitize_environment(source: Mapping[str, object] | None) -> SanitizedEnvironment:
    """Return an allowlisted environment from an explicit mapping.

    The sanitizer never reads process environment, env files, auth stores,
    Keychain, network, or filesystem state. Denylist matching wins over allowlist.
    """

    if not isinstance(source, Mapping):
        return SanitizedEnvironment({}, (), ())

    env: dict[str, str] = {}
    denied: list[str] = []
    ignored: list[str] = []
    allowed_keys = PRESERVE_KEYS | PANKSTER_RUNTIME_KEYS

    for raw_key, raw_value in source.items():
        key = str(raw_key)
        if _is_denied_key(key):
            denied.append(key)
            continue
        if key not in allowed_keys:
            ignored.append(key)
            continue
        if not isinstance(raw_value, str):
            ignored.append(key)
            continue
        env[key] = raw_value

    return SanitizedEnvironment(env, tuple(sorted(denied)), tuple(sorted(ignored)))


def _is_denied_key(key: str) -> bool:
    upper_key = key.upper()
    return any(fnmatchcase(upper_key, pattern) for pattern in MANDATORY_DENYLIST)

