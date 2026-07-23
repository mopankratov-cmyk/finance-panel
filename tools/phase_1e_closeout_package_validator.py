#!/usr/bin/env python3
"""Validate the Phase 1E closeout package."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-closeout/phase-1e-closeout-package.json"
EXPECTED_SCHEMA = "pankster.phase1e-closeout.phase-1e-closeout-package.v1"
EXPECTED_CONTENT_SHA = "c7f41b5ba574bef55cb80ccd050a8225f9e81920540ca90164b8056886445a81"
EXPECTED_A56_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a56/phase-closeout-approval-request.json"
EXPECTED_A56_EVIDENCE_SHA = "67b1fe1d59c0252468de59700892ea64054b3b12d3d1a56b09c46ca70287232d"
EXPECTED_A56_CONTENT_SHA = "70884118220ccc9306c655caa33f7ea8d59020e48a78f20f921e62847c59ab87"


class Phase1ECloseoutValidationError(RuntimeError):
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
        raise Phase1ECloseoutValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1ECloseoutValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1ECloseoutValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1ECloseoutValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1ECloseoutValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1ECloseoutValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1ECloseoutValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1ECloseoutValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A56_EVIDENCE) != EXPECTED_A56_EVIDENCE_SHA:
        raise Phase1ECloseoutValidationError("SOURCE_A56_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A56_EVIDENCE, "SOURCE_A56_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A56_CONTENT_SHA:
        raise Phase1ECloseoutValidationError("SOURCE_A56_CONTENT_SHA_UNEXPECTED")

    if content.get("verdict") != "PHASE_1E_CONTRACT_RUNTIME_ARCHITECTURE_COMPLETE_NOT_PRODUCTION_READY":
        raise Phase1ECloseoutValidationError("VERDICT_INVALID")
    for field in (
        "runtime_execution_approved",
        "deployment_approved",
        "production_profiles_approved",
        "provider_api_calls_approved",
        "model_api_calls_approved",
        "sandbox_execution_approved",
        "subprocess_launch_approved",
        "gateway_changes_approved",
        "hermes_core_changes_approved",
        "dependency_changes_approved",
        "oauth_refresh_approved",
    ):
        if content.get(field) is not False:
            raise Phase1ECloseoutValidationError(f"{field.upper()}_NOT_FALSE")
    invariants = content.get("security_invariants")
    if not isinstance(invariants, dict) or not invariants:
        raise Phase1ECloseoutValidationError("SECURITY_INVARIANTS_INVALID")
    for field, value in invariants.items():
        if value is not True:
            raise Phase1ECloseoutValidationError("SECURITY_INVARIANT_NOT_TRUE", field)
    blocked = set(content.get("blocked_until_separate_future_phase", []))
    required_blocked = {
        "Hermes core integration",
        "gateway.py or web_server.py runtime binding",
        "profile worker runtime mutation",
        "real host-side credential broker storage",
        "real provider/model broker calls",
        "OAuth refresh integration",
        "profile runtime process launch",
        "named profile start",
        "production deployment",
    }
    missing = sorted(required_blocked - blocked)
    if missing:
        raise Phase1ECloseoutValidationError("BLOCKED_SCOPE_INCOMPLETE", ",".join(missing))
    chain = content.get("commit_chain")
    if not isinstance(chain, dict) or chain.get("a57") is not None:
        raise Phase1ECloseoutValidationError("COMMIT_CHAIN_INVALID")
    for index in range(57):
        gate = f"a{index}"
        if not isinstance(chain.get(gate), str) or not chain[gate]:
            raise Phase1ECloseoutValidationError("COMMIT_CHAIN_MISSING_GATE", gate)
    if content.get("required_changes") != []:
        raise Phase1ECloseoutValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    tests = content.get("test_results", {})
    closeout_tests = tests.get("targeted_closeout_validator_tests", {})
    if closeout_tests.get("result") != "PASS" or closeout_tests.get("tests") != 5:
        raise Phase1ECloseoutValidationError("TARGETED_TEST_RESULT_INVALID")
    full_tests = tests.get("full_tools_unittest_discover", {})
    if full_tests.get("result") != "PASS" or full_tests.get("tests") != 750:
        raise Phase1ECloseoutValidationError("FULL_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1F_REQUIRES_SEPARATE_OWNER_APPROVAL":
        raise Phase1ECloseoutValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "runtime_execution_approved": False,
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
    except (Phase1ECloseoutValidationError, json.JSONDecodeError) as error:
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
