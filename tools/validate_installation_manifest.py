#!/usr/bin/env python3
"""Validate Phase 1B installation manifests without external dependencies."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping
from urllib.parse import unquote, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_SCHEMA_VERSION = "phase1b.installation-manifest.v2"
TRUST_ANCHOR_SCHEMA_VERSION = "pankster.release-trust-anchors.v1"
ARTIFACT_PIN_REGISTRY_SCHEMA_VERSION = "pankster.phase1b-b0.artifact-pin-registry.v1"
TRUST_ANCHOR_REGISTRY_RELATIVE_PATH = Path("docs/security/apple_container_release_trust_anchors.json")
ARTIFACT_PIN_REGISTRY_RELATIVE_PATH = Path("docs/security/phase_1b_b0_artifact_pin_registry.json")
DEFAULT_TRUST_ANCHORS_PATH = PROJECT_ROOT / TRUST_ANCHOR_REGISTRY_RELATIVE_PATH
DEFAULT_ARTIFACT_PIN_REGISTRY_PATH = PROJECT_ROOT / ARTIFACT_PIN_REGISTRY_RELATIVE_PATH
ALLOWED_STATES = {"TEMPLATE", "DRAFT", "READY_FOR_REVIEW", "APPROVED", "EXPIRED", "REVOKED"}
REVIEW_STATE = "READY_FOR_REVIEW"
APPROVABLE_BACKENDS = {"apple-container-cli", "lima-vz"}
KNOWN_BACKENDS = {"apple-container-cli", "lima-vz"}
FORBIDDEN_VERSION_WORDS = {"", "latest", "stable", "current", "nightly", "main", "master", "release"}
ABSENCE_MARKERS = {
    "none",
    "n/a",
    "na",
    "not applicable",
    "no change",
    "no changes",
    "nothing",
    "unknown",
    "tbd",
    "to be determined",
    "not known",
}
GENERIC_SIGNER_VALUES = {"unknown", "unsigned", "any signer", "not_applicable", "n/a", "fake", "test", "example", "placeholder", "tbd"}
GENERIC_SIGNER_SUFFIXES = {
    "unknown",
    "unsigned",
    "any signer",
    "not applicable",
    "n/a",
    "fake",
    "test",
    "example",
    "placeholder",
    "tbd",
}
GENERIC_TEAM_IDS = {"ABCDEFGHIJ", "AAAAAAAAAA", "XXXXXXXXXX", "1234567890", "NOTAPPLICA"}
FAKE_TEAM_IDS = {"FAKE123456", "TEST123456", "DEMO123456", "EXAMPLE123"}
ALLOWED_DOWNLOAD_HOSTS = {
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "ghcr.io",
    "registry.k8s.io",
    "europe-west3-docker.pkg.dev",
    "raw.githubusercontent.com",
    "cloud-images.ubuntu.com",
}
ALLOWED_TRUST_ANCHOR_STATES = {"DRAFT", "PINNED", "REVOKED"}
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
OCI_DIGEST_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
APPLE_SEMVER_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
LIMA_SEMVER_RE = APPLE_SEMVER_RE
APPLE_INSTALLER_SIGNER_RE = re.compile(r"^Developer ID Installer: .{1,180}$")
APPLE_TEAM_ID_RE = re.compile(r"^[A-Z0-9]{10}$")
APPROVED_BY_RE = re.compile(r"^owner:[A-Za-z0-9._-]{1,128}$")
AUTH_EVENT_RE = re.compile(r"^hgate-[A-Za-z0-9._-]{8,128}$")
AUTHN_CONTEXT_RE = re.compile(r"^interactive-(owner|hardware-key|passkey|synthetic)$")
SECRET_SHAPED_RES = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bghp_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    re.compile(r"(?i)(api[_-]?key|token|secret|password)\s*[:=]\s*[\"']?[A-Za-z0-9_./+=-]{16,}"),
]
MAX_STRING_LENGTH = 512
MAX_IDENTIFIER_LENGTH = 256
MAX_VERSION_LENGTH = 128
MAX_CLOCK_SKEW = dt.timedelta(minutes=5)
TEMPLATE_STATE = "TEMPLATE"

MANIFEST_ENVELOPE_FIELDS = {
    "schema_version",
    "manifest_state",
    "manifest_content",
    "content_sha256",
}

MANIFEST_CONTENT_FIELDS = {
    "approval_id",
    "backend",
    "backend_version",
    "artifacts",
    "disk_changes",
    "background_services",
    "required_permissions",
    "network_changes",
    "rollback_plan_hash",
    "created_at",
    "expires_at",
}

ARTIFACT_FIELDS = {
    "role",
    "name",
    "version",
    "source_url",
    "resolved_download_hosts",
    "sha256",
    "size_bytes",
    "signature_type",
    "expected_signer_identity",
    "expected_signer_team_id",
    "notarization_requirement",
    "verification_policy_id",
    "oci_digest",
}

ARTIFACT_REQUIRED_FIELDS = ARTIFACT_FIELDS - {"oci_digest"}

APPROVAL_RECORD_FIELDS = {
    "approval_id",
    "manifest_content_sha256",
    "trust_anchor_registry_sha256",
    "decision",
    "approved_by",
    "authorization_event_id",
    "authorization_source",
    "authn_context",
    "approved_at",
    "expires_at",
    "owner_command_hash",
    "synthetic_only",
    "real_credentials_allowed",
    "production_profiles_allowed",
    "record_sha256",
}

APPLE_ROLES = {"backend-installer", "linux-kernel", "init-filesystem", "synthetic-oci-manifest"}
LIMA_ROLES = {"backend-installer", "release-checksums", "lima-template", "guest-image"}
BACKEND_ARTIFACT_POLICIES = {
    "apple-container-cli": {
        "required_roles": APPLE_ROLES,
        "allowed_roles": APPLE_ROLES,
    },
    "lima-vz": {
        "required_roles": LIMA_ROLES,
        "allowed_roles": LIMA_ROLES,
    },
}

BACKEND_REPOSITORIES = {
    "apple-container-cli": {
        "owner": "apple",
        "repo": "container",
        "version_re": APPLE_SEMVER_RE,
    },
    "lima-vz": {
        "owner": "lima-vm",
        "repo": "lima",
        "version_re": LIMA_SEMVER_RE,
    },
}

ROLE_SIGNATURE_POLICIES = {
    "backend-installer": {"apple-signed-pkg", "sha256-only"},
    "linux-kernel": {"sha256-only"},
    "init-filesystem": {"sha256-only"},
    "synthetic-oci-manifest": {"oci-digest"},
    "release-checksums": {"sha256-only"},
    "lima-template": {"git-tagged-source-sha256"},
    "guest-image": {"sha256-only"},
}

ROLE_VERIFICATION_POLICIES = {
    ("apple-container-cli", "backend-installer"): "apple-container-installer-v1",
    ("lima-vz", "backend-installer"): "lima-release-asset-sha256-v1",
    "linux-kernel": "apple-container-release-asset-sha256-v1",
    "init-filesystem": "oci-manifest-sha256-v1",
    "synthetic-oci-manifest": "oci-digest-pinned-v1",
    "release-checksums": "lima-sha256sums-sha256-v1",
    "lima-template": "lima-release-tagged-template-sha256-v1",
    "guest-image": "ubuntu-cloud-image-sha256-from-lima-template-v1",
}

APPLE_SIGNED_INSTALLER_ASSET_NAMES = {
    "container-{version}-installer-signed.pkg",
    "container-installer-signed.pkg",
}
APPLE_KERNEL_ARTIFACT = {
    "repository": "kata-containers/kata-containers",
    "release_tag": "3.28.0",
    "asset_name": "kata-static-3.28.0-arm64.tar.zst",
}
APPLE_INIT_MANIFEST_PREFIX = "/v2/apple/containerization/vminit/manifests/"
SYNTHETIC_OCI_MANIFEST_PREFIX = "/v2/pause/manifests/"
LIMA_RELEASE_TAG_PREFIX = "v"
LIMA_INSTALLER_ASSET_TEMPLATE = "lima-{version}-Darwin-arm64.tar.gz"
LIMA_CHECKSUMS_ASSET_NAME = "SHA256SUMS"
LIMA_UBUNTU_TEMPLATE_PATH_TEMPLATE = "/lima-vm/lima/v{version}/templates/_images/ubuntu-24.04.yaml"
LIMA_UBUNTU_TEMPLATE_NAME = "ubuntu-24.04.yaml"
LIMA_GUEST_IMAGE_NAME = "ubuntu-24.04-minimal-cloudimg-arm64.img"
LIMA_GUEST_IMAGE_VERSION = "24.04-noble-release-20260716"
LIMA_GUEST_IMAGE_PATH = "/minimal/releases/noble/release-20260716/ubuntu-24.04-minimal-cloudimg-arm64.img"

BACKEND_DISCLOSURE_POLICIES = {
    "apple-container-cli": {
        "disk_changes": {"allow_absence": False},
        "background_services": {"allow_absence": False},
        "required_permissions": {"allow_absence": False},
        "network_changes": {"allow_absence": True},
    },
    "lima-vz": {
        "disk_changes": {"allow_absence": False},
        "background_services": {"allow_absence": True},
        "required_permissions": {"allow_absence": True},
        "network_changes": {"allow_absence": True},
    },
}

TRUST_ANCHOR_FIELDS = {
    "backend",
    "backend_version",
    "artifact_role",
    "repository",
    "release_tag",
    "asset_name",
    "verification_policy_id",
    "expected_signer_identity",
    "expected_signer_team_id",
    "trust_anchor_source",
    "source_status",
    "observed_at",
}

TRUST_ANCHOR_REGISTRY_FIELDS = {"schema_version", "entries"}
ARTIFACT_PIN_REGISTRY_FIELDS = {
    "schema_version",
    "registry_status",
    "blocker",
    "entries",
    "evidence_pack_manifest_path",
    "evidence_pack_manifest_sha256",
    "observed_at",
}
ALLOWED_ARTIFACT_PIN_REGISTRY_STATES = {
    "PINNED",
    "BLOCKED_KATA_ARCHIVE_INSPECTION_CAPABILITY_UNAVAILABLE",
}


class ManifestError(ValueError):
    pass


@dataclass(frozen=True)
class RegistrySnapshot:
    anchors: Mapping[tuple[str, str, str, str], dict]
    relative_path: str
    raw_sha256: str
    schema_version: str
    source_kind: Literal["COMMITTED_PROJECT_REGISTRY", "TEST_FIXTURE"]


def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ManifestError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_floats(value):
    raise ManifestError("floats are not allowed in canonical manifest JSON")


def load_json_bytes(raw: bytes, source: str = "<bytes>"):
    try:
        return json.loads(
            raw.decode("utf-8"),
            parse_float=_reject_floats,
            parse_constant=lambda value: (_ for _ in ()).throw(ManifestError(f"invalid constant: {value}")),
            object_pairs_hook=reject_duplicate_keys,
        )
    except UnicodeDecodeError as error:
        raise ManifestError(f"{source}: invalid UTF-8") from error
    except json.JSONDecodeError as error:
        raise ManifestError(f"invalid JSON: {error}") from error


def load_json(path: Path):
    return load_json_bytes(path.read_bytes(), str(path))


def normalize_unicode(value):
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, list):
        return [normalize_unicode(item) for item in value]
    if isinstance(value, dict):
        return {normalize_unicode(str(key)): normalize_unicode(item) for key, item in value.items()}
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ManifestError("NaN/Infinity are forbidden")
        raise ManifestError("floats are forbidden")
    return value


def canonical_json_bytes(value) -> bytes:
    """Project canonical JSON: UTF-8, NFC strings, sorted keys, compact separators.

    Arrays preserve order. Floats, NaN and Infinity are rejected. This is a
    strict project contract, not a full RFC 8785 implementation.
    """

    normalized = normalize_unicode(value)
    return json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def content_sha256(content) -> str:
    return hashlib.sha256(canonical_json_bytes(content)).hexdigest()


def approval_command_prefix(backend: str) -> str:
    if backend == "lima-vz":
        return "APPROVE_FALLBACK_BACKEND_INSTALL"
    return "APPROVE_PRIMARY_BACKEND_INSTALL"


def expected_owner_command(approval_id: str, manifest_content_sha256: str, backend: str = "apple-container-cli") -> str:
    return f"{approval_command_prefix(backend)}:{approval_id}:{manifest_content_sha256}"


def expected_owner_command_hash(approval_id: str, manifest_content_sha256: str, backend: str = "apple-container-cli") -> str:
    return hashlib.sha256(expected_owner_command(approval_id, manifest_content_sha256, backend).encode("utf-8")).hexdigest()


def is_placeholder(value: str) -> bool:
    lowered = value.lower()
    return (
        "todo" in lowered
        or "to_be_pinned" in lowered
        or "to-be-pinned" in lowered
        or "placeholder" in lowered
        or "example.invalid" in lowered
    )


def normalize_security_text(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    return " ".join(normalized.strip().casefold().split())


def is_absence_marker(value: str) -> bool:
    return normalize_security_text(value) in ABSENCE_MARKERS


def is_secret_shaped(value: str) -> bool:
    return any(pattern.search(value) for pattern in SECRET_SHAPED_RES)


def contains_forbidden_unicode(value: str) -> bool:
    for character in value:
        category = unicodedata.category(character)
        if category == "Cc":
            return True
        if category == "Cf":
            return True
    return False


def require_exact_fields(value: dict, expected: set[str], location: str, *, required: set[str] | None = None) -> None:
    if not isinstance(value, dict):
        raise ManifestError(f"{location}: expected object")
    unknown = sorted(set(value) - expected)
    if unknown:
        raise ManifestError(f"unknown field: {location}.{unknown[0]}")
    missing = sorted((required or expected) - set(value))
    if missing:
        raise ManifestError(f"missing field: {location}.{missing[0]}")


def require_non_empty_string(
    value,
    field: str,
    *,
    max_length: int = MAX_STRING_LENGTH,
    allow_placeholder: bool = False,
    allow_none_marker: bool = False,
) -> str:
    if not isinstance(value, str):
        raise ManifestError(f"{field}: expected string")
    normalized = unicodedata.normalize("NFC", value)
    if len(normalized) == 0:
        raise ManifestError(f"{field}: empty string rejected")
    if len(normalized) > max_length:
        raise ManifestError(f"{field}: string too long")
    if normalized != normalized.strip():
        raise ManifestError(f"{field}: leading/trailing whitespace rejected")
    if contains_forbidden_unicode(normalized):
        raise ManifestError(f"{field}: forbidden unicode/control character rejected")
    if not allow_none_marker and normalized == "NONE":
        raise ManifestError(f"{field}: NONE marker not allowed")
    if not allow_placeholder and is_placeholder(normalized):
        raise ManifestError(f"{field}: placeholder text forbidden")
    if is_secret_shaped(normalized):
        raise ManifestError(f"{field}: secret-shaped value rejected")
    return normalized


def require_identifier(value, field: str, pattern: re.Pattern[str]) -> str:
    normalized = require_non_empty_string(value, field, max_length=MAX_IDENTIFIER_LENGTH)
    if not pattern.fullmatch(normalized):
        raise ManifestError(f"{field}: invalid provenance identifier")
    return normalized


def require_string_list(value, field: str, *, allow_none_marker: bool = False, unique: bool = False) -> list[str]:
    if not isinstance(value, list):
        raise ManifestError(f"{field}: expected list")
    output: list[str] = []
    for index, item in enumerate(value):
        output.append(require_non_empty_string(item, f"{field}[{index}]", allow_none_marker=allow_none_marker))
    if unique and len(output) != len(set(output)):
        raise ManifestError(f"{field}: duplicate list item rejected")
    return output


def require_non_empty_string_list(value, field: str, *, allow_none_marker: bool = False, unique: bool = False) -> list[str]:
    output = require_string_list(value, field, allow_none_marker=allow_none_marker, unique=unique)
    if not output:
        raise ManifestError(f"{field}: empty required list rejected")
    if "NONE" in output and output != ["NONE"]:
        raise ManifestError(f"{field}: NONE marker must be the only item")
    return output


def validate_sha256(value: str, field: str) -> None:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ManifestError(f"{field}: invalid sha256")
    if len(set(value)) == 1:
        raise ManifestError(f"{field}: repeating-character placeholder hash")


def parse_time(value: str, field: str) -> dt.datetime:
    if not isinstance(value, str):
        raise ManifestError(f"{field}: expected RFC3339 string")
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(normalized)
    except ValueError as error:
        raise ManifestError(f"{field}: invalid datetime") from error
    if parsed.tzinfo is None:
        raise ManifestError(f"{field}: timezone required")
    return parsed.astimezone(dt.timezone.utc)


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def validate_version_string(value: str, field: str) -> None:
    normalized = require_non_empty_string(value, field, max_length=MAX_VERSION_LENGTH)
    if normalized.lower() in FORBIDDEN_VERSION_WORDS:
        raise ManifestError(f"{field}: floating/generic version forbidden")
    if any(character.isspace() for character in normalized):
        raise ManifestError(f"{field}: whitespace/control characters forbidden")


def validate_manifest_lists(content: dict, backend: str) -> None:
    policy = BACKEND_DISCLOSURE_POLICIES[backend]
    for field in ("disk_changes", "background_services", "required_permissions", "network_changes"):
        allow_absence = policy[field]["allow_absence"]
        values = require_non_empty_string_list(
            content.get(field),
            field,
            allow_none_marker=allow_absence,
            unique=True,
        )
        for value in values:
            if value == "NONE":
                if not allow_absence:
                    raise ManifestError(f"{field}: NONE marker not allowed for {backend}")
                continue
            if is_absence_marker(value):
                raise ManifestError(f"{field}: ambiguous absence marker rejected")


def split_github_release_path(source_url: str) -> dict[str, str]:
    parsed = urlparse(source_url)
    raw_parts = parsed.path.split("/")
    if len(raw_parts) != 7:
        raise ManifestError("source_url: exact six-segment release URL required")
    parts = raw_parts[1:]
    return {
        "repository": f"{parts[0]}/{parts[1]}",
        "release_tag": parts[4],
        "asset_name": parts[5],
    }


def validate_github_release_url(
    artifact: dict,
    backend: str,
    backend_version: str,
    *,
    expected_repository: str | None = None,
    expected_release_tag: str | None = None,
    expected_asset_name: str | None = None,
) -> None:
    repository = BACKEND_REPOSITORIES[backend]
    source_url = require_non_empty_string(artifact["source_url"], "source_url")
    parsed = urlparse(source_url)
    if parsed.scheme != "https":
        raise ManifestError("source_url: scheme must be https")
    if parsed.username or parsed.password or "@" in parsed.netloc:
        raise ManifestError("source_url: URL userinfo rejected")
    if parsed.hostname != "github.com":
        raise ManifestError("source_url: host not allowed")
    try:
        parsed_port = parsed.port
    except ValueError as error:
        raise ManifestError("source_url: explicit port rejected") from error
    if parsed_port is not None or parsed.netloc != "github.com":
        raise ManifestError("source_url: explicit port rejected")
    if parsed.query or parsed.fragment:
        raise ManifestError("source_url: URL query or fragment rejected")
    if "//" in parsed.path:
        raise ManifestError("source_url: repeated slashes rejected")
    lowered_path = parsed.path.lower()
    if "%2f" in lowered_path:
        raise ManifestError("source_url: encoded slash rejected")
    if "%5c" in lowered_path:
        raise ManifestError("source_url: encoded backslash rejected")
    if "%" in parsed.path:
        raise ManifestError("source_url: percent-encoding rejected")

    raw_parts = parsed.path.split("/")
    decoded_for_shape = [unquote(part) for part in raw_parts[1:] if part]
    if any(part in {".", ".."} for part in decoded_for_shape):
        raise ManifestError("source_url: dot segment rejected")
    if len(raw_parts) != 7 or raw_parts[0] != "" or any(part == "" for part in raw_parts[1:]):
        raise ManifestError("source_url: exact six-segment release URL required")
    decoded_path_parts = [unquote(part) for part in raw_parts[1:]]
    if len(decoded_path_parts) != 6:
        raise ManifestError("source_url: exact six-segment release URL required")
    for part in decoded_path_parts:
        if part in {".", ".."}:
            raise ManifestError("source_url: dot segment rejected")
        if "/" in part:
            raise ManifestError("source_url: encoded slash rejected")
        if "\\" in part:
            raise ManifestError("source_url: encoded backslash rejected")
        if contains_forbidden_unicode(part):
            raise ManifestError("source_url: forbidden unicode/control character rejected")
    if not decoded_path_parts[-1]:
        raise ManifestError("source_url: empty asset basename rejected")

    repository_name = expected_repository or f"{repository['owner']}/{repository['repo']}"
    try:
        expected_owner, expected_repo = repository_name.split("/", 1)
    except ValueError as error:
        raise ManifestError("source_url: invalid expected repository") from error
    release_tag = expected_release_tag or backend_version
    asset_name = expected_asset_name or artifact["name"]
    expected_parts = [
        expected_owner,
        expected_repo,
        "releases",
        "download",
        release_tag,
        asset_name,
    ]
    if decoded_path_parts[:2] != expected_parts[:2]:
        raise ManifestError("wrong GitHub repository")
    if decoded_path_parts[:5] != expected_parts[:5]:
        raise ManifestError("wrong release tag")
    if decoded_path_parts != expected_parts:
        raise ManifestError("asset basename mismatch")

    hosts = require_non_empty_string_list(artifact["resolved_download_hosts"], "resolved_download_hosts")
    if len(hosts) != len(set(hosts)):
        raise ManifestError("resolved_download_hosts: duplicate host")
    for host in hosts:
        if host not in ALLOWED_DOWNLOAD_HOSTS:
            raise ManifestError(f"unknown download host: {host}")
    if parsed.hostname not in hosts:
        raise ManifestError("source host must be declared")


def validate_registry_manifest_url(
    artifact: dict,
    *,
    expected_host: str,
    expected_path_prefix: str,
    expected_digest: str,
) -> None:
    source_url = require_non_empty_string(artifact["source_url"], "source_url")
    parsed = urlparse(source_url)
    if parsed.scheme != "https":
        raise ManifestError("source_url: scheme must be https")
    if parsed.username or parsed.password or "@" in parsed.netloc:
        raise ManifestError("source_url: URL userinfo rejected")
    try:
        parsed_port = parsed.port
    except ValueError as error:
        raise ManifestError("source_url: explicit port rejected") from error
    if parsed_port is not None:
        raise ManifestError("source_url: explicit port rejected")
    if parsed.hostname != expected_host or parsed.netloc != expected_host:
        raise ManifestError("source_url: registry host not allowed")
    if parsed.query or parsed.fragment:
        raise ManifestError("source_url: URL query or fragment rejected")
    if not parsed.path.startswith(expected_path_prefix):
        raise ManifestError("source_url: registry manifest path mismatch")
    if parsed.path != f"{expected_path_prefix}{expected_digest}":
        raise ManifestError("source_url: registry digest mismatch")
    hosts = require_non_empty_string_list(artifact["resolved_download_hosts"], "resolved_download_hosts")
    if len(hosts) != len(set(hosts)):
        raise ManifestError("resolved_download_hosts: duplicate host")
    for host in hosts:
        if host not in ALLOWED_DOWNLOAD_HOSTS:
            raise ManifestError(f"unknown download host: {host}")
    if expected_host not in hosts:
        raise ManifestError("source host must be declared")


def _validate_https_url_base(artifact: dict, source_url: str, *, expected_host: str) -> tuple:
    parsed = urlparse(source_url)
    if parsed.scheme != "https":
        raise ManifestError("source_url: scheme must be https")
    if parsed.username or parsed.password or "@" in parsed.netloc:
        raise ManifestError("source_url: URL userinfo rejected")
    try:
        parsed_port = parsed.port
    except ValueError as error:
        raise ManifestError("source_url: explicit port rejected") from error
    if parsed_port is not None:
        raise ManifestError("source_url: explicit port rejected")
    if parsed.hostname != expected_host or parsed.netloc != expected_host:
        raise ManifestError("source_url: host not allowed")
    if parsed.query or parsed.fragment:
        raise ManifestError("source_url: URL query or fragment rejected")
    if "//" in parsed.path:
        raise ManifestError("source_url: repeated slashes rejected")
    lowered_path = parsed.path.lower()
    if "%2f" in lowered_path:
        raise ManifestError("source_url: encoded slash rejected")
    if "%5c" in lowered_path:
        raise ManifestError("source_url: encoded backslash rejected")
    if "%" in parsed.path:
        raise ManifestError("source_url: percent-encoding rejected")
    decoded_path_parts = [unquote(part) for part in parsed.path.split("/") if part]
    if any(part in {".", ".."} for part in decoded_path_parts):
        raise ManifestError("source_url: dot segment rejected")
    if any(contains_forbidden_unicode(part) for part in decoded_path_parts):
        raise ManifestError("source_url: forbidden unicode/control character rejected")
    hosts = require_non_empty_string_list(artifact["resolved_download_hosts"], "resolved_download_hosts")
    if len(hosts) != len(set(hosts)):
        raise ManifestError("resolved_download_hosts: duplicate host")
    for host in hosts:
        if host not in ALLOWED_DOWNLOAD_HOSTS:
            raise ManifestError(f"unknown download host: {host}")
    if expected_host not in hosts:
        raise ManifestError("source host must be declared")
    return parsed


def validate_raw_github_template_url(artifact: dict, backend_version: str) -> None:
    source_url = require_non_empty_string(artifact["source_url"], "source_url")
    parsed = _validate_https_url_base(artifact, source_url, expected_host="raw.githubusercontent.com")
    expected_path = LIMA_UBUNTU_TEMPLATE_PATH_TEMPLATE.format(version=backend_version)
    if parsed.path != expected_path:
        raise ManifestError("source_url: Lima release-tagged template path mismatch")


def validate_lima_guest_image_url(artifact: dict) -> None:
    source_url = require_non_empty_string(artifact["source_url"], "source_url")
    parsed = _validate_https_url_base(artifact, source_url, expected_host="cloud-images.ubuntu.com")
    if parsed.path != LIMA_GUEST_IMAGE_PATH:
        raise ManifestError("source_url: pinned Ubuntu guest image path mismatch")
    if "/release/" in parsed.path or not re.search(r"/release-[0-9]{8}/", parsed.path):
        raise ManifestError("source_url: mutable Ubuntu release path rejected")


def validate_apple_signer_identity(value: str, field: str = "expected_signer_identity") -> str:
    identity = require_non_empty_string(value, field, max_length=MAX_IDENTIFIER_LENGTH)
    if normalize_security_text(identity) in GENERIC_SIGNER_VALUES:
        raise ManifestError("Apple installer signer not_applicable/generic rejected")
    if not APPLE_INSTALLER_SIGNER_RE.fullmatch(identity):
        raise ManifestError("invalid Apple signer identity")
    _, signer_name = identity.split(":", 1)
    normalized_signer = normalize_security_text(signer_name)
    if normalized_signer in GENERIC_SIGNER_SUFFIXES or is_absence_marker(signer_name) or is_placeholder(signer_name):
        raise ManifestError("generic Apple signer suffix rejected")
    return identity


def validate_apple_team_id(value: str, field: str = "expected_signer_team_id") -> str:
    team_id = require_non_empty_string(value, field, max_length=MAX_IDENTIFIER_LENGTH)
    if is_absence_marker(team_id):
        raise ManifestError("Apple installer team identifier not_applicable rejected")
    if not APPLE_TEAM_ID_RE.fullmatch(team_id):
        raise ManifestError("invalid Apple Team ID")
    if len(set(team_id)) == 1 or team_id in GENERIC_TEAM_IDS or team_id in FAKE_TEAM_IDS:
        raise ManifestError("invalid Apple Team ID")
    return team_id


def validate_trust_anchor_entry(entry: dict) -> tuple[str, str, str, str]:
    require_exact_fields(entry, TRUST_ANCHOR_FIELDS, "trust_anchor")
    backend = require_non_empty_string(entry["backend"], "trust_anchor.backend", max_length=MAX_IDENTIFIER_LENGTH)
    if backend != "apple-container-cli":
        raise ManifestError("trust_anchor: invalid backend")
    backend_version = require_non_empty_string(entry["backend_version"], "trust_anchor.backend_version", max_length=MAX_VERSION_LENGTH)
    if not APPLE_SEMVER_RE.fullmatch(backend_version):
        raise ManifestError("trust_anchor: backend_version must be strict semver")
    artifact_role = require_non_empty_string(entry["artifact_role"], "trust_anchor.artifact_role", max_length=MAX_IDENTIFIER_LENGTH)
    if artifact_role != "backend-installer":
        raise ManifestError("trust_anchor: invalid artifact_role")
    repository = require_non_empty_string(entry["repository"], "trust_anchor.repository", max_length=MAX_IDENTIFIER_LENGTH)
    if repository != "apple/container":
        raise ManifestError("trust_anchor: canonical repository required")
    release_tag = require_non_empty_string(entry["release_tag"], "trust_anchor.release_tag", max_length=MAX_VERSION_LENGTH)
    if release_tag != backend_version:
        raise ManifestError("trust_anchor: release tag mismatch")
    asset_name = require_non_empty_string(entry["asset_name"], "trust_anchor.asset_name", max_length=MAX_STRING_LENGTH)
    allowed_asset_names = {
        template.format(version=backend_version)
        for template in APPLE_SIGNED_INSTALLER_ASSET_NAMES
    }
    if asset_name not in allowed_asset_names:
        raise ManifestError("trust_anchor: canonical asset basename required")
    verification_policy_id = require_non_empty_string(
        entry["verification_policy_id"],
        "trust_anchor.verification_policy_id",
        max_length=MAX_IDENTIFIER_LENGTH,
    )
    if verification_policy_id != "apple-container-installer-v1":
        raise ManifestError("trust_anchor: invalid verification policy")
    source_status = require_non_empty_string(entry["source_status"], "trust_anchor.source_status", max_length=MAX_IDENTIFIER_LENGTH)
    if source_status not in ALLOWED_TRUST_ANCHOR_STATES:
        raise ManifestError("trust_anchor: invalid source_status")
    trust_anchor_source = require_non_empty_string(
        entry["trust_anchor_source"],
        "trust_anchor.trust_anchor_source",
        max_length=MAX_STRING_LENGTH,
        allow_placeholder=source_status == "DRAFT",
    )
    parse_time(require_non_empty_string(entry["observed_at"], "trust_anchor.observed_at"), "trust_anchor.observed_at")

    signer_identity = entry["expected_signer_identity"]
    team_id = entry["expected_signer_team_id"]
    if source_status == "PINNED":
        validate_apple_signer_identity(signer_identity, "trust_anchor.expected_signer_identity")
        validate_apple_team_id(team_id, "trust_anchor.expected_signer_team_id")
        if is_placeholder(trust_anchor_source):
            raise ManifestError("trust_anchor: placeholder text forbidden")
    else:
        if not is_placeholder(signer_identity):
            validate_apple_signer_identity(signer_identity, "trust_anchor.expected_signer_identity")
        else:
            require_non_empty_string(
                signer_identity,
                "trust_anchor.expected_signer_identity",
                allow_placeholder=True,
            )
        if not is_placeholder(team_id):
            validate_apple_team_id(team_id, "trust_anchor.expected_signer_team_id")
        else:
            require_non_empty_string(
                team_id,
                "trust_anchor.expected_signer_team_id",
                allow_placeholder=True,
            )
    return backend, backend_version, artifact_role, asset_name


def validate_release_trust_anchor_registry(registry: dict) -> dict[tuple[str, str, str, str], dict]:
    require_exact_fields(registry, TRUST_ANCHOR_REGISTRY_FIELDS, "trust_anchor_registry")
    if registry.get("schema_version") != TRUST_ANCHOR_SCHEMA_VERSION:
        raise ManifestError("trust_anchor_registry: invalid schema_version")
    entries = registry.get("entries")
    if not isinstance(entries, list):
        raise ManifestError("trust_anchor_registry.entries: expected list")
    anchors: dict[tuple[str, str, str, str], dict] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ManifestError("trust_anchor_registry.entries: expected object")
        key = validate_trust_anchor_entry(entry)
        if key in anchors:
            raise ManifestError("trust_anchor_registry: duplicate entry")
        anchors[key] = entry
    return anchors


def _reject_symlink(path: Path) -> None:
    try:
        if path.is_symlink():
            raise ManifestError("TRUST_ANCHOR_REGISTRY_SYMLINK_REJECTED")
    except OSError as error:
        raise ManifestError("TRUST_ANCHOR_REGISTRY_PATH_UNTRUSTED") from error


def resolve_trusted_registry_path(
    registry_path: Path = DEFAULT_TRUST_ANCHORS_PATH,
    *,
    project_root: Path = PROJECT_ROOT,
    relative_path: Path = TRUST_ANCHOR_REGISTRY_RELATIVE_PATH,
) -> Path:
    expected_registry_path = project_root / relative_path
    if not registry_path.is_absolute():
        raise ManifestError("TRUST_ANCHOR_REGISTRY_PATH_UNTRUSTED")
    for component in (
        project_root / "docs",
        project_root / "docs" / "security",
        expected_registry_path,
    ):
        _reject_symlink(component)
    try:
        if not registry_path.exists() or not registry_path.is_file():
            raise ManifestError("TRUST_ANCHOR_REGISTRY_PATH_UNTRUSTED")
        if registry_path.resolve() != expected_registry_path.resolve():
            raise ManifestError("TRUST_ANCHOR_REGISTRY_PATH_UNTRUSTED")
    except OSError as error:
        raise ManifestError("TRUST_ANCHOR_REGISTRY_PATH_UNTRUSTED") from error
    return expected_registry_path


def trusted_registry_relative_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(PROJECT_ROOT).as_posix()
    except ValueError as error:
        raise ManifestError("TRUST_ANCHOR_REGISTRY_PATH_UNTRUSTED") from error


def load_release_trust_anchor_registry() -> RegistrySnapshot:
    registry_path = resolve_trusted_registry_path()
    raw = registry_path.read_bytes()
    registry = load_json_bytes(raw, TRUST_ANCHOR_REGISTRY_RELATIVE_PATH.as_posix())
    anchors = validate_release_trust_anchor_registry(registry)
    return RegistrySnapshot(
        anchors=anchors,
        relative_path=trusted_registry_relative_path(registry_path),
        raw_sha256=hashlib.sha256(raw).hexdigest(),
        schema_version=TRUST_ANCHOR_SCHEMA_VERSION,
        source_kind="COMMITTED_PROJECT_REGISTRY",
    )


def load_release_trust_anchors() -> dict[tuple[str, str, str, str], dict]:
    return dict(load_release_trust_anchor_registry().anchors)


def resolve_artifact_pin_registry_path(
    registry_path: Path = DEFAULT_ARTIFACT_PIN_REGISTRY_PATH,
    *,
    project_root: Path = PROJECT_ROOT,
    relative_path: Path = ARTIFACT_PIN_REGISTRY_RELATIVE_PATH,
) -> Path:
    expected_registry_path = project_root / relative_path
    if not registry_path.is_absolute():
        raise ManifestError("ARTIFACT_PIN_REGISTRY_PATH_UNTRUSTED")
    for component in (
        project_root / "docs",
        project_root / "docs" / "security",
        expected_registry_path,
    ):
        _reject_symlink(component)
    try:
        if not registry_path.exists() or not registry_path.is_file():
            raise ManifestError("ARTIFACT_PIN_REGISTRY_PATH_UNTRUSTED")
        if registry_path.resolve() != expected_registry_path.resolve():
            raise ManifestError("ARTIFACT_PIN_REGISTRY_PATH_UNTRUSTED")
    except OSError as error:
        raise ManifestError("ARTIFACT_PIN_REGISTRY_PATH_UNTRUSTED") from error
    return expected_registry_path


def validate_artifact_pin_registry(registry: dict) -> dict:
    require_exact_fields(registry, ARTIFACT_PIN_REGISTRY_FIELDS, "artifact_pin_registry")
    if registry.get("schema_version") != ARTIFACT_PIN_REGISTRY_SCHEMA_VERSION:
        raise ManifestError("artifact_pin_registry: invalid schema_version")
    status = require_non_empty_string(registry.get("registry_status"), "artifact_pin_registry.registry_status")
    if status not in ALLOWED_ARTIFACT_PIN_REGISTRY_STATES:
        raise ManifestError("artifact_pin_registry: invalid registry_status")
    blocker = registry.get("blocker")
    if status == "PINNED":
        if blocker != "NONE":
            raise ManifestError("artifact_pin_registry: pinned registry cannot carry blocker")
    else:
        if blocker != status:
            raise ManifestError(status)
    evidence_path = require_non_empty_string(
        registry.get("evidence_pack_manifest_path"),
        "artifact_pin_registry.evidence_pack_manifest_path",
        max_length=MAX_IDENTIFIER_LENGTH,
    )
    if evidence_path != "security/evidence/phase-1b-b0/evidence-pack-manifest.json":
        raise ManifestError("artifact_pin_registry: canonical evidence pack path required")
    validate_sha256(registry.get("evidence_pack_manifest_sha256"), "artifact_pin_registry.evidence_pack_manifest_sha256")
    parse_time(require_non_empty_string(registry.get("observed_at"), "artifact_pin_registry.observed_at"), "artifact_pin_registry.observed_at")
    entries = registry.get("entries")
    if not isinstance(entries, list):
        raise ManifestError("artifact_pin_registry.entries: expected list")
    roles = set()
    artifact_ids = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ManifestError("artifact_pin_registry.entries: expected object")
        for key in entry:
            if key.endswith("evidencesha256"):
                raise ManifestError("artifact_pin_registry: malformed evidence sha field")
        role = require_non_empty_string(entry.get("role"), f"artifact_pin_registry.entries[{index}].role")
        artifact_id = require_non_empty_string(entry.get("artifact_id"), f"artifact_pin_registry.entries[{index}].artifact_id")
        if role in roles:
            raise ManifestError("artifact_pin_registry: duplicate role")
        if artifact_id in artifact_ids:
            raise ManifestError("artifact_pin_registry: duplicate artifact_id")
        roles.add(role)
        artifact_ids.add(artifact_id)
        if status == "PINNED" and role == "linux-kernel":
            validate_sha256(entry.get("inner_kernel_sha256"), "artifact_pin_registry.linux-kernel.inner_kernel_sha256")
            inner_size = entry.get("inner_kernel_size_bytes")
            if isinstance(inner_size, bool) or not isinstance(inner_size, int) or inner_size <= 0:
                raise ManifestError("artifact_pin_registry.linux-kernel.inner_kernel_size_bytes invalid")
            if entry.get("archive_inspection_evidence_path") != "security/evidence/phase-1b-b0/kata-archive-inspection.json":
                raise ManifestError("artifact_pin_registry: canonical Kata inspection evidence path required")
            validate_sha256(
                entry.get("archive_inspection_evidence_sha256"),
                "artifact_pin_registry.linux-kernel.archive_inspection_evidence_sha256",
            )
    missing = APPLE_ROLES - roles
    if missing:
        raise ManifestError(f"artifact_pin_registry: missing role {sorted(missing)[0]}")
    return registry


def require_artifact_pin_registry_evidence_binding(registry: dict) -> None:
    evidence_pack_path = PROJECT_ROOT / registry["evidence_pack_manifest_path"]
    _reject_symlink(evidence_pack_path)
    if not evidence_pack_path.is_file():
        raise ManifestError("artifact_pin_registry: evidence pack manifest missing")
    if hashlib.sha256(evidence_pack_path.read_bytes()).hexdigest() != registry["evidence_pack_manifest_sha256"]:
        raise ManifestError("artifact_pin_registry: evidence pack manifest hash mismatch")

    linux_entry = next(entry for entry in registry["entries"] if entry["role"] == "linux-kernel")
    kata_evidence_path = PROJECT_ROOT / linux_entry["archive_inspection_evidence_path"]
    _reject_symlink(kata_evidence_path)
    if not kata_evidence_path.is_file():
        raise ManifestError("artifact_pin_registry: Kata inspection evidence missing")
    if hashlib.sha256(kata_evidence_path.read_bytes()).hexdigest() != linux_entry["archive_inspection_evidence_sha256"]:
        raise ManifestError("artifact_pin_registry: Kata inspection evidence hash mismatch")
    evidence = load_json_bytes(
        kata_evidence_path.read_bytes(),
        linux_entry["archive_inspection_evidence_path"],
    )
    if evidence.get("result") != "PASS" or evidence.get("archive_inspected") is not True:
        raise ManifestError("artifact_pin_registry: Kata archive inspection is not PASS")
    if evidence.get("outer_archive_sha256") != linux_entry["sha256"]:
        raise ManifestError("artifact_pin_registry: Kata outer archive hash mismatch")
    if evidence.get("outer_archive_size_bytes") != linux_entry["size_bytes"]:
        raise ManifestError("artifact_pin_registry: Kata outer archive size mismatch")
    if evidence.get("expected_kernel_member_path") != linux_entry.get("kernel_member_path"):
        raise ManifestError("artifact_pin_registry: Kata kernel member path mismatch")
    if evidence.get("inner_kernel_sha256") != linux_entry["inner_kernel_sha256"]:
        raise ManifestError("artifact_pin_registry: Kata inner kernel hash mismatch")
    if evidence.get("inner_kernel_size_bytes") != linux_entry["inner_kernel_size_bytes"]:
        raise ManifestError("artifact_pin_registry: Kata inner kernel size mismatch")


def load_artifact_pin_registry() -> dict:
    registry_path = resolve_artifact_pin_registry_path()
    registry = load_json_bytes(registry_path.read_bytes(), ARTIFACT_PIN_REGISTRY_RELATIVE_PATH.as_posix())
    return validate_artifact_pin_registry(registry)


def require_artifact_pin_registry_ready() -> None:
    registry = load_artifact_pin_registry()
    status = registry["registry_status"]
    if status != "PINNED":
        raise ManifestError(status)
    require_artifact_pin_registry_evidence_binding(registry)


def validate_apple_installer_trust_anchor(
    artifact: dict,
    backend: str,
    backend_version: str,
    registry_snapshot: RegistrySnapshot,
) -> dict:
    key = (backend, backend_version, artifact["role"], artifact["name"])
    anchor = registry_snapshot.anchors.get(key)
    if not anchor or anchor.get("source_status") != "PINNED":
        raise ManifestError("RELEASE_TRUST_ANCHOR_NOT_PINNED")
    release = split_github_release_path(artifact["source_url"])
    comparisons = {
        "repository": release["repository"],
        "release_tag": release["release_tag"],
        "asset_name": artifact["name"],
        "verification_policy_id": artifact["verification_policy_id"],
        "expected_signer_identity": artifact["expected_signer_identity"],
        "expected_signer_team_id": artifact["expected_signer_team_id"],
    }
    for field, actual in comparisons.items():
        if anchor.get(field) != actual:
            raise ManifestError("RELEASE_TRUST_ANCHOR_MISMATCH")
    return anchor


def validate_artifact(
    artifact: dict,
    backend: str,
    backend_version: str,
    *,
    registry_snapshot: RegistrySnapshot,
) -> dict | None:
    require_exact_fields(artifact, ARTIFACT_FIELDS, "artifact", required=ARTIFACT_REQUIRED_FIELDS)
    role = require_non_empty_string(artifact["role"], "artifact.role")
    policy = BACKEND_ARTIFACT_POLICIES[backend]
    if role not in policy["allowed_roles"]:
        raise ManifestError(f"unknown artifact role: {role}")

    name = require_non_empty_string(artifact["name"], "artifact.name")
    if "/" in name or "\\" in name or name in {".", ".."}:
        raise ManifestError("artifact.name: bounded basename required")
    validate_version_string(artifact["version"], f"artifact {role} version")
    if role == "backend-installer" and artifact["version"] != backend_version:
        raise ManifestError("installer version mismatch")
    validate_sha256(artifact["sha256"], f"artifact {role} sha256")

    size_bytes = artifact["size_bytes"]
    if isinstance(size_bytes, bool) or not isinstance(size_bytes, int) or size_bytes <= 0:
        raise ManifestError(f"artifact {role}: invalid size_bytes")

    signature_type = require_non_empty_string(artifact["signature_type"], f"artifact {role} signature_type")
    if signature_type not in ROLE_SIGNATURE_POLICIES[role]:
        raise ManifestError(f"artifact {role}: invalid signature_type")
    verification_policy_id = require_non_empty_string(
        artifact["verification_policy_id"],
        f"artifact {role} verification_policy_id",
        max_length=MAX_IDENTIFIER_LENGTH,
    )
    expected_policy = ROLE_VERIFICATION_POLICIES.get((backend, role), ROLE_VERIFICATION_POLICIES.get(role))
    if verification_policy_id != expected_policy:
        raise ManifestError("unknown verification policy")
    expected_signer_identity = require_non_empty_string(
        artifact["expected_signer_identity"],
        f"artifact {role} expected_signer_identity",
        max_length=MAX_IDENTIFIER_LENGTH,
    )
    expected_signer_team_id = require_non_empty_string(
        artifact["expected_signer_team_id"],
        f"artifact {role} expected_signer_team_id",
        max_length=MAX_IDENTIFIER_LENGTH,
    )
    notarization = require_non_empty_string(artifact["notarization_requirement"], f"artifact {role} notarization_requirement")

    if role != "backend-installer" and notarization != "not_applicable":
        raise ManifestError(f"artifact {role}: notarization must be not_applicable")

    if role == "backend-installer":
        if backend == "apple-container-cli":
            allowed_asset_names = {
                template.format(version=backend_version)
                for template in APPLE_SIGNED_INSTALLER_ASSET_NAMES
            }
            if name not in allowed_asset_names:
                raise ManifestError("Apple backend installer must use a signed package asset")
            validate_github_release_url(artifact, backend, backend_version)
            if not name.endswith(".pkg"):
                raise ManifestError("Apple backend installer must be a signed .pkg")
            if signature_type != "apple-signed-pkg":
                raise ManifestError("Apple backend installer requires apple-signed-pkg signature")
            if notarization != "required":
                raise ManifestError("Apple backend installer notarization is required")
            validate_apple_signer_identity(expected_signer_identity)
            validate_apple_team_id(expected_signer_team_id)
            return validate_apple_installer_trust_anchor(artifact, backend, backend_version, registry_snapshot)
        if backend == "lima-vz":
            expected_name = LIMA_INSTALLER_ASSET_TEMPLATE.format(version=backend_version)
            if name != expected_name:
                raise ManifestError("Lima backend installer asset basename mismatch")
            validate_github_release_url(
                artifact,
                backend,
                backend_version,
                expected_release_tag=f"{LIMA_RELEASE_TAG_PREFIX}{backend_version}",
                expected_asset_name=expected_name,
            )
            if signature_type != "sha256-only":
                raise ManifestError("Lima backend installer requires sha256-only signature")
            if notarization != "not_applicable":
                raise ManifestError("Lima backend installer notarization must be not_applicable")
    elif role == "linux-kernel":
        validate_github_release_url(
            artifact,
            backend,
            backend_version,
            expected_repository=APPLE_KERNEL_ARTIFACT["repository"],
            expected_release_tag=APPLE_KERNEL_ARTIFACT["release_tag"],
            expected_asset_name=APPLE_KERNEL_ARTIFACT["asset_name"],
        )
    elif role == "init-filesystem":
        validate_registry_manifest_url(
            artifact,
            expected_host="ghcr.io",
            expected_path_prefix=APPLE_INIT_MANIFEST_PREFIX,
            expected_digest=f"sha256:{artifact['sha256']}",
        )
    elif role == "synthetic-oci-manifest":
        digest = artifact.get("oci_digest")
        if not isinstance(digest, str) or not OCI_DIGEST_RE.fullmatch(digest):
            raise ManifestError("OCI artifact without digest")
        if digest != f"sha256:{artifact['sha256']}":
            raise ManifestError("OCI artifact digest must match sha256")
        validate_registry_manifest_url(
            artifact,
            expected_host="registry.k8s.io",
            expected_path_prefix=SYNTHETIC_OCI_MANIFEST_PREFIX,
            expected_digest=digest,
        )
    elif role == "release-checksums":
        if backend != "lima-vz":
            raise ManifestError(f"unknown artifact role: {role}")
        if name != LIMA_CHECKSUMS_ASSET_NAME:
            raise ManifestError("Lima checksums asset basename mismatch")
        if artifact["version"] != backend_version:
            raise ManifestError("Lima checksums version mismatch")
        validate_github_release_url(
            artifact,
            backend,
            backend_version,
            expected_release_tag=f"{LIMA_RELEASE_TAG_PREFIX}{backend_version}",
            expected_asset_name=LIMA_CHECKSUMS_ASSET_NAME,
        )
    elif role == "lima-template":
        if backend != "lima-vz":
            raise ManifestError(f"unknown artifact role: {role}")
        if name != LIMA_UBUNTU_TEMPLATE_NAME:
            raise ManifestError("Lima template basename mismatch")
        if artifact["version"] != f"{LIMA_RELEASE_TAG_PREFIX}{backend_version}":
            raise ManifestError("Lima template version mismatch")
        validate_raw_github_template_url(artifact, backend_version)
    elif role == "guest-image":
        if backend != "lima-vz":
            raise ManifestError(f"unknown artifact role: {role}")
        if name != LIMA_GUEST_IMAGE_NAME:
            raise ManifestError("Lima guest image basename mismatch")
        if artifact["version"] != LIMA_GUEST_IMAGE_VERSION:
            raise ManifestError("Lima guest image version mismatch")
        validate_lima_guest_image_url(artifact)

    if role != "synthetic-oci-manifest" and "oci_digest" in artifact:
        raise ManifestError(f"unknown field: artifact.oci_digest for role {role}")
    return None


def validate_manifest_common(manifest: dict) -> dict:
    require_exact_fields(manifest, MANIFEST_ENVELOPE_FIELDS, "manifest")
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise ManifestError("invalid schema_version")
    state = manifest.get("manifest_state")
    if state not in ALLOWED_STATES:
        raise ManifestError("invalid manifest_state")
    content = manifest.get("manifest_content")
    require_exact_fields(content, MANIFEST_CONTENT_FIELDS, "manifest_content")
    if "manifest_sha256" in content:
        raise ManifestError("self-referential manifest hash is forbidden")
    if "content_sha256" in content:
        raise ManifestError("content_sha256 must live outside manifest_content")
    return content


def validate_template(manifest: dict) -> None:
    content = validate_manifest_common(manifest)
    if manifest["manifest_state"] != "TEMPLATE":
        raise ManifestError("template mode requires TEMPLATE state")
    artifacts = content.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise ManifestError("template must show artifact descriptor shape")
    for artifact in artifacts:
        require_exact_fields(artifact, ARTIFACT_FIELDS, "artifact", required=ARTIFACT_REQUIRED_FIELDS)
    if manifest.get("content_sha256") != content_sha256(content):
        raise ManifestError("content hash mismatch")


def validate_manifest_times(content: dict, now: dt.datetime) -> tuple[dt.datetime, dt.datetime]:
    created_at = parse_time(content.get("created_at"), "created_at")
    expires_at = parse_time(content.get("expires_at"), "expires_at")
    if created_at > now + MAX_CLOCK_SKEW:
        raise ManifestError("future manifest timestamp rejected")
    if expires_at <= created_at:
        raise ManifestError("expires_at must be after created_at")
    if expires_at - created_at > dt.timedelta(days=7):
        raise ManifestError("approval TTL must be at most 7 days")
    if now >= expires_at:
        raise ManifestError("expired manifest rejected")
    return created_at, expires_at


def validate_artifact_roles(backend: str, artifacts: list[dict]) -> None:
    policy = BACKEND_ARTIFACT_POLICIES[backend]
    seen: dict[str, int] = {}
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise ManifestError("artifact must be object")
        role = artifact.get("role")
        if role not in policy["allowed_roles"]:
            raise ManifestError(f"unknown artifact role: {role}")
        seen[role] = seen.get(role, 0) + 1
        if seen[role] > 1:
            raise ManifestError(f"duplicate artifact role: {role}")
    missing = sorted(policy["required_roles"] - set(seen))
    if missing:
        raise ManifestError(f"missing artifact role: {missing[0]}")
    extras = sorted(set(seen) - policy["allowed_roles"])
    if extras:
        raise ManifestError(f"unknown artifact role: {extras[0]}")


def _result_from_core(core_result: dict[str, str], registry_snapshot: RegistrySnapshot, *, mode: str) -> dict:
    if registry_snapshot.source_kind != "COMMITTED_PROJECT_REGISTRY":
        raise ManifestError("NON_AUTHORITATIVE_TRUST_REGISTRY")
    return {
        "result": "PASS",
        "authoritative": True,
        "mode": mode,
        "registry_source_kind": registry_snapshot.source_kind,
        **core_result,
    }


def _test_result_from_core(core_result: dict[str, str], registry_snapshot: RegistrySnapshot, *, mode: str) -> dict:
    return {
        "result": "TEST_ONLY_PASS",
        "authoritative": False,
        "mode": mode,
        "registry_source_kind": registry_snapshot.source_kind,
        **core_result,
    }


def _validate_review_manifest_core(
    manifest: dict,
    *,
    now: dt.datetime,
    registry_snapshot: RegistrySnapshot,
) -> dict[str, str]:
    content = validate_manifest_common(manifest)
    if manifest["manifest_state"] != REVIEW_STATE:
        raise ManifestError("review mode requires READY_FOR_REVIEW state")
    declared_hash = manifest.get("content_sha256")
    validate_sha256(declared_hash, "content_sha256")
    if declared_hash != content_sha256(content):
        raise ManifestError("content hash mismatch")

    approval_id = content.get("approval_id")
    require_non_empty_string(approval_id, "approval_id", max_length=MAX_IDENTIFIER_LENGTH)
    if not isinstance(approval_id, str) or not re.fullmatch(r"^p1b-[0-9]{8}-[a-z0-9-]{8,64}$", approval_id):
        raise ManifestError("invalid approval_id")

    backend = content.get("backend")
    if backend not in KNOWN_BACKENDS:
        raise ManifestError("invalid backend")
    if backend not in APPROVABLE_BACKENDS:
        raise ManifestError(f"{backend} approval contract not ready")
    validate_manifest_lists(content, backend)

    version = content.get("backend_version")
    validate_version_string(version, "backend_version")
    if not BACKEND_REPOSITORIES[backend]["version_re"].fullmatch(version):
        raise ManifestError("backend_version must be strict semver")

    validate_sha256(content.get("rollback_plan_hash"), "rollback_plan_hash")
    validate_manifest_times(content, now)

    artifacts = content.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise ManifestError("artifacts required")
    validate_artifact_roles(backend, artifacts)
    trust_anchor_status = "NOT_APPLICABLE"
    for artifact in artifacts:
        anchor = validate_artifact(artifact, backend, version, registry_snapshot=registry_snapshot)
        if anchor:
            trust_anchor_status = anchor["source_status"]
    return {
        "manifest_content_sha256": declared_hash,
        "trust_anchor_registry_sha256": registry_snapshot.raw_sha256,
        "trust_anchor_registry_path": registry_snapshot.relative_path,
        "trust_anchor_schema_version": registry_snapshot.schema_version,
        "trust_anchor_status": trust_anchor_status,
    }


def validate_review_manifest(
    manifest: dict,
    *,
    now: dt.datetime | None = None,
) -> dict:
    require_artifact_pin_registry_ready()
    registry_snapshot = load_release_trust_anchor_registry()
    core_result = _validate_review_manifest_core(
        manifest,
        now=now or utc_now(),
        registry_snapshot=registry_snapshot,
    )
    return _result_from_core(core_result, registry_snapshot, mode="review")


def _validate_review_manifest_for_test(
    manifest: dict,
    *,
    now: dt.datetime,
    registry_snapshot: RegistrySnapshot,
) -> dict:
    core_result = _validate_review_manifest_core(
        manifest,
        now=now,
        registry_snapshot=registry_snapshot,
    )
    return _test_result_from_core(core_result, registry_snapshot, mode="review")


def record_without_hash(record: dict) -> dict:
    return {key: value for key, value in record.items() if key != "record_sha256"}


def _validate_approval_record_common_core(
    record: dict,
    manifest: dict,
    *,
    now: dt.datetime,
    registry_snapshot: RegistrySnapshot,
) -> dict[str, str]:
    require_exact_fields(record, APPROVAL_RECORD_FIELDS, "approval_record")
    content = validate_manifest_common(manifest)
    if manifest["manifest_state"] != REVIEW_STATE:
        raise ManifestError("install mode requires immutable READY_FOR_REVIEW manifest_state")
    if record.get("decision") != "APPROVED":
        raise ManifestError("approval record decision must be APPROVED")
    if record.get("authorization_source") != "pankster-human-gate":
        raise ManifestError("approval authorization source is not trusted")

    approved_by = require_identifier(record.get("approved_by"), "approved_by", APPROVED_BY_RE)
    authorization_event_id = require_identifier(record.get("authorization_event_id"), "authorization_event_id", AUTH_EVENT_RE)
    authn_context = require_identifier(record.get("authn_context"), "authn_context", AUTHN_CONTEXT_RE)
    if not approved_by or not authorization_event_id or not authn_context:
        raise ManifestError("approval provenance missing")

    if record.get("approval_id") != content.get("approval_id"):
        raise ManifestError("approval_id mismatch")

    manifest_hash = manifest.get("content_sha256")
    validate_sha256(manifest_hash, "content_sha256")
    if record.get("manifest_content_sha256") != manifest_hash:
        raise ManifestError("approval manifest hash mismatch")
    if manifest_hash != content_sha256(content):
        raise ManifestError("content hash mismatch")
    record_registry_hash = record.get("trust_anchor_registry_sha256")
    validate_sha256(record_registry_hash, "trust_anchor_registry_sha256")
    if record_registry_hash != registry_snapshot.raw_sha256:
        raise ManifestError("TRUST_ANCHOR_REGISTRY_HASH_MISMATCH")

    expected_hash = expected_owner_command_hash(record["approval_id"], manifest_hash, content["backend"])
    if record.get("owner_command_hash") != expected_hash:
        raise ManifestError("owner command hash mismatch")

    if not isinstance(record.get("synthetic_only"), bool):
        raise ManifestError("synthetic_only must be boolean")
    if not isinstance(record.get("real_credentials_allowed"), bool):
        raise ManifestError("real_credentials_allowed must be boolean")
    if not isinstance(record.get("production_profiles_allowed"), bool):
        raise ManifestError("production_profiles_allowed must be boolean")

    record_hash = record.get("record_sha256")
    validate_sha256(record_hash, "record_sha256")
    if record_hash != hashlib.sha256(canonical_json_bytes(record_without_hash(record))).hexdigest():
        raise ManifestError("approval record hash mismatch")

    manifest_created_at, manifest_expires_at = validate_manifest_times(content, now)
    approved_at = parse_time(record.get("approved_at"), "approved_at")
    approval_expires_at = parse_time(record.get("expires_at"), "expires_at")
    if approval_expires_at < approved_at:
        raise ManifestError("approval expires before approval rejected")
    if approval_expires_at == approved_at:
        raise ManifestError("zero-lifetime approval rejected")
    if approved_at < manifest_created_at:
        raise ManifestError("approval before manifest creation rejected")
    if approved_at > manifest_expires_at:
        raise ManifestError("approval after manifest expiry rejected")
    if approval_expires_at > manifest_expires_at:
        raise ManifestError("approval expiry beyond manifest expiry rejected")
    if now >= approval_expires_at:
        raise ManifestError("approval expired")
    if approved_at > now + MAX_CLOCK_SKEW:
        raise ManifestError("future approval timestamp rejected")

    return _validate_review_manifest_core(
        manifest,
        now=now,
        registry_snapshot=registry_snapshot,
    )


def _validate_synthetic_install_core(
    record: dict,
    manifest: dict,
    *,
    now: dt.datetime,
    registry_snapshot: RegistrySnapshot,
) -> dict[str, str]:
    result = _validate_approval_record_common_core(
        record,
        manifest,
        now=now,
        registry_snapshot=registry_snapshot,
    )
    if record.get("authn_context") != "interactive-synthetic":
        raise ManifestError("synthetic install requires interactive-synthetic authn_context")
    if record.get("synthetic_only") is not True:
        raise ManifestError("synthetic approval requires synthetic_only")
    if record.get("real_credentials_allowed") is not False:
        raise ManifestError("synthetic approval forbids real credentials")
    if record.get("production_profiles_allowed") is not False:
        raise ManifestError("synthetic approval forbids production profiles")
    return result


def validate_synthetic_install(
    record: dict,
    manifest: dict,
    *,
    now: dt.datetime | None = None,
) -> dict:
    require_artifact_pin_registry_ready()
    registry_snapshot = load_release_trust_anchor_registry()
    core_result = _validate_synthetic_install_core(
        record,
        manifest,
        now=now or utc_now(),
        registry_snapshot=registry_snapshot,
    )
    return _result_from_core(core_result, registry_snapshot, mode="synthetic-install")


def _validate_synthetic_install_for_test(
    record: dict,
    manifest: dict,
    *,
    now: dt.datetime,
    registry_snapshot: RegistrySnapshot,
) -> dict:
    core_result = _validate_synthetic_install_core(
        record,
        manifest,
        now=now,
        registry_snapshot=registry_snapshot,
    )
    return _test_result_from_core(core_result, registry_snapshot, mode="synthetic-install")


def validate_production_install(record: dict, manifest: dict, *, now: dt.datetime | None = None) -> None:
    raise ManifestError("BLOCKED_AUTHENTICATION_BACKEND_PENDING")


def print_json_result(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["template", "review", "synthetic-install", "production-install"])
    parser.add_argument("--json", action="store_true")
    parser.add_argument("manifest")
    parser.add_argument("--approval-record")
    args = parser.parse_args(argv)

    try:
        manifest = load_json(Path(args.manifest))
        if args.mode == "template":
            validate_template(manifest)
            result = {"result": "PASS", "mode": args.mode}
        elif args.mode == "review":
            result = validate_review_manifest(manifest)
        else:
            if not args.approval_record:
                raise ManifestError(f"{args.mode} mode requires --approval-record")
            record = load_json(Path(args.approval_record))
            if args.mode == "synthetic-install":
                result = validate_synthetic_install(record, manifest)
            else:
                validate_production_install(record, manifest)
                result = {"result": "PASS", "mode": args.mode}
    except ManifestError as error:
        if args.json:
            payload = {"result": "DENIED", "mode": args.mode, "reason": str(error)}
            try:
                registry_snapshot = load_release_trust_anchor_registry()
            except ManifestError:
                registry_snapshot = None
            if registry_snapshot:
                payload["trust_anchor_registry_sha256"] = registry_snapshot.raw_sha256
                payload["trust_anchor_registry_path"] = registry_snapshot.relative_path
                payload["trust_anchor_schema_version"] = registry_snapshot.schema_version
            print_json_result(payload)
            return 1
        raise SystemExit(str(error)) from error
    if args.json:
        print_json_result(result)
    else:
        print(f"installation manifest {args.mode} validation OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
