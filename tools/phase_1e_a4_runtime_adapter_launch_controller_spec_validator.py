#!/usr/bin/env python3
"""Validate Phase 1E-A4 runtime adapter launch controller spec evidence."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a4/runtime-adapter-launch-controller-spec.json"
EXPECTED_SCHEMA = "pankster.phase1e-a4.runtime-adapter-launch-controller-spec.v1"
EXPECTED_CONTENT_SHA = "4946bd1cfb55e85e5e3afac7cbd8ccbb1f118430cdc5910e737418197c6385a7"
EXPECTED_A3_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a3/model-broker-detailed-spec.json"
EXPECTED_A3_EVIDENCE_SHA = "e7782da90d7ea486822d8a669a2d02eca7a0fe06d35b8c90b9072e343aa5c39d"
EXPECTED_A3_CONTENT_SHA = "0200b623f0e232f3261515127924c0ecc2868c7e90b22aec4dce30efb5dc7db5"


class Phase1EA4ValidationError(RuntimeError):
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
        raise Phase1EA4ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1EA4ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1EA4ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1EA4ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1EA4ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1EA4ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1EA4ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1EA4ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A3_EVIDENCE) != EXPECTED_A3_EVIDENCE_SHA:
        raise Phase1EA4ValidationError("SOURCE_A3_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A3_EVIDENCE, "SOURCE_A3_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A3_CONTENT_SHA:
        raise Phase1EA4ValidationError("SOURCE_A3_CONTENT_SHA_UNEXPECTED")

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
    ):
        if content.get(field) is not False:
            raise Phase1EA4ValidationError(f"{field.upper()}_NOT_FALSE")
    contract = content.get("launch_controller_contract")
    if not isinstance(contract, dict) or not contract:
        raise Phase1EA4ValidationError("LAUNCH_CONTROLLER_CONTRACT_INVALID")
    for field, value in contract.items():
        if value is not True:
            raise Phase1EA4ValidationError("LAUNCH_CONTROLLER_CONTRACT_NOT_TRUE", field)
    env_contract = content.get("environment_contract")
    if not isinstance(env_contract, dict) or not env_contract:
        raise Phase1EA4ValidationError("ENVIRONMENT_CONTRACT_INVALID")
    for field, value in env_contract.items():
        if value is not True:
            raise Phase1EA4ValidationError("ENVIRONMENT_CONTRACT_NOT_TRUE", field)
    states = set(content.get("lifecycle_states", []))
    for state in ("preflight_validated", "environment_sanitized", "destroyed", "rollback_disabled"):
        if state not in states:
            raise Phase1EA4ValidationError("LIFECYCLE_STATE_MISSING", state)
    fail_closed = set(content.get("fail_closed_cases", []))
    for case in ("missing_owner_approval", "audit_unavailable", "provider_secret_detected", "retry_or_reclaim_context_mismatch"):
        if case not in fail_closed:
            raise Phase1EA4ValidationError("FAIL_CLOSED_CASE_MISSING", case)
    tests = content.get("test_results", {}).get("targeted_1e_a4_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1EA4ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1E_A5_AUDIT_AND_ROLLBACK_SPEC":
        raise Phase1EA4ValidationError("NEXT_GATE_INVALID")

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
    except (Phase1EA4ValidationError, json.JSONDecodeError) as error:
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
