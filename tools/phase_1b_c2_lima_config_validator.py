#!/usr/bin/env python3
"""Validate the Phase 1B-C2 Lima-vz synthetic VM config without starting it."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Sequence
from urllib.parse import urlparse

import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = PROJECT_ROOT / "docs/program/PHASE_1B_C2_LIMA_VZ_SYNTHETIC_VM_CONFIG.yaml"

EXPECTED_TOP_LEVEL_KEYS = {
    "vmType",
    "arch",
    "images",
    "cpus",
    "memory",
    "disk",
    "mounts",
    "mountType",
    "additionalDisks",
    "containerd",
    "ssh",
    "portForwards",
    "networks",
    "propagateProxyEnv",
    "hostResolver",
    "dns",
    "env",
    "param",
    "provision",
    "upgradePackages",
    "message",
}
EXPECTED_IMAGE = {
    "location": "https://cloud-images.ubuntu.com/minimal/releases/noble/release-20260716/ubuntu-24.04-minimal-cloudimg-arm64.img",
    "arch": "aarch64",
    "digest": "sha256:7e938df669e3b1923595eeda97aa28569350c5283e05a835cc912a2486a54934",
    "variant": "minimal",
}
SHA256_DIGEST_RE = re.compile(r"^sha256:[a-f0-9]{64}$")


class LimaConfigError(ValueError):
    pass


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _load_yaml(path: Path) -> dict:
    raw = path.read_bytes()
    loaded = yaml.safe_load(raw)
    if not isinstance(loaded, dict):
        raise LimaConfigError("CONFIG_NOT_OBJECT")
    return loaded


def _validate_exact_keys(config: dict) -> None:
    keys = set(config)
    unknown = sorted(keys - EXPECTED_TOP_LEVEL_KEYS)
    missing = sorted(EXPECTED_TOP_LEVEL_KEYS - keys)
    if unknown:
        raise LimaConfigError(f"UNKNOWN_TOP_LEVEL_KEY:{unknown[0]}")
    if missing:
        raise LimaConfigError(f"MISSING_TOP_LEVEL_KEY:{missing[0]}")


def _validate_image(image: dict) -> None:
    if set(image) != set(EXPECTED_IMAGE):
        raise LimaConfigError("IMAGE_KEYS_MISMATCH")
    if image != EXPECTED_IMAGE:
        raise LimaConfigError("IMAGE_PIN_MISMATCH")
    digest = image["digest"]
    if not isinstance(digest, str) or not SHA256_DIGEST_RE.fullmatch(digest):
        raise LimaConfigError("IMAGE_DIGEST_INVALID")
    parsed = urlparse(image["location"])
    if parsed.scheme != "https" or parsed.netloc != "cloud-images.ubuntu.com":
        raise LimaConfigError("IMAGE_LOCATION_HOST_INVALID")
    if "/release/" in parsed.path or "/release-20260716/" not in parsed.path:
        raise LimaConfigError("IMAGE_LOCATION_MUTABLE")


def validate_config(path: Path = DEFAULT_CONFIG) -> dict:
    if not path.is_file() or path.is_symlink():
        raise LimaConfigError("CONFIG_PATH_INVALID")
    raw = path.read_bytes()
    config = _load_yaml(path)
    _validate_exact_keys(config)
    if config["vmType"] != "vz":
        raise LimaConfigError("VM_TYPE_NOT_VZ")
    if config["arch"] != "aarch64":
        raise LimaConfigError("ARCH_NOT_AARCH64")
    images = config["images"]
    if not isinstance(images, list) or len(images) != 1 or not isinstance(images[0], dict):
        raise LimaConfigError("IMAGES_SHAPE_INVALID")
    _validate_image(images[0])
    if config["mounts"] != []:
        raise LimaConfigError("HOST_MOUNTS_FORBIDDEN")
    if config["additionalDisks"] != []:
        raise LimaConfigError("ADDITIONAL_DISKS_FORBIDDEN")
    if config["containerd"] != {"system": False, "user": False}:
        raise LimaConfigError("CONTAINERD_MUST_BE_DISABLED")
    expected_ssh = {
        "localPort": 0,
        "loadDotSSHPubKeys": False,
        "forwardAgent": False,
        "forwardX11": False,
        "forwardX11Trusted": False,
    }
    if config["ssh"] != expected_ssh:
        raise LimaConfigError("SSH_POLICY_MISMATCH")
    if config["portForwards"] != []:
        raise LimaConfigError("PORT_FORWARDS_FORBIDDEN")
    if config["networks"] != []:
        raise LimaConfigError("EXPLICIT_NETWORKS_FORBIDDEN")
    if config["propagateProxyEnv"] is not False:
        raise LimaConfigError("PROXY_ENV_PROPAGATION_FORBIDDEN")
    expected_host_resolver = {"enabled": False, "ipv6": False, "hosts": {}}
    if config["hostResolver"] != expected_host_resolver:
        raise LimaConfigError("HOST_RESOLVER_POLICY_MISMATCH")
    if config["dns"] != []:
        raise LimaConfigError("DNS_OVERRIDES_FORBIDDEN")
    if config["env"] != {}:
        raise LimaConfigError("GUEST_ENV_FORBIDDEN")
    if config["param"] != {}:
        raise LimaConfigError("GUEST_PARAM_FORBIDDEN")
    if config["provision"] != []:
        raise LimaConfigError("PROVISION_FORBIDDEN")
    if config["upgradePackages"] is not False:
        raise LimaConfigError("UPGRADE_PACKAGES_FORBIDDEN")
    return {
        "result": "PASS",
        "mode": "static-config-validation",
        "config_path": str(path),
        "config_sha256": hashlib.sha256(raw).hexdigest(),
        "vm_type": config["vmType"],
        "arch": config["arch"],
        "image_digest": config["images"][0]["digest"],
        "host_mounts": 0,
        "containerd_system": False,
        "containerd_user": False,
        "port_forwards": 0,
        "explicit_networks": 0,
        "proxy_env_propagation": False,
        "host_resolver_enabled": False,
        "guest_env_entries": 0,
        "guest_param_entries": 0,
        "runtime_start_executed": False,
        "guest_image_downloaded": False,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        result = validate_config(args.config)
    except LimaConfigError as error:
        if args.json:
            _json_print({"result": "DENIED", "mode": "static-config-validation", "reason": str(error)})
            return 1
        raise SystemExit(str(error)) from error
    if args.json:
        _json_print(result)
    else:
        print("Lima C2 static config validation OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
