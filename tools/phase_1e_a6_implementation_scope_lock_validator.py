#!/usr/bin/env python3
"""Validate Phase 1E-A6 implementation scope lock evidence."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a6/implementation-scope-lock.json"
EXPECTED_SCHEMA = "pankster.phase1e-a6.implementation-scope-lock.v1"
EXPECTED_CONTENT_SHA = "818a7334cf6694e04d0823206d159cd7e34117cab95f1dd9fc910bf39c421ad1"
EXPECTED_A5_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a5/audit-and-rollback-spec.json"
EXPECTED_A5_EVIDENCE_SHA = "e45d5843d78ff903f1fb363dbe6a214e17e78bfb9cdd19ce4570a180aeee4162"
EXPECTED_A5_CONTENT_SHA = "9d24699742c36b8adb5daf8fe0b0f9b8a581eddb973279760c10a59ec085764d"


class Phase1EA6ValidationError(RuntimeError):
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
        raise Phase1EA6ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1EA6ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1EA6ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1EA6ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1EA6ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1EA6ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1EA6ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1EA6ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A5_EVIDENCE) != EXPECTED_A5_EVIDENCE_SHA:
        raise Phase1EA6ValidationError("SOURCE_A5_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A5_EVIDENCE, "SOURCE_A5_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A5_CONTENT_SHA:
        raise Phase1EA6ValidationError("SOURCE_A5_CONTENT_SHA_UNEXPECTED")

    for field in (
        "deployment_approved",
        "production_profiles_approved",
        "provider_api_calls_approved",
        "model_api_calls_approved",
        "sandbox_execution_approved",
        "subprocess_launch_approved",
        "gateway_changes_approved",
        "dependency_changes_approved",
        "credential_migration_approved",
        "oauth_refresh_approved",
        "implementation_code_approved",
    ):
        if content.get(field) is not False:
            raise Phase1EA6ValidationError(f"{field.upper()}_NOT_FALSE")
    allowlist = set(content.get("future_code_allowlist", []))
    for file_name in (
        "tools/pankster_runtime_security/credential_broker_contracts.py",
        "tools/pankster_runtime_security/model_broker_contracts.py",
        "tools/pankster_runtime_security/audit_contracts.py",
        "tools/pankster_runtime_security/runtime_launch_contracts.py",
    ):
        if file_name not in allowlist:
            raise Phase1EA6ValidationError("ALLOWLIST_FILE_MISSING", file_name)
    forbidden = set(content.get("forbidden_file_scope", []))
    for item in ("app/", "lib/", "package.json", ".env*", "gateway.py", "agent/conversation_loop.py"):
        if item not in forbidden:
            raise Phase1EA6ValidationError("FORBIDDEN_SCOPE_MISSING", item)
    constraints = content.get("future_code_constraints")
    if not isinstance(constraints, dict) or not constraints:
        raise Phase1EA6ValidationError("FUTURE_CODE_CONSTRAINTS_INVALID")
    for field, value in constraints.items():
        if value is not True:
            raise Phase1EA6ValidationError("FUTURE_CODE_CONSTRAINT_NOT_TRUE", field)
    approvals = set(content.get("separate_approval_required_for", []))
    for item in ("any provider SDK use", "any sandbox or subprocess launch", "any real credential read or OAuth refresh", "any production deployment"):
        if item not in approvals:
            raise Phase1EA6ValidationError("SEPARATE_APPROVAL_MISSING", item)
    tests = content.get("test_results", {}).get("targeted_1e_a6_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1EA6ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1E_A7_INDEPENDENT_SECURITY_REVIEW_BEFORE_CODE":
        raise Phase1EA6ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "deployment_approved": False,
        "implementation_approved": False,
        "production_approved": False,
        "next_gate": content["next_gate"],
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["validate-evidence"])
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-evidence":
            _json_print(validate_evidence(args.evidence))
            return 0
    except (Phase1EA6ValidationError, json.JSONDecodeError) as error:
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
