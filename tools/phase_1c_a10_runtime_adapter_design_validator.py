#!/usr/bin/env python3
"""Validate the Phase 1C-A10 runtime adapter design review.

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


DEFAULT_REVIEW = PROJECT_ROOT / "security/evidence/phase-1c-a10/runtime-adapter-design-review.json"
EXPECTED_SCHEMA = "pankster.phase1c-a10.runtime-adapter-design-review.v1"
EXPECTED_CONTENT_SHA = "9a69b9d6c9d9cdc8b7a9100b06fd1546038396b353181073e2abfe101a1bf7b2"
EXPECTED_DECISION = "RUNTIME_ADAPTER_DESIGN_ACCEPTED_FOR_IMPLEMENTATION_PLANNING_NOT_PRODUCTION"
EXPECTED_STATUS = "DESIGN_REVIEW_COMPLETE_NO_IMPLEMENTATION_APPROVED"
EXPECTED_A9_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1c-a9/host-side-model-and-credential-broker-spec.json"
EXPECTED_A9_EVIDENCE_SHA = "769d17a69d3c9dc9a8fa9969415a983fffc4d6d8a1b202c9b29f6ac3b62ea351"
EXPECTED_A9_CONTENT_SHA = "c24d2b25bde9ec7c84126cbb37e88a2cfbffc0dceca2a534d83230d2dd42a469"


class Phase1CA10ValidationError(RuntimeError):
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
        raise Phase1CA10ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA10ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA10ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1CA10ValidationError("SOURCE_A9_EVIDENCE_MISSING", str(path)) from error


def _expect_subset(values: object, expected: set[str], reason: str) -> None:
    if not isinstance(values, list):
        raise Phase1CA10ValidationError(reason, "not a list")
    missing = sorted(expected - set(values))
    if missing:
        raise Phase1CA10ValidationError(reason, ",".join(missing))


def _expect_false(content: dict, field: str) -> None:
    if content.get(field) is not False:
        raise Phase1CA10ValidationError(f"{field.upper()}_NOT_FALSE")


def _validate_a9_dependency() -> dict:
    if _sha256_file(EXPECTED_A9_EVIDENCE) != EXPECTED_A9_EVIDENCE_SHA:
        raise Phase1CA10ValidationError("SOURCE_A9_EVIDENCE_SHA_MISMATCH")
    evidence = _load_json(EXPECTED_A9_EVIDENCE, "SOURCE_A9_EVIDENCE_MISSING")
    if evidence.get("content_sha256") != EXPECTED_A9_CONTENT_SHA:
        raise Phase1CA10ValidationError("SOURCE_A9_CONTENT_SHA_UNEXPECTED")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1CA10ValidationError("SOURCE_A9_CONTENT_INVALID")
    if content.get("status") != "SPEC_COMPLETE_NO_IMPLEMENTATION_APPROVED":
        raise Phase1CA10ValidationError("SOURCE_A9_STATUS_INVALID")
    if content.get("next_gate") != "A10_RUNTIME_ADAPTER_DESIGN_REVIEW":
        raise Phase1CA10ValidationError("SOURCE_A9_NEXT_GATE_INVALID")
    for field in ("implementation_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved"):
        if content.get(field) is not False:
            raise Phase1CA10ValidationError("SOURCE_A9_SCOPE_TOO_BROAD", field)
    return content


def _validate_components(components: object) -> None:
    if not isinstance(components, dict):
        raise Phase1CA10ValidationError("COMPONENTS_INVALID")
    required = {
        "runtime_security_context_loader",
        "environment_sanitizer",
        "sandbox_launcher",
        "broker_channel_adapter",
        "artifact_boundary",
        "lifecycle_manager",
        "evidence_recorder",
    }
    if set(components) != required:
        raise Phase1CA10ValidationError("COMPONENT_SET_INVALID")
    if components["runtime_security_context_loader"].get("required_before_launch") is not True:
        raise Phase1CA10ValidationError("RUNTIME_SECURITY_CONTEXT_NOT_REQUIRED")
    env = components["environment_sanitizer"]
    _expect_subset(env.get("preserve_keys"), {"PATH", "HOME", "TMPDIR", "LANG", "SHELL", "NO_PROXY", "no_proxy"}, "ENV_PRESERVE_KEYS_INCOMPLETE")
    _expect_subset(env.get("pankster_keys"), {"PANKSTER_PROFILE_ID", "PANKSTER_ATTEMPT_ID", "PANKSTER_GRANT_IDS", "PANKSTER_POLICY_VERSION", "PANKSTER_NETWORK_POLICY"}, "PANKSTER_KEYS_INCOMPLETE")
    _expect_subset(env.get("mandatory_denylist"), {"*_KEY", "*_TOKEN", "*_SECRET", "*_PASSWORD", "AUTHORIZATION", "ANTHROPIC_*", "OPENAI_*", "GLM_*", "GITEA_*", "SUPABASE_*", "TELEGRAM_*", "E2B_API_KEY"}, "ENV_DENYLIST_INCOMPLETE")
    _expect_subset(env.get("applies_to"), {"sandbox_launch", "terminal", "code_execution", "delegate_task", "mcp", "background_process", "retry", "reclaim", "restart"}, "ENV_APPLIES_TO_INCOMPLETE")
    if env.get("secret_values_allowed") is not False:
        raise Phase1CA10ValidationError("ENV_SANITIZER_ALLOWS_SECRETS")
    launcher = components["sandbox_launcher"]
    if launcher.get("approved_to_execute_in_a10") is not False:
        raise Phase1CA10ValidationError("SANDBOX_EXECUTION_APPROVED_IN_A10")
    if launcher.get("network_policy_default") != "deny_all":
        raise Phase1CA10ValidationError("SANDBOX_NETWORK_DEFAULT_INVALID")
    broker = components["broker_channel_adapter"]
    if broker.get("approved_to_implement_in_a10") is not False:
        raise Phase1CA10ValidationError("BROKER_CHANNEL_IMPLEMENTATION_APPROVED")
    if broker.get("must_revalidate_policy_per_request") is not True:
        raise Phase1CA10ValidationError("BROKER_CHANNEL_POLICY_REVALIDATION_MISSING")
    artifact = components["artifact_boundary"]
    if artifact.get("root_auth_paths_allowed") is not False or artifact.get("provider_secret_files_allowed") is not False:
        raise Phase1CA10ValidationError("ARTIFACT_BOUNDARY_ALLOWS_SECRET_PATHS")
    lifecycle = components["lifecycle_manager"]
    if lifecycle.get("destroy_idempotent") is not True:
        raise Phase1CA10ValidationError("DESTROY_NOT_IDEMPOTENT")
    if lifecycle.get("retry_changes_attempt_id") is not True:
        raise Phase1CA10ValidationError("RETRY_DOES_NOT_CHANGE_ATTEMPT")
    if lifecycle.get("reclaim_must_revalidate_runtime_identity") is not True:
        raise Phase1CA10ValidationError("RECLAIM_REVALIDATION_MISSING")
    recorder = components["evidence_recorder"]
    if recorder.get("raw_env_allowed") is not False or recorder.get("argv_secret_values_allowed") is not False:
        raise Phase1CA10ValidationError("EVIDENCE_RECORDER_ALLOWS_RAW_SECRET_MATERIAL")


def _validate_file_access(contract: object) -> None:
    if not isinstance(contract, dict):
        raise Phase1CA10ValidationError("FILE_ACCESS_CONTRACT_INVALID")
    for field in (
        "root_auth_json_read_allowed",
        "root_auth_json_fallback_allowed",
        "root_credential_pool_materialization_allowed",
        "profile_auth_store_write_allowed",
        "oauth_refresh_allowed_in_adapter",
        "provider_secret_in_env_allowed",
        "provider_secret_in_argv_allowed",
        "provider_secret_in_artifacts_allowed",
    ):
        if contract.get(field) is not False:
            raise Phase1CA10ValidationError(f"{field.upper()}_NOT_FALSE")
    if contract.get("host_filesystem_mounts_default") != "none_except_explicit_sanitized_artifacts":
        raise Phase1CA10ValidationError("HOST_FILESYSTEM_MOUNTS_DEFAULT_INVALID")


def _validate_child_contract(contract: object) -> None:
    if not isinstance(contract, dict):
        raise Phase1CA10ValidationError("CHILD_ENV_CONTRACT_INVALID")
    expected = {
        "terminal": "sanitized_environment_only",
        "code_execution": "sanitized_environment_only",
        "delegate_task": "sanitized_environment_or_unavailable_fail_closed",
        "mcp": "sanitized_environment_or_unavailable_fail_closed",
        "background_process": "sanitized_environment_only",
        "retry": "new_attempt_new_grants_sanitized_environment",
        "reclaim": "revalidate_runtime_identity_before_reuse",
        "restart": "new_runtime_identity_and_policy_revalidation_required",
    }
    for key, value in expected.items():
        if contract.get(key) != value:
            raise Phase1CA10ValidationError("CHILD_ENV_CONTRACT_INVALID", key)


def _validate_required_tests(required_tests: object) -> None:
    if not isinstance(required_tests, dict):
        raise Phase1CA10ValidationError("REQUIRED_TESTS_INVALID")
    _expect_subset(
        required_tests.get("unit"),
        {
            "runtime_security_context_required_before_launch",
            "environment_sanitizer_preserves_no_proxy_and_blocks_denylist",
            "sandbox_launcher_denies_missing_network_policy",
            "broker_channel_metadata_contains_no_credentials",
            "artifact_boundary_rejects_root_auth_paths",
            "lifecycle_manager_retry_uses_new_attempt_and_grants",
            "reclaim_revalidates_runtime_identity",
            "evidence_recorder_rejects_raw_env_and_secret_values",
        },
        "UNIT_TESTS_INCOMPLETE",
    )
    _expect_subset(
        required_tests.get("integration_synthetic"),
        {
            "synthetic_adapter_launch_receives_only_allowlisted_env",
            "synthetic_child_terminal_env_is_sanitized",
            "synthetic_code_execution_env_is_sanitized",
            "synthetic_delegate_and_mcp_unavailable_fail_closed_or_sanitized",
            "synthetic_retry_reclaim_restart_preserve_security_contract",
            "synthetic_destroy_is_idempotent_and_audited",
        },
        "INTEGRATION_TESTS_INCOMPLETE",
    )
    _expect_subset(
        required_tests.get("security"),
        {
            "adapter_never_reads_root_auth_json",
            "adapter_never_materializes_root_credential_pool",
            "adapter_never_passes_provider_secret_to_env_argv_artifacts_or_evidence",
            "adapter_fails_closed_when_broker_or_audit_unavailable",
            "secret_scan_adapter_logs_journal_argv_evidence",
        },
        "SECURITY_TESTS_INCOMPLETE",
    )


def validate_review(path: Path = DEFAULT_REVIEW) -> dict:
    review = _load_json(path, "REVIEW_MISSING")
    if review.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA10ValidationError("SCHEMA_INVALID")
    content = review.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1CA10ValidationError("DECISION_CONTENT_INVALID")
    if review.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1CA10ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1CA10ValidationError("CONTENT_SHA_MISMATCH")

    _validate_a9_dependency()
    source = content.get("source_evidence")
    if not isinstance(source, dict):
        raise Phase1CA10ValidationError("SOURCE_EVIDENCE_INVALID")
    if source.get("a9_spec_file_sha256") != EXPECTED_A9_EVIDENCE_SHA:
        raise Phase1CA10ValidationError("A10_SOURCE_A9_FILE_SHA_INVALID")
    if source.get("a9_content_sha256") != EXPECTED_A9_CONTENT_SHA:
        raise Phase1CA10ValidationError("A10_SOURCE_A9_CONTENT_SHA_INVALID")

    if content.get("phase") != "1C-A10":
        raise Phase1CA10ValidationError("PHASE_INVALID")
    if content.get("status") != EXPECTED_STATUS:
        raise Phase1CA10ValidationError("STATUS_INVALID")
    if content.get("decision") != EXPECTED_DECISION:
        raise Phase1CA10ValidationError("DECISION_INVALID")
    for field in ("implementation_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved"):
        _expect_false(content, field)

    _expect_subset(
        content.get("adapter_design_principles"),
        {
            "host_control_plane_owns_runtime_lifecycle",
            "sandbox_receives_only_allowlisted_environment",
            "sandbox_receives_no_real_provider_credentials",
            "sandbox_receives_only_non_secret_grant_references",
            "network_policy_defaults_to_deny_all",
            "retry_reclaim_restart_preserve_attempt_binding",
            "destroy_is_idempotent_and_audited",
            "missing_runtime_policy_fails_closed",
            "no_gateway_or_default_profile_change_in_design",
        },
        "DESIGN_PRINCIPLES_INCOMPLETE",
    )
    _validate_components(content.get("runtime_adapter_components"))
    _validate_child_contract(content.get("child_environment_contract"))
    _validate_file_access(content.get("credential_and_file_access_contract"))
    _expect_subset(
        content.get("fail_closed_cases"),
        {
            "a9_spec_missing_or_hash_mismatch",
            "missing_runtime_security_context",
            "profile_policy_missing_or_disabled",
            "network_policy_missing",
            "grant_missing_or_expired",
            "grant_attempt_mismatch",
            "env_denylist_violation",
            "broker_channel_unavailable",
            "runtime_identity_mismatch_on_reclaim",
            "destroy_failure",
            "evidence_recorder_unavailable",
        },
        "FAIL_CLOSED_CASES_INCOMPLETE",
    )
    _validate_required_tests(content.get("required_tests"))
    findings = content.get("design_review_findings")
    if not isinstance(findings, dict):
        raise Phase1CA10ValidationError("DESIGN_REVIEW_FINDINGS_INVALID")
    if findings.get("a9_dependency_satisfied") is not True or findings.get("implementation_plan_ready") is not True:
        raise Phase1CA10ValidationError("DESIGN_REVIEW_NOT_READY")
    if findings.get("production_runtime_ready") is not False:
        raise Phase1CA10ValidationError("PRODUCTION_RUNTIME_READY_UNEXPECTED")
    if content.get("next_gate") != "A11_PRODUCTION_PROFILE_POLICY_CONTRACT":
        raise Phase1CA10ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-review",
        "decision": EXPECTED_DECISION,
        "status": EXPECTED_STATUS,
        "content_sha256": EXPECTED_CONTENT_SHA,
        "production_approved": False,
        "implementation_approved": False,
        "next_gate": content["next_gate"],
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["validate-review"])
    parser.add_argument("--review", type=Path, default=DEFAULT_REVIEW)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-review":
            _json_print(validate_review(args.review))
            return 0
    except (Phase1CA10ValidationError, json.JSONDecodeError) as error:
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
