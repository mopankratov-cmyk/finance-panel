#!/usr/bin/env python3
"""Validate the Phase 1C-A13 rollback and operator runbook.

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


DEFAULT_RUNBOOK = PROJECT_ROOT / "security/evidence/phase-1c-a13/rollback-operator-runbook.json"
EXPECTED_SCHEMA = "pankster.phase1c-a13.rollback-operator-runbook.v1"
EXPECTED_CONTENT_SHA = "ebc4f0879a72b106d610b48b252f661de8749053bbc6307c803ced9300f32afc"
EXPECTED_DECISION = "OPERATOR_RUNBOOK_READY_FOR_FINAL_IMPLEMENTATION_READINESS_REVIEW_NOT_DEPLOYMENT"
EXPECTED_STATUS = "ROLLBACK_AND_OPERATOR_RUNBOOK_COMPLETE_NO_DEPLOYMENT_APPROVAL"
EXPECTED_A12_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1c-a12/synthetic-integration-test-plan.json"
EXPECTED_A12_EVIDENCE_SHA = "d275ee7d47304545793debf12ce0b5820df1bf04705f15073518e83f872a33cf"
EXPECTED_A12_CONTENT_SHA = "267dc67342d617abc79c7736e9b08e29b4fbd8c69a9e0615a9627be02dd167de"


class Phase1CA13ValidationError(RuntimeError):
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
        raise Phase1CA13ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA13ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA13ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1CA13ValidationError("SOURCE_A12_EVIDENCE_MISSING", str(path)) from error


def _expect_subset(values: object, expected: set[str], reason: str) -> None:
    if not isinstance(values, list):
        raise Phase1CA13ValidationError(reason, "not a list")
    missing = sorted(expected - set(values))
    if missing:
        raise Phase1CA13ValidationError(reason, ",".join(missing))


def _expect_false(content: dict, field: str) -> None:
    if content.get(field) is not False:
        raise Phase1CA13ValidationError(f"{field.upper()}_NOT_FALSE")


def _validate_a12_dependency() -> None:
    if _sha256_file(EXPECTED_A12_EVIDENCE) != EXPECTED_A12_EVIDENCE_SHA:
        raise Phase1CA13ValidationError("SOURCE_A12_EVIDENCE_SHA_MISMATCH")
    evidence = _load_json(EXPECTED_A12_EVIDENCE, "SOURCE_A12_EVIDENCE_MISSING")
    if evidence.get("content_sha256") != EXPECTED_A12_CONTENT_SHA:
        raise Phase1CA13ValidationError("SOURCE_A12_CONTENT_SHA_UNEXPECTED")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1CA13ValidationError("SOURCE_A12_CONTENT_INVALID")
    if content.get("status") != "SYNTHETIC_INTEGRATION_TEST_PLAN_COMPLETE_NO_EXECUTION_APPROVAL":
        raise Phase1CA13ValidationError("SOURCE_A12_STATUS_INVALID")
    if content.get("next_gate") != "A13_ROLLBACK_AND_OPERATOR_RUNBOOK":
        raise Phase1CA13ValidationError("SOURCE_A12_NEXT_GATE_INVALID")
    for field in ("implementation_approved", "test_execution_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved"):
        if content.get(field) is not False:
            raise Phase1CA13ValidationError("SOURCE_A12_SCOPE_TOO_BROAD", field)


def _validate_feature_flags(flags: object) -> None:
    if not isinstance(flags, dict):
        raise Phase1CA13ValidationError("FEATURE_FLAGS_INVALID")
    for key, value in flags.items():
        if value is not False:
            raise Phase1CA13ValidationError("FEATURE_FLAG_NOT_DISABLED", key)
    _expect_subset(list(flags), {"runtime_adapter_enabled_default", "host_model_broker_enabled_default", "credential_broker_enabled_default", "named_profile_runtime_enabled_default", "synthetic_runner_enabled_default", "production_profiles_enabled_default"}, "FEATURE_FLAGS_INCOMPLETE")


def _validate_operator_policy(policy: object) -> None:
    if not isinstance(policy, dict):
        raise Phase1CA13ValidationError("OPERATOR_COMMANDS_POLICY_INVALID")
    if policy.get("commands_in_a13_executable") is not False:
        raise Phase1CA13ValidationError("A13_COMMANDS_EXECUTABLE")
    for field in ("commands_must_not_print_secrets", "commands_must_not_read_auth_json", "commands_must_not_read_keychain", "commands_must_not_restart_gateway", "commands_must_not_start_profiles", "commands_must_not_call_providers", "commands_must_use_explicit_paths"):
        if policy.get(field) is not True:
            raise Phase1CA13ValidationError("OPERATOR_POLICY_MISSING", field)


def _validate_required_tests(required_tests: object) -> None:
    if not isinstance(required_tests, dict):
        raise Phase1CA13ValidationError("REQUIRED_TESTS_INVALID")
    _expect_subset(required_tests.get("unit"), {"runbook_feature_flags_default_disabled", "rollback_sequence_disables_all_runtime_flags", "operator_commands_policy_forbids_secret_auth_keychain_gateway_profile_provider_actions", "evidence_pack_requires_sanitized_env_key_list_only", "emergency_stop_conditions_cover_secret_root_oauth_gateway_provider_destroy"}, "UNIT_TESTS_INCOMPLETE")
    _expect_subset(required_tests.get("integration_synthetic"), {"synthetic_rollback_disables_named_profile_runtime", "synthetic_rollback_revokes_grants", "synthetic_rollback_preserves_default_profile_state", "synthetic_evidence_pack_contains_no_secret_values", "synthetic_uncertain_state_fails_closed"}, "INTEGRATION_TESTS_INCOMPLETE")
    _expect_subset(required_tests.get("security"), {"operator_runbook_contains_no_secret_values", "rollback_commands_do_not_include_auth_json_keychain_or_provider_calls", "evidence_pack_secret_scan_required", "manual_approval_required_before_execution_steps"}, "SECURITY_TESTS_INCOMPLETE")


def validate_runbook(path: Path = DEFAULT_RUNBOOK) -> dict:
    runbook = _load_json(path, "RUNBOOK_MISSING")
    if runbook.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA13ValidationError("SCHEMA_INVALID")
    content = runbook.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1CA13ValidationError("DECISION_CONTENT_INVALID")
    if runbook.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1CA13ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1CA13ValidationError("CONTENT_SHA_MISMATCH")
    _validate_a12_dependency()

    if content.get("phase") != "1C-A13":
        raise Phase1CA13ValidationError("PHASE_INVALID")
    if content.get("status") != EXPECTED_STATUS:
        raise Phase1CA13ValidationError("STATUS_INVALID")
    if content.get("decision") != EXPECTED_DECISION:
        raise Phase1CA13ValidationError("DECISION_INVALID")
    for field in ("implementation_approved", "deployment_approved", "test_execution_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved"):
        _expect_false(content, field)
    source = content.get("source_evidence")
    if not isinstance(source, dict) or source.get("a12_plan_file_sha256") != EXPECTED_A12_EVIDENCE_SHA or source.get("a12_content_sha256") != EXPECTED_A12_CONTENT_SHA:
        raise Phase1CA13ValidationError("SOURCE_EVIDENCE_INVALID")

    _expect_subset(content.get("runbook_principles"), {"feature_flags_default_disabled", "named_profiles_remain_disabled_until_explicit_owner_approval", "rollback_must_not_restart_gateway", "rollback_must_preserve_default_profile_behavior", "no_secret_values_in_operator_commands", "fail_closed_on_uncertain_state", "manual_approval_required_for_execution_steps"}, "RUNBOOK_PRINCIPLES_INCOMPLETE")
    _validate_feature_flags(content.get("feature_flags"))
    _expect_subset(content.get("operator_preflight_checks"), {"confirm_gateway_not_targeted", "confirm_default_profile_unchanged", "confirm_named_profiles_disabled", "confirm_no_real_credentials_in_plan", "confirm_no_provider_api_calls_approved", "confirm_no_auth_json_or_keychain_access", "confirm_secret_scan_passed"}, "PREFLIGHT_CHECKS_INCOMPLETE")
    _expect_subset(content.get("rollback_sequence"), {"disable_named_profile_runtime_feature_flag", "disable_runtime_adapter_feature_flag", "disable_host_model_broker_feature_flag", "disable_credential_broker_feature_flag", "revoke_unexpired_grants", "verify_default_gateway_still_serving", "verify_default_profile_behavior_unchanged"}, "ROLLBACK_SEQUENCE_INCOMPLETE")
    _expect_subset(content.get("emergency_stop_conditions"), {"provider_secret_detected_in_env_argv_logs_or_evidence", "root_auth_json_read_detected", "root_credential_pool_materialization_detected", "oauth_refresh_by_worker_or_adapter_detected", "gateway_restart_attempt_detected", "direct_provider_egress_from_sandbox_detected", "sandbox_destroy_failure"}, "EMERGENCY_STOPS_INCOMPLETE")
    _validate_operator_policy(content.get("operator_commands_policy"))
    _expect_subset(content.get("evidence_pack_requirements"), {"commit_sha", "branch_name", "feature_flag_state", "profile_state", "grant_ids_hashed_or_opaque_only", "runtime_identity_hash", "sanitized_env_key_list_only", "secret_scan_result", "rollback_verification_result"}, "EVIDENCE_PACK_REQUIREMENTS_INCOMPLETE")
    _expect_subset(content.get("rollback_verification_checks"), {"named_profile_runtime_disabled", "runtime_adapter_disabled", "host_model_broker_disabled", "credential_broker_disabled", "no_unexpired_runtime_grants", "gateway_not_restarted_by_runbook", "default_profile_smoke_check_unchanged", "evidence_secret_scan_passed"}, "ROLLBACK_VERIFICATION_INCOMPLETE")
    _expect_subset(content.get("fail_closed_cases"), {"preflight_state_uncertain", "feature_flag_state_unknown", "named_profile_state_unknown", "secret_scan_unavailable_or_failed", "rollback_verification_failed", "gateway_state_changed_unexpectedly", "default_profile_behavior_changed", "unrevoked_grants_detected"}, "FAIL_CLOSED_CASES_INCOMPLETE")
    _validate_required_tests(content.get("required_tests"))
    findings = content.get("design_review_findings")
    if not isinstance(findings, dict):
        raise Phase1CA13ValidationError("DESIGN_REVIEW_FINDINGS_INVALID")
    if findings.get("a12_dependency_satisfied") is not True or findings.get("operator_runbook_ready") is not True or findings.get("rollback_path_defined") is not True:
        raise Phase1CA13ValidationError("DESIGN_REVIEW_NOT_READY")
    if findings.get("deployment_ready") is not False or findings.get("production_runtime_ready") is not False:
        raise Phase1CA13ValidationError("DEPLOYMENT_OR_PRODUCTION_READY_UNEXPECTED")
    if content.get("next_gate") != "A14_FINAL_IMPLEMENTATION_READINESS_REVIEW":
        raise Phase1CA13ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-runbook",
        "decision": EXPECTED_DECISION,
        "status": EXPECTED_STATUS,
        "content_sha256": EXPECTED_CONTENT_SHA,
        "deployment_approved": False,
        "production_approved": False,
        "implementation_approved": False,
        "next_gate": content["next_gate"],
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["validate-runbook"])
    parser.add_argument("--runbook", type=Path, default=DEFAULT_RUNBOOK)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-runbook":
            _json_print(validate_runbook(args.runbook))
            return 0
    except (Phase1CA13ValidationError, json.JSONDecodeError) as error:
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
