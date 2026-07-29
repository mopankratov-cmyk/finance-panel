#!/usr/bin/env python3
"""Validate the Phase 1D-A13 closeout package."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a13/phase-1d-closeout-package.json"
EXPECTED_SCHEMA = "pankster.phase1d-a13.phase-1d-closeout-package.v1"
EXPECTED_CONTENT_SHA = "df1a30a56cd6cdd07cff13bd34422367968a00afc552ea54bd3296beb70d5418"
EXPECTED_A12_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a12/runtime-integration-scope-decision.json"
EXPECTED_A12_EVIDENCE_SHA = "5163c6ebb11aa30870bfa21b34d24d2a8994d14cb6fcf401e09ad9893f5dba44"
EXPECTED_A12_CONTENT_SHA = "dbf93a979138eec47f2c842c2b71be201ad124a31e6995a0fe486cd1f253f104"


class Phase1DA13ValidationError(RuntimeError):
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
        raise Phase1DA13ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA13ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA13ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA13ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA13ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA13ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA13ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA13ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A12_EVIDENCE) != EXPECTED_A12_EVIDENCE_SHA:
        raise Phase1DA13ValidationError("SOURCE_A12_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A12_EVIDENCE, "SOURCE_A12_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A12_CONTENT_SHA:
        raise Phase1DA13ValidationError("SOURCE_A12_CONTENT_SHA_UNEXPECTED")

    if content.get("verdict") != "PHASE_1D_SYNTHETIC_BASELINE_COMPLETE_NOT_PRODUCTION_READY":
        raise Phase1DA13ValidationError("VERDICT_INVALID")
    for field in ("deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved", "dependency_changes_approved"):
        if content.get(field) is not False:
            raise Phase1DA13ValidationError(f"{field.upper()}_NOT_FALSE")
    invariants = content.get("security_invariants")
    if not isinstance(invariants, dict) or not invariants:
        raise Phase1DA13ValidationError("SECURITY_INVARIANTS_INVALID")
    for field, value in invariants.items():
        if value is not True:
            raise Phase1DA13ValidationError("SECURITY_INVARIANT_NOT_TRUE", field)
    blocked = set(content.get("blocked_until_phase_1e", []))
    required_blocked = {"real sandbox runtime integration", "real host-side credential broker", "real provider/model broker calls", "named profile runtime enablement", "gateway/Hermes core integration", "OAuth refresh integration", "production deployment"}
    missing = sorted(required_blocked - blocked)
    if missing:
        raise Phase1DA13ValidationError("BLOCKED_SCOPE_INCOMPLETE", ",".join(missing))
    chain = content.get("commit_chain")
    if not isinstance(chain, dict) or chain.get("a13") is not None:
        raise Phase1DA13ValidationError("COMMIT_CHAIN_INVALID")
    for gate in ("a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12"):
        if not isinstance(chain.get(gate), str) or not chain[gate]:
            raise Phase1DA13ValidationError("COMMIT_CHAIN_MISSING_GATE", gate)
    if content.get("required_changes") != []:
        raise Phase1DA13ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    tests = content.get("test_results", {}).get("targeted_a13_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1DA13ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1E_A0_REAL_RUNTIME_ARCHITECTURE_PLANNING":
        raise Phase1DA13ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
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
    except (Phase1DA13ValidationError, json.JSONDecodeError) as error:
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
