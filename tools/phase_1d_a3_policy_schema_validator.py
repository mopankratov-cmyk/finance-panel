#!/usr/bin/env python3
"""Validate the Phase 1D-A3 policy schema validator implementation evidence."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a3/policy-schema-validator-implementation.json"
EXPECTED_SCHEMA = "pankster.phase1d-a3.policy-schema-validator-implementation.v1"
EXPECTED_CONTENT_SHA = "ea8b47a50ee02033172440fddfef1c8810bd45e177b73b49b5ed09bc27abd24b"
EXPECTED_A2_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a2/feature-flag-and-config-scaffold-spec.json"
EXPECTED_A2_EVIDENCE_SHA = "7835aaeb3a6370745e759306f2308f83fecbe980b4512b0230889a041cddec59"
EXPECTED_A2_CONTENT_SHA = "d40eab7a1fa78f004f07b8c81da83f140e39462c2b03b7a1c1f6dcfca28ddc66"
EXPECTED_FILE_HASHES = {
    "tools/pankster_runtime_security/__init__.py": "34c5af6f6325d803e9533955f0a60d081452a3162fa6bd0057792dad4d4f885c",
    "tools/pankster_runtime_security/policy_schema.py": "6aba57790acbd05ed1b89f621bee79bf24786f9d2b76769a22f65fd993372fd5",
    "tools/tests/test_pankster_runtime_security_policy_schema.py": "a756fa887937ad7bd4b2a98d4ca929e55ca35359659a6d0b10a1e8d589d6367e",
}


class Phase1DA3ValidationError(RuntimeError):
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
        raise Phase1DA3ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA3ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA3ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA3ValidationError("FILE_MISSING", str(path)) from error


def _expect_subset(values: object, expected: set[str], reason: str) -> None:
    if not isinstance(values, list):
        raise Phase1DA3ValidationError(reason, "not a list")
    missing = sorted(expected - set(values))
    if missing:
        raise Phase1DA3ValidationError(reason, ",".join(missing))


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA3ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA3ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA3ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA3ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A2_EVIDENCE) != EXPECTED_A2_EVIDENCE_SHA:
        raise Phase1DA3ValidationError("SOURCE_A2_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A2_EVIDENCE, "SOURCE_A2_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A2_CONTENT_SHA:
        raise Phase1DA3ValidationError("SOURCE_A2_CONTENT_SHA_UNEXPECTED")

    implemented = content.get("implemented_files")
    if implemented != EXPECTED_FILE_HASHES:
        raise Phase1DA3ValidationError("IMPLEMENTED_FILE_HASHES_UNEXPECTED")
    for relative_path, expected_hash in EXPECTED_FILE_HASHES.items():
        if _sha256_file(PROJECT_ROOT / relative_path) != expected_hash:
            raise Phase1DA3ValidationError("IMPLEMENTED_FILE_HASH_MISMATCH", relative_path)

    if content.get("implementation_scope") != "pure_policy_schema_validator_only":
        raise Phase1DA3ValidationError("IMPLEMENTATION_SCOPE_INVALID")
    for field in ("deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved", "dependency_changes_approved"):
        if content.get(field) is not False:
            raise Phase1DA3ValidationError(f"{field.upper()}_NOT_FALSE")

    contract = content.get("policy_schema_contract")
    if not isinstance(contract, dict):
        raise Phase1DA3ValidationError("POLICY_SCHEMA_CONTRACT_INVALID")
    _expect_subset(contract.get("required_fields"), {"profile_id", "enabled", "owner_principal_id", "policy_version", "runtime_backend", "network_policy_id", "model_provider_allowlist", "model_allowlist", "operation_allowlist", "grant_ttl_seconds_max", "budget", "rate_limits", "credential_reference_allowlist"}, "REQUIRED_FIELDS_INCOMPLETE")
    _expect_subset(contract.get("forbidden_fields"), {"api_key", "access_token", "refresh_token", "authorization_header", "provider_secret_value", "root_auth_json_path", "root_credential_pool", "plaintext_credential", "environment_secret_value"}, "FORBIDDEN_FIELDS_INCOMPLETE")
    if contract.get("grant_ttl_seconds_max") != 900 or contract.get("result_is_secret_free") is not True:
        raise Phase1DA3ValidationError("POLICY_SCHEMA_CONTRACT_SCOPE_INVALID")

    purity = content.get("purity_contract")
    if not isinstance(purity, dict):
        raise Phase1DA3ValidationError("PURITY_CONTRACT_INVALID")
    for field, value in purity.items():
        if value is not False:
            raise Phase1DA3ValidationError("PURITY_CONTRACT_VIOLATION", field)

    tests = content.get("test_results", {}).get("targeted_policy_schema_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1DA3ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "1D-A4_ENVIRONMENT_SANITIZER_IMPLEMENTATION":
        raise Phase1DA3ValidationError("NEXT_GATE_INVALID")

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
    except (Phase1DA3ValidationError, json.JSONDecodeError) as error:
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
