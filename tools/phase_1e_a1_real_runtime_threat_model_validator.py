#!/usr/bin/env python3
"""Validate Phase 1E-A1 real runtime threat model evidence."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a1/real-runtime-threat-model.json"
EXPECTED_SCHEMA = "pankster.phase1e-a1.real-runtime-threat-model.v1"
EXPECTED_CONTENT_SHA = "2c9629a6389d94098fcb8e8938af4a377277ef3cd34f795f5fbbe6f5d882839b"
EXPECTED_A0_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a0/real-runtime-architecture-planning.json"
EXPECTED_A0_EVIDENCE_SHA = "0f6053cf7f754f2dc11f4eab9190da4e49cfca24440193dd0b78042a64a71bf6"
EXPECTED_A0_CONTENT_SHA = "884ad39df8a0de0fe51ebd1deabf2bfb5c8a38ab9ff16d62553f7d16ede0a143"


class Phase1EA1ValidationError(RuntimeError):
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
        raise Phase1EA1ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1EA1ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1EA1ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1EA1ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1EA1ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1EA1ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1EA1ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1EA1ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A0_EVIDENCE) != EXPECTED_A0_EVIDENCE_SHA:
        raise Phase1EA1ValidationError("SOURCE_A0_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A0_EVIDENCE, "SOURCE_A0_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A0_CONTENT_SHA:
        raise Phase1EA1ValidationError("SOURCE_A0_CONTENT_SHA_UNEXPECTED")

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
            raise Phase1EA1ValidationError(f"{field.upper()}_NOT_FALSE")
    assets = set(content.get("protected_assets", []))
    for asset in ("owner-scoped provider credentials", "root auth store and credential pools", "Evidence Packs and logs"):
        if asset not in assets:
            raise Phase1EA1ValidationError("PROTECTED_ASSET_MISSING", asset)
    threats = {item.get("id"): item for item in content.get("threats", []) if isinstance(item, dict)}
    for threat_id in ("T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"):
        if threat_id not in threats:
            raise Phase1EA1ValidationError("THREAT_MISSING", threat_id)
    requirements = content.get("security_requirements")
    if not isinstance(requirements, dict) or not requirements:
        raise Phase1EA1ValidationError("SECURITY_REQUIREMENTS_INVALID")
    for field, value in requirements.items():
        if value is not True:
            raise Phase1EA1ValidationError("SECURITY_REQUIREMENT_NOT_TRUE", field)
    required_tests = set(content.get("required_tests_before_code", []))
    for test_name in ("root auth fallback disabled tests", "OAuth refresh owner-only CAS tests", "retry reclaim restart lifecycle preservation tests"):
        if test_name not in required_tests:
            raise Phase1EA1ValidationError("REQUIRED_TEST_MISSING", test_name)
    if content.get("required_changes") != []:
        raise Phase1EA1ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    tests = content.get("test_results", {}).get("targeted_1e_a1_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1EA1ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1E_A2_CREDENTIAL_BROKER_DETAILED_SPEC":
        raise Phase1EA1ValidationError("NEXT_GATE_INVALID")

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
    except (Phase1EA1ValidationError, json.JSONDecodeError) as error:
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
