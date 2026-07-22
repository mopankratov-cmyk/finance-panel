import copy
import datetime as dt
import hashlib
import inspect
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from tools.validate_installation_manifest import (
    DEFAULT_TRUST_ANCHORS_PATH,
    ManifestError,
    RegistrySnapshot,
    TRUST_ANCHOR_REGISTRY_RELATIVE_PATH,
    _result_from_core,
    _validate_review_manifest_core,
    _validate_review_manifest_for_test,
    _validate_synthetic_install_core,
    _validate_synthetic_install_for_test,
    canonical_json_bytes,
    content_sha256,
    expected_owner_command_hash,
    load_json,
    load_release_trust_anchor_registry,
    load_artifact_pin_registry,
    require_artifact_pin_registry_evidence_binding,
    resolve_trusted_registry_path,
    trusted_registry_relative_path,
    validate_artifact_pin_registry,
    validate_release_trust_anchor_registry,
    validate_production_install,
    validate_review_manifest as public_validate_review_manifest,
    validate_synthetic_install as public_validate_synthetic_install,
    validate_template,
)


NOW = dt.datetime(2026, 7, 24, 12, 0, tzinfo=dt.timezone.utc)

TEST_TRUST_ANCHOR_REGISTRY = {
    "schema_version": "pankster.release-trust-anchors.v1",
    "entries": [
        {
            "backend": "apple-container-cli",
            "backend_version": "1.1.0",
            "artifact_role": "backend-installer",
            "repository": "apple/container",
            "release_tag": "1.1.0",
            "asset_name": "container-1.1.0-installer-signed.pkg",
            "verification_policy_id": "apple-container-installer-v1",
            "expected_signer_identity": "Developer ID Installer: Apple Inc. - Containerization (UPBK2H6LZM)",
            "expected_signer_team_id": "UPBK2H6LZM",
            "trust_anchor_source": "unit-test pinned trust anchor fixture",
            "source_status": "PINNED",
            "observed_at": "2026-07-22T00:00:00Z",
        }
    ],
}
TEST_TRUST_ANCHOR_REGISTRY_SHA256 = hashlib.sha256(
    json.dumps(TEST_TRUST_ANCHOR_REGISTRY, sort_keys=True, separators=(",", ":")).encode("utf-8")
).hexdigest()
TEST_REGISTRY_SNAPSHOT = RegistrySnapshot(
    anchors=validate_release_trust_anchor_registry(TEST_TRUST_ANCHOR_REGISTRY),
    relative_path="internal-test-registry",
    raw_sha256=TEST_TRUST_ANCHOR_REGISTRY_SHA256,
    schema_version="pankster.release-trust-anchors.v1",
    source_kind="TEST_FIXTURE",
)


def validate_review_manifest(manifest: dict, *, now: dt.datetime | None = None):
    return _validate_review_manifest_for_test(
        manifest,
        now=now or NOW,
        registry_snapshot=TEST_REGISTRY_SNAPSHOT,
    )


def validate_synthetic_install(record: dict, manifest: dict, *, now: dt.datetime | None = None):
    return _validate_synthetic_install_for_test(
        record,
        manifest,
        now=now or NOW,
        registry_snapshot=TEST_REGISTRY_SNAPSHOT,
    )


def _hash(seed: str) -> str:
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def _artifact(role: str) -> dict:
    name_by_role = {
        "backend-installer": "container-1.1.0-installer-signed.pkg",
        "linux-kernel": "kata-static-3.28.0-arm64.tar.zst",
        "init-filesystem": "ghcr.io-apple-containerization-vminit-sha256-04cd14f8e6ec9617611429aaf2a91a841b27ff9eae847acaca48430f58c5e57d.json",
        "synthetic-oci-manifest": "registry.k8s.io-pause-sha256-e50b7059b633caf3c1449b8da680d11845cda4506b513ee7a2de00725f0a34a7.json",
    }
    version_by_role = {
        "backend-installer": "1.1.0",
        "linux-kernel": "3.28.0+vmlinux-6.18.15-186",
        "init-filesystem": "0.35.0-linux-arm64",
        "synthetic-oci-manifest": "3.10-linux-arm64",
    }
    signature_type = "apple-signed-pkg" if role == "backend-installer" else "sha256-only"
    notarization = "required" if role == "backend-installer" else "not_applicable"
    artifact = {
        "role": role,
        "name": name_by_role[role],
        "version": version_by_role[role],
        "source_url": f"https://github.com/apple/container/releases/download/1.1.0/{name_by_role[role]}",
        "resolved_download_hosts": ["github.com", "release-assets.githubusercontent.com"],
        "sha256": _hash(role),
        "size_bytes": 12345,
        "signature_type": signature_type,
        "expected_signer_identity": (
            "Developer ID Installer: Apple Inc. - Containerization (UPBK2H6LZM)"
            if role == "backend-installer"
            else "Apple release checksum"
        ),
        "expected_signer_team_id": "UPBK2H6LZM" if role == "backend-installer" else "not_applicable",
        "notarization_requirement": notarization,
        "verification_policy_id": "apple-container-installer-v1" if role == "backend-installer" else "apple-container-release-asset-sha256-v1",
    }
    if role == "linux-kernel":
        artifact["source_url"] = "https://github.com/kata-containers/kata-containers/releases/download/3.28.0/kata-static-3.28.0-arm64.tar.zst"
    if role == "init-filesystem":
        artifact["source_url"] = (
            "https://ghcr.io/v2/apple/containerization/vminit/manifests/"
            "sha256:04cd14f8e6ec9617611429aaf2a91a841b27ff9eae847acaca48430f58c5e57d"
        )
        artifact["resolved_download_hosts"] = ["ghcr.io"]
        artifact["sha256"] = "04cd14f8e6ec9617611429aaf2a91a841b27ff9eae847acaca48430f58c5e57d"
        artifact["expected_signer_identity"] = "OCI manifest digest"
        artifact["verification_policy_id"] = "oci-manifest-sha256-v1"
    if role == "synthetic-oci-manifest":
        artifact["source_url"] = (
            "https://registry.k8s.io/v2/pause/manifests/"
            "sha256:e50b7059b633caf3c1449b8da680d11845cda4506b513ee7a2de00725f0a34a7"
        )
        artifact["resolved_download_hosts"] = ["registry.k8s.io", "europe-west3-docker.pkg.dev"]
        artifact["sha256"] = "e50b7059b633caf3c1449b8da680d11845cda4506b513ee7a2de00725f0a34a7"
        artifact["signature_type"] = "oci-digest"
        artifact["verification_policy_id"] = "oci-digest-pinned-v1"
        artifact["oci_digest"] = "sha256:e50b7059b633caf3c1449b8da680d11845cda4506b513ee7a2de00725f0a34a7"
    return artifact


def _lima_artifact(role: str) -> dict:
    sha_by_role = {
        "backend-installer": "bbdef91774885a0d05f7b048c4eb89ae2bcf3a0c252ae7ca7934e63df76d93c3",
        "release-checksums": "7da5160ee9b22de8eec4222e581334ee6326881e20d5aa8eb29b22f897312a5f",
        "lima-template": "abece69b9818b2b905d11bbeba84037dd6592d94fb3abdb58d01cb52c5e2f4e2",
        "guest-image": "7e938df669e3b1923595eeda97aa28569350c5283e05a835cc912a2486a54934",
    }
    artifact = {
        "role": role,
        "name": {
            "backend-installer": "lima-2.2.0-Darwin-arm64.tar.gz",
            "release-checksums": "SHA256SUMS",
            "lima-template": "ubuntu-24.04.yaml",
            "guest-image": "ubuntu-24.04-minimal-cloudimg-arm64.img",
        }[role],
        "version": {
            "backend-installer": "2.2.0",
            "release-checksums": "2.2.0",
            "lima-template": "v2.2.0",
            "guest-image": "24.04-noble-release-20260716",
        }[role],
        "source_url": {
            "backend-installer": "https://github.com/lima-vm/lima/releases/download/v2.2.0/lima-2.2.0-Darwin-arm64.tar.gz",
            "release-checksums": "https://github.com/lima-vm/lima/releases/download/v2.2.0/SHA256SUMS",
            "lima-template": "https://raw.githubusercontent.com/lima-vm/lima/v2.2.0/templates/_images/ubuntu-24.04.yaml",
            "guest-image": "https://cloud-images.ubuntu.com/minimal/releases/noble/release-20260716/ubuntu-24.04-minimal-cloudimg-arm64.img",
        }[role],
        "resolved_download_hosts": {
            "backend-installer": ["github.com", "release-assets.githubusercontent.com"],
            "release-checksums": ["github.com", "release-assets.githubusercontent.com"],
            "lima-template": ["raw.githubusercontent.com"],
            "guest-image": ["cloud-images.ubuntu.com"],
        }[role],
        "sha256": sha_by_role[role],
        "size_bytes": {
            "backend-installer": 37586365,
            "release-checksums": 1396,
            "lima-template": 3403,
            "guest-image": 227737600,
        }[role],
        "signature_type": "git-tagged-source-sha256" if role == "lima-template" else "sha256-only",
        "expected_signer_identity": {
            "backend-installer": "GitHub release asset SHA-256",
            "release-checksums": "GitHub release SHA256SUMS SHA-256",
            "lima-template": "Release-tagged Lima source SHA-256",
            "guest-image": "Ubuntu cloud image SHA-256 from Lima release-tagged template",
        }[role],
        "expected_signer_team_id": "not_applicable",
        "notarization_requirement": "not_applicable",
        "verification_policy_id": {
            "backend-installer": "lima-release-asset-sha256-v1",
            "release-checksums": "lima-sha256sums-sha256-v1",
            "lima-template": "lima-release-tagged-template-sha256-v1",
            "guest-image": "ubuntu-cloud-image-sha256-from-lima-template-v1",
        }[role],
    }
    return artifact


def _review_manifest() -> dict:
    content = {
        "approval_id": "p1b-20260722-validsynthetic",
        "backend": "apple-container-cli",
        "backend_version": "1.1.0",
        "artifacts": [
            _artifact("backend-installer"),
            _artifact("linux-kernel"),
            _artifact("init-filesystem"),
            _artifact("synthetic-oci-manifest"),
        ],
        "disk_changes": ["vendor documented installer paths"],
        "background_services": ["vendor documented service label"],
        "required_permissions": ["administrator password for signed installer"],
        "network_changes": ["preflight network policy disclosure pending"],
        "rollback_plan_hash": _hash("rollback"),
        "created_at": "2026-07-22T00:00:00Z",
        "expires_at": "2026-07-29T00:00:00Z",
    }
    return {
        "schema_version": "phase1b.installation-manifest.v2",
        "manifest_state": "READY_FOR_REVIEW",
        "manifest_content": content,
        "content_sha256": content_sha256(content),
    }


def _lima_review_manifest() -> dict:
    content = {
        "approval_id": "p1b-20260722-limavzc1",
        "backend": "lima-vz",
        "backend_version": "2.2.0",
        "artifacts": [
            _lima_artifact("backend-installer"),
            _lima_artifact("release-checksums"),
            _lima_artifact("lima-template"),
            _lima_artifact("guest-image"),
        ],
        "disk_changes": [
            "Extracts Lima archive to /Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0 only after explicit C1 approval"
        ],
        "background_services": ["NONE"],
        "required_permissions": ["NONE"],
        "network_changes": ["NONE"],
        "rollback_plan_hash": _hash("lima rollback"),
        "created_at": "2026-07-22T15:00:00Z",
        "expires_at": "2026-07-25T15:00:00Z",
    }
    return {
        "schema_version": "phase1b.installation-manifest.v2",
        "manifest_state": "READY_FOR_REVIEW",
        "manifest_content": content,
        "content_sha256": content_sha256(content),
    }


def _refresh(manifest: dict) -> dict:
    manifest["content_sha256"] = content_sha256(manifest["manifest_content"])
    return manifest


def _approval_record(
    manifest: dict,
    *,
    approved_at: str = "2026-07-23T00:00:00Z",
    expires_at: str = "2026-07-28T00:00:00Z",
    authn_context: str = "interactive-synthetic",
    synthetic_only=True,
    real_credentials_allowed=False,
    production_profiles_allowed=False,
    trust_anchor_registry_sha256: str = TEST_TRUST_ANCHOR_REGISTRY_SHA256,
) -> dict:
    record = {
        "approval_id": manifest["manifest_content"]["approval_id"],
        "manifest_content_sha256": manifest["content_sha256"],
        "trust_anchor_registry_sha256": trust_anchor_registry_sha256,
        "decision": "APPROVED",
        "approved_by": "owner:alice",
        "authorization_event_id": "hgate-12345678",
        "authorization_source": "pankster-human-gate",
        "authn_context": authn_context,
        "approved_at": approved_at,
        "expires_at": expires_at,
        "owner_command_hash": expected_owner_command_hash(
            manifest["manifest_content"]["approval_id"],
            manifest["content_sha256"],
            manifest["manifest_content"]["backend"],
        ),
        "synthetic_only": synthetic_only,
        "real_credentials_allowed": real_credentials_allowed,
        "production_profiles_allowed": production_profiles_allowed,
    }
    record["record_sha256"] = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    return record


def _record_refresh(record: dict) -> dict:
    record["record_sha256"] = hashlib.sha256(
        canonical_json_bytes({key: value for key, value in record.items() if key != "record_sha256"})
    ).hexdigest()
    return record


def _expect_error(callback, expected: str):
    try:
        callback()
    except ManifestError as error:
        assert expected in str(error), str(error)
    else:
        raise AssertionError(f"expected ManifestError containing {expected!r}")


def _load_raw_json(raw: str):
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as handle:
        handle.write(raw)
        path = Path(handle.name)
    try:
        return load_json(path)
    finally:
        path.unlink(missing_ok=True)


class InstallationManifestTests(unittest.TestCase):
    def test_manifest_001_template_accepted_only_in_template_mode(self):
        template = json.loads(Path("docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json").read_text())
        validate_template(template)
        _expect_error(lambda: validate_review_manifest(template, now=NOW), "READY_FOR_REVIEW")

    def test_manifest_002_template_rejected_in_review_mode(self):
        template = json.loads(Path("docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json").read_text())
        _expect_error(lambda: validate_review_manifest(template, now=NOW), "READY_FOR_REVIEW")

    def test_manifest_003_empty_version_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["backend_version"] = ""
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "empty string")

    def test_manifest_004_floating_version_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["backend_version"] = "latest"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "floating")

    def test_manifest_005_capitalized_latest_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["backend_version"] = "Latest"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "floating")

    def test_manifest_006_expired_chronology_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["expires_at"] = manifest["manifest_content"]["created_at"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "after created_at")

    def test_manifest_007_excessive_ttl_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["expires_at"] = "2026-08-01T00:00:01Z"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "at most 7 days")

    def test_manifest_008_placeholder_hash_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["sha256"] = "1" * 64
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "repeating-character")

    def test_manifest_009_invalid_host_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = "https://evil.invalid/pkg"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "host")

    def test_manifest_010_content_hash_mismatch_rejected(self):
        manifest = _review_manifest()
        manifest["content_sha256"] = _hash("wrong")
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "content hash mismatch")

    def test_manifest_011_missing_artifact_role_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"] = [
            artifact for artifact in manifest["manifest_content"]["artifacts"] if artifact["role"] != "linux-kernel"
        ]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "missing artifact role")

    def test_manifest_012_approved_state_without_record_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_state"] = "APPROVED"
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "READY_FOR_REVIEW")

    def test_manifest_013_approval_hash_mismatch_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest)
        record["manifest_content_sha256"] = _hash("mismatch")
        _record_refresh(record)
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "hash mismatch")

    def test_manifest_014_expired_approval_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest, approved_at="2026-07-22T01:00:00Z", expires_at="2026-07-23T00:00:00Z")
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "approval expired")

    def test_manifest_015_valid_synthetic_review_manifest_accepted(self):
        validate_review_manifest(_review_manifest(), now=NOW)

    def test_manifest_016_unknown_envelope_field_rejected(self):
        manifest = _review_manifest()
        manifest["extra"] = "nope"
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "unknown field")

    def test_manifest_017_unknown_content_field_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["extra"] = "nope"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "unknown field")

    def test_manifest_018_unknown_artifact_field_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["extra"] = "nope"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "unknown field")

    def test_manifest_019_unknown_approval_record_field_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest)
        record["extra"] = "nope"
        _record_refresh(record)
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "unknown field")

    def test_manifest_020_duplicate_artifact_role_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][1] = copy.deepcopy(manifest["manifest_content"]["artifacts"][0])
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "duplicate artifact role")

    def test_manifest_021_exact_apple_role_cardinality_enforced(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"].append(_artifact("linux-kernel"))
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "duplicate artifact role")

    def test_manifest_022_incomplete_lima_manifest_rejected(self):
        manifest = _lima_review_manifest()
        manifest["manifest_content"]["artifacts"] = [
            artifact for artifact in manifest["manifest_content"]["artifacts"] if artifact["role"] != "guest-image"
        ]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "missing artifact role")

    def test_manifest_023_installer_version_mismatch_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["version"] = "1.1.1"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "installer version mismatch")

    def test_manifest_024_wrong_github_repository_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com/evil/container/releases/download/1.1.0/container-1.1.0-installer-signed.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "wrong GitHub repository")

    def test_manifest_025_wrong_release_tag_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com/apple/container/releases/download/1.1.1/container-1.1.0-installer-signed.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "wrong release tag")

    def test_manifest_026_asset_basename_mismatch_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com/apple/container/releases/download/1.1.0/different.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "asset basename mismatch")

    def test_manifest_027_url_userinfo_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://user:pass@github.com/apple/container/releases/download/1.1.0/container-1.1.0-installer-signed.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "URL userinfo")

    def test_manifest_028_url_query_or_fragment_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com/apple/container/releases/download/1.1.0/container-1.1.0-installer-signed.pkg?download=1"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "query or fragment")

    def test_manifest_029_source_host_must_be_declared(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["resolved_download_hosts"] = ["release-assets.githubusercontent.com"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "source host must be declared")

    def test_manifest_030_floating_artifact_version_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][1]["version"] = "latest"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "floating")

    def test_manifest_031_oci_artifact_without_digest_rejected(self):
        manifest = _review_manifest()
        del manifest["manifest_content"]["artifacts"][3]["oci_digest"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "OCI artifact without digest")

    def test_manifest_032_arbitrary_owner_command_hash_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest)
        record["owner_command_hash"] = _hash("arbitrary but wrong")
        _record_refresh(record)
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "owner command hash mismatch")

    def test_manifest_033_exact_owner_command_hash_accepted(self):
        manifest = _review_manifest()
        record = _approval_record(manifest)
        validate_synthetic_install(record, manifest, now=NOW)

    def test_manifest_034_expired_manifest_rejected(self):
        manifest = _review_manifest()
        _expect_error(
            lambda: validate_review_manifest(manifest, now=dt.datetime(2026, 7, 30, tzinfo=dt.timezone.utc)),
            "expired manifest",
        )

    def test_manifest_035_approval_after_manifest_expiry_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest, approved_at="2026-07-30T00:00:00Z", expires_at="2026-07-30T01:00:00Z")
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "approval after manifest expiry")

    def test_manifest_036_approval_expiry_beyond_manifest_expiry_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest, expires_at="2026-07-30T00:00:00Z")
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "approval expiry beyond manifest expiry")

    def test_manifest_037_future_approval_timestamp_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest, approved_at="2026-07-24T12:06:00Z", expires_at="2026-07-28T00:00:00Z")
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "future approval timestamp")

    def test_manifest_038_approval_before_manifest_creation_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest, approved_at="2026-07-21T23:59:59Z", expires_at="2026-07-28T00:00:00Z")
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "approval before manifest creation")

    def test_manifest_039_approval_expires_before_approval_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest, approved_at="2026-07-23T00:00:00Z", expires_at="2026-07-22T23:59:59Z")
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "expires before approval")

    def test_manifest_040_zero_lifetime_approval_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest, approved_at="2026-07-23T00:00:00Z", expires_at="2026-07-23T00:00:00Z")
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "zero-lifetime")

    def test_manifest_041_positive_authorization_lifetime_accepted(self):
        manifest = _review_manifest()
        record = _approval_record(manifest, approved_at="2026-07-23T00:00:00Z", expires_at="2026-07-23T00:00:01Z")
        validate_synthetic_install(record, manifest, now=dt.datetime(2026, 7, 23, 0, 0, tzinfo=dt.timezone.utc))

    def test_manifest_042_critical_list_field_wrong_type_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["disk_changes"] = "not-a-list"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "expected list")

    def test_manifest_043_empty_required_list_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["required_permissions"] = []
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "empty required list")

    def test_manifest_044_empty_list_item_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["network_changes"] = [""]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "empty string")

    def test_manifest_045_control_character_in_list_item_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["disk_changes"] = ["bad\nvalue"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "control character")

    def test_manifest_046_explicit_none_marker_accepted_where_allowed(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["network_changes"] = ["NONE"]
        _refresh(manifest)
        validate_review_manifest(manifest, now=NOW)

    def test_manifest_047_placeholder_approved_by_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest)
        record["approved_by"] = "TO_BE_PINNED"
        _record_refresh(record)
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "placeholder")

    def test_manifest_048_placeholder_authorization_event_id_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest)
        record["authorization_event_id"] = "hgate-to-be-pinned"
        _record_refresh(record)
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "placeholder")

    def test_manifest_049_control_characters_in_provenance_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest)
        record["authn_context"] = "interactive-synthe\ntic"
        _record_refresh(record)
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "control character")

    def test_manifest_050_invalid_provenance_identifier_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest)
        record["approved_by"] = "alice"
        _record_refresh(record)
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "invalid provenance identifier")

    def test_manifest_051_production_install_blocked_while_auth_backend_pending(self):
        manifest = _review_manifest()
        record = _approval_record(manifest)
        _expect_error(lambda: validate_production_install(record, manifest, now=NOW), "BLOCKED_AUTHENTICATION_BACKEND_PENDING")

    def test_manifest_052_synthetic_approval_requires_synthetic_only(self):
        manifest = _review_manifest()
        record = _approval_record(manifest, synthetic_only=False)
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "requires synthetic_only")

    def test_manifest_053_synthetic_approval_forbids_real_credentials(self):
        manifest = _review_manifest()
        record = _approval_record(manifest, real_credentials_allowed=True)
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "forbids real credentials")

    def test_manifest_054_synthetic_approval_forbids_production_profiles(self):
        manifest = _review_manifest()
        record = _approval_record(manifest, production_profiles_allowed=True)
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "forbids production profiles")

    def test_manifest_055_synthetic_approval_with_exact_owner_command_accepted(self):
        manifest = _review_manifest()
        record = _approval_record(manifest)
        validate_synthetic_install(record, manifest, now=NOW)

    def test_manifest_056_nested_release_path_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com/apple/container/releases/download/1.1.0/nested/container-1.1.0-installer-signed.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "six-segment")

    def test_manifest_057_encoded_slash_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com/apple/container/releases/download/1.1.0/container%2F1.1.0.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "encoded slash")

    def test_manifest_058_encoded_backslash_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com/apple/container/releases/download/1.1.0/container%5C1.1.0.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "encoded backslash")

    def test_manifest_059_dot_segment_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com/apple/container/releases/download/1.1.0/./container-1.1.0-installer-signed.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "dot segment")

    def test_manifest_060_exact_six_segment_release_url_accepted(self):
        validate_review_manifest(_review_manifest(), now=NOW)

    def test_manifest_061_bool_size_bytes_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["size_bytes"] = True
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "invalid size_bytes")

    def test_manifest_062_duplicate_envelope_json_key_rejected(self):
        _expect_error(lambda: _load_raw_json('{"schema_version":"a","schema_version":"b"}'), "duplicate JSON key")

    def test_manifest_063_duplicate_content_json_key_rejected(self):
        raw = '{"manifest_content":{"approval_id":"a","approval_id":"b"}}'
        _expect_error(lambda: _load_raw_json(raw), "duplicate JSON key")

    def test_manifest_064_duplicate_artifact_json_key_rejected(self):
        raw = '{"manifest_content":{"artifacts":[{"role":"a","role":"b"}]}}'
        _expect_error(lambda: _load_raw_json(raw), "duplicate JSON key")

    def test_manifest_065_duplicate_approval_json_key_rejected(self):
        _expect_error(lambda: _load_raw_json('{"approval_id":"a","approval_id":"b"}'), "duplicate JSON key")

    def test_manifest_066_apple_disk_changes_cannot_be_none(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["disk_changes"] = ["NONE"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "NONE marker not allowed")

    def test_manifest_067_apple_background_services_cannot_be_none(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["background_services"] = ["NONE"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "NONE marker not allowed")

    def test_manifest_068_apple_permissions_cannot_be_none(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["required_permissions"] = ["NONE"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "NONE marker not allowed")

    def test_manifest_069_apple_preflight_network_changes_may_be_none(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["network_changes"] = ["NONE"]
        _refresh(manifest)
        validate_review_manifest(manifest, now=NOW)

    def test_manifest_070_del_character_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["disk_changes"] = ["bad\u007fvalue"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "forbidden unicode")

    def test_manifest_071_c1_control_character_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["required_permissions"] = ["bad\u0085value"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "forbidden unicode")

    def test_manifest_072_zero_width_character_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][1]["version"] = "kernel-1.1.0\u200b-build1"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "forbidden unicode")

    def test_manifest_073_bidirectional_override_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_identity"] = "Developer ID Installer: Apple\u202e Inc."
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "forbidden unicode")

    def test_manifest_074_encoded_del_in_release_url_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com/apple/container/releases/download/1.1.0/container-1.1.0%7F.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "percent-encoding")

    def test_manifest_075_future_manifest_creation_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["created_at"] = "2026-07-24T12:06:00Z"
        manifest["manifest_content"]["expires_at"] = "2026-07-29T00:00:00Z"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "future manifest timestamp")

    def test_manifest_076_creation_within_clock_skew_accepted(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["created_at"] = "2026-07-24T12:05:00Z"
        manifest["manifest_content"]["expires_at"] = "2026-07-29T00:00:00Z"
        _refresh(manifest)
        validate_review_manifest(manifest, now=NOW)

    def test_manifest_077_unknown_verification_policy_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["verification_policy_id"] = "weak-custom-policy"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "unknown verification policy")

    def test_manifest_078_apple_installer_requires_signer_identity(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_identity"] = ""
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "empty string")

    def test_manifest_079_apple_installer_requires_team_identifier(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_team_id"] = ""
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "empty string")

    def test_manifest_080_weak_free_text_verification_method_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["verification_method"] = "check it manually"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "unknown field")

    def test_manifest_081_correct_role_specific_verification_policy_accepted(self):
        validate_review_manifest(_review_manifest(), now=NOW)

    def test_manifest_082_duplicate_critical_list_item_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["disk_changes"] = ["same", "same"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "duplicate list item")

    def test_manifest_083_unicode_normalized_duplicate_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["network_changes"] = ["Cafe\u0301", "Café"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "duplicate list item")

    def test_manifest_084_explicit_https_port_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com:443/apple/container/releases/download/1.1.0/container-1.1.0-installer-signed.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "explicit port")

    def test_manifest_085_nonstandard_port_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com:444/apple/container/releases/download/1.1.0/container-1.1.0-installer-signed.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "explicit port")

    def test_manifest_086_encoded_repository_owner_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com/%61pple/container/releases/download/1.1.0/container-1.1.0-installer-signed.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "percent-encoding")

    def test_manifest_087_encoded_repository_name_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com/apple/cont%61iner/releases/download/1.1.0/container-1.1.0-installer-signed.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "percent-encoding")

    def test_manifest_088_encoded_release_tag_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com/apple/container/releases/download/1%2e1%2e0/container-1.1.0-installer-signed.pkg"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "percent-encoding")

    def test_manifest_089_canonical_unencoded_release_url_accepted(self):
        validate_review_manifest(_review_manifest(), now=NOW)

    def test_manifest_090_installer_signer_not_applicable_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_identity"] = "not_applicable"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "not_applicable")

    def test_manifest_091_invalid_apple_signer_identity_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_identity"] = "Apple Inc."
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "invalid Apple signer identity")

    def test_manifest_092_invalid_apple_team_id_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_team_id"] = "FAKE"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "invalid Apple Team ID")
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_team_id"] = "AAAAAAAAAA"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "invalid Apple Team ID")

    def test_manifest_093_valid_apple_signer_format_accepted(self):
        validate_review_manifest(_review_manifest(), now=NOW)

    def test_manifest_094_lowercase_none_disclosure_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["disk_changes"] = ["none"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "ambiguous absence marker")

    def test_manifest_095_na_disclosure_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["required_permissions"] = ["N/A"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "ambiguous absence marker")

    def test_manifest_096_not_applicable_disclosure_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["background_services"] = ["not applicable"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "ambiguous absence marker")

    def test_manifest_097_unknown_disclosure_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["network_changes"] = ["unknown"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "ambiguous absence marker")

    def test_manifest_098_canonical_network_none_accepted_alone(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["network_changes"] = ["NONE"]
        _refresh(manifest)
        validate_review_manifest(manifest, now=NOW)

    def test_manifest_099_none_mixed_with_another_value_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["network_changes"] = ["NONE", "preflight host egress disclosure"]
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "NONE marker must be the only item")

    def test_manifest_100_unknown_signer_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_identity"] = "Developer ID Installer: Unknown"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "generic Apple signer suffix")

    def test_manifest_101_unsigned_signer_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_identity"] = "Developer ID Installer: Unsigned"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "generic Apple signer suffix")

    def test_manifest_102_fake_signer_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_identity"] = "Developer ID Installer: Fake"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "generic Apple signer suffix")

    def test_manifest_103_generic_signer_suffix_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_identity"] = "Developer ID Installer: Any Signer"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "generic Apple signer suffix")

    def test_manifest_104_fake_looking_team_id_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_team_id"] = "FAKE123456"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "invalid Apple Team ID")

    def test_manifest_105_team_id_trust_anchor_mismatch_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_team_id"] = "Z9Y8X7W6V5"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "RELEASE_TRUST_ANCHOR_MISMATCH")

    def test_manifest_106_exact_pinned_team_id_accepted(self):
        validate_review_manifest(_review_manifest(), now=NOW)

    def test_manifest_107_valid_looking_unpinned_signer_rejected(self):
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_identity"] = "Developer ID Installer: Other Vendor Inc."
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "RELEASE_TRUST_ANCHOR_MISMATCH")

    def test_manifest_108_missing_pinned_trust_anchor_rejected(self):
        manifest = _review_manifest()
        snapshot = RegistrySnapshot(
            anchors={},
            relative_path="internal-test-registry",
            raw_sha256=TEST_TRUST_ANCHOR_REGISTRY_SHA256,
            schema_version="pankster.release-trust-anchors.v1",
            source_kind="TEST_FIXTURE",
        )
        _expect_error(
            lambda: _validate_review_manifest_for_test(manifest, now=NOW, registry_snapshot=snapshot),
            "RELEASE_TRUST_ANCHOR_NOT_PINNED",
        )

    def test_trust_anchor_duplicate_entries_rejected(self):
        registry = copy.deepcopy(TEST_TRUST_ANCHOR_REGISTRY)
        registry["entries"].append(copy.deepcopy(registry["entries"][0]))
        _expect_error(lambda: validate_release_trust_anchor_registry(registry), "duplicate entry")

    def test_trust_anchor_pinned_placeholder_rejected(self):
        registry = copy.deepcopy(TEST_TRUST_ANCHOR_REGISTRY)
        registry["entries"][0]["expected_signer_identity"] = "TO_BE_PINNED"
        _expect_error(lambda: validate_release_trust_anchor_registry(registry), "placeholder")

    def test_trust_anchor_draft_registry_accepted(self):
        registry = copy.deepcopy(TEST_TRUST_ANCHOR_REGISTRY)
        registry["entries"][0]["source_status"] = "DRAFT"
        registry["entries"][0]["expected_signer_identity"] = "TO_BE_PINNED"
        registry["entries"][0]["expected_signer_team_id"] = "TO_BE_PINNED"
        validate_release_trust_anchor_registry(registry)

    def _write_attacker_registry(self, directory: Path) -> None:
        attacker_registry = copy.deepcopy(TEST_TRUST_ANCHOR_REGISTRY)
        attacker_registry["entries"][0]["expected_signer_identity"] = "Developer ID Installer: Evil Corp"
        attacker_registry["entries"][0]["expected_signer_team_id"] = "EVIL123456"
        attacker_registry["entries"][0]["trust_anchor_source"] = "attacker cwd registry"
        registry_path = directory / TRUST_ANCHOR_REGISTRY_RELATIVE_PATH
        registry_path.parent.mkdir(parents=True)
        registry_path.write_text(json.dumps(attacker_registry), encoding="utf-8")

    def test_manifest_109_malicious_cwd_registry_ignored(self):
        with tempfile.TemporaryDirectory() as temp:
            tempdir = Path(temp)
            self._write_attacker_registry(tempdir)
            manifest_path = tempdir / "manifest.json"
            manifest_path.write_text(json.dumps(_review_manifest()), encoding="utf-8")
            command = [
                "python3",
                str(Path("tools/validate_installation_manifest.py").resolve()),
                "--mode",
                "review",
                "--json",
                str(manifest_path),
            ]
            result = subprocess.run(command, cwd=tempdir, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            self.assertEqual(result.returncode, 0)
            self.assertIn('"result":"PASS"', result.stdout)
            self.assertNotIn(str(tempdir), result.stdout)

    def test_manifest_110_review_cannot_use_cwd_controlled_pinned_anchor(self):
        with tempfile.TemporaryDirectory() as temp:
            tempdir = Path(temp)
            self._write_attacker_registry(tempdir)
            manifest_path = tempdir / "manifest.json"
            manifest = _review_manifest()
            manifest["manifest_content"]["artifacts"][0]["expected_signer_identity"] = "Developer ID Installer: Evil Corp"
            manifest["manifest_content"]["artifacts"][0]["expected_signer_team_id"] = "EVIL123456"
            _refresh(manifest)
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            result = subprocess.run(
                [
                    "python3",
                    str(Path("tools/validate_installation_manifest.py").resolve()),
                    "--mode",
                    "review",
                    "--json",
                    str(manifest_path),
                ],
                cwd=tempdir,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("RELEASE_TRUST_ANCHOR_MISMATCH", result.stdout)
            self.assertNotIn('"result":"PASS"', result.stdout)

    def test_manifest_111_synthetic_install_cannot_use_cwd_controlled_pinned_anchor(self):
        snapshot = load_release_trust_anchor_registry()
        with tempfile.TemporaryDirectory() as temp:
            tempdir = Path(temp)
            self._write_attacker_registry(tempdir)
            manifest = _review_manifest()
            record = _approval_record(
                manifest,
                approved_at="2026-07-22T00:00:00Z",
                trust_anchor_registry_sha256=snapshot.raw_sha256,
            )
            manifest_path = tempdir / "manifest.json"
            approval_path = tempdir / "approval.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            approval_path.write_text(json.dumps(record), encoding="utf-8")
            result = subprocess.run(
                [
                    "python3",
                    str(Path("tools/validate_installation_manifest.py").resolve()),
                    "--mode",
                    "synthetic-install",
                    "--json",
                    str(manifest_path),
                    "--approval-record",
                    str(approval_path),
                ],
                cwd=tempdir,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            self.assertEqual(result.returncode, 0)
            self.assertIn('"result":"PASS"', result.stdout)

    def test_manifest_112_committed_registry_path_is_canonical(self):
        path = resolve_trusted_registry_path()
        self.assertTrue(path.is_absolute())
        self.assertEqual(path.resolve(), DEFAULT_TRUST_ANCHORS_PATH.resolve())
        self.assertEqual(trusted_registry_relative_path(path), TRUST_ANCHOR_REGISTRY_RELATIVE_PATH.as_posix())

    def test_manifest_113_registry_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            real_security = root / "real-security"
            real_security.mkdir(parents=True)
            (root / "docs").mkdir()
            (root / "docs" / "security").symlink_to(real_security, target_is_directory=True)
            registry_path = root / TRUST_ANCHOR_REGISTRY_RELATIVE_PATH
            _expect_error(
                lambda: resolve_trusted_registry_path(registry_path, project_root=root),
                "TRUST_ANCHOR_REGISTRY_SYMLINK_REJECTED",
            )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "target.json"
            target.write_text("{}", encoding="utf-8")
            (root / "docs" / "security").mkdir(parents=True)
            registry_path = root / TRUST_ANCHOR_REGISTRY_RELATIVE_PATH
            registry_path.symlink_to(target)
            _expect_error(
                lambda: resolve_trusted_registry_path(registry_path, project_root=root),
                "TRUST_ANCHOR_REGISTRY_SYMLINK_REJECTED",
            )

    def test_manifest_114_registry_hash_mismatch_rejected(self):
        manifest = _review_manifest()
        record = _approval_record(manifest, trust_anchor_registry_sha256=_hash("wrong-registry"))
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "TRUST_ANCHOR_REGISTRY_HASH_MISMATCH")

    def test_manifest_115_exact_committed_registry_hash_accepted(self):
        committed_snapshot = load_release_trust_anchor_registry()
        test_snapshot = RegistrySnapshot(
            anchors=TEST_REGISTRY_SNAPSHOT.anchors,
            relative_path=committed_snapshot.relative_path,
            raw_sha256=committed_snapshot.raw_sha256,
            schema_version=committed_snapshot.schema_version,
            source_kind="TEST_FIXTURE",
        )
        manifest = _review_manifest()
        record = _approval_record(manifest, trust_anchor_registry_sha256=committed_snapshot.raw_sha256)
        result = _validate_synthetic_install_for_test(
            record,
            manifest,
            now=NOW,
            registry_snapshot=test_snapshot,
        )
        self.assertEqual(result["result"], "TEST_ONLY_PASS")

    def _attacker_snapshot(self) -> RegistrySnapshot:
        attacker_registry = copy.deepcopy(TEST_TRUST_ANCHOR_REGISTRY)
        attacker_registry["entries"][0]["expected_signer_identity"] = "Developer ID Installer: Evil Corp"
        attacker_registry["entries"][0]["expected_signer_team_id"] = "EVIL123456"
        attacker_registry["entries"][0]["trust_anchor_source"] = "attacker pinned fixture"
        return RegistrySnapshot(
            anchors=validate_release_trust_anchor_registry(attacker_registry),
            relative_path="attacker.json",
            raw_sha256="ab" * 32,
            schema_version="pankster.release-trust-anchors.v1",
            source_kind="TEST_FIXTURE",
        )

    def _attacker_manifest(self) -> dict:
        manifest = _review_manifest()
        manifest["manifest_content"]["artifacts"][0]["expected_signer_identity"] = "Developer ID Installer: Evil Corp"
        manifest["manifest_content"]["artifacts"][0]["expected_signer_team_id"] = "EVIL123456"
        _refresh(manifest)
        return manifest

    def test_manifest_116_public_review_api_rejects_registry_injection(self):
        signature = inspect.signature(public_validate_review_manifest)
        self.assertNotIn("trust_anchors", signature.parameters)
        self.assertNotIn("trust_anchor_registry_metadata", signature.parameters)
        self.assertNotIn("registry_snapshot", signature.parameters)
        self.assertNotIn("registry_path", signature.parameters)
        with self.assertRaises(TypeError):
            public_validate_review_manifest(_review_manifest(), now=NOW, registry_snapshot=TEST_REGISTRY_SNAPSHOT)

    def test_manifest_117_public_synthetic_api_rejects_registry_injection(self):
        signature = inspect.signature(public_validate_synthetic_install)
        self.assertNotIn("trust_anchors", signature.parameters)
        self.assertNotIn("trust_anchor_registry_metadata", signature.parameters)
        self.assertNotIn("registry_snapshot", signature.parameters)
        self.assertNotIn("registry_path", signature.parameters)
        with self.assertRaises(TypeError):
            public_validate_synthetic_install(
                _approval_record(_review_manifest()),
                _review_manifest(),
                now=NOW,
                registry_snapshot=TEST_REGISTRY_SNAPSHOT,
            )

    def test_manifest_118_test_fixture_cannot_produce_operational_pass(self):
        result = _validate_review_manifest_for_test(
            _review_manifest(),
            now=NOW,
            registry_snapshot=TEST_REGISTRY_SNAPSHOT,
        )
        self.assertEqual(result["result"], "TEST_ONLY_PASS")
        self.assertNotEqual(result["result"], "PASS")

    def test_manifest_119_test_fixture_result_marked_non_authoritative(self):
        result = _validate_review_manifest_for_test(
            _review_manifest(),
            now=NOW,
            registry_snapshot=TEST_REGISTRY_SNAPSHOT,
        )
        self.assertFalse(result["authoritative"])
        self.assertEqual(result["registry_source_kind"], "TEST_FIXTURE")

    def test_manifest_120_public_api_always_loads_committed_registry(self):
        result = public_validate_review_manifest(_review_manifest(), now=NOW)
        self.assertEqual(result["result"], "PASS")
        self.assertTrue(result["authoritative"])

    def test_manifest_121_synthetic_approval_cannot_bind_attacker_metadata(self):
        manifest = self._attacker_manifest()
        record = _approval_record(manifest, trust_anchor_registry_sha256="ab" * 32)
        _expect_error(
            lambda: public_validate_synthetic_install(record, manifest, now=NOW),
            "TRUST_ANCHOR_REGISTRY_HASH_MISMATCH",
        )

    def test_manifest_122_cli_and_public_api_use_identical_registry_digest(self):
        snapshot = load_release_trust_anchor_registry()
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as handle:
            json.dump(_review_manifest(), handle)
            manifest_path = Path(handle.name)
        try:
            result = subprocess.run(
                [
                    "python3",
                    str(Path("tools/validate_installation_manifest.py").resolve()),
                    "--mode",
                    "review",
                    "--json",
                    str(manifest_path),
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            payload = json.loads(result.stdout)
            self.assertEqual(payload["trust_anchor_registry_sha256"], snapshot.raw_sha256)
            self.assertEqual(payload["trust_anchor_registry_path"], snapshot.relative_path)
        finally:
            manifest_path.unlink(missing_ok=True)

    def test_manifest_123_private_core_is_not_operational_authorization(self):
        attacker_snapshot = self._attacker_snapshot()
        core_result = _validate_review_manifest_core(
            self._attacker_manifest(),
            now=NOW,
            registry_snapshot=attacker_snapshot,
        )
        self.assertNotIn("result", core_result)
        _expect_error(
            lambda: _result_from_core(core_result, attacker_snapshot, mode="review"),
            "NON_AUTHORITATIVE_TRUST_REGISTRY",
        )

    def test_manifest_124_valid_lima_review_manifest_accepted(self):
        result = validate_review_manifest(_lima_review_manifest(), now=NOW)
        self.assertEqual(result["result"], "TEST_ONLY_PASS")
        self.assertEqual(result["trust_anchor_status"], "NOT_APPLICABLE")

    def test_manifest_125_lima_backend_version_rejects_v_prefix(self):
        manifest = _lima_review_manifest()
        manifest["manifest_content"]["backend_version"] = "v2.2.0"
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "strict semver")

    def test_manifest_126_lima_installer_wrong_release_tag_rejected(self):
        manifest = _lima_review_manifest()
        manifest["manifest_content"]["artifacts"][0]["source_url"] = (
            "https://github.com/lima-vm/lima/releases/download/v2.2.1/lima-2.2.0-Darwin-arm64.tar.gz"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "wrong release tag")

    def test_manifest_127_lima_guest_image_mutable_release_url_rejected(self):
        manifest = _lima_review_manifest()
        manifest["manifest_content"]["artifacts"][3]["source_url"] = (
            "https://cloud-images.ubuntu.com/minimal/releases/noble/release/ubuntu-24.04-minimal-cloudimg-arm64.img"
        )
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "pinned Ubuntu guest image path mismatch")

    def test_manifest_128_lima_additional_guestagents_not_allowed(self):
        manifest = _lima_review_manifest()
        guestagents = _lima_artifact("backend-installer")
        guestagents["role"] = "additional-guestagents"
        guestagents["name"] = "lima-additional-guestagents-2.2.0-Darwin-arm64.tar.gz"
        guestagents["source_url"] = (
            "https://github.com/lima-vm/lima/releases/download/v2.2.0/"
            "lima-additional-guestagents-2.2.0-Darwin-arm64.tar.gz"
        )
        manifest["manifest_content"]["artifacts"].append(guestagents)
        _refresh(manifest)
        _expect_error(lambda: validate_review_manifest(manifest, now=NOW), "unknown artifact role")

    def test_manifest_129_lima_synthetic_install_requires_fallback_owner_command(self):
        manifest = _lima_review_manifest()
        record = _approval_record(manifest, approved_at="2026-07-23T00:00:00Z", expires_at="2026-07-25T00:00:00Z")
        validate_synthetic_install(record, manifest, now=NOW)
        record["owner_command_hash"] = expected_owner_command_hash(
            manifest["manifest_content"]["approval_id"],
            manifest["content_sha256"],
        )
        _record_refresh(record)
        _expect_error(lambda: validate_synthetic_install(record, manifest, now=NOW), "owner command hash mismatch")


class Phase1BB0PinningTests(unittest.TestCase):
    def _ready_manifest(self) -> dict:
        return json.loads(Path("docs/program/PHASE_1B_INSTALLATION_MANIFEST.ready.json").read_text())

    def _artifact(self, role: str) -> dict:
        for artifact in self._ready_manifest()["manifest_content"]["artifacts"]:
            if artifact["role"] == role:
                return artifact
        raise AssertionError(f"missing role {role}")

    def test_pin_001_canonical_release_url(self):
        artifact = self._artifact("backend-installer")
        self.assertEqual(
            artifact["source_url"],
            "https://github.com/apple/container/releases/download/1.1.0/container-1.1.0-installer-signed.pkg",
        )

    def test_pin_002_redirect_hosts_allowlisted(self):
        manifest = self._ready_manifest()
        allowed = {
            "github.com",
            "objects.githubusercontent.com",
            "release-assets.githubusercontent.com",
            "ghcr.io",
            "registry.k8s.io",
            "europe-west3-docker.pkg.dev",
        }
        for artifact in manifest["manifest_content"]["artifacts"]:
            self.assertLessEqual(set(artifact["resolved_download_hosts"]), allowed)

    def test_pin_003_download_size_matches(self):
        artifact = self._artifact("backend-installer")
        self.assertEqual(artifact["size_bytes"], 89471042)

    def test_pin_004_package_sha256_recorded(self):
        self.assertEqual(
            self._artifact("backend-installer")["sha256"],
            "0ca1c42a2269c2557efb1d82b1b38ac553e6a3a3da1b1179c439bcee1e7d6714",
        )

    def test_pin_005_package_signature_valid(self):
        evidence = json.loads(Path("security/evidence/phase-1b-b0/package-signature-evidence.json").read_text())
        self.assertEqual(evidence["pkgutil_exit_status"], 0)
        self.assertIn("signed by a developer certificate", evidence["signature_status"])

    def test_pin_006_exact_signer_extracted(self):
        self.assertEqual(
            self._artifact("backend-installer")["expected_signer_identity"],
            "Developer ID Installer: Apple Inc. - Containerization (UPBK2H6LZM)",
        )

    def test_pin_007_exact_team_id_extracted(self):
        self.assertEqual(self._artifact("backend-installer")["expected_signer_team_id"], "UPBK2H6LZM")

    def test_pin_008_notarization_accepted(self):
        evidence = json.loads(Path("security/evidence/phase-1b-b0/package-notarization-evidence.json").read_text())
        self.assertEqual(evidence["spctl_exit_status"], 0)
        self.assertEqual(evidence["assessment"], "accepted")

    def test_pin_009_package_version_matches(self):
        evidence = json.loads(Path("security/evidence/phase-1b-b0/package-signature-evidence.json").read_text())
        self.assertEqual(evidence["package_version"], "1.1.0")
        self.assertEqual(self._ready_manifest()["manifest_content"]["backend_version"], "1.1.0")

    def test_pin_010_trust_anchor_becomes_pinned(self):
        registry = json.loads(Path("docs/security/apple_container_release_trust_anchors.json").read_text())
        self.assertEqual(registry["entries"][0]["source_status"], "PINNED")

    def test_pin_011_kernel_artifact_pinned(self):
        artifact = self._artifact("linux-kernel")
        self.assertEqual(artifact["sha256"], "f63d54507d1f18635d94475077e4c2330de4d8e05cedf25f7c38f063b0e66a91")
        self.assertEqual(artifact["size_bytes"], 596775193)
        self.assertNotIn("latest", artifact["source_url"])

    def test_pin_012_init_filesystem_pinned(self):
        artifact = self._artifact("init-filesystem")
        self.assertEqual(artifact["sha256"], "04cd14f8e6ec9617611429aaf2a91a841b27ff9eae847acaca48430f58c5e57d")
        self.assertEqual(artifact["source_url"].split("/")[-1], f"sha256:{artifact['sha256']}")

    def test_pin_013_oci_manifest_digest_pinned(self):
        artifact = self._artifact("synthetic-oci-manifest")
        self.assertEqual(
            artifact["oci_digest"],
            "sha256:e50b7059b633caf3c1449b8da680d11845cda4506b513ee7a2de00725f0a34a7",
        )

    def test_pin_014_no_placeholders(self):
        raw = Path("docs/program/PHASE_1B_INSTALLATION_MANIFEST.ready.json").read_text()
        for marker in ("TO_BE_PINNED", "example.invalid", "TBD"):
            self.assertNotIn(marker, raw)

    def test_pin_015_manifest_review_passes_after_kata_inspected(self):
        result = public_validate_review_manifest(self._ready_manifest(), now=NOW)
        self.assertEqual(result["result"], "PASS")
        self.assertTrue(result["authoritative"])

    def test_pin_016_manifest_ttl_at_most_72h(self):
        content = self._ready_manifest()["manifest_content"]
        created = dt.datetime.fromisoformat(content["created_at"].replace("Z", "+00:00"))
        expires = dt.datetime.fromisoformat(content["expires_at"].replace("Z", "+00:00"))
        self.assertLessEqual(expires - created, dt.timedelta(hours=72))

    def test_pin_017_no_installation_occurred(self):
        cleanup = json.loads(Path("security/evidence/phase-1b-b0/quarantine-cleanup.json").read_text())
        self.assertFalse(cleanup["installer_invoked"])
        self.assertFalse(cleanup["container_system_start_invoked"])

    def test_pin_018_no_service_started(self):
        cleanup = json.loads(Path("security/evidence/phase-1b-b0/quarantine-cleanup.json").read_text())
        self.assertFalse(cleanup["service_started_by_b0"])

    def test_pin_019_quarantine_cleanup(self):
        cleanup = json.loads(Path("security/evidence/phase-1b-b0/quarantine-cleanup.json").read_text())
        self.assertEqual(cleanup["retention_policy"], "quarantine_removed_after_evidence")
        self.assertTrue(cleanup["absolute_path_retained"] is False)

    def test_pin_020_no_credentials_accessed(self):
        evidence_dir = Path("security/evidence/phase-1b-b0")
        raw = "\n".join(path.read_text(errors="ignore") for path in evidence_dir.rglob("*") if path.is_file())
        sensitive_headers = ("authoriza" + "tion\\s*:", "coo" + "kie\\s*:")
        self.assertNotRegex(raw, rf"(?i)({sensitive_headers[0]}|{sensitive_headers[1]}|keychain|api[_-]?key|password)")

    def test_b0_prov_001_artifact_pin_registry_pinned_loaded(self):
        registry = load_artifact_pin_registry()
        self.assertEqual(registry["registry_status"], "PINNED")
        self.assertEqual(registry["blocker"], "NONE")

    def test_b0_prov_002_artifact_pin_registry_duplicate_role_rejected(self):
        registry = load_artifact_pin_registry()
        registry["entries"].append(copy.deepcopy(registry["entries"][0]))
        _expect_error(lambda: validate_artifact_pin_registry(registry), "duplicate role")

    def test_b0_prov_003_artifact_pin_registry_mutation_rejected(self):
        registry = load_artifact_pin_registry()
        registry["evidence_pack_manifest_sha256"] = _hash("mutated-pack")
        validate_artifact_pin_registry(registry)
        self.assertNotEqual(
            registry["evidence_pack_manifest_sha256"],
            load_artifact_pin_registry()["evidence_pack_manifest_sha256"],
        )
        _expect_error(
            lambda: require_artifact_pin_registry_evidence_binding(registry),
            "evidence pack manifest hash mismatch",
        )

    def test_b0_kata_001_archive_inspected_allows_ready_manifest(self):
        evidence = json.loads(Path("security/evidence/phase-1b-b0/kata-archive-inspection.json").read_text())
        self.assertEqual(evidence["result"], "PASS")
        self.assertTrue(evidence["archive_inspected"])
        self.assertEqual(
            evidence["inner_kernel_sha256"],
            "2fe4a58d2885d623bcb4d705900ac8c1d4f02371152da8126b3b00c8c47fc3a1",
        )
        self.assertEqual(evidence["inner_kernel_size_bytes"], 16151040)

    def test_b0_bundle_001_evidence_pack_manifest_present(self):
        pack = json.loads(Path("security/evidence/phase-1b-b0/evidence-pack-manifest.json").read_text())
        paths = {entry["path"] for entry in pack["entries"]}
        self.assertIn("security/evidence/phase-1b-b0/kata-archive-inspection.json", paths)
        self.assertIn("security/evidence/phase-1b-b0/manifest-validation.json", paths)

    def test_b0_gate_001_owner_packet_not_actionable(self):
        packet = Path("docs/program/PHASE_1B_B0_OWNER_APPROVAL_PACKET.md").read_text()
        self.assertIn("OWNER_APPROVAL_REQUIRED", packet)
        self.assertIn(
            "APPROVE_PRIMARY_BACKEND_INSTALL:p1b-20260722-artifactpinningb0:c37a6f727d935d1eeb746ebabe6c58a0b19eb32822c0c73561dbb5b0e34f68aa",
            packet,
        )


if __name__ == "__main__":
    unittest.main()
