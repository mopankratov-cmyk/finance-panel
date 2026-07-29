#!/usr/bin/env python3
"""Validate the Phase 1C-A12 synthetic-only integration test plan.

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


DEFAULT_PLAN = PROJECT_ROOT / "security/evidence/phase-1c-a12/synthetic-integration-test-plan.json"
EXPECTED_SCHEMA = "pankster.phase1c-a12.synthetic-integration-test-plan.v1"
EXPECTED_CONTENT_SHA = "267dc67342d617abc79c7736e9b08e29b4fbd8c69a9e0615a9627be02dd167de"
EXPECTED_DECISION = "SYNTHETIC_ONLY_INTEGRATION_TEST_PLAN_READY_NOT_RUNTIME_EXECUTION"
EXPECTED_STATUS = "SYNTHETIC_INTEGRATION_TEST_PLAN_COMPLETE_NO_EXECUTION_APPROVAL"
EXPECTED_A11_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1c-a11/production-profile-policy-contract.json"
EXPECTED_A11_EVIDENCE_SHA = "4f4a035776c085a930a43a8f50d03b94895cde12b874efd3d265514edce20f93"
EXPECTED_A11_CONTENT_SHA = "2861465540563590d895cb99d2d1b40ce8e45512133102687c03c62c294d21cd"


class Phase1CA12ValidationError(RuntimeError):
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
        raise Phase1CA12ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA12ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA12ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1CA12ValidationError("SOURCE_A11_EVIDENCE_MISSING", str(path)) from error


def _expect_subset(values: object, expected: set[str], reason: str) -> None:
    if not isinstance(values, list):
        raise Phase1CA12ValidationError(reason, "not a list")
    missing = sorted(expected - set(values))
    if missing:
        raise Phase1CA12ValidationError(reason, ",".join(missing))


def _expect_false(content: dict, field: str) -> None:
    if content.get(field) is not False:
        raise Phase1CA12ValidationError(f"{field.upper()}_NOT_FALSE")


def _validate_a11_dependency() -> None:
    if _sha256_file(EXPECTED_A11_EVIDENCE) != EXPECTED_A11_EVIDENCE_SHA:
        raise Phase1CA12ValidationError("SOURCE_A11_EVIDENCE_SHA_MISMATCH")
    evidence = _load_json(EXPECTED_A11_EVIDENCE, "SOURCE_A11_EVIDENCE_MISSING")
    if evidence.get("content_sha256") != EXPECTED_A11_CONTENT_SHA:
        raise Phase1CA12ValidationError("SOURCE_A11_CONTENT_SHA_UNEXPECTED")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1CA12ValidationError("SOURCE_A11_CONTENT_INVALID")
    if content.get("status") != "PROFILE_POLICY_CONTRACT_COMPLETE_NO_PRODUCTION_APPROVAL":
        raise Phase1CA12ValidationError("SOURCE_A11_STATUS_INVALID")
    if content.get("next_gate") != "A12_INTEGRATION_TEST_PLAN_WITH_SYNTHETIC_ONLY_FIXTURES":
        raise Phase1CA12ValidationError("SOURCE_A11_NEXT_GATE_INVALID")
    for field in ("implementation_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved"):
        if content.get(field) is not False:
            raise Phase1CA12ValidationError("SOURCE_A11_SCOPE_TOO_BROAD", field)


def _validate_fixture_inventory(inventory: object) -> None:
    if not isinstance(inventory, dict):
        raise Phase1CA12ValidationError("FIXTURE_INVENTORY_INVALID")
    if inventory.get("secret_values_present") is not False:
        raise Phase1CA12ValidationError("FIXTURE_SECRET_VALUES_PRESENT")
    _expect_subset(inventory.get("synthetic_profiles"), {"synthetic-dev-director-disabled", "synthetic-content-director-disabled", "synthetic-enabled-test-profile"}, "SYNTHETIC_PROFILES_INCOMPLETE")
    _expect_subset(inventory.get("synthetic_credentials"), {"fake-provider-reference-not-secret", "fake-expired-grant", "fake-replayed-grant", "fake-owner-mismatch-grant"}, "SYNTHETIC_CREDENTIALS_INCOMPLETE")
    _expect_subset(inventory.get("network_modes"), {"deny_all", "broker_channel_fake_only"}, "NETWORK_MODES_INCOMPLETE")
    _expect_subset(inventory.get("synthetic_artifacts"), {"root-auth-trap-path", "credential-pool-trap-path"}, "SYNTHETIC_ARTIFACTS_INCOMPLETE")


def _validate_test_suites(suites: object) -> None:
    if not isinstance(suites, dict):
        raise Phase1CA12ValidationError("TEST_SUITES_INVALID")
    required_suites = {
        "policy_contract_suite",
        "runtime_adapter_suite",
        "broker_suite",
        "child_process_suite",
        "lifecycle_suite",
        "secret_regression_suite",
    }
    if set(suites) != required_suites:
        raise Phase1CA12ValidationError("TEST_SUITE_SET_INVALID")
    _expect_subset(suites["policy_contract_suite"], {"disabled_named_profiles_deny_launch", "missing_profile_policy_denies_launch", "default_profile_compatibility_does_not_enable_named_profiles"}, "POLICY_SUITE_INCOMPLETE")
    _expect_subset(suites["runtime_adapter_suite"], {"sanitized_env_preserves_no_proxy_and_no_proxy_lowercase", "mandatory_denylist_blocks_sensitive_keys_even_if_allowlisted", "artifact_boundary_rejects_root_auth_and_pool_paths"}, "RUNTIME_SUITE_INCOMPLETE")
    _expect_subset(suites["broker_suite"], {"fake_model_broker_denies_expired_grant", "fake_model_broker_denies_replayed_grant", "fake_model_broker_response_contains_no_provider_secret"}, "BROKER_SUITE_INCOMPLETE")
    _expect_subset(suites["child_process_suite"], {"terminal_child_receives_sanitized_env", "code_execution_child_receives_sanitized_env", "delegate_task_child_sanitized_or_unavailable_fail_closed", "mcp_child_sanitized_or_unavailable_fail_closed"}, "CHILD_SUITE_INCOMPLETE")
    _expect_subset(suites["lifecycle_suite"], {"retry_uses_new_attempt_and_new_grants", "reclaim_revalidates_runtime_identity", "restart_uses_new_runtime_identity_and_policy_revalidation", "destroy_is_idempotent_and_audited"}, "LIFECYCLE_SUITE_INCOMPLETE")
    _expect_subset(suites["secret_regression_suite"], {"root_auth_json_trap_path_not_read", "root_credential_pool_trap_path_not_materialized", "oauth_refresh_attempt_by_worker_or_adapter_denied", "env_argv_logs_journal_evidence_secret_scan_passes"}, "SECRET_SUITE_INCOMPLETE")


def _validate_required_assertions(assertions: object) -> None:
    if not isinstance(assertions, dict):
        raise Phase1CA12ValidationError("REQUIRED_ASSERTIONS_INVALID")
    if assertions.get("all_tests_use_synthetic_fixtures") is not True:
        raise Phase1CA12ValidationError("SYNTHETIC_ONLY_NOT_REQUIRED")
    for field in ("real_provider_credentials_required", "provider_api_calls_allowed", "sandbox_execution_allowed_by_plan", "production_profile_launch_allowed", "gateway_change_allowed", "hermes_core_change_allowed_by_a12", "raw_env_capture_allowed", "secret_values_in_expected_outputs_allowed"):
        if assertions.get(field) is not False:
            raise Phase1CA12ValidationError(f"{field.upper()}_NOT_FALSE")


def _validate_required_tests(required_tests: object) -> None:
    if not isinstance(required_tests, dict):
        raise Phase1CA12ValidationError("REQUIRED_TESTS_INVALID")
    _expect_subset(required_tests.get("validator_unit"), {"plan_rejects_provider_api_calls", "plan_rejects_sandbox_execution_approval", "fixture_inventory_declares_secret_values_absent", "all_required_suites_present", "coverage_maps_a9_a10_a11", "execution_gate_forbids_gateway_profiles_auth_and_keychain"}, "VALIDATOR_TESTS_INCOMPLETE")
    _expect_subset(required_tests.get("future_synthetic_runner"), {"synthetic_policy_contract_suite", "synthetic_runtime_adapter_suite", "synthetic_broker_suite", "synthetic_child_process_suite", "synthetic_lifecycle_suite", "synthetic_secret_regression_suite"}, "RUNNER_TESTS_INCOMPLETE")
    _expect_subset(required_tests.get("security"), {"fixture_secret_scan", "runner_secret_scan", "evidence_pack_secret_scan", "no_network_provider_call_probe", "no_auth_json_or_keychain_access_probe"}, "SECURITY_TESTS_INCOMPLETE")


def validate_plan(path: Path = DEFAULT_PLAN) -> dict:
    plan = _load_json(path, "PLAN_MISSING")
    if plan.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA12ValidationError("SCHEMA_INVALID")
    content = plan.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1CA12ValidationError("DECISION_CONTENT_INVALID")
    if plan.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1CA12ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1CA12ValidationError("CONTENT_SHA_MISMATCH")
    _validate_a11_dependency()

    if content.get("phase") != "1C-A12":
        raise Phase1CA12ValidationError("PHASE_INVALID")
    if content.get("status") != EXPECTED_STATUS:
        raise Phase1CA12ValidationError("STATUS_INVALID")
    if content.get("decision") != EXPECTED_DECISION:
        raise Phase1CA12ValidationError("DECISION_INVALID")
    for field in ("implementation_approved", "test_execution_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved"):
        _expect_false(content, field)

    source = content.get("source_evidence")
    if not isinstance(source, dict) or source.get("a11_contract_file_sha256") != EXPECTED_A11_EVIDENCE_SHA or source.get("a11_content_sha256") != EXPECTED_A11_CONTENT_SHA:
        raise Phase1CA12ValidationError("SOURCE_EVIDENCE_INVALID")
    _expect_subset(content.get("test_plan_principles"), {"synthetic_only_fixtures", "no_real_credentials", "no_provider_api_calls", "no_production_profiles", "no_gateway_or_default_runtime_change", "deny_all_network_by_default", "host_side_broker_is_fake_and_secret_free", "fail_closed_assertions_are_first_class"}, "TEST_PLAN_PRINCIPLES_INCOMPLETE")
    _validate_fixture_inventory(content.get("fixture_inventory"))
    _validate_test_suites(content.get("test_suites"))
    _validate_required_assertions(content.get("required_assertions"))
    coverage = content.get("coverage_mapping")
    if not isinstance(coverage, dict) or set(coverage) != {"a9_broker_contract", "a10_runtime_adapter_design", "a11_profile_policy_contract"}:
        raise Phase1CA12ValidationError("COVERAGE_MAPPING_INVALID")
    _expect_subset(content.get("execution_gate_requirements"), {"owner_approves_synthetic_test_execution_contract", "runner_uses_isolated_synthetic_home", "runner_blocks_network_or_uses_fake_broker_only", "runner_does_not_start_gateway_profiles_or_canary", "runner_does_not_read_auth_json_or_keychain", "runner_outputs_sanitized_evidence_pack"}, "EXECUTION_GATE_REQUIREMENTS_INCOMPLETE")
    _expect_subset(content.get("fail_closed_cases"), {"fixture_contains_secret_shaped_value", "test_requires_real_provider_credential", "test_attempts_provider_network_call", "test_attempts_gateway_restart", "test_attempts_profile_launch", "test_attempts_auth_json_read", "test_attempts_keychain_read", "test_attempts_oauth_refresh", "test_attempts_root_pool_materialization", "expected_output_contains_secret_value"}, "FAIL_CLOSED_CASES_INCOMPLETE")
    _validate_required_tests(content.get("required_tests"))
    findings = content.get("design_review_findings")
    if not isinstance(findings, dict):
        raise Phase1CA12ValidationError("DESIGN_REVIEW_FINDINGS_INVALID")
    if findings.get("a11_dependency_satisfied") is not True or findings.get("synthetic_test_plan_ready") is not True:
        raise Phase1CA12ValidationError("DESIGN_REVIEW_NOT_READY")
    if findings.get("test_execution_ready") is not False or findings.get("production_runtime_ready") is not False:
        raise Phase1CA12ValidationError("EXECUTION_OR_PRODUCTION_READY_UNEXPECTED")
    if content.get("next_gate") != "A13_ROLLBACK_AND_OPERATOR_RUNBOOK":
        raise Phase1CA12ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-plan",
        "decision": EXPECTED_DECISION,
        "status": EXPECTED_STATUS,
        "content_sha256": EXPECTED_CONTENT_SHA,
        "test_execution_approved": False,
        "production_approved": False,
        "implementation_approved": False,
        "next_gate": content["next_gate"],
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["validate-plan"])
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-plan":
            _json_print(validate_plan(args.plan))
            return 0
    except (Phase1CA12ValidationError, json.JSONDecodeError) as error:
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
