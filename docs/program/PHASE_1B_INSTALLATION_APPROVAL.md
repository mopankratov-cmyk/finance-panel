# Phase 1B Installation Approval

Status: `OWNER_APPROVAL_REQUIRED`

Current Phase 1B-B0 status:

```text
ARTIFACT_PIN_REGISTRY_PINNED
INSTALLATION_MANIFEST_READY_FOR_OWNER_APPROVAL
```

No installation is authorized until the immutable installation manifest is
completed, separately reviewed, authenticated by a trusted Human Gate, and the
owner explicitly sends:

```text
APPROVE_PRIMARY_BACKEND_INSTALL:<approval_id>:<manifest_content_sha256>
```

## Primary backend

Apple Container CLI / Apple Containerization stack.

## Fallback backend

Lima with `vmType: vz`.

## Software to install

| Backend | Software | Download source | Version | Disk usage |
| --- | --- | --- | --- | --- |
| Primary | Apple Container CLI signed installer package | https://github.com/apple/container/releases/download/1.1.0/container-1.1.0-installer-signed.pkg | Pinned by Phase 1B-B0: 1.1.0 | 89,471,042 byte package; declared payload 326,041 install KB |
| Fallback | Lima Darwin arm64 archive | https://github.com/lima-vm/lima/releases | Currently observed: v2.1.1 on 2026-07-22; must reverify before approval | 35.5 MB archive for `lima-2.1.1-Darwin-arm64.tar.gz` |

Lima is `FALLBACK_EXPERIMENT_CANDIDATE` but
`APPROVAL_CONTRACT_NOT_READY`. It is intentionally not an approvable backend in
`tools/validate_installation_manifest.py` until a separate Lima guest-image and
template supply-chain contract exists.

## Approval manifest requirements

Required files:

- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL_RECORD.schema.json`
- `docs/security/apple_container_release_trust_anchors.json`

The future approval manifest must reject:

- duplicate JSON keys at any object level before normal dict materialization;
- unknown envelope, content, artifact and approval-record fields;
- missing required envelope, content, artifact and approval-record fields;
- wrong JSON types, nulls, nested lists, booleans masquerading as integers, and
  empty/whitespace/control-character strings in critical fields;
- Unicode control/format characters, including DEL, C1 controls, zero-width
  characters, bidirectional overrides and isolates;
- `latest`;
- `stable`, `current`, `nightly`, `main`, `master`, `release`;
- floating OCI tags;
- duplicate artifact roles;
- backend installer version mismatch;
- source URLs outside the expected GitHub owner/repository/release tag;
- source URLs with userinfo, query or fragment;
- source URLs with an explicit port, including `:443` and non-standard ports;
- source URLs whose origin is not the exact canonical netloc `github.com`;
- source URLs with percent-encoding anywhere in the current Apple release path;
- source URLs whose basename does not match the artifact name;
- source URLs with extra path segments, repeated slashes, encoded slash,
  encoded backslash, dot segments, NUL/control characters, or empty asset
  basenames;
- undeclared source hosts or duplicate `resolved_download_hosts`;
- duplicate normalized list values in critical disclosure lists and
  `resolved_download_hosts`;
- ambiguous semantic absence markers such as `none`, `N/A`, `not applicable`,
  `no changes`, `unknown` or `TBD`;
- empty hashes;
- repeating-character placeholder hashes;
- OCI artifacts without `sha256:<64 hex>` digest;
- unknown download hosts;
- approval without expiry;
- expiry greater than 7 days;
- mutation after owner approval.

Critical manifest lists must be non-empty lists of bounded non-empty strings:

- `disk_changes`;
- `background_services`;
- `required_permissions`;
- `network_changes`.

If a field intentionally has no changes, the explicit marker is:

```json
["NONE"]
```

Canonical semantic absence normalization is:

```text
Unicode NFC normalization -> trim -> casefold -> collapse internal whitespace
```

The canonical explicit absence marker is exactly:

```text
NONE
```

Backend-specific disclosure policy:

```text
apple-container-cli.disk_changes.allow_absence = false
apple-container-cli.background_services.allow_absence = false
apple-container-cli.required_permissions.allow_absence = false
apple-container-cli.network_changes.allow_absence = true
```

For Apple, `network_changes = ["NONE"]` is allowed only as the exact
canonical marker and only when it is the sole list item. Lowercase `none`,
`N/A`, `not applicable`, `unknown`, `TBD` and other synonyms are rejected as
ambiguous. Disk changes, background services and required permissions must be
disclosed explicitly and reject all absence markers, including exact `NONE`.

## Structured supply-chain verification

Artifact descriptors use structured verification fields:

```json
{
  "verification_policy_id": "...",
  "expected_signer_identity": "...",
  "expected_signer_team_id": "..."
}
```

Allowed role-specific policies:

| Role | `verification_policy_id` |
| --- | --- |
| `backend-installer` | `apple-container-installer-v1` |
| `linux-kernel` | `apple-container-release-asset-sha256-v1` |
| `init-filesystem` | `oci-manifest-sha256-v1` |
| `synthetic-oci-manifest` | `oci-digest-pinned-v1` |

`apple-container-installer-v1` requires SHA-256, `pkgutil` signature, expected
team identity, `spctl` install assessment and notarization checks. Free-text
`verification_method` is not allowed.

`oci-manifest-sha256-v1` requires the source URL to be the canonical registry
manifest URL for the digest that is pinned in `sha256`. Floating tags are not
allowed in the immutable manifest.

`TO_BE_PINNED` signer identity/team placeholders are allowed only in
`TEMPLATE`. `READY_FOR_REVIEW` rejects placeholders.

For the `apple-container-cli` `backend-installer` artifact,
`READY_FOR_REVIEW` pins both exact signer fields:

- `expected_signer_identity` must match
  `^Developer ID Installer: .{1,180}$` and must not be `not_applicable`,
  a placeholder, a generic value such as `unknown`, `unsigned`,
  `any signer`, `fake`, `test`, `example`, `placeholder` or `TBD`, or contain
  leading/trailing whitespace or Unicode control/format characters. Generic
  rejection applies to the signer suffix after `Developer ID Installer:`, not
  only to the full field value.
- `expected_signer_team_id` must match `^[A-Z0-9]{10}$` and must not be
  `not_applicable`, a placeholder, a repeating-character value, or a generic
  example ID such as `FAKE123456`, `TEST123456`, `DEMO123456`,
  `EXAMPLE123`, `ABCDEFGHIJ`, `AAAAAAAAAA` or `1234567890`.

Phase 1B-B package verification must compare actual `pkgutil` and `spctl`
output against the exact values contained in the approved manifest. Pattern
validation alone does not establish trust. If the actual signer identity or
Team ID differs from the approved manifest, the result is:

```text
INSTALLATION_DENIED
```

The denial applies even when SHA-256 matches a package obtained from another
source.

## Release trust-anchor registry

Apple Container release trust anchors are recorded in:

```text
docs/security/apple_container_release_trust_anchors.json
```

The trusted registry path is resolved from the validator file location, not
from the current working directory:

```text
PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT/docs/security/apple_container_release_trust_anchors.json
```

Review and install modes do not accept an arbitrary registry path. The
canonical path must be absolute, must exist, must be a regular file, and must
resolve to the committed registry path. `docs`, `docs/security` and the
registry file itself are security-sensitive path components; symlinks are
rejected with:

```text
TRUST_ANCHOR_REGISTRY_SYMLINK_REJECTED
```

Missing, non-file, relative, substituted or otherwise untrusted registry paths
fail closed with:

```text
TRUST_ANCHOR_REGISTRY_PATH_UNTRUSTED
```

The public operational Python API is intentionally narrow:

```python
validate_review_manifest(manifest, *, now=None)
validate_synthetic_install(record, manifest, *, now=None)
```

These public functions always load the committed project registry themselves.
They do not accept `trust_anchors`, `trust_anchor_registry_metadata`,
`registry_snapshot`, `registry_path` or registry override parameters.

Internal validation cores may accept a typed `RegistrySnapshot` only for tests.
A snapshot has an explicit source kind:

```text
COMMITTED_PROJECT_REGISTRY
TEST_FIXTURE
```

Operational authorization can return `PASS` only with
`COMMITTED_PROJECT_REGISTRY`. A `TEST_FIXTURE` snapshot can exercise validation
logic but must be marked non-authoritative and can return only:

```text
TEST_ONLY_PASS
```

If code attempts to convert non-authoritative validation into operational
authorization, validation fails closed:

```text
NON_AUTHORITATIVE_TRUST_REGISTRY
```

The registry schema version is:

```text
pankster.release-trust-anchors.v1
```

Each entry binds:

- backend;
- backend version;
- artifact role;
- canonical repository;
- release tag;
- asset name;
- verification policy;
- exact expected signer identity;
- exact expected Team ID;
- trust-anchor source;
- source status;
- observation timestamp.

Allowed source statuses:

```text
DRAFT
PINNED
REVOKED
```

`PINNED` entries must not contain placeholders. Because the exact Apple
installer signer identity and Team ID have not yet been independently
confirmed, the current Apple Container 1.1.0 entry remains:

```text
DRAFT
```

That is intentional and means:

```text
owner approval manifest: OWNER_APPROVAL_MANIFEST_NOT_READY
review manifest validation: FAIL
```

In review mode the installer manifest must find an anchor by:

```text
backend
backend_version
artifact_role
asset_name
```

The anchor must have `source_status = PINNED`. Missing, `DRAFT` or `REVOKED`
anchors fail with:

```text
RELEASE_TRUST_ANCHOR_NOT_PINNED
```

If the anchor is pinned but repository, release tag, asset name, verification
policy, signer identity or Team ID differs from the manifest, validation fails
with:

```text
RELEASE_TRUST_ANCHOR_MISMATCH
```

Regex validation is only a preliminary safety check. Exact pinned trust-anchor
comparison is mandatory before any future installation approval.

The validator computes:

```text
trust_anchor_registry_sha256 = sha256(raw committed registry bytes)
```

The hash is computed from the original bytes on disk, not from a reserialized
Python object. Review evidence may include only the project-relative registry
path:

```text
docs/security/apple_container_release_trust_anchors.json
```

It must not include an absolute local path.

Approval records bind to the exact registry digest:

```json
{
  "trust_anchor_registry_sha256": "<64 hex>"
}
```

For `synthetic-install`, the approval record digest must equal the current
committed registry digest. Mismatch fails closed:

```text
TRUST_ANCHOR_REGISTRY_HASH_MISMATCH
```

Registry digest equality does not replace signer/Team ID pinning. Both controls
are mandatory:

```text
registry digest match
+
exact PINNED anchor match
```

The manifest envelope is not self-hashing. `content_sha256` is computed only
over `manifest_content`. Every manifest state, including `TEMPLATE`, carries a
reproducible `content_sha256`; `TEMPLATE` remains non-approvable because it
contains placeholders and has the wrong state for review/install modes.

Canonical content hash algorithm:

1. Parse JSON as UTF-8.
2. Reject floats, NaN and Infinity.
3. Normalize all strings and object keys with Unicode NFC.
4. Serialize `manifest_content` with sorted object keys.
5. Use compact separators with no insignificant whitespace.
6. Preserve array order.
7. Hash the resulting UTF-8 bytes with SHA-256.

This is the project canonical JSON contract for Phase 1B-A; it is intentionally
dependency-free and is not a full RFC 8785 implementation.

Manifest states:

- `TEMPLATE`: contains placeholders and is never approvable.
- `DRAFT`: may change.
- `READY_FOR_REVIEW`: fully filled and ready for independent hash review.
- `APPROVED`: allowed only as an archival label; production install mode does
  not rely on it.
- `EXPIRED`: time window passed.
- `REVOKED`: approval cancelled.

Approval state contract: the approvable manifest remains immutable
`READY_FOR_REVIEW`; the separate approval record carries decision `APPROVED`.
Never trust a manifest state flip to `APPROVED` without a valid approval record.

## Exact owner command hash

The approval record must bind to the exact command:

```text
APPROVE_PRIMARY_BACKEND_INSTALL:<approval_id>:<manifest_content_sha256>
```

`owner_command_hash` is:

```text
sha256(expected_owner_command.encode("utf-8")).hexdigest()
```

An arbitrary SHA-256 value is invalid even if it is syntactically correct.

## Trusted approval provenance

Approval records include:

- `approved_by`;
- `authorization_event_id`;
- `authorization_source`;
- `authn_context`.

Provenance patterns:

```text
approved_by: ^owner:[A-Za-z0-9._-]{1,128}$
authorization_event_id: ^hgate-[A-Za-z0-9._-]{8,128}$
authn_context: ^interactive-(owner|hardware-key|passkey|synthetic)$
```

The only accepted `authorization_source` value is:

```text
pankster-human-gate
```

Phase 1B-A status:

```text
approval_record_trust:
DESIGN_COMPLETE_BUT_AUTHENTICATION_BACKEND_PENDING
```

Production install mode must not trust arbitrary local JSON. Until the trusted
Human Gate authentication backend exists, production installation is always:

```text
BLOCKED_AUTHENTICATION_BACKEND_PENDING
```

Before that backend exists, only future disposable synthetic installation may be
authorized, and only with:

```text
authorization_source = pankster-human-gate
authn_context = interactive-synthetic
synthetic_only = true
real_credentials_allowed = false
production_profiles_allowed = false
```

Validator modes:

```bash
python3 tools/validate_release_trust_anchors.py docs/security/apple_container_release_trust_anchors.json
python3 tools/validate_installation_manifest.py --mode review manifest.json
python3 tools/validate_installation_manifest.py --mode review manifest.json --json
python3 tools/validate_installation_manifest.py --mode synthetic-install manifest.json --approval-record approval.json
python3 tools/validate_installation_manifest.py --mode production-install manifest.json --approval-record approval.json
```

The CLI calls only the public operational wrappers for review and
synthetic-install. It has no flags for custom registries, test registries or
trust-anchor injection.

JSON output is sanitized. On the current `DRAFT` anchor, review mode returns a
denied result with registry digest evidence and no absolute local paths:

```json
{
  "result": "DENIED",
  "reason": "RELEASE_TRUST_ANCHOR_NOT_PINNED",
  "trust_anchor_registry_path": "docs/security/apple_container_release_trust_anchors.json"
}
```

## Time-window invariants

Install mode validates:

- `manifest.created_at <= now + 5 minutes`;
- `approval.approved_at < approval.expires_at`;
- `manifest.created_at <= approval.approved_at`;
- `approval.approved_at <= manifest.expires_at`;
- `approval.expires_at <= manifest.expires_at`;
- current time is before both manifest and approval expiry;
- `approval.approved_at` is not more than five minutes in the future.

## Parser and schema authority checklist

JSON Schema provides structural validation for the envelope, field presence,
basic primitive types, enums, string bounds and `additionalProperties: false`.

The Python validator is authoritative for:

- duplicate raw keys;
- canonical URL rules;
- NFC-normalized duplicates;
- Unicode security categories;
- time relationships;
- backend-specific policies;
- approval authorization modes.

## Required permissions

- Apple Container install may require administrator password to install under
  `/usr/local` and start its system service.
- Lima install path depends on chosen installer. Homebrew install is forbidden
  until owner approval.
- No `sudo` is authorized in Phase 1B-A.

## Background services

- Apple Container: system service may be required after installation.
- Lima: VM instances are user-managed; no persistent profile runtime should be
  created until Phase 1B-B.

## Verification notes for approval

- Apple Container: verify signed installer package, release URL, installer
  signature/notarization and SHA-256 before installation.
- Lima fallback: currently observed v2.1.1 release data on 2026-07-22:
  asset `lima-2.1.1-Darwin-arm64.tar.gz`, SHA-256
  `b6b0e6701189cd8c4e549cc39e6d054dc681487798b9b774ad2cbd30c08b2bd8`,
  size 35.5 MB, release commit `3f73aec`.
- `observed_latest_at: 2026-07-22`
- `must_reverify_before_approval: true`

## Network changes

None approved yet. Phase 1B-B must first prove `NETWORK_DISABLED`; restricted
egress may require an explicit proxy or firewall design and owner approval.

## Rollback steps

1. Stop all synthetic runtimes.
2. Delete synthetic containers/VMs/images/volumes.
3. Remove installed backend using vendor/package-manager uninstall.
4. Remove synthetic runtime state directories.
5. Verify no runtime socket/service remains.
6. Verify no synthetic credential files remain.
7. Record sanitized rollback evidence.

## Known risks

- Apple Container is newer and may have CLI/network/mount gaps for PANKSTER.
- Lima is more mature but requires more custom orchestration.
- Docker Desktop ECI is strong on paper but adds subscription/admin policy and
  Docker control-plane governance.
- Network allowlist enforcement is unproven for all candidates until Phase 1B-B.

## Estimated operational burden

Primary: medium during prototype, potentially low-medium after automation.

Fallback: medium-high because PANKSTER must own more lifecycle and policy
orchestration directly.
