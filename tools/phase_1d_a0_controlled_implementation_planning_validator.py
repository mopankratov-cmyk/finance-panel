#!/usr/bin/env python3
"""Validate the Phase 1D-A0 controlled implementation planning contract.

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


DEFAULT_PLAN = PROJECT_ROOT / "security/evidence/phase-1d-a0/controlled-implementation-planning.json"
EXPECTED_SCHEMA = "pankster.phase1d-a0.controlled-implementation-planning.v1"
EXPECTED_CONTENT_SHA = "346de53f0268a98d52dbd9805c1a1b8e9c7851f5dce92b122ec0879c10f109d9"
EXPECTED_DECISION = "PHASE_1D_SCOPE_READY_FOR_FEATURE_FLAGGED_IMPLEMENTATION_PLANNING_ONLY"
EXPECTED_STATUS = "CONTROLLED_IMPLEMENTATION_PLANNING_COMPLETE_NO_RUNTIME_APPROVAL"
EXPECTED_A14_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1c-a14/final-implementation-readiness-review.json"
EXPECTED_A14_EVIDENCE_SHA = "652284b5633d26eacc0c99c2b9f34471968f2a2f1bfdcfced6d02e0fb1505cf8"
EXPECTED_A14_CONTENT_SHA = "dc7374fdb34401768683f09874833ec7c3f666a569b18515ee4960a064ff1400"


class Phase1DA0ValidationError(RuntimeError):
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
        raise Phase1DA0ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA0ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA0ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA0ValidationError("SOURCE_A14_EVIDENCE_MISSING", str(path)) from error


def _expect_subset(values: object, expected: set[str], reason: str) -> None:
    if not isinstance(values, list):
        raise Phase1DA0ValidationError(reason, "not a list")
    missing = sorted(expected - set(values))
    if missing:
        raise Phase1DA0ValidationError(reason, ",".join(missing))


def _validate_a14_dependency() -> None:
    if _sha256_file(EXPECTED_A14_EVIDENCE) != EXPECTED_A14_EVIDENCE_SHA:
        raise Phase1DA0ValidationError("SOURCE_A14_EVIDENCE_SHA_MISMATCH")
    evidence = _load_json(EXPECTED_A14_EVIDENCE, "SOURCE_A14_EVIDENCE_MISSING")
    if evidence.get("content_sha256") != EXPECTED_A14_CONTENT_SHA:
        raise Phase1DA0ValidationError("SOURCE_A14_CONTENT_SHA_UNEXPECTED")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA0ValidationError("SOURCE_A14_CONTENT_INVALID")
    if content.get("verdict") != "READY_FOR_CONTROLLED_IMPLEMENTATION_PHASE_NOT_DEPLOYMENT":
        raise Phase1DA0ValidationError("SOURCE_A14_VERDICT_INVALID")
    if content.get("next_gate") != "PHASE_1D_CONTROLLED_IMPLEMENTATION_PLANNING":
        raise Phase1DA0ValidationError("SOURCE_A14_NEXT_GATE_INVALID")


def validate_plan(path: Path = DEFAULT_PLAN) -> dict:
    plan = _load_json(path, "PLAN_MISSING")
    if plan.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA0ValidationError("SCHEMA_INVALID")
    content = plan.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA0ValidationError("DECISION_CONTENT_INVALID")
    if plan.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA0ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA0ValidationError("CONTENT_SHA_MISMATCH")
    _validate_a14_dependency()

    if content.get("phase") != "1D-A0":
        raise Phase1DA0ValidationError("PHASE_INVALID")
    if content.get("status") != EXPECTED_STATUS:
        raise Phase1DA0ValidationError("STATUS_INVALID")
    if content.get("decision") != EXPECTED_DECISION:
        raise Phase1DA0ValidationError("DECISION_INVALID")
    for field in (
        "implementation_code_approved_by_a0",
        "deployment_approved",
        "production_profiles_approved",
        "provider_api_calls_approved",
        "sandbox_execution_approved",
        "gateway_changes_approved",
    ):
        if content.get(field) is not False:
            raise Phase1DA0ValidationError(f"{field.upper()}_NOT_FALSE")

    _expect_subset(
        content.get("planning_principles"),
        {
            "implementation_must_be_incremental",
            "all_runtime_paths_behind_disabled_feature_flags",
            "start_with_pure_policy_and_sanitizer_units",
            "fake_brokers_before_real_brokers",
            "synthetic_tests_before_any_sandbox_execution",
            "no_gateway_default_profile_change",
            "no_real_credentials_until_later_security_gate",
            "named_profiles_remain_disabled",
            "fail_closed_on_missing_policy_or_flag",
        },
        "PLANNING_PRINCIPLES_INCOMPLETE",
    )
    _expect_subset(
        content.get("allowed_planning_scope"),
        {
            "define_phase_1d_gate_sequence",
            "define_feature_flag_names_and_default_disabled_state",
            "define_module_boundaries_for_policy_broker_adapter_sanitizer",
            "define_test_fixture_boundaries",
            "define_secret_scan_requirements",
            "define_review_checkpoints",
        },
        "ALLOWED_SCOPE_INCOMPLETE",
    )
    _expect_subset(
        content.get("forbidden_planning_scope"),
        {
            "modify_hermes_core_runtime_behavior",
            "start_gateway_or_canary",
            "start_profiles",
            "call_real_model_or_provider_apis",
            "read_auth_json_or_keychain",
            "write_profile_provider_secrets",
            "perform_oauth_refresh",
            "enable_named_profiles",
            "deploy_to_production",
        },
        "FORBIDDEN_SCOPE_INCOMPLETE",
    )

    gates = content.get("phase_1d_gate_sequence")
    if not isinstance(gates, list) or len(gates) != 8:
        raise Phase1DA0ValidationError("GATE_SEQUENCE_INVALID")
    code_allowed = {entry["gate"]: entry["allows_code"] for entry in gates if isinstance(entry, dict) and "gate" in entry}
    if code_allowed.get("1D-A1_IMPLEMENTATION_SCOPE_AND_BRANCH_CONTRACT") is not False:
        raise Phase1DA0ValidationError("A1_CODE_UNEXPECTEDLY_ALLOWED")
    if code_allowed.get("1D-A3_POLICY_SCHEMA_VALIDATOR_IMPLEMENTATION") is not True:
        raise Phase1DA0ValidationError("A3_CODE_NOT_ALLOWED")
    if code_allowed.get("1D-A6_RUNTIME_ADAPTER_INTERFACE_STUBS") is not True:
        raise Phase1DA0ValidationError("A6_CODE_NOT_ALLOWED")
    if code_allowed.get("1D-A7_SYNTHETIC_RUNNER_PREFLIGHT_CONTRACT") is not False:
        raise Phase1DA0ValidationError("A7_EXECUTION_OR_CODE_UNEXPECTEDLY_ALLOWED")

    flags = content.get("feature_flags_default_disabled")
    if not isinstance(flags, dict):
        raise Phase1DA0ValidationError("FEATURE_FLAGS_INVALID")
    for flag, value in flags.items():
        if value is not False:
            raise Phase1DA0ValidationError("FEATURE_FLAG_NOT_DISABLED", flag)
    _expect_subset(list(flags), {"PANKSTER_RUNTIME_ADAPTER_ENABLED", "PANKSTER_HOST_MODEL_BROKER_ENABLED", "PANKSTER_CREDENTIAL_BROKER_ENABLED", "PANKSTER_NAMED_PROFILE_RUNTIME_ENABLED", "PANKSTER_SYNTHETIC_RUNNER_ENABLED"}, "FEATURE_FLAGS_INCOMPLETE")

    modules = content.get("initial_module_boundaries")
    if not isinstance(modules, dict):
        raise Phase1DA0ValidationError("MODULE_BOUNDARIES_INVALID")
    for module_name in ("policy_schema_validator", "environment_sanitizer", "fake_grant_registry", "fake_model_broker", "runtime_adapter_stubs"):
        module = modules.get(module_name)
        if not isinstance(module, dict):
            raise Phase1DA0ValidationError("MODULE_BOUNDARY_MISSING", module_name)
        forbidden = module.get("forbidden", "")
        if module_name in {"policy_schema_validator", "fake_model_broker"} and not any(term in forbidden for term in ("credential", "network", "Provider", "provider")):
            raise Phase1DA0ValidationError("MODULE_FORBIDDEN_SCOPE_TOO_WEAK", module_name)
    if "sandbox launch" not in modules["runtime_adapter_stubs"].get("forbidden", ""):
        raise Phase1DA0ValidationError("RUNTIME_ADAPTER_STUBS_ALLOW_SANDBOX")

    findings = content.get("readiness_findings")
    if not isinstance(findings, dict):
        raise Phase1DA0ValidationError("READINESS_FINDINGS_INVALID")
    if findings.get("phase_1c_complete") is not True or findings.get("phase_1d_planning_ready") is not True:
        raise Phase1DA0ValidationError("PLANNING_NOT_READY")
    for field in ("implementation_code_ready_to_start", "runtime_execution_ready", "production_ready"):
        if findings.get(field) is not False:
            raise Phase1DA0ValidationError("READINESS_SCOPE_TOO_BROAD", field)
    _expect_subset(content.get("fail_closed_cases"), {"a14_dependency_missing_or_hash_mismatch", "requested_code_before_scope_gate", "feature_flag_default_true", "module_requires_real_credentials", "module_requires_provider_network", "module_reads_auth_json_or_keychain", "gateway_change_requested", "secret_scan_failed"}, "FAIL_CLOSED_CASES_INCOMPLETE")
    if content.get("next_gate") != "1D-A1_IMPLEMENTATION_SCOPE_AND_BRANCH_CONTRACT":
        raise Phase1DA0ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-plan",
        "decision": EXPECTED_DECISION,
        "status": EXPECTED_STATUS,
        "content_sha256": EXPECTED_CONTENT_SHA,
        "implementation_code_approved": False,
        "deployment_approved": False,
        "production_approved": False,
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
    except (Phase1DA0ValidationError, json.JSONDecodeError) as error:
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
