#!/usr/bin/env python3
"""Validate the Phase 1D-A12 runtime integration scope decision."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a12/runtime-integration-scope-decision.json"
EXPECTED_SCHEMA = "pankster.phase1d-a12.runtime-integration-scope-decision.v1"
EXPECTED_CONTENT_SHA = "dbf93a979138eec47f2c842c2b71be201ad124a31e6995a0fe486cd1f253f104"
EXPECTED_A11_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a11/synthetic-preflight-execution-review.json"
EXPECTED_A11_EVIDENCE_SHA = "1abc4f8c84c0ceb84c464202307a6137737937f62962f3a00bfdece4c9b1523c"
EXPECTED_A11_CONTENT_SHA = "df6e642748e5e09e8835ade9b805e2de6709a82137be1616cbce4e9653f09186"


class Phase1DA12ValidationError(RuntimeError):
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
        raise Phase1DA12ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA12ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA12ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA12ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA12ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA12ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA12ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA12ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A11_EVIDENCE) != EXPECTED_A11_EVIDENCE_SHA:
        raise Phase1DA12ValidationError("SOURCE_A11_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A11_EVIDENCE, "SOURCE_A11_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A11_CONTENT_SHA:
        raise Phase1DA12ValidationError("SOURCE_A11_CONTENT_SHA_UNEXPECTED")

    for field in ("deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved", "dependency_changes_approved"):
        if content.get(field) is not False:
            raise Phase1DA12ValidationError(f"{field.upper()}_NOT_FALSE")
    decision = content.get("scope_decision")
    if not isinstance(decision, dict):
        raise Phase1DA12ValidationError("SCOPE_DECISION_INVALID")
    if decision.get("phase_1d_deliverable") != "synthetic_runtime_security_baseline_only":
        raise Phase1DA12ValidationError("PHASE_1D_DELIVERABLE_INVALID")
    for field in (
        "real_runtime_integration_in_phase_1d",
        "production_deployment_in_phase_1d",
        "named_profile_enablement_in_phase_1d",
        "real_credential_broker_in_phase_1d",
        "real_model_broker_provider_calls_in_phase_1d",
        "gateway_or_hermes_core_changes_in_phase_1d",
    ):
        if decision.get(field) is not False:
            raise Phase1DA12ValidationError("PHASE_1D_FORBIDDEN_SCOPE_INVALID", field)
    if decision.get("new_phase_required_for_runtime_integration") is not True or decision.get("new_owner_approval_required") is not True:
        raise Phase1DA12ValidationError("FUTURE_GATE_REQUIREMENTS_INVALID")
    blocked = set(content.get("blocked_until_phase_1e", []))
    required_blocked = {"sandbox runtime integration", "host-side real credential broker", "real model broker provider calls", "profile runtime enablement", "gateway integration", "OAuth refresh integration", "production deployment"}
    missing = sorted(required_blocked - blocked)
    if missing:
        raise Phase1DA12ValidationError("BLOCKED_SCOPE_INCOMPLETE", ",".join(missing))
    if content.get("required_changes") != []:
        raise Phase1DA12ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    tests = content.get("test_results", {}).get("targeted_a12_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1DA12ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "1D-A13_PHASE_1D_CLOSEOUT_PACKAGE":
        raise Phase1DA12ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
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
    except (Phase1DA12ValidationError, json.JSONDecodeError) as error:
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
