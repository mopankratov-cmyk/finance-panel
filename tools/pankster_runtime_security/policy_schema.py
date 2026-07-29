"""Pure profile policy schema validation for Phase 1D runtime-security gates."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping


GRANT_TTL_SECONDS_MAX = 900

REQUIRED_FIELDS = frozenset(
    {
        "profile_id",
        "enabled",
        "owner_principal_id",
        "policy_version",
        "runtime_backend",
        "network_policy_id",
        "model_provider_allowlist",
        "model_allowlist",
        "operation_allowlist",
        "grant_ttl_seconds_max",
        "budget",
        "rate_limits",
        "credential_reference_allowlist",
        "environment_policy_id",
        "artifact_policy_id",
        "audit_policy_id",
        "rollback_policy_id",
    }
)

FORBIDDEN_FIELDS = frozenset(
    {
        "api_key",
        "access_token",
        "refresh_token",
        "authorization_header",
        "provider_secret_value",
        "root_auth_json_path",
        "root_credential_pool",
        "plaintext_credential",
        "environment_secret_value",
    }
)

BUDGET_FIELDS = frozenset(
    {
        "max_usd_per_attempt",
        "max_tokens_per_attempt",
        "max_requests_per_attempt",
        "max_wall_clock_seconds",
        "max_retries",
    }
)


@dataclass(frozen=True)
class PolicyValidationResult:
    """Secret-free validation result."""

    allowed: bool
    reasons: tuple[str, ...]
    normalized_keys: tuple[str, ...]


def validate_profile_policy(policy: Mapping[str, Any] | None, *, require_enabled: bool = True) -> PolicyValidationResult:
    """Validate a profile policy without side effects.

    The function never reads process environment, files, Keychain, auth stores,
    or network. It reports only field names and reason codes, never values.
    """

    reasons: list[str] = []
    if not isinstance(policy, Mapping):
        return PolicyValidationResult(False, ("POLICY_NOT_MAPPING",), ())

    keys = tuple(sorted(str(key) for key in policy.keys()))
    missing = sorted(REQUIRED_FIELDS - set(policy.keys()))
    if missing:
        reasons.extend(f"MISSING_FIELD:{field}" for field in missing)

    forbidden_paths = _find_forbidden_field_paths(policy)
    if forbidden_paths:
        reasons.extend(f"FORBIDDEN_FIELD:{path}" for path in forbidden_paths)

    if policy.get("enabled") is not True and require_enabled:
        reasons.append("PROFILE_DISABLED")
    elif "enabled" in policy and not isinstance(policy.get("enabled"), bool):
        reasons.append("ENABLED_NOT_BOOLEAN")

    for field in (
        "profile_id",
        "owner_principal_id",
        "policy_version",
        "runtime_backend",
        "network_policy_id",
        "environment_policy_id",
        "artifact_policy_id",
        "audit_policy_id",
        "rollback_policy_id",
    ):
        if field in policy and not _is_nonempty_string(policy[field]):
            reasons.append(f"INVALID_STRING:{field}")

    for field in ("model_provider_allowlist", "model_allowlist", "operation_allowlist", "credential_reference_allowlist"):
        if field in policy and not _is_nonempty_string_list(policy[field]):
            reasons.append(f"INVALID_ALLOWLIST:{field}")

    ttl = policy.get("grant_ttl_seconds_max")
    if ttl is not None and not _is_int_in_range(ttl, minimum=1, maximum=GRANT_TTL_SECONDS_MAX):
        reasons.append("INVALID_GRANT_TTL")

    budget = policy.get("budget")
    if budget is not None:
        reasons.extend(_validate_budget(budget))

    rate_limits = policy.get("rate_limits")
    if rate_limits is not None and not isinstance(rate_limits, Mapping):
        reasons.append("INVALID_RATE_LIMITS")

    return PolicyValidationResult(not reasons, tuple(reasons), keys)


def _is_nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_nonempty_string_list(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(_is_nonempty_string(item) for item in value)


def _is_int_in_range(value: Any, *, minimum: int, maximum: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum


def _validate_budget(value: Any) -> list[str]:
    reasons: list[str] = []
    if not isinstance(value, Mapping):
        return ["INVALID_BUDGET"]
    missing = sorted(BUDGET_FIELDS - set(value.keys()))
    if missing:
        reasons.extend(f"MISSING_BUDGET_FIELD:{field}" for field in missing)
    for field in BUDGET_FIELDS.intersection(value.keys()):
        amount = value[field]
        if isinstance(amount, bool) or not isinstance(amount, (int, float)) or amount < 0:
            reasons.append(f"INVALID_BUDGET_FIELD:{field}")
    return reasons


def _find_forbidden_field_paths(value: Any, prefix: str = "") -> tuple[str, ...]:
    paths: list[str] = []
    if isinstance(value, Mapping):
        for raw_key, nested in value.items():
            key = str(raw_key)
            path = f"{prefix}.{key}" if prefix else key
            if key in FORBIDDEN_FIELDS:
                paths.append(path)
            paths.extend(_find_forbidden_field_paths(nested, path))
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            paths.extend(_find_forbidden_field_paths(nested, f"{prefix}[{index}]"))
    return tuple(sorted(paths))

