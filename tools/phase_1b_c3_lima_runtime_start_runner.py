#!/usr/bin/env python3
"""Phase 1B-C3 synthetic Lima-vz runtime start runner.

Fail-closed runner for exactly one synthetic Lima VM. It uses an isolated
LIMA_HOME and the C2-validated config. It does not run production profiles,
does not use real credentials, does not change gateway, and does not modify PATH.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.phase_1b_c2_lima_config_validator import validate_config
from tools.validate_installation_manifest import ManifestError, canonical_json_bytes, load_json


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1B_C3_R2_SYNTHETIC_LIMA_RUNTIME_START_CONTRACT.ready.json"
DEFAULT_APPROVAL_RECORD = PROJECT_ROOT / "docs/program/PHASE_1B_C3_R2_SYNTHETIC_LIMA_RUNTIME_START_APPROVAL_RECORD.json"
APPROVAL_PREFIX = "APPROVE_SYNTHETIC_LIMA_RUNTIME_START"
EXPECTED_SCHEMA = "pankster.phase1b-c3.synthetic-runtime-start-contract.v1"
EXPECTED_RECORD_SHA = "0ea09a3ea8d39a0180b4d48c9a92e3f2db8da64b65b6f152cb2f7e8d3bd7375d"
EXPECTED_CONTRACT_SHA = "ca488375aab8af38f144ab98a9ec1382a6df8d03f5248f215d5c2024753d4e7e"
EXPECTED_NETWORK_DECISION = "ACCEPT_DEFAULT_LIMA_NAT_EGRESS_FOR_SYNTHETIC_BOOT_ONLY"

ALLOWED_ENV_KEYS = {
    "HOME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "NO_PROXY",
    "PATH",
    "SHELL",
    "TMP",
    "TMPDIR",
    "TEMP",
    "no_proxy",
}


class RuntimeStartError(RuntimeError):
    def __init__(self, reason: str, detail: str | None = None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f"{reason}: {detail}")


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _parse_time(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(dt.timezone.utc)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _owner_command_hash(approval_id: str, content_sha: str) -> str:
    command = f"{APPROVAL_PREFIX}:{approval_id}:{content_sha}"
    return hashlib.sha256(command.encode("utf-8")).hexdigest()


def _record_without_hash(record: dict) -> dict:
    return {key: value for key, value in record.items() if key != "record_sha256"}


def _sanitized_env(contract_content: dict) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if key in ALLOWED_ENV_KEYS}
    install_prefix = contract_content["install_prefix"]
    env["PATH"] = f"{install_prefix}/bin:/usr/bin:/bin"
    env["LIMA_HOME"] = contract_content["lima_home"]
    env.setdefault("HOME", "/Users/maksimpankratov")
    env.setdefault("LANG", "C")
    return env


def _run(args: Sequence[str], *, env: dict[str, str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(args),
        check=False,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )


def _validate_exact_contract(contract: dict) -> dict:
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise RuntimeStartError("CONTRACT_SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise RuntimeStartError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise RuntimeStartError("CONTRACT_CONTENT_INVALID")
    declared = contract.get("content_sha256")
    if declared != EXPECTED_CONTRACT_SHA:
        raise RuntimeStartError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != declared:
        raise RuntimeStartError("CONTRACT_CONTENT_SHA_MISMATCH")
    if content.get("network_risk_decision") != EXPECTED_NETWORK_DECISION:
        raise RuntimeStartError("NETWORK_RISK_DECISION_MISSING")
    if content.get("real_credentials_allowed") is not False:
        raise RuntimeStartError("REAL_CREDENTIALS_UNEXPECTEDLY_ALLOWED")
    if content.get("production_profiles_allowed") is not False:
        raise RuntimeStartError("PRODUCTION_PROFILES_UNEXPECTEDLY_ALLOWED")
    if content.get("gateway_changes_allowed") is not False:
        raise RuntimeStartError("GATEWAY_CHANGES_UNEXPECTEDLY_ALLOWED")
    if content.get("canary_allowed") is not False:
        raise RuntimeStartError("CANARY_UNEXPECTEDLY_ALLOWED")
    if _now() >= _parse_time(content["expires_at"]):
        raise RuntimeStartError("CONTRACT_EXPIRED")
    return content


def _validate_record(record: dict, content: dict) -> None:
    if record.get("record_sha256") != EXPECTED_RECORD_SHA:
        raise RuntimeStartError("APPROVAL_RECORD_SHA_UNEXPECTED")
    actual_record_sha = hashlib.sha256(canonical_json_bytes(_record_without_hash(record))).hexdigest()
    if actual_record_sha != record["record_sha256"]:
        raise RuntimeStartError("APPROVAL_RECORD_SHA_MISMATCH")
    if record.get("decision") != "APPROVED":
        raise RuntimeStartError("APPROVAL_DECISION_NOT_APPROVED")
    if record.get("approval_id") != content["approval_id"]:
        raise RuntimeStartError("APPROVAL_ID_MISMATCH")
    if record.get("contract_content_sha256") != EXPECTED_CONTRACT_SHA:
        raise RuntimeStartError("APPROVAL_CONTRACT_SHA_MISMATCH")
    if record.get("owner_command_hash") != _owner_command_hash(content["approval_id"], EXPECTED_CONTRACT_SHA):
        raise RuntimeStartError("OWNER_COMMAND_HASH_MISMATCH")
    if record.get("network_risk_decision") != EXPECTED_NETWORK_DECISION:
        raise RuntimeStartError("NETWORK_RISK_DECISION_NOT_APPROVED")
    if record.get("synthetic_only") is not True:
        raise RuntimeStartError("SYNTHETIC_ONLY_REQUIRED")
    for field in ("real_credentials_allowed", "production_profiles_allowed", "gateway_changes_allowed", "canary_allowed"):
        if record.get(field) is not False:
            raise RuntimeStartError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if _now() >= _parse_time(record["expires_at"]):
        raise RuntimeStartError("APPROVAL_RECORD_EXPIRED")


def _validate_paths(content: dict) -> None:
    limactl_path = Path(content["limactl_path"])
    if not limactl_path.is_file() or limactl_path.is_symlink():
        raise RuntimeStartError("LIMACTL_PATH_INVALID")
    if _sha256_file(limactl_path) != content["limactl_binary_sha256"]:
        raise RuntimeStartError("LIMACTL_SHA_MISMATCH")
    lima_home = Path(content["lima_home"])
    allowed_root = Path("/Users/maksimpankratov/.local/pankster/runtime")
    try:
        lima_home.relative_to(allowed_root)
    except ValueError as error:
        raise RuntimeStartError("LIMA_HOME_OUT_OF_SCOPE") from error
    if lima_home == allowed_root or lima_home.is_symlink():
        raise RuntimeStartError("LIMA_HOME_UNSAFE")
    config_result = validate_config(PROJECT_ROOT / content["config_path"])
    if config_result["config_sha256"] != content["config_sha256"]:
        raise RuntimeStartError("C2_CONFIG_SHA_MISMATCH")


def _validate_no_existing_runtime_state(content: dict) -> None:
    lima_home = Path(content["lima_home"])
    if lima_home.exists():
        raise RuntimeStartError("LIMA_HOME_ALREADY_EXISTS", str(lima_home))
    default_lima = Path("/Users/maksimpankratov/.lima")
    if default_lima.exists():
        raise RuntimeStartError("DEFAULT_LIMA_HOME_EXISTS")


def load_and_validate(contract_path: Path, approval_record_path: Path, *, require_empty_home: bool) -> tuple[dict, dict]:
    try:
        contract = load_json(contract_path)
        record = load_json(approval_record_path)
    except ManifestError as error:
        raise RuntimeStartError("CONTRACT_OR_APPROVAL_INVALID", str(error)) from error
    content = _validate_exact_contract(contract)
    _validate_record(record, content)
    _validate_paths(content)
    if require_empty_home:
        _validate_no_existing_runtime_state(content)
    return content, record


def preflight(contract_path: Path, approval_record_path: Path) -> dict:
    content, _record = load_and_validate(contract_path, approval_record_path, require_empty_home=True)
    return {
        "result": "PASS",
        "mode": "preflight",
        "approval_id": content["approval_id"],
        "instance_name": content["instance_name"],
        "lima_home": content["lima_home"],
        "config_sha256": content["config_sha256"],
        "network_risk_decision": content["network_risk_decision"],
        "runtime_start_executed": False,
        "guest_image_downloaded": False,
        "real_credentials_allowed": False,
        "production_profiles_allowed": False,
        "gateway_changes_allowed": False,
    }


def _sanitize_list_payload(raw: str) -> dict | list:
    parsed = json.loads(raw)
    return parsed


def execute_start(contract_path: Path, approval_record_path: Path) -> dict:
    content, _record = load_and_validate(contract_path, approval_record_path, require_empty_home=True)
    env = _sanitized_env(content)
    config_path = PROJECT_ROOT / content["config_path"]
    result = _run(
        [
            content["limactl_path"],
            "start",
            "--tty=false",
            "--name",
            content["instance_name"],
            "--timeout",
            "20m",
            str(config_path),
        ],
        env=env,
        timeout=1500,
    )
    if result.returncode != 0:
        raise RuntimeStartError("RUNTIME_START_FAILED", f"rc={result.returncode}")
    list_result = _run(
        [content["limactl_path"], "list", "--format", "json", content["instance_name"]],
        env=env,
        timeout=60,
    )
    if list_result.returncode != 0:
        raise RuntimeStartError("RUNTIME_LIST_FAILED", f"rc={list_result.returncode}")
    return {
        "result": "PASS",
        "mode": "execute-start",
        "approval_id": content["approval_id"],
        "instance_name": content["instance_name"],
        "lima_home": content["lima_home"],
        "network_risk_decision": content["network_risk_decision"],
        "limactl_returncode": result.returncode,
        "instance_list": _sanitize_list_payload(list_result.stdout),
        "guest_image_sha256": content["guest_image_sha256"],
        "guest_image_downloaded": True,
        "runtime_start_executed": True,
        "vm_created": True,
        "real_credentials_allowed": False,
        "production_profiles_allowed": False,
        "gateway_changes_allowed": False,
        "canary_allowed": False,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["preflight", "execute-start"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--approval-record", type=Path, default=DEFAULT_APPROVAL_RECORD)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "preflight":
            _json_print(preflight(args.contract, args.approval_record))
            return 0
        if args.mode == "execute-start":
            _json_print(execute_start(args.contract, args.approval_record))
            return 0
    except (RuntimeStartError, ManifestError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
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
