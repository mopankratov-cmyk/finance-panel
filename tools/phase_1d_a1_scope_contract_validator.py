#!/usr/bin/env python3
"""Validate the Phase 1D-A1 implementation scope and branch contract.

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


DEFAULT_CONTRACT = PROJECT_ROOT / "security/evidence/phase-1d-a1/implementation-scope-and-branch-contract.json"
EXPECTED_SCHEMA = "pankster.phase1d-a1.implementation-scope-and-branch-contract.v1"
EXPECTED_CONTENT_SHA = "80c77343c615d5e3a4cb7dc48569e8aa40a24254e4689032d72471f3c82e1035"
EXPECTED_DECISION = "PHASE_1D_EXACT_SCOPE_LOCKED_FOR_FUTURE_PURE_IMPLEMENTATION_GATES"
EXPECTED_STATUS = "IMPLEMENTATION_SCOPE_AND_BRANCH_CONTRACT_COMPLETE_NO_CODE_APPROVAL"
EXPECTED_A0_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a0/controlled-implementation-planning.json"
EXPECTED_A0_EVIDENCE_SHA = "5be6986909ef8213e65c2f42e5841a377af2caf2087ce79fa1a4855378d012b6"
EXPECTED_A0_CONTENT_SHA = "346de53f0268a98d52dbd9805c1a1b8e9c7851f5dce92b122ec0879c10f109d9"


class Phase1DA1ValidationError(RuntimeError):
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
        raise Phase1DA1ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA1ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA1ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA1ValidationError("SOURCE_A0_EVIDENCE_MISSING", str(path)) from error


def _expect_subset(values: object, expected: set[str], reason: str) -> None:
    if not isinstance(values, list):
        raise Phase1DA1ValidationError(reason, "not a list")
    missing = sorted(expected - set(values))
    if missing:
        raise Phase1DA1ValidationError(reason, ",".join(missing))


def _validate_a0_dependency() -> None:
    if _sha256_file(EXPECTED_A0_EVIDENCE) != EXPECTED_A0_EVIDENCE_SHA:
        raise Phase1DA1ValidationError("SOURCE_A0_EVIDENCE_SHA_MISMATCH")
    evidence = _load_json(EXPECTED_A0_EVIDENCE, "SOURCE_A0_EVIDENCE_MISSING")
    if evidence.get("content_sha256") != EXPECTED_A0_CONTENT_SHA:
        raise Phase1DA1ValidationError("SOURCE_A0_CONTENT_SHA_UNEXPECTED")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA1ValidationError("SOURCE_A0_CONTENT_INVALID")
    if content.get("status") != "CONTROLLED_IMPLEMENTATION_PLANNING_COMPLETE_NO_RUNTIME_APPROVAL":
        raise Phase1DA1ValidationError("SOURCE_A0_STATUS_INVALID")
    if content.get("next_gate") != "1D-A1_IMPLEMENTATION_SCOPE_AND_BRANCH_CONTRACT":
        raise Phase1DA1ValidationError("SOURCE_A0_NEXT_GATE_INVALID")


def validate_contract(path: Path = DEFAULT_CONTRACT) -> dict:
    contract = _load_json(path, "CONTRACT_MISSING")
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA1ValidationError("SCHEMA_INVALID")
    content = contract.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA1ValidationError("DECISION_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA1ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA1ValidationError("CONTENT_SHA_MISMATCH")
    _validate_a0_dependency()

    if content.get("phase") != "1D-A1":
        raise Phase1DA1ValidationError("PHASE_INVALID")
    if content.get("status") != EXPECTED_STATUS:
        raise Phase1DA1ValidationError("STATUS_INVALID")
    if content.get("decision") != EXPECTED_DECISION:
        raise Phase1DA1ValidationError("DECISION_INVALID")
    for field in ("implementation_code_approved_by_a1", "deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved", "dependency_changes_approved"):
        if content.get(field) is not False:
            raise Phase1DA1ValidationError(f"{field.upper()}_NOT_FALSE")

    branch = content.get("branch_contract")
    if not isinstance(branch, dict):
        raise Phase1DA1ValidationError("BRANCH_CONTRACT_INVALID")
    if branch.get("current_branch") != "phase/1c-runtime-isolation-architecture":
        raise Phase1DA1ValidationError("CURRENT_BRANCH_CONTRACT_INVALID")
    for field in ("main_push_allowed", "force_push_allowed", "dirty_worktree_allowed_before_gate"):
        if branch.get(field) is not False:
            raise Phase1DA1ValidationError(f"{field.upper()}_NOT_FALSE")
    if branch.get("commit_each_gate") is not True or branch.get("push_after_each_gate") is not True:
        raise Phase1DA1ValidationError("COMMIT_PUSH_GATE_CONTRACT_INVALID")

    scope = content.get("future_code_scope_allowed")
    if not isinstance(scope, dict):
        raise Phase1DA1ValidationError("FUTURE_SCOPE_INVALID")
    if scope.get("new_package_root") != "tools/pankster_runtime_security/":
        raise Phase1DA1ValidationError("PACKAGE_ROOT_INVALID")
    _expect_subset(scope.get("package_files"), {"tools/pankster_runtime_security/policy_schema.py", "tools/pankster_runtime_security/environment_sanitizer.py", "tools/pankster_runtime_security/fake_grants.py", "tools/pankster_runtime_security/fake_model_broker.py", "tools/pankster_runtime_security/runtime_adapter_contracts.py"}, "PACKAGE_FILES_INCOMPLETE")
    _expect_subset(scope.get("test_files"), {"tools/tests/test_pankster_runtime_security_policy_schema.py", "tools/tests/test_pankster_runtime_security_environment_sanitizer.py", "tools/tests/test_pankster_runtime_security_fake_model_broker.py", "tools/tests/test_pankster_runtime_security_runtime_adapter_contracts.py"}, "TEST_FILES_INCOMPLETE")

    _expect_subset(
        content.get("forbidden_planning_scope"),
        {"app/", "components/", "lib/", "package.json", ".env", ".env.local", ".gitea/", ".github/", "gateway.py", "web_server.py", "agent/conversation_loop.py", "Hermes core runtime files outside this repository"},
        "FORBIDDEN_SCOPE_INCOMPLETE",
    )
    matrix = content.get("module_permission_matrix")
    if not isinstance(matrix, dict):
        raise Phase1DA1ValidationError("MODULE_PERMISSION_MATRIX_INVALID")
    for module in ("policy_schema", "environment_sanitizer", "fake_grants_and_broker"):
        entry = matrix.get(module)
        if not isinstance(entry, dict):
            raise Phase1DA1ValidationError("MODULE_ENTRY_MISSING", module)
        for field in ("runtime_side_effects_allowed", "network_allowed", "credential_reads_allowed"):
            if entry.get(field) is not False:
                raise Phase1DA1ValidationError("MODULE_PERMISSION_TOO_BROAD", f"{module}:{field}")
    adapter = matrix.get("runtime_adapter_contracts")
    if adapter.get("sandbox_launch_allowed") is not False or adapter.get("gateway_integration_allowed") is not False:
        raise Phase1DA1ValidationError("RUNTIME_ADAPTER_SCOPE_TOO_BROAD")

    findings = content.get("readiness_findings")
    if not isinstance(findings, dict) or findings.get("exact_scope_locked") is not True:
        raise Phase1DA1ValidationError("READINESS_FINDINGS_INVALID")
    if findings.get("future_code_gates_can_start_after_a2") is not False:
        raise Phase1DA1ValidationError("CODE_GATES_START_TOO_EARLY")
    if findings.get("runtime_execution_ready") is not False or findings.get("production_ready") is not False:
        raise Phase1DA1ValidationError("RUNTIME_OR_PRODUCTION_READY_UNEXPECTED")
    if content.get("next_gate") != "1D-A2_FEATURE_FLAG_AND_CONFIG_SCAFFOLD_SPEC":
        raise Phase1DA1ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-contract",
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
    parser.add_argument("--mode", required=True, choices=["validate-contract"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-contract":
            _json_print(validate_contract(args.contract))
            return 0
    except (Phase1DA1ValidationError, json.JSONDecodeError) as error:
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
