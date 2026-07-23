#!/usr/bin/env python3
"""Validate Phase 1F-A0 runtime integration planning."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a0/runtime-integration-planning.json"
EXPECTED_SCHEMA = "pankster.phase1f-a0.runtime-integration-planning.v1"
EXPECTED_CONTENT_SHA = "7d6a0ce18b9c20055fd5372e7f27a1977743cd191a28488187ce49713bc102b4"
EXPECTED_PHASE_1E_CLOSEOUT = PROJECT_ROOT / "security/evidence/phase-1e-closeout/phase-1e-closeout-package.json"
EXPECTED_PHASE_1E_CLOSEOUT_FILE_SHA = "6722a84ce4a21b5358fb1330aec669e11048938b0b69cf89e8d2ff946d5a6004"
EXPECTED_PHASE_1E_CLOSEOUT_CONTENT_SHA = "c7f41b5ba574bef55cb80ccd050a8225f9e81920540ca90164b8056886445a81"


class Phase1FA0ValidationError(RuntimeError):
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
        raise Phase1FA0ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1FA0ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1FA0ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1FA0ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA0ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1FA0ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1FA0ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1FA0ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_PHASE_1E_CLOSEOUT) != EXPECTED_PHASE_1E_CLOSEOUT_FILE_SHA:
        raise Phase1FA0ValidationError("SOURCE_PHASE_1E_CLOSEOUT_FILE_SHA_MISMATCH")
    source = _load_json(EXPECTED_PHASE_1E_CLOSEOUT, "SOURCE_PHASE_1E_CLOSEOUT_MISSING")
    if source.get("content_sha256") != EXPECTED_PHASE_1E_CLOSEOUT_CONTENT_SHA:
        raise Phase1FA0ValidationError("SOURCE_PHASE_1E_CLOSEOUT_CONTENT_SHA_UNEXPECTED")

    if content.get("verdict") != "PHASE_1F_PLANNING_ONLY_NOT_READY_FOR_RUNTIME_OR_PRODUCTION":
        raise Phase1FA0ValidationError("VERDICT_INVALID")
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
        "implementation_allowed_now",
    ):
        if content.get(field) is not False:
            raise Phase1FA0ValidationError(f"{field.upper()}_NOT_FALSE")
    invariants = content.get("security_invariants")
    if not isinstance(invariants, dict) or not invariants:
        raise Phase1FA0ValidationError("SECURITY_INVARIANTS_INVALID")
    for field, value in invariants.items():
        if value is not True:
            raise Phase1FA0ValidationError("SECURITY_INVARIANT_NOT_TRUE", field)
    blocked = set(content.get("blocked_actions_without_future_explicit_owner_approval", []))
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
        raise Phase1FA0ValidationError("BLOCKED_SCOPE_INCOMPLETE", ",".join(missing))
    if content.get("required_changes") != []:
        raise Phase1FA0ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    tests = content.get("test_results", {})
    targeted = tests.get("targeted_a0_validator_tests", {})
    if targeted.get("result") != "PASS" or targeted.get("tests") != 5:
        raise Phase1FA0ValidationError("TARGETED_TEST_RESULT_INVALID")
    full = tests.get("full_tools_unittest_discover", {})
    if full.get("result") != "PASS" or full.get("tests") != 755:
        raise Phase1FA0ValidationError("FULL_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1F_A1_RUNTIME_INTEGRATION_OWNER_APPROVAL_REQUEST":
        raise Phase1FA0ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "implementation_allowed_now": False,
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
    except (Phase1FA0ValidationError, json.JSONDecodeError) as error:
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
