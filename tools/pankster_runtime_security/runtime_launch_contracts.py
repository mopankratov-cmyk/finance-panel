"""Pure runtime launch contracts for Phase 1E runtime-security gates."""

from __future__ import annotations

from dataclasses import dataclass
from fnmatch import fnmatchcase
from typing import Mapping


SYSTEM_PRESERVE_KEYS = frozenset({"PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "SHELL", "NO_PROXY", "no_proxy"})
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
class ProfileEnvironmentPolicy:
    profile_id: str
    allowed_environment_keys: tuple[str, ...]
    hermes_kanban_prefix_allowed: bool = True


@dataclass(frozen=True)
class RuntimeLaunchContext:
    owner_approval_verified: bool
    profile_id: str
    workflow_id: str
    task_id: str
    attempt_id: str
    runtime_identity_hash: str
    network_policy_id: str
    policy_version: str
    grant_refs: tuple[str, ...]


@dataclass(frozen=True)
class RuntimeSanitizedEnvironment:
    env: Mapping[str, str]
    denied_keys: tuple[str, ...]
    ignored_keys: tuple[str, ...]


@dataclass(frozen=True)
class RuntimeLaunchDecision:
    allowed: bool
    reason: str
    sanitized_environment: RuntimeSanitizedEnvironment
    lifecycle_state: str
    runtime_started: bool = False


EMPTY_RUNTIME_ENVIRONMENT = RuntimeSanitizedEnvironment({}, (), ())


def build_child_environment(
    *,
    source_environment: Mapping[str, object] | None,
    profile_policy: ProfileEnvironmentPolicy,
    context: RuntimeLaunchContext,
) -> RuntimeSanitizedEnvironment:
    """Build a profile-scoped child environment from an explicit mapping."""

    if not isinstance(source_environment, Mapping):
        source_environment = {}
    env: dict[str, str] = {}
    denied: list[str] = []
    ignored: list[str] = []
    allowed = SYSTEM_PRESERVE_KEYS | set(profile_policy.allowed_environment_keys)

    for raw_key, raw_value in source_environment.items():
        key = str(raw_key)
        if _is_denied_key(key):
            denied.append(key)
            continue
        if key in allowed or (profile_policy.hermes_kanban_prefix_allowed and key.startswith("HERMES_KANBAN_")):
            if isinstance(raw_value, str):
                env[key] = raw_value
            else:
                ignored.append(key)
            continue
        ignored.append(key)

    env.update(
        {
            "HERMES_KANBAN_PROFILE_ID": context.profile_id,
            "HERMES_KANBAN_WORKFLOW_ID": context.workflow_id,
            "HERMES_KANBAN_TASK_ID": context.task_id,
            "HERMES_KANBAN_ATTEMPT_ID": context.attempt_id,
            "HERMES_KANBAN_POLICY_VERSION": context.policy_version,
            "HERMES_KANBAN_NETWORK_POLICY_ID": context.network_policy_id,
            "HERMES_KANBAN_GRANT_REFS": ",".join(context.grant_refs),
        }
    )
    return RuntimeSanitizedEnvironment(dict(sorted(env.items())), tuple(sorted(denied)), tuple(sorted(ignored)))


def prepare_runtime_launch(
    *,
    source_environment: Mapping[str, object] | None,
    profile_policy: ProfileEnvironmentPolicy,
    context: RuntimeLaunchContext,
    audit_available: bool,
    broker_available: bool,
) -> RuntimeLaunchDecision:
    """Prepare a launch decision without starting a runtime."""

    context_reason = _context_denial_reason(context, profile_policy)
    if context_reason is not None:
        return RuntimeLaunchDecision(False, context_reason, EMPTY_RUNTIME_ENVIRONMENT, "launch_denied_or_started")
    if not audit_available:
        return RuntimeLaunchDecision(False, "AUDIT_UNAVAILABLE", EMPTY_RUNTIME_ENVIRONMENT, "launch_denied_or_started")
    if not broker_available:
        return RuntimeLaunchDecision(False, "BROKER_UNAVAILABLE", EMPTY_RUNTIME_ENVIRONMENT, "launch_denied_or_started")
    sanitized = build_child_environment(source_environment=source_environment, profile_policy=profile_policy, context=context)
    if sanitized.denied_keys:
        return RuntimeLaunchDecision(False, "SANITIZER_DENIED_SENSITIVE_KEY", sanitized, "environment_sanitized")
    return RuntimeLaunchDecision(False, "RUNTIME_LAUNCH_NOT_IMPLEMENTED", sanitized, "grant_refs_attached")


def prepare_retry_reclaim_restart(
    *,
    original_context: RuntimeLaunchContext,
    next_context: RuntimeLaunchContext,
) -> RuntimeLaunchDecision:
    """Validate retry/reclaim/restart context binding without execution."""

    for field in ("profile_id", "workflow_id", "task_id", "attempt_id", "runtime_identity_hash", "network_policy_id", "policy_version", "grant_refs"):
        if getattr(original_context, field) != getattr(next_context, field):
            return RuntimeLaunchDecision(False, f"REVALIDATION_CONTEXT_MISMATCH:{field}", EMPTY_RUNTIME_ENVIRONMENT, "retry_requested")
    return RuntimeLaunchDecision(False, "REVALIDATED_NOT_IMPLEMENTED", EMPTY_RUNTIME_ENVIRONMENT, "retry_requested")


def _context_denial_reason(context: RuntimeLaunchContext, profile_policy: ProfileEnvironmentPolicy) -> str | None:
    if not context.owner_approval_verified:
        return "OWNER_APPROVAL_MISSING"
    for field, value in (
        ("profile_id", context.profile_id),
        ("workflow_id", context.workflow_id),
        ("task_id", context.task_id),
        ("attempt_id", context.attempt_id),
        ("runtime_identity_hash", context.runtime_identity_hash),
        ("network_policy_id", context.network_policy_id),
        ("policy_version", context.policy_version),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"RUNTIME_CONTEXT_FIELD_MISSING:{field}"
    if context.profile_id != profile_policy.profile_id:
        return "PROFILE_POLICY_MISMATCH"
    if not context.grant_refs:
        return "GRANT_REFS_MISSING"
    if not all(isinstance(grant_ref, str) and grant_ref.strip() for grant_ref in context.grant_refs):
        return "GRANT_REF_INVALID"
    return None


def _is_denied_key(key: str) -> bool:
    upper_key = key.upper()
    return any(fnmatchcase(upper_key, pattern) for pattern in MANDATORY_DENYLIST)
