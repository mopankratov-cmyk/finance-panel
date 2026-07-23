#!/usr/bin/env python3
"""Validate the Phase 1C-A11 production profile policy contract.

This validator is read-only. It does not call providers, start sandboxes,
restart gateways, run profiles, read credentials, or change runtime state.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.validate_installation_manifest import canonical_json_bytes


DEFAULT_CONTRACT = PROJECT_ROOT / "security/evidence/phase-1c-a11/production-profile-policy-contract.json"
EXPECTED_SCHEMA = "pankster.phase1c-a11.production-profile-policy-contract.v1"
EXPECTED_CONTENT_SHA = "2861465540563590d895cb99d2d1b40ce8e45512133102687c03c62c294d21cd"
EXPECTED_DECISION = "PRODUCTION_PROFILE_POLICY_CONTRACT_READY_FOR_SYNTHETIC_TEST_PLANNING_NOT_RUNTIME"
EXPECTED_STATUS = "PROFILE_POLICY_CONTRACT_COMPLETE_NO_PRODUCTION_APPROVAL"
EXPECTED_A10_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1c-a10/runtime-adapter-design-review.json"
EXPECTED_A10_EVIDENCE_SHA = "fd3aea723a55e95ca7abb5e4ca8f4d29a7d6f7983573613bc0663464f04ca9be"
EXPECTED_A10_CONTENT_SHA = "9a69b9d6c9d9cdc8b7a9100b06fd1546038396b353181073e2abfe101a1bf7b2"


class Phase1CA11ValidationError(RuntimeError):
    def __init__(self, reason: str, detail: str | None = None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f"{reason}: {detail}")


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _load_json(path: Path, missing_reason: str) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError as error:
        raise Phase1CA11ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA11ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA11ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1CA11ValidationError("SOURCE_A10_EVIDENCE_MISSING", str(path)) from error


def _expect_subset(values: object, expected: set[str], reason: str) -> None:
    if not isinstance(values, list):
        raise Phase1CA11ValidationError(reason, "not a list")
    missing = sorted(expected - set(values))
    if missing:
        raise Phase1CA11ValidationError(reason, ",".join(missing))


def _expect_false(content: dict, field: str) -> None:
    if content.get(field) is not False:
        raise Phase1CA11ValidationError(f"{field.upper()}_NOT_FALSE")


def _validate_a10_dependency() -> dict:
    if _sha256_file(EXPECTED_A10_EVIDENCE) != EXPECTED_A10_EVIDENCE_SHA:
        raise Phase1CA11ValidationError("SOURCE_A10_EVIDENCE_SHA_MISMATCH")
    evidence = _load_json(EXPECTED_A10_EVIDENCE, "SOURCE_A10_EVIDENCE_MISSING")
    if evidence.get("content_sha256") != EXPECTED_A10_CONTENT_SHA:
        raise Phase1CA11ValidationError("SOURCE_A10_CONTENT_SHA_UNEXPECTED")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1CA11ValidationError("SOURCE_A10_CONTENT_INVALID")
    if content.get("status") != "DESIGN_REVIEW_COMPLETE_NO_IMPLEMENTATION_APPROVED":
        raise Phase1CA11ValidationError("SOURCE_A10_STATUS_INVALID")
    if content.get("next_gate") != "A11_PRODUCTION_PROFILE_POLICY_CONTRACT":
        raise Phase1CA11ValidationError("SOURCE_A10_NEXT_GATE_INVALID")
    for field in ("implementation_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved"):
        if content.get(field) is not False:
            raise Phase1CA11ValidationError("SOURCE_A10_SCOPE_TOO_BROAD", field)
    return content


def _validate_schema(schema: object) -> None:
    if not isinstance(schema, dict):
        raise Phase1CA11ValidationError("PROFILE_POLICY_SCHEMA_INVALID")
    _expect_subset(
        schema.get("required_fields"),
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
        },
        "PROFILE_POLICY_REQUIRED_FIELDS_INCOMPLETE",
    )
    _expect_subset(
        schema.get("forbidden_fields"),
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
        },
        "PROFILE_POLICY_FORBIDDEN_FIELDS_INCOMPLETE",
    )
    if schema.get("enabled_default") is not False:
        raise Phase1CA11ValidationError("PROFILE_POLICY_ENABLED_DEFAULT_NOT_FALSE")
    if schema.get("missing_policy_behavior") != "deny" or schema.get("ambiguous_policy_behavior") != "deny":
        raise Phase1CA11ValidationError("PROFILE_POLICY_MISSING_OR_AMBIGUOUS_NOT_DENY")
    if schema.get("grant_ttl_seconds_max_upper_bound") != 900:
        raise Phase1CA11ValidationError("PROFILE_POLICY_GRANT_TTL_INVALID")


def _validate_profiles(profiles: object) -> None:
    if not isinstance(profiles, dict):
        raise Phase1CA11ValidationError("PROFILES_INVALID")
    for profile_id in ("default", "dev-director", "content-director"):
        if profile_id not in profiles:
            raise Phase1CA11ValidationError("PROFILE_MISSING", profile_id)
    default = profiles["default"]
    if default.get("compatibility_mode") is not True:
        raise Phase1CA11ValidationError("DEFAULT_COMPATIBILITY_MODE_INVALID")
    if default.get("runtime_isolation_enabled") is not False:
        raise Phase1CA11ValidationError("DEFAULT_RUNTIME_ISOLATION_ENABLED")
    if default.get("inherits_named_profile_credentials") is not False:
        raise Phase1CA11ValidationError("DEFAULT_INHERITS_NAMED_CREDENTIALS")
    for profile_id in ("dev-director", "content-director"):
        profile = profiles[profile_id]
        if profile.get("state") != "CREATED_BUT_DISABLED" or profile.get("enabled") is not False:
            raise Phase1CA11ValidationError("NAMED_PROFILE_NOT_DISABLED", profile_id)
        for field in ("runtime_isolation_required", "profile_auth_store_required", "minimal_model_auth_required", "approval_required_to_enable"):
            if profile.get(field) is not True:
                raise Phase1CA11ValidationError("NAMED_PROFILE_REQUIREMENT_MISSING", f"{profile_id}:{field}")
        if profile.get("root_auth_fallback_allowed") is not False:
            raise Phase1CA11ValidationError("NAMED_PROFILE_ROOT_FALLBACK_ALLOWED", profile_id)
        if profile.get("root_credential_pool_materialization_allowed") is not False:
            raise Phase1CA11ValidationError("NAMED_PROFILE_ROOT_POOL_ALLOWED", profile_id)
        for field in ("provider_families", "models", "operations"):
            if profile.get(field) != []:
                raise Phase1CA11ValidationError("NAMED_PROFILE_ALLOWLIST_NOT_EMPTY_PRE_APPROVAL", f"{profile_id}:{field}")


def _validate_minimal_model_auth(contract: object) -> None:
    if not isinstance(contract, dict):
        raise Phase1CA11ValidationError("MINIMAL_MODEL_AUTH_CONTRACT_INVALID")
    if contract.get("delivery_mechanism") != "host_side_broker_grant_reference_only":
        raise Phase1CA11ValidationError("MODEL_AUTH_DELIVERY_INVALID")
    if contract.get("grant_reference_secret") is not False:
        raise Phase1CA11ValidationError("GRANT_REFERENCE_MARKED_SECRET")
    _expect_subset(
        contract.get("permitted_scope_fields"),
        {"profile_id", "workflow_id", "task_id", "attempt_id", "purpose", "provider_family", "model", "operation", "ttl_seconds", "budget", "policy_version", "runtime_identity_hash", "network_policy_id"},
        "MODEL_AUTH_SCOPE_INCOMPLETE",
    )
    _expect_subset(
        contract.get("forbidden_material"),
        {"provider_api_key", "provider_access_token", "provider_refresh_token", "authorization_header", "root_auth_json", "root_credential_pool", "owner_keychain_reference", "credential_store_path"},
        "MODEL_AUTH_FORBIDDEN_MATERIAL_INCOMPLETE",
    )
    for field in ("grant_replay_behavior", "grant_expiry_behavior", "grant_owner_mismatch_behavior"):
        if contract.get(field) != "deny":
            raise Phase1CA11ValidationError("MODEL_AUTH_FAIL_CLOSED_INVALID", field)


def _validate_credential_policy(policy: object) -> None:
    if not isinstance(policy, dict):
        raise Phase1CA11ValidationError("CREDENTIAL_POLICY_INVALID")
    for field in (
        "root_auth_json_fallback_allowed_for_named_profiles",
        "root_credential_pool_materialization_allowed",
        "profile_auth_store_may_contain_provider_secret_values",
        "oauth_refresh_by_profile_worker_allowed",
        "oauth_refresh_by_runtime_adapter_allowed",
        "credential_value_logging_allowed",
    ):
        if policy.get(field) is not False:
            raise Phase1CA11ValidationError(f"{field.upper()}_NOT_FALSE")
    for field in ("profile_auth_store_required_for_named_profiles", "oauth_refresh_owner_only_cas_required", "credential_reference_allowlist_required"):
        if policy.get(field) is not True:
            raise Phase1CA11ValidationError(f"{field.upper()}_NOT_TRUE")


def _validate_environment_policy(policy: object) -> None:
    if not isinstance(policy, dict):
        raise Phase1CA11ValidationError("ENVIRONMENT_POLICY_INVALID")
    _expect_subset(policy.get("preserve_keys"), {"PATH", "HOME", "TMPDIR", "LANG", "SHELL", "NO_PROXY", "no_proxy"}, "ENV_PRESERVE_KEYS_INCOMPLETE")
    _expect_subset(policy.get("allowed_runtime_keys"), {"PANKSTER_PROFILE_ID", "PANKSTER_ATTEMPT_ID", "PANKSTER_POLICY_VERSION", "PANKSTER_GRANT_IDS", "PANKSTER_NETWORK_POLICY"}, "ENV_RUNTIME_KEYS_INCOMPLETE")
    _expect_subset(policy.get("mandatory_denylist"), {"*_KEY", "*_TOKEN", "*_SECRET", "*_PASSWORD", "AUTHORIZATION", "ANTHROPIC_*", "OPENAI_*", "GLM_*", "GITEA_*", "SUPABASE_*", "TELEGRAM_*", "E2B_API_KEY"}, "ENV_DENYLIST_INCOMPLETE")
    _expect_subset(policy.get("applies_to"), {"sandbox_launch", "terminal", "code_execution", "delegate_task", "mcp", "background_process", "retry", "reclaim", "restart"}, "ENV_APPLIES_TO_INCOMPLETE")
    if policy.get("denylist_precedence_over_allowlist") is not True:
        raise Phase1CA11ValidationError("ENV_DENYLIST_PRECEDENCE_MISSING")


def _validate_network_budget_audit(content: dict) -> None:
    network = content.get("network_policy")
    if not isinstance(network, dict):
        raise Phase1CA11ValidationError("NETWORK_POLICY_INVALID")
    if network.get("default") != "deny_all":
        raise Phase1CA11ValidationError("NETWORK_DEFAULT_INVALID")
    for field in ("profile_specific_policy_required", "broker_channel_requires_policy"):
        if network.get(field) is not True:
            raise Phase1CA11ValidationError(f"{field.upper()}_NOT_TRUE")
    if network.get("direct_provider_egress_from_sandbox_allowed") is not False:
        raise Phase1CA11ValidationError("DIRECT_PROVIDER_EGRESS_ALLOWED")
    if network.get("missing_network_policy_behavior") != "deny":
        raise Phase1CA11ValidationError("MISSING_NETWORK_POLICY_NOT_DENY")

    budget = content.get("budget_policy")
    if not isinstance(budget, dict) or budget.get("required") is not True:
        raise Phase1CA11ValidationError("BUDGET_POLICY_INVALID")
    _expect_subset(budget.get("dimensions"), {"max_usd_per_attempt", "max_tokens_per_attempt", "max_requests_per_attempt", "max_wall_clock_seconds", "max_retries"}, "BUDGET_DIMENSIONS_INCOMPLETE")
    if budget.get("budget_exceeded_behavior") != "deny_before_provider_call":
        raise Phase1CA11ValidationError("BUDGET_EXCEEDED_BEHAVIOR_INVALID")

    audit = content.get("audit_policy")
    if not isinstance(audit, dict) or audit.get("required") is not True:
        raise Phase1CA11ValidationError("AUDIT_POLICY_INVALID")
    if audit.get("secret_values_allowed") is not False:
        raise Phase1CA11ValidationError("AUDIT_ALLOWS_SECRETS")
    if audit.get("audit_unavailable_behavior") != "deny":
        raise Phase1CA11ValidationError("AUDIT_UNAVAILABLE_NOT_DENY")


def _validate_required_tests(required_tests: object) -> None:
    if not isinstance(required_tests, dict):
        raise Phase1CA11ValidationError("REQUIRED_TESTS_INVALID")
    _expect_subset(
        required_tests.get("unit"),
        {
            "profile_policy_schema_rejects_secret_fields",
            "missing_profile_policy_denies_launch",
            "disabled_profile_denies_launch",
            "default_profile_does_not_inherit_named_policy",
            "model_allowlist_required_and_enforced",
            "provider_family_allowlist_required_and_enforced",
            "operation_allowlist_required_and_enforced",
            "budget_required_and_enforced_before_provider_call",
            "credential_reference_allowlist_required",
            "environment_denylist_precedence_over_allowlist",
        },
        "UNIT_TESTS_INCOMPLETE",
    )
    _expect_subset(
        required_tests.get("integration_synthetic"),
        {
            "dev_director_created_but_disabled_denies_runtime_launch",
            "content_director_created_but_disabled_denies_runtime_launch",
            "synthetic_profile_receives_grant_reference_without_provider_secret",
            "synthetic_default_profile_compatibility_does_not_enable_named_profiles",
            "synthetic_budget_denial_records_secret_free_audit",
            "synthetic_oauth_refresh_attempt_by_worker_fails_closed",
        },
        "INTEGRATION_TESTS_INCOMPLETE",
    )
    _expect_subset(
        required_tests.get("security"),
        {
            "named_profiles_cannot_read_root_auth_json",
            "named_profiles_cannot_materialize_root_credential_pool",
            "provider_secret_never_in_env_argv_artifacts_evidence",
            "telegram_gitea_supabase_anthropic_glm_env_keys_denied",
            "terminal_code_execution_delegate_mcp_background_children_sanitized",
            "retry_reclaim_restart_preserve_policy_and_attempt_binding",
        },
        "SECURITY_TESTS_INCOMPLETE",
    )


def validate_contract(path: Path = DEFAULT_CONTRACT) -> dict:
    contract = _load_json(path, "CONTRACT_MISSING")
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA11ValidationError("SCHEMA_INVALID")
    content = contract.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1CA11ValidationError("DECISION_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1CA11ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1CA11ValidationError("CONTENT_SHA_MISMATCH")

    _validate_a10_dependency()
    source = content.get("source_evidence")
    if not isinstance(source, dict):
        raise Phase1CA11ValidationError("SOURCE_EVIDENCE_INVALID")
    if source.get("a10_review_file_sha256") != EXPECTED_A10_EVIDENCE_SHA:
        raise Phase1CA11ValidationError("A11_SOURCE_A10_FILE_SHA_INVALID")
    if source.get("a10_content_sha256") != EXPECTED_A10_CONTENT_SHA:
        raise Phase1CA11ValidationError("A11_SOURCE_A10_CONTENT_SHA_INVALID")

    if content.get("phase") != "1C-A11":
        raise Phase1CA11ValidationError("PHASE_INVALID")
    if content.get("status") != EXPECTED_STATUS:
        raise Phase1CA11ValidationError("STATUS_INVALID")
    if content.get("decision") != EXPECTED_DECISION:
        raise Phase1CA11ValidationError("DECISION_INVALID")
    for field in ("implementation_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved"):
        _expect_false(content, field)

    _expect_subset(
        content.get("policy_contract_principles"),
        {
            "named_profiles_are_explicitly_declared",
            "default_profile_backward_compatibility_is_explicit_and_not_inherited",
            "profile_policy_required_before_any_runtime_launch",
            "model_allowlist_required_per_profile",
            "provider_family_allowlist_required_per_profile",
            "operation_allowlist_required_per_profile",
            "budget_and_rate_limits_required_per_profile",
            "grant_scope_is_profile_task_attempt_and_purpose_bound",
            "no_root_auth_fallback_for_named_profiles",
            "no_root_credential_pool_materialization",
            "fail_closed_on_missing_or_ambiguous_policy",
        },
        "POLICY_PRINCIPLES_INCOMPLETE",
    )
    _validate_schema(content.get("profile_policy_schema"))
    _validate_profiles(content.get("profiles"))
    _validate_minimal_model_auth(content.get("minimal_model_auth_contract"))
    _validate_credential_policy(content.get("credential_policy"))
    _validate_environment_policy(content.get("environment_policy"))
    _validate_network_budget_audit(content)
    _expect_subset(
        content.get("fail_closed_cases"),
        {
            "missing_profile_policy",
            "disabled_profile",
            "ambiguous_default_profile_inheritance",
            "model_not_allowlisted",
            "provider_family_not_allowlisted",
            "operation_not_allowlisted",
            "budget_exceeded",
            "missing_network_policy",
            "root_auth_fallback_requested",
            "root_pool_materialization_requested",
            "oauth_refresh_requested_by_worker_or_adapter",
            "environment_denylist_violation",
            "audit_unavailable",
        },
        "FAIL_CLOSED_CASES_INCOMPLETE",
    )
    _validate_required_tests(content.get("required_tests"))
    findings = content.get("design_review_findings")
    if not isinstance(findings, dict):
        raise Phase1CA11ValidationError("DESIGN_REVIEW_FINDINGS_INVALID")
    for field in ("a10_dependency_satisfied", "profile_policy_contract_ready", "dev_director_remains_created_but_disabled", "content_director_remains_created_but_disabled", "default_gateway_unchanged"):
        if findings.get(field) is not True:
            raise Phase1CA11ValidationError(f"{field.upper()}_NOT_TRUE")
    if findings.get("production_runtime_ready") is not False:
        raise Phase1CA11ValidationError("PRODUCTION_RUNTIME_READY_UNEXPECTED")
    if content.get("next_gate") != "A12_INTEGRATION_TEST_PLAN_WITH_SYNTHETIC_ONLY_FIXTURES":
        raise Phase1CA11ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-contract",
        "decision": EXPECTED_DECISION,
        "status": EXPECTED_STATUS,
        "content_sha256": EXPECTED_CONTENT_SHA,
        "production_approved": False,
        "implementation_approved": False,
        "next_gate": content["next_gate"],
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["validate-contract"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-contract":
            _json_print(validate_contract(args.contract))
            return 0
    except (Phase1CA11ValidationError, json.JSONDecodeError) as error:
        reason = getattr(error, "reason", error.__class__.__name__)
        detail = getattr(error, "detail", str(error))
        payload = {"result": "DENIED", "mode": args.mode, "reason": reason}
        if detail and detail != reason:
            payload["detail"] = detail
        _json_print(payload)
        return 1
    raise AssertionError(f"unhandled mode: {args.mode}")


if __name__ == "__main__":
    raise SystemExit(main())
