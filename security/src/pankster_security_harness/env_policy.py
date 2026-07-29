"""Environment construction policy for the safe prototype."""

from __future__ import annotations

import re
from pathlib import Path

from .redaction import has_secret_shape
from .sentinels import contains_sentinel

DEFAULT_ENV_ALLOWLIST = frozenset(
    {
        "PATH",
        "HOME",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "SHELL",
        "NO_PROXY",
        "no_proxy",
        "HERMES_HOME",
    }
)

KANBAN_ENV_ALLOWLIST = frozenset(
    {
        "HERMES_KANBAN_DB",
        "HERMES_KANBAN_TASK_ID",
        "HERMES_KANBAN_RUN_ID",
        "HERMES_KANBAN_PROFILE_ID",
    }
)

ENV_NAME_CATALOG = DEFAULT_ENV_ALLOWLIST | KANBAN_ENV_ALLOWLIST

MANDATORY_SECRET_DENYLIST = frozenset(
    {
        "ANTHROPIC_API_KEY",
        "DEEPSEEK_API_KEY",
        "GITEA_TOKEN",
        "GLM_API_KEY",
        "KIMI_API_KEY",
        "MCP_FAKE_TOKEN",
        "OAUTH_REFRESH_TOKEN",
        "OPENAI_API_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_URL",
        "TELEGRAM_BOT_TOKEN",
    }
)

SECRET_NAME_PATTERN = re.compile(r"(KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL)", re.IGNORECASE)
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class EnvironmentPolicyError(ValueError):
    pass


def is_allowed_env_name(name: str, allowlist: frozenset[str]) -> bool:
    return name in allowlist and name in ENV_NAME_CATALOG


def is_denied_env_name(name: str, denylist: frozenset[str]) -> bool:
    return name in denylist or bool(SECRET_NAME_PATTERN.search(name))


def build_safe_environment(
    *,
    source_env: dict[str, str],
    profile_home: Path,
    hermes_home: Path,
    allowlist: frozenset[str],
    required: frozenset[str],
    denylist: frozenset[str],
    session_id: str,
    overrides: dict[str, str] | None = None,
) -> dict[str, str]:
    """Build a worker environment from an explicit allowlist.

    The function intentionally does not read os.environ. Callers must pass a
    synthetic source environment in tests or a vetted source in production code.
    """

    env: dict[str, str] = {}
    merged_denylist = frozenset(set(denylist) | set(MANDATORY_SECRET_DENYLIST))
    overrides = overrides or {}

    for name, value in source_env.items():
        if is_allowed_env_name(name, allowlist) and not is_denied_env_name(name, merged_denylist):
            env[name] = value

    env["HOME"] = str(profile_home)
    env["HERMES_HOME"] = str(hermes_home)
    env["TMPDIR"] = str(create_profile_tmpdir(profile_home=profile_home, session_id=session_id))

    for name, value in overrides.items():
        if is_denied_env_name(name, merged_denylist):
            raise EnvironmentPolicyError(f"override collides with denied env name: {name}")
        if not is_allowed_env_name(name, allowlist):
            raise EnvironmentPolicyError(f"override is not allowlisted: {name}")
        env[name] = value

    denied_present = [name for name in env if is_denied_env_name(name, merged_denylist)]
    if denied_present:
        raise EnvironmentPolicyError(f"denied env name survived policy: {denied_present[0]}")

    missing = sorted(name for name in required if name not in env)
    if missing:
        raise EnvironmentPolicyError(f"required env missing: {missing[0]}")

    secret_values = [name for name, value in env.items() if contains_sentinel(value)]
    if secret_values:
        raise EnvironmentPolicyError(f"secret-shaped synthetic value survived policy: {secret_values[0]}")
    for name, value in env.items():
        if has_secret_shape(value):
            raise EnvironmentPolicyError(f"secret-shaped value rejected for env key: {name}")

    return env


def _validate_safe_id(value: str, *, label: str) -> None:
    if not value or value.strip() != value:
        raise EnvironmentPolicyError(f"{label} must be a safe identifier")
    if "/" in value or "\\" in value or ".." in value:
        raise EnvironmentPolicyError(f"{label} must be a safe identifier")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise EnvironmentPolicyError(f"{label} must be a safe identifier")
    if not SAFE_ID_RE.fullmatch(value):
        raise EnvironmentPolicyError(f"{label} must be a safe identifier")


def create_profile_tmpdir(*, profile_home: Path, session_id: str) -> Path:
    _validate_safe_id(session_id, label="session_id")
    if not profile_home.is_absolute():
        raise EnvironmentPolicyError("profile_home must be absolute")
    resolved_home = profile_home.resolve()
    normalized = resolved_home / "runtime" / session_id / "tmp"
    try:
        normalized.relative_to(resolved_home)
    except ValueError as exc:
        raise EnvironmentPolicyError("TMPDIR escaped profile boundary") from exc

    candidate = profile_home / "runtime" / session_id / "tmp"
    if candidate.exists() and candidate.is_symlink():
        raise EnvironmentPolicyError("TMPDIR must not be a symlink")

    existing = candidate.parent
    while not existing.exists() and existing != existing.parent:
        existing = existing.parent
    if existing.exists() and existing.is_symlink():
        raise EnvironmentPolicyError("TMPDIR parent must not be a symlink")
    try:
        existing.resolve().relative_to(resolved_home)
    except ValueError as exc:
        raise EnvironmentPolicyError("TMPDIR escaped profile boundary") from exc

    for parent in normalized.parents:
        if parent == resolved_home.parent:
            break
        if parent.exists() and parent.is_symlink():
            raise EnvironmentPolicyError("TMPDIR parent must not be a symlink")

    tmpdir = normalized
    tmpdir.mkdir(parents=True, exist_ok=True)
    resolved_tmpdir = tmpdir.resolve()
    try:
        resolved_tmpdir.relative_to(resolved_home)
    except ValueError as exc:
        raise EnvironmentPolicyError("TMPDIR escaped profile boundary") from exc
    if tmpdir.is_symlink():
        raise EnvironmentPolicyError("TMPDIR must not be a symlink")
    return resolved_tmpdir


def sanitized_env_event(
    env: dict[str, str],
    *,
    policy_version: str,
    sources: dict[str, str] | None = None,
) -> dict[str, object]:
    sources = sources or {}
    event = {
        "env_keys": sorted(env),
        "value_metadata": {
            name: {
                "present": True,
                "source": sources.get(name, "allowlist"),
            }
            for name in sorted(env)
        },
        "policy_version": policy_version,
    }
    assert "env_values" not in event
    assert "redacted_env_values" not in event
    return {
        "env_keys": event["env_keys"],
        "value_metadata": event["value_metadata"],
        "policy_version": event["policy_version"],
    }


def baseline_no_proxy_allowlists() -> dict[str, frozenset[str]]:
    return {
        "terminal": frozenset({"PATH", "HOME", "TMPDIR", "LANG", "SHELL", "NO_PROXY"}),
        "code_execution": frozenset({"PATH", "HOME", "TMPDIR", "LANG", "SHELL", "no_proxy"}),
        "mcp": frozenset({"PATH", "HOME", "TMPDIR", "LANG", "SHELL", "NO_PROXY"}),
    }
