#!/usr/bin/env python3
"""Validate the Phase 1C-A8 production-readiness static closeout.

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


DEFAULT_CLOSEOUT = PROJECT_ROOT / "security/evidence/phase-1c-a8/production-readiness-static-closeout.json"
EXPECTED_SCHEMA = "pankster.phase1c-a8.production-readiness-static-closeout.v1"
EXPECTED_CONTENT_SHA = "672d87fd9546879dcff960d7b6cc8f074ac35b5da20d314c96cc394545750bfb"
EXPECTED_A7_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1c-a7/e2b-synthetic-proof-with-sdk-execution.json"
EXPECTED_A7_EVIDENCE_SHA = "affbe7a3fa065330b720736ba803fb781b7257b2d2ca305703278f0dec15ad89"


class Phase1CA8ValidationError(RuntimeError):
    def __init__(self, reason: str, detail: str | None = None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f"{reason}: {detail}")


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError as error:
        raise Phase1CA8ValidationError("CLOSEOUT_MISSING", str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA8ValidationError("CLOSEOUT_INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA8ValidationError("CLOSEOUT_NOT_OBJECT")
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1CA8ValidationError("SOURCE_A7_EVIDENCE_MISSING", str(path)) from error


def _validate_a7_evidence() -> dict:
    if _sha256_file(EXPECTED_A7_EVIDENCE) != EXPECTED_A7_EVIDENCE_SHA:
        raise Phase1CA8ValidationError("SOURCE_A7_EVIDENCE_SHA_MISMATCH")
    evidence = _load_json(EXPECTED_A7_EVIDENCE)
    if evidence.get("result") != "PASS":
        raise Phase1CA8ValidationError("A7_RESULT_NOT_PASS")
    if evidence.get("provider_credential_value_printed") is not False:
        raise Phase1CA8ValidationError("A7_PROVIDER_CREDENTIAL_PRINTED")
    if evidence.get("sandbox_created") is not True:
        raise Phase1CA8ValidationError("A7_SANDBOX_NOT_CREATED")
    if evidence.get("sandbox_destroyed") is not True:
        raise Phase1CA8ValidationError("A7_SANDBOX_NOT_DESTROYED")
    a4 = evidence.get("a4_runner_json")
    if not isinstance(a4, dict) or a4.get("result") != "PASS":
        raise Phase1CA8ValidationError("A4_PROOF_NOT_PASS")
    try:
        inner = json.loads(a4["sandbox_stdout_sanitized"])
    except (KeyError, json.JSONDecodeError) as error:
        raise Phase1CA8ValidationError("A4_SANDBOX_OUTPUT_INVALID") from error
    for field in (
        "application_level_outbound_denial_observed",
        "sandbox_environment_contains_only_allowlisted_synthetic_keys",
        "sandbox_cannot_read_root_auth_json",
        "terminal_child_environment_sanitized",
        "code_execution_child_environment_sanitized",
        "mcp_child_environment_sanitized_or_not_available_fail_closed",
        "delegation_child_environment_sanitized_or_not_available_fail_closed",
    ):
        if inner.get(field) is not True:
            raise Phase1CA8ValidationError(f"{field.upper()}_NOT_PROVEN")
    return inner


def validate_closeout(path: Path = DEFAULT_CLOSEOUT) -> dict:
    closeout = _load_json(path)
    if closeout.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA8ValidationError("SCHEMA_INVALID")
    content = closeout.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1CA8ValidationError("DECISION_CONTENT_INVALID")
    if closeout.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1CA8ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1CA8ValidationError("CONTENT_SHA_MISMATCH")

    if content.get("decision") != "SYNTHETIC_E2B_ISOLATION_PROOF_PASSED_PRODUCTION_NOT_APPROVED":
        raise Phase1CA8ValidationError("DECISION_INVALID")
    if content.get("final_status") != "READY_FOR_ARCHITECTURE_DESIGN_NEXT_NOT_PRODUCTION_DEPLOYMENT":
        raise Phase1CA8ValidationError("FINAL_STATUS_INVALID")

    basis = content.get("basis")
    if not isinstance(basis, dict):
        raise Phase1CA8ValidationError("BASIS_INVALID")
    if basis.get("a7_evidence_sha256") != EXPECTED_A7_EVIDENCE_SHA:
        raise Phase1CA8ValidationError("BASIS_A7_SHA_INVALID")
    _validate_a7_evidence()

    for field, value in content.get("approved_capabilities", {}).items():
        if value is not True:
            raise Phase1CA8ValidationError(f"{field.upper()}_NOT_APPROVED")
    for field, value in content.get("not_approved_capabilities", {}).items():
        if value is not True:
            raise Phase1CA8ValidationError(f"{field.upper()}_NOT_BLOCKED")
    runtime = content.get("read_only_runtime_confirmation")
    if not isinstance(runtime, dict):
        raise Phase1CA8ValidationError("RUNTIME_CONFIRMATION_INVALID")
    for field, value in runtime.items():
        if value is not False:
            raise Phase1CA8ValidationError(f"{field.upper()}_UNEXPECTEDLY_CHANGED")
    if len(content.get("production_blockers", [])) < 8:
        raise Phase1CA8ValidationError("PRODUCTION_BLOCKERS_INCOMPLETE")
    if len(content.get("required_next_gates", [])) < 6:
        raise Phase1CA8ValidationError("NEXT_GATES_INCOMPLETE")

    return {
        "result": "PASS",
        "mode": "validate-closeout",
        "decision": content["decision"],
        "final_status": content["final_status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "a7_evidence_sha256": EXPECTED_A7_EVIDENCE_SHA,
        "production_approved": False,
        "next_gate": content["required_next_gates"][0],
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["validate-closeout"])
    parser.add_argument("--closeout", type=Path, default=DEFAULT_CLOSEOUT)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-closeout":
            _json_print(validate_closeout(args.closeout))
            return 0
    except (Phase1CA8ValidationError, json.JSONDecodeError) as error:
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
