#!/usr/bin/env python3
"""Validate the Phase 1C-A14 final implementation readiness review.

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


DEFAULT_REVIEW = PROJECT_ROOT / "security/evidence/phase-1c-a14/final-implementation-readiness-review.json"
EXPECTED_SCHEMA = "pankster.phase1c-a14.final-implementation-readiness-review.v1"
EXPECTED_CONTENT_SHA = "dc7374fdb34401768683f09874833ec7c3f666a569b18515ee4960a064ff1400"
EXPECTED_DECISION = "PHASE_1C_ARCHITECTURE_READY_FOR_CONTROLLED_IMPLEMENTATION_PRODUCTION_NOT_APPROVED"
EXPECTED_VERDICT = "READY_FOR_CONTROLLED_IMPLEMENTATION_PHASE_NOT_DEPLOYMENT"
EXPECTED_A13_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1c-a13/rollback-operator-runbook.json"
EXPECTED_A13_EVIDENCE_SHA = "9b1960dc33ef5e260eeb2b9f3e41d1cb6ea84b9005789d8b2332f6978888f1b1"
EXPECTED_A13_CONTENT_SHA = "ebc4f0879a72b106d610b48b252f661de8749053bbc6307c803ced9300f32afc"


class Phase1CA14ValidationError(RuntimeError):
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
        raise Phase1CA14ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA14ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA14ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1CA14ValidationError("SOURCE_A13_EVIDENCE_MISSING", str(path)) from error


def _expect_subset(values: object, expected: set[str], reason: str) -> None:
    if not isinstance(values, list):
        raise Phase1CA14ValidationError(reason, "not a list")
    missing = sorted(expected - set(values))
    if missing:
        raise Phase1CA14ValidationError(reason, ",".join(missing))


def _validate_a13_dependency() -> None:
    if _sha256_file(EXPECTED_A13_EVIDENCE) != EXPECTED_A13_EVIDENCE_SHA:
        raise Phase1CA14ValidationError("SOURCE_A13_EVIDENCE_SHA_MISMATCH")
    evidence = _load_json(EXPECTED_A13_EVIDENCE, "SOURCE_A13_EVIDENCE_MISSING")
    if evidence.get("content_sha256") != EXPECTED_A13_CONTENT_SHA:
        raise Phase1CA14ValidationError("SOURCE_A13_CONTENT_SHA_UNEXPECTED")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1CA14ValidationError("SOURCE_A13_CONTENT_INVALID")
    if content.get("status") != "ROLLBACK_AND_OPERATOR_RUNBOOK_COMPLETE_NO_DEPLOYMENT_APPROVAL":
        raise Phase1CA14ValidationError("SOURCE_A13_STATUS_INVALID")
    if content.get("next_gate") != "A14_FINAL_IMPLEMENTATION_READINESS_REVIEW":
        raise Phase1CA14ValidationError("SOURCE_A13_NEXT_GATE_INVALID")


def validate_review(path: Path = DEFAULT_REVIEW) -> dict:
    review = _load_json(path, "REVIEW_MISSING")
    if review.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA14ValidationError("SCHEMA_INVALID")
    content = review.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1CA14ValidationError("DECISION_CONTENT_INVALID")
    if review.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1CA14ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1CA14ValidationError("CONTENT_SHA_MISMATCH")
    _validate_a13_dependency()

    if content.get("phase") != "1C-A14":
        raise Phase1CA14ValidationError("PHASE_INVALID")
    if content.get("status") != "FINAL_IMPLEMENTATION_READINESS_REVIEW_COMPLETE":
        raise Phase1CA14ValidationError("STATUS_INVALID")
    if content.get("verdict") != EXPECTED_VERDICT:
        raise Phase1CA14ValidationError("VERDICT_INVALID")
    if content.get("decision") != EXPECTED_DECISION:
        raise Phase1CA14ValidationError("DECISION_INVALID")
    if content.get("controlled_implementation_phase_entry_ready") is not True:
        raise Phase1CA14ValidationError("CONTROLLED_IMPLEMENTATION_PHASE_NOT_READY")
    for field in ("code_changes_approved_by_a14", "deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved"):
        if content.get(field) is not False:
            raise Phase1CA14ValidationError(f"{field.upper()}_NOT_FALSE")

    if len(content.get("reviewed_gates", [])) != 14:
        raise Phase1CA14ValidationError("REVIEWED_GATES_INCOMPLETE")
    findings = content.get("readiness_findings")
    if not isinstance(findings, dict):
        raise Phase1CA14ValidationError("READINESS_FINDINGS_INVALID")
    for field in ("synthetic_e2b_isolation_proof_passed", "host_side_broker_spec_complete", "runtime_adapter_design_review_complete", "profile_policy_contract_complete", "synthetic_test_plan_complete", "rollback_operator_runbook_complete", "dev_director_remains_created_but_disabled", "content_director_remains_created_but_disabled", "default_gateway_unchanged_by_phase_1c"):
        if findings.get(field) is not True:
            raise Phase1CA14ValidationError("READINESS_FINDING_MISSING", field)
    if findings.get("production_runtime_ready") is not False or findings.get("deployment_ready") is not False:
        raise Phase1CA14ValidationError("PRODUCTION_OR_DEPLOYMENT_READY_UNEXPECTED")

    _expect_subset(content.get("implementation_scope_allowed_next"), {"create_feature_flagged_runtime_adapter_interfaces", "create_policy_schema_and_validation_units", "create_fake_host_side_model_broker_for_tests", "create_fake_credential_broker_grant_registry_for_tests", "create_environment_sanitizer_units"}, "ALLOWED_SCOPE_INCOMPLETE")
    _expect_subset(content.get("implementation_scope_forbidden_next"), {"enable_production_profiles", "start_gateway_or_canary", "call_real_model_or_provider_apis", "read_root_auth_json_or_keychain", "materialize_root_credential_pool", "write_profile_provider_secrets", "perform_oauth_refresh", "pass_provider_secret_to_sandbox_or_child_process", "change_default_gateway_behavior", "deploy_to_production"}, "FORBIDDEN_SCOPE_INCOMPLETE")
    _expect_subset(content.get("minimum_acceptance_criteria_for_next_phase"), {"all_runtime_changes_behind_disabled_feature_flags", "unit_tests_for_policy_broker_adapter_environment_lifecycle", "synthetic_only_integration_tests_before_real_runtime", "secret_scan_for_env_argv_logs_journal_evidence", "rollback_tests_disable_flags_and_revoke_grants", "independent_security_review_before_any_production_profile_enablement"}, "ACCEPTANCE_CRITERIA_INCOMPLETE")
    controls = content.get("required_next_phase_controls")
    if not isinstance(controls, dict):
        raise Phase1CA14ValidationError("NEXT_PHASE_CONTROLS_INVALID")
    for field in ("feature_flags_required", "synthetic_only_initial_tests_required", "owner_approval_required_for_any_execution", "independent_review_required_before_production", "default_gateway_must_remain_unchanged", "named_profiles_must_remain_disabled_until_owner_approval", "no_real_credentials_until_security_gate"):
        if controls.get(field) is not True:
            raise Phase1CA14ValidationError("NEXT_PHASE_CONTROL_MISSING", field)
    if len(content.get("residual_risks", [])) < 5:
        raise Phase1CA14ValidationError("RESIDUAL_RISKS_INCOMPLETE")
    if len(content.get("hard_blockers_to_production", [])) < 6:
        raise Phase1CA14ValidationError("PRODUCTION_BLOCKERS_INCOMPLETE")
    closeout = content.get("phase_1c_closeout")
    if not isinstance(closeout, dict) or closeout.get("complete") is not True:
        raise Phase1CA14ValidationError("PHASE_CLOSEOUT_INVALID")
    if closeout.get("production_approval") != "NOT_APPROVED" or closeout.get("deployment_approval") != "NOT_APPROVED":
        raise Phase1CA14ValidationError("PHASE_CLOSEOUT_SCOPE_TOO_BROAD")
    if content.get("next_gate") != "PHASE_1D_CONTROLLED_IMPLEMENTATION_PLANNING":
        raise Phase1CA14ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-review",
        "decision": EXPECTED_DECISION,
        "verdict": EXPECTED_VERDICT,
        "content_sha256": EXPECTED_CONTENT_SHA,
        "phase_1c_complete": True,
        "deployment_approved": False,
        "production_approved": False,
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
    except (Phase1CA14ValidationError, json.JSONDecodeError) as error:
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
