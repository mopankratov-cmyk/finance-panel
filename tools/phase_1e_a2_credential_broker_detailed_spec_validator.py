#!/usr/bin/env python3
"""Validate Phase 1E-A2 credential broker detailed spec evidence."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a2/credential-broker-detailed-spec.json"
EXPECTED_SCHEMA = "pankster.phase1e-a2.credential-broker-detailed-spec.v1"
EXPECTED_CONTENT_SHA = "f750f0ead6313a0c89ed7edd0c908c7c43b3c11324ec5c013171e919874159df"
EXPECTED_A1_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a1/real-runtime-threat-model.json"
EXPECTED_A1_EVIDENCE_SHA = "13da547bdd5d649b83887430b7486afb512872dc04b72b8a88ba00d13000e822"
EXPECTED_A1_CONTENT_SHA = "2c9629a6389d94098fcb8e8938af4a377277ef3cd34f795f5fbbe6f5d882839b"


class Phase1EA2ValidationError(RuntimeError):
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
        raise Phase1EA2ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1EA2ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1EA2ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1EA2ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1EA2ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1EA2ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1EA2ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1EA2ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A1_EVIDENCE) != EXPECTED_A1_EVIDENCE_SHA:
        raise Phase1EA2ValidationError("SOURCE_A1_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A1_EVIDENCE, "SOURCE_A1_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A1_CONTENT_SHA:
        raise Phase1EA2ValidationError("SOURCE_A1_CONTENT_SHA_UNEXPECTED")

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
            raise Phase1EA2ValidationError(f"{field.upper()}_NOT_FALSE")
    contract = content.get("credential_broker_contract")
    if not isinstance(contract, dict) or not contract:
        raise Phase1EA2ValidationError("CREDENTIAL_BROKER_CONTRACT_INVALID")
    for field, value in contract.items():
        if value is not True:
            raise Phase1EA2ValidationError("CREDENTIAL_BROKER_CONTRACT_NOT_TRUE", field)
    credential_fields = set(content.get("credential_reference_schema_required_fields", []))
    for field in ("credential_ref_id", "owner_principal_id", "provider_family", "allowed_profiles", "status"):
        if field not in credential_fields:
            raise Phase1EA2ValidationError("CREDENTIAL_SCHEMA_FIELD_MISSING", field)
    grant_fields = set(content.get("grant_schema_required_fields", []))
    for field in ("grant_id", "profile_id", "attempt_id", "runtime_identity_hash", "audit_event_id"):
        if field not in grant_fields:
            raise Phase1EA2ValidationError("GRANT_SCHEMA_FIELD_MISSING", field)
    refresh = content.get("oauth_refresh_future_contract")
    if not isinstance(refresh, dict) or not refresh:
        raise Phase1EA2ValidationError("OAUTH_REFRESH_CONTRACT_INVALID")
    for field, value in refresh.items():
        if value is not True:
            raise Phase1EA2ValidationError("OAUTH_REFRESH_CONTRACT_NOT_TRUE", field)
    denied = set(content.get("denied_paths", []))
    for path_name in ("root auth fallback for named profile", "OAuth refresh from worker", "terminal child secret inheritance"):
        if path_name not in denied:
            raise Phase1EA2ValidationError("DENIED_PATH_MISSING", path_name)
    if content.get("required_changes") != []:
        raise Phase1EA2ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    tests = content.get("test_results", {}).get("targeted_1e_a2_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1EA2ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1E_A3_MODEL_BROKER_DETAILED_SPEC":
        raise Phase1EA2ValidationError("NEXT_GATE_INVALID")

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
    except (Phase1EA2ValidationError, json.JSONDecodeError) as error:
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
