#!/usr/bin/env python3
"""Validate the Phase 1D-A2 feature flag and config scaffold spec.

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


DEFAULT_SPEC = PROJECT_ROOT / "security/evidence/phase-1d-a2/feature-flag-and-config-scaffold-spec.json"
EXPECTED_SCHEMA = "pankster.phase1d-a2.feature-flag-config-scaffold-spec.v1"
EXPECTED_CONTENT_SHA = "d40eab7a1fa78f004f07b8c81da83f140e39462c2b03b7a1c1f6dcfca28ddc66"
EXPECTED_DECISION = "FEATURE_FLAGS_AND_CONFIG_RULES_READY_FOR_PURE_UNIT_IMPLEMENTATION_NOT_RUNTIME"
EXPECTED_STATUS = "FEATURE_FLAG_AND_CONFIG_SCAFFOLD_SPEC_COMPLETE_NO_CODE_APPROVAL"
EXPECTED_A1_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a1/implementation-scope-and-branch-contract.json"
EXPECTED_A1_EVIDENCE_SHA = "a18a115f6fb8ea133f11c8636b8d910a902f5317bb33da23e3338cb29147e27d"
EXPECTED_A1_CONTENT_SHA = "80c77343c615d5e3a4cb7dc48569e8aa40a24254e4689032d72471f3c82e1035"


class Phase1DA2ValidationError(RuntimeError):
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
        raise Phase1DA2ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA2ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA2ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA2ValidationError("SOURCE_A1_EVIDENCE_MISSING", str(path)) from error


def _expect_subset(values: object, expected: set[str], reason: str) -> None:
    if not isinstance(values, list):
        raise Phase1DA2ValidationError(reason, "not a list")
    missing = sorted(expected - set(values))
    if missing:
        raise Phase1DA2ValidationError(reason, ",".join(missing))


def _validate_a1_dependency() -> None:
    if _sha256_file(EXPECTED_A1_EVIDENCE) != EXPECTED_A1_EVIDENCE_SHA:
        raise Phase1DA2ValidationError("SOURCE_A1_EVIDENCE_SHA_MISMATCH")
    evidence = _load_json(EXPECTED_A1_EVIDENCE, "SOURCE_A1_EVIDENCE_MISSING")
    if evidence.get("content_sha256") != EXPECTED_A1_CONTENT_SHA:
        raise Phase1DA2ValidationError("SOURCE_A1_CONTENT_SHA_UNEXPECTED")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA2ValidationError("SOURCE_A1_CONTENT_INVALID")
    if content.get("status") != "IMPLEMENTATION_SCOPE_AND_BRANCH_CONTRACT_COMPLETE_NO_CODE_APPROVAL":
        raise Phase1DA2ValidationError("SOURCE_A1_STATUS_INVALID")
    if content.get("next_gate") != "1D-A2_FEATURE_FLAG_AND_CONFIG_SCAFFOLD_SPEC":
        raise Phase1DA2ValidationError("SOURCE_A1_NEXT_GATE_INVALID")


def validate_spec(path: Path = DEFAULT_SPEC) -> dict:
    spec = _load_json(path, "SPEC_MISSING")
    if spec.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA2ValidationError("SCHEMA_INVALID")
    content = spec.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA2ValidationError("DECISION_CONTENT_INVALID")
    if spec.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA2ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA2ValidationError("CONTENT_SHA_MISMATCH")
    _validate_a1_dependency()

    if content.get("phase") != "1D-A2":
        raise Phase1DA2ValidationError("PHASE_INVALID")
    if content.get("status") != EXPECTED_STATUS:
        raise Phase1DA2ValidationError("STATUS_INVALID")
    if content.get("decision") != EXPECTED_DECISION:
        raise Phase1DA2ValidationError("DECISION_INVALID")
    for field in ("implementation_code_approved_by_a2", "deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved", "dependency_changes_approved"):
        if content.get(field) is not False:
            raise Phase1DA2ValidationError(f"{field.upper()}_NOT_FALSE")

    flags = content.get("flag_definitions")
    if not isinstance(flags, dict) or len(flags) != 5:
        raise Phase1DA2ValidationError("FLAG_DEFINITIONS_INVALID")
    for flag, definition in flags.items():
        if definition.get("default") is not False:
            raise Phase1DA2ValidationError("FLAG_DEFAULT_NOT_FALSE", flag)
        _expect_subset(definition.get("allowed_true_values"), {"1", "true", "yes", "on"}, "TRUE_VALUES_INCOMPLETE")
        _expect_subset(definition.get("allowed_false_values"), {"0", "false", "no", "off", ""}, "FALSE_VALUES_INCOMPLETE")
        if definition.get("invalid_value_behavior") != "deny":
            raise Phase1DA2ValidationError("INVALID_FLAG_NOT_DENY", flag)

    config = content.get("config_source_contract")
    if not isinstance(config, dict):
        raise Phase1DA2ValidationError("CONFIG_SOURCE_CONTRACT_INVALID")
    if config.get("input_type") != "explicit_mapping_only":
        raise Phase1DA2ValidationError("CONFIG_INPUT_TYPE_INVALID")
    for field in ("read_process_environment_allowed_in_pure_units", "read_env_files_allowed", "read_auth_json_allowed", "read_keychain_allowed", "network_allowed", "filesystem_writes_allowed"):
        if config.get(field) is not False:
            raise Phase1DA2ValidationError("CONFIG_SOURCE_TOO_BROAD", field)
    if config.get("invalid_flag_behavior") != "deny":
        raise Phase1DA2ValidationError("CONFIG_INVALID_FLAG_NOT_DENY")

    rules = content.get("gate_dependency_rules")
    if not isinstance(rules, dict):
        raise Phase1DA2ValidationError("GATE_DEPENDENCY_RULES_INVALID")
    _expect_subset(rules.get("runtime_adapter_requires"), {"PANKSTER_RUNTIME_ADAPTER_ENABLED", "PANKSTER_HOST_MODEL_BROKER_ENABLED", "PANKSTER_CREDENTIAL_BROKER_ENABLED"}, "RUNTIME_ADAPTER_REQUIREMENTS_INCOMPLETE")
    _expect_subset(rules.get("named_profile_runtime_requires"), {"PANKSTER_NAMED_PROFILE_RUNTIME_ENABLED", "PANKSTER_RUNTIME_ADAPTER_ENABLED"}, "NAMED_PROFILE_REQUIREMENTS_INCOMPLETE")
    if rules.get("production_profile_requires_future_gate") != "not_defined_in_a2":
        raise Phase1DA2ValidationError("PRODUCTION_PROFILE_GATE_UNEXPECTEDLY_DEFINED")

    scaffold = content.get("scaffold_files_allowed_next")
    if not isinstance(scaffold, dict):
        raise Phase1DA2ValidationError("SCAFFOLD_FILES_INVALID")
    if scaffold.get("package_init_file") != "tools/pankster_runtime_security/__init__.py":
        raise Phase1DA2ValidationError("PACKAGE_INIT_FILE_INVALID")
    if scaffold.get("policy_schema_file") != "tools/pankster_runtime_security/policy_schema.py":
        raise Phase1DA2ValidationError("POLICY_SCHEMA_FILE_INVALID")
    if scaffold.get("policy_schema_test") != "tools/tests/test_pankster_runtime_security_policy_schema.py":
        raise Phase1DA2ValidationError("POLICY_SCHEMA_TEST_INVALID")

    _expect_subset(content.get("forbidden_files"), {"app/", "components/", "lib/", "package.json", ".env", ".env.local", ".gitea/", ".github/", "gateway.py", "web_server.py", "agent/conversation_loop.py"}, "FORBIDDEN_FILES_INCOMPLETE")
    _expect_subset(content.get("required_behavior_for_future_implementation"), {"all_flags_default_false", "parser_is_case_insensitive", "parser_trims_surrounding_whitespace", "invalid_values_return_denied_state_not_true", "unknown_flags_do_not_enable_any_capability", "enabled_named_profile_runtime_requires_runtime_adapter_enabled", "no_process_env_read_in_unit_tests", "no_secret_values_logged"}, "REQUIRED_BEHAVIOR_INCOMPLETE")
    _expect_subset(content.get("fail_closed_cases"), {"a1_dependency_missing_or_hash_mismatch", "flag_default_true", "invalid_flag_value", "named_profile_runtime_enabled_without_runtime_adapter", "runtime_adapter_enabled_without_brokers", "auth_json_or_keychain_read_detected", "network_call_detected", "forbidden_file_changed", "secret_scan_failed"}, "FAIL_CLOSED_CASES_INCOMPLETE")

    findings = content.get("readiness_findings")
    if not isinstance(findings, dict) or findings.get("feature_flag_spec_ready") is not True:
        raise Phase1DA2ValidationError("READINESS_FINDINGS_INVALID")
    if findings.get("future_a3_code_gate_may_start_after_a2") is not True:
        raise Phase1DA2ValidationError("A3_GATE_NOT_READY")
    if findings.get("runtime_execution_ready") is not False or findings.get("production_ready") is not False:
        raise Phase1DA2ValidationError("RUNTIME_OR_PRODUCTION_READY_UNEXPECTED")
    if content.get("next_gate") != "1D-A3_POLICY_SCHEMA_VALIDATOR_IMPLEMENTATION":
        raise Phase1DA2ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-spec",
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
    parser.add_argument("--mode", required=True, choices=["validate-spec"])
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-spec":
            _json_print(validate_spec(args.spec))
            return 0
    except (Phase1DA2ValidationError, json.JSONDecodeError) as error:
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
