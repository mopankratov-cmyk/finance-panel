#!/usr/bin/env python3
"""Validate the Phase 1D-A4 environment sanitizer implementation evidence."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a4/environment-sanitizer-implementation.json"
EXPECTED_SCHEMA = "pankster.phase1d-a4.environment-sanitizer-implementation.v1"
EXPECTED_CONTENT_SHA = "134354cebf43a950887d039b3bd11d244ef8eef28d19ae4370c161d32e37ed3a"
EXPECTED_A3_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a3/policy-schema-validator-implementation.json"
EXPECTED_A3_EVIDENCE_SHA = "da7848d7c4726a8e8aaedc2b24e589deb389a030d4d94583a36d039a9289c25d"
EXPECTED_A3_CONTENT_SHA = "ea8b47a50ee02033172440fddfef1c8810bd45e177b73b49b5ed09bc27abd24b"
EXPECTED_FILE_HASHES = {
    "tools/pankster_runtime_security/environment_sanitizer.py": "f3c218b90077ad9419f25444b423c11e8c55d03e6410ef551db0df9011bfb046",
    "tools/tests/test_pankster_runtime_security_environment_sanitizer.py": "9df1005be92dfba231f7f864340ac4bbd269003f37d55e8033600400fd633eba",
}


class Phase1DA4ValidationError(RuntimeError):
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
        raise Phase1DA4ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA4ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA4ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA4ValidationError("FILE_MISSING", str(path)) from error


def _expect_subset(values: object, expected: set[str], reason: str) -> None:
    if not isinstance(values, list):
        raise Phase1DA4ValidationError(reason, "not a list")
    missing = sorted(expected - set(values))
    if missing:
        raise Phase1DA4ValidationError(reason, ",".join(missing))


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA4ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA4ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA4ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA4ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A3_EVIDENCE) != EXPECTED_A3_EVIDENCE_SHA:
        raise Phase1DA4ValidationError("SOURCE_A3_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A3_EVIDENCE, "SOURCE_A3_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A3_CONTENT_SHA:
        raise Phase1DA4ValidationError("SOURCE_A3_CONTENT_SHA_UNEXPECTED")

    if content.get("implemented_files") != EXPECTED_FILE_HASHES:
        raise Phase1DA4ValidationError("IMPLEMENTED_FILE_HASHES_UNEXPECTED")
    for relative_path, expected_hash in EXPECTED_FILE_HASHES.items():
        if _sha256_file(PROJECT_ROOT / relative_path) != expected_hash:
            raise Phase1DA4ValidationError("IMPLEMENTED_FILE_HASH_MISMATCH", relative_path)
    for field in ("deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved", "dependency_changes_approved"):
        if content.get(field) is not False:
            raise Phase1DA4ValidationError(f"{field.upper()}_NOT_FALSE")

    contract = content.get("sanitizer_contract")
    if not isinstance(contract, dict):
        raise Phase1DA4ValidationError("SANITIZER_CONTRACT_INVALID")
    _expect_subset(contract.get("preserve_keys"), {"PATH", "HOME", "TMPDIR", "SHELL", "NO_PROXY", "no_proxy"}, "PRESERVE_KEYS_INCOMPLETE")
    _expect_subset(contract.get("pankster_runtime_keys"), {"PANKSTER_PROFILE_ID", "PANKSTER_ATTEMPT_ID", "PANKSTER_POLICY_VERSION", "PANKSTER_GRANT_IDS", "PANKSTER_NETWORK_POLICY"}, "PANKSTER_KEYS_INCOMPLETE")
    _expect_subset(contract.get("mandatory_denylist"), {"*_KEY", "*_TOKEN", "*_SECRET", "*_PASSWORD", "AUTHORIZATION", "ANTHROPIC_*", "OPENAI_*", "GLM_*", "GITEA_*", "SUPABASE_*", "TELEGRAM_*", "E2B_API_KEY"}, "DENYLIST_INCOMPLETE")
    if contract.get("denylist_precedence_over_allowlist") is not True or contract.get("result_is_secret_free") is not True:
        raise Phase1DA4ValidationError("SANITIZER_CONTRACT_SCOPE_INVALID")

    purity = content.get("purity_contract")
    if not isinstance(purity, dict):
        raise Phase1DA4ValidationError("PURITY_CONTRACT_INVALID")
    for field, value in purity.items():
        if value is not False:
            raise Phase1DA4ValidationError("PURITY_CONTRACT_VIOLATION", field)
    tests = content.get("test_results", {}).get("targeted_environment_sanitizer_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1DA4ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "1D-A5_FAKE_GRANT_REGISTRY_AND_BROKER_IMPLEMENTATION":
        raise Phase1DA4ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "implemented_files": sorted(EXPECTED_FILE_HASHES),
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
    except (Phase1DA4ValidationError, json.JSONDecodeError) as error:
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
