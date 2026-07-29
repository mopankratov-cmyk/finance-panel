#!/usr/bin/env python3
"""Validate the Phase 1D-A7 synthetic runner preflight contract."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a7/synthetic-runner-preflight-contract.json"
EXPECTED_SCHEMA = "pankster.phase1d-a7.synthetic-runner-preflight-contract.v1"
EXPECTED_CONTENT_SHA = "6c7f81b7d89118c9765360f734d1bbb8ffead126acedf4a8e8bc522f4a9b900f"
EXPECTED_A6_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a6/runtime-adapter-interface-stubs.json"
EXPECTED_A6_EVIDENCE_SHA = "06ea35078937d094ed10072a52a8940d45df89c0047c428741a846ca7174a1e3"
EXPECTED_A6_CONTENT_SHA = "c4a6e7ed09e7964bac9c057a86dc0a2d6a413ff971deeab3609bf905edcda1c0"
EXPECTED_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1D_A7_SYNTHETIC_RUNNER_PREFLIGHT_CONTRACT.ready.json"
EXPECTED_CONTRACT_FILE_SHA = "289f9fac25ee2013e9658bc2c2deb618a693a1c8ac502b86fcf0dc3057ed76a7"
EXPECTED_CONTRACT_CONTENT_SHA = "5b5daecd9c659a0f9292d8b0af828b017cfc3a266ee28487c2d03430c2b8efe8"


class Phase1DA7ValidationError(RuntimeError):
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
        raise Phase1DA7ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA7ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA7ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA7ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA7ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA7ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA7ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA7ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A6_EVIDENCE) != EXPECTED_A6_EVIDENCE_SHA:
        raise Phase1DA7ValidationError("SOURCE_A6_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A6_EVIDENCE, "SOURCE_A6_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A6_CONTENT_SHA:
        raise Phase1DA7ValidationError("SOURCE_A6_CONTENT_SHA_UNEXPECTED")

    if _sha256_file(EXPECTED_CONTRACT) != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase1DA7ValidationError("CONTRACT_FILE_SHA_MISMATCH")
    contract = _load_json(EXPECTED_CONTRACT, "CONTRACT_MISSING")
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA7ValidationError("CONTRACT_SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_SECURITY_REVIEW_NO_EXECUTION_APPROVAL":
        raise Phase1DA7ValidationError("CONTRACT_STATE_INVALID")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase1DA7ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1DA7ValidationError("CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1DA7ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")

    artifact = content.get("contract_artifact")
    if not isinstance(artifact, dict):
        raise Phase1DA7ValidationError("CONTRACT_ARTIFACT_INVALID")
    if artifact.get("file_sha256") != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase1DA7ValidationError("CONTRACT_ARTIFACT_FILE_SHA_INVALID")
    if artifact.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1DA7ValidationError("CONTRACT_ARTIFACT_CONTENT_SHA_INVALID")
    if artifact.get("execution_approval_issued") is not False or artifact.get("future_execution_requires_new_owner_approval") is not True:
        raise Phase1DA7ValidationError("CONTRACT_ARTIFACT_APPROVAL_SCOPE_INVALID")

    for field in ("deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved", "dependency_changes_approved"):
        if content.get(field) is not False:
            raise Phase1DA7ValidationError(f"{field.upper()}_NOT_FALSE")
    invariants = content.get("preflight_contract_invariants")
    if not isinstance(invariants, dict):
        raise Phase1DA7ValidationError("PREFLIGHT_INVARIANTS_INVALID")
    if invariants.get("preflight_contract_only") is not True or invariants.get("future_execution_requires_post_a8_owner_approval") is not True:
        raise Phase1DA7ValidationError("PREFLIGHT_POSITIVE_INVARIANTS_INVALID")
    for field in ("execution_allowed_by_this_gate", "sandbox_creation_allowed_by_this_gate", "provider_api_calls_allowed_by_this_gate", "real_credentials_allowed_by_this_gate", "gateway_or_profile_start_allowed_by_this_gate"):
        if invariants.get(field) is not False:
            raise Phase1DA7ValidationError("PREFLIGHT_FORBIDDEN_SCOPE_INVALID", field)
    tests = content.get("test_results", {}).get("targeted_preflight_contract_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1DA7ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "1D-A8_IMPLEMENTATION_SECURITY_REVIEW":
        raise Phase1DA7ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "contract_content_sha256": EXPECTED_CONTRACT_CONTENT_SHA,
        "execution_approval_issued": False,
        "deployment_approved": False,
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
    except (Phase1DA7ValidationError, json.JSONDecodeError) as error:
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
