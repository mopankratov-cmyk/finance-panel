#!/usr/bin/env python3
"""Validate Phase 1E-A0 real runtime architecture planning evidence."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a0/real-runtime-architecture-planning.json"
EXPECTED_SCHEMA = "pankster.phase1e-a0.real-runtime-architecture-planning.v1"
EXPECTED_CONTENT_SHA = "884ad39df8a0de0fe51ebd1deabf2bfb5c8a38ab9ff16d62553f7d16ede0a143"
EXPECTED_A13_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a13/phase-1d-closeout-package.json"
EXPECTED_A13_EVIDENCE_SHA = "415a65e12669ea132eb122138e7a1a8372be6feacb34ec06d4491f3e0117024e"
EXPECTED_A13_CONTENT_SHA = "df1a30a56cd6cdd07cff13bd34422367968a00afc552ea54bd3296beb70d5418"


class Phase1EA0ValidationError(RuntimeError):
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
        raise Phase1EA0ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1EA0ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1EA0ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1EA0ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1EA0ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1EA0ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1EA0ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1EA0ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A13_EVIDENCE) != EXPECTED_A13_EVIDENCE_SHA:
        raise Phase1EA0ValidationError("SOURCE_A13_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A13_EVIDENCE, "SOURCE_A13_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A13_CONTENT_SHA:
        raise Phase1EA0ValidationError("SOURCE_A13_CONTENT_SHA_UNEXPECTED")

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
            raise Phase1EA0ValidationError(f"{field.upper()}_NOT_FALSE")
    components = set(content.get("architecture_components", []))
    for component in ("host-side credential broker", "host-side model broker", "runtime adapter boundary", "audit sink"):
        if component not in components:
            raise Phase1EA0ValidationError("ARCHITECTURE_COMPONENT_MISSING", component)
    invariants = content.get("required_invariants")
    if not isinstance(invariants, dict) or not invariants:
        raise Phase1EA0ValidationError("REQUIRED_INVARIANTS_INVALID")
    for field, value in invariants.items():
        if value is not True:
            raise Phase1EA0ValidationError("REQUIRED_INVARIANT_NOT_TRUE", field)
    forbidden = set(content.get("forbidden_in_phase_1e_a0", []))
    for item in ("implementation code", "sandbox or subprocess launch", "provider/model API call", "real credential read", "auth.json or Keychain read"):
        if item not in forbidden:
            raise Phase1EA0ValidationError("FORBIDDEN_SCOPE_MISSING", item)
    if content.get("required_changes") != []:
        raise Phase1EA0ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    tests = content.get("test_results", {}).get("targeted_1e_a0_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1EA0ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1E_A1_REAL_RUNTIME_THREAT_MODEL":
        raise Phase1EA0ValidationError("NEXT_GATE_INVALID")

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
    except (Phase1EA0ValidationError, json.JSONDecodeError) as error:
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
