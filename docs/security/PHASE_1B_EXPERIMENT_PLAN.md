# Phase 1B-B Disposable Prototype Plan

This is a plan for a future phase. Do not execute it during Phase 1B-A.

## Software

Primary path:

- Apple Container CLI from official Apple GitHub releases.
- Version: owner-approved current stable release at execution time.
- Source: https://github.com/apple/container/releases
- Verification: signed installer package; record release URL, SHA-256, signature
  or notarization evidence if available.
- Release trust anchor: `docs/security/apple_container_release_trust_anchors.json`
  must contain a `PINNED` entry for the exact backend version, repository,
  release tag, asset name, verification policy, installer signer identity and
  Team ID before review or install mode can pass. The registry is resolved from
  the validator's committed project root, not from the current working
  directory.
- Approval digest binding: synthetic installation approval records must include
  `trust_anchor_registry_sha256`, computed from raw committed registry bytes.
  Registry digest match and exact `PINNED` anchor match are both required.
- Public API boundary: Phase 1B-B tooling must call only the operational
  validators that load the committed registry themselves. Test fixtures may
  exercise validation logic but can never produce an authoritative
  installation authorization result.
- Linux kernel artifact: must be declared in the approval manifest before any
  `container system start` or runtime launch.
- Init/base filesystem artifact: must be declared in the approval manifest.
- Synthetic OCI image: pinned by digest, never floating tag.
- Registry/download hosts: explicit allowlist in approval manifest.
- Registry login: prohibited for Phase 1B-B synthetic prototype.
- Keychain credential creation: prohibited.

Fallback path:

- Lima from official Lima releases or Homebrew formula after owner approval.
- Version: pinned stable version.
- Source: https://lima-vm.io/docs/installation/
- Verification: release checksum or Homebrew formula metadata.
- Approval readiness: `APPROVAL_CONTRACT_NOT_READY`. Lima may not be used by
  installation mode until a separate contract pins the backend installer, guest
  image, Lima template and synthetic OCI manifest with exact source, SHA-256,
  size and attestation/signature metadata.

## Required owner approval

No install may happen until the owner explicitly sends:

```text
APPROVE_PRIMARY_BACKEND_INSTALL:<approval_id>:<manifest_content_sha256>
```

The manifest remains immutable `READY_FOR_REVIEW`; approval is represented only
by a separate trusted approval record.

Authorization modes:

- `review`: validates the immutable installation manifest only.
- `synthetic-install`: allowed only for the future Phase 1B-B disposable
  synthetic experiment. It requires `authorization_source =
  pankster-human-gate`, `authn_context = interactive-synthetic`,
  `synthetic_only = true`, `real_credentials_allowed = false` and
  `production_profiles_allowed = false`.
- `production-install`: blocked until the trusted Human Gate authentication
  backend exists and must return `BLOCKED_AUTHENTICATION_BACKEND_PENDING`.

Phase 1B-A does not yet implement the Human Gate authentication backend, so
production install mode must not trust arbitrary local approval JSON.

## Expected Mac changes

Apple Container path may install files under `/usr/local` and start a system
service when explicitly requested. Lima path may install binaries and create VM
state under user-managed directories. Exact file/service inventory must be
recorded during Phase 1B-B before and after install.

Apple Container artifacts to inventory separately:

1. Signed Apple Container installer.
2. Apple Container version.
3. Linux kernel artifact.
4. Init/base filesystem.
5. Synthetic OCI image.
6. Image digest.
7. Registry/download hosts.
8. No registry login.
9. No Keychain credential creation.
10. Before/after filesystem and service inventory.

`container system start` must not interactively choose or download an unknown
kernel or init filesystem. Any download must appear in the immutable approval
manifest before owner approval. A valid-looking signer or Team ID is not enough:
Phase 1B-B package verification must compare actual `pkgutil`/`spctl` output to
the exact pinned trust anchor, and any mismatch is `INSTALLATION_DENIED`.

## Rollback plan

1. Stop disposable runtimes.
2. Delete synthetic VMs/containers/images/volumes.
3. Remove installed CLI via vendor uninstall or package manager.
4. Remove synthetic runtime directories.
5. Verify no background service remains.
6. Verify no runtime socket remains.
7. Verify no synthetic credential file remains.
8. Record rollback evidence.

## Prototype steps

1. Install owner-approved primary backend.
2. Verify version, checksum/signature and executable path.
3. Create synthetic-only directories:
   - profile A workspace;
   - profile B workspace;
   - root-home decoy;
   - artifact input;
   - artifact output;
   - credential grant temp.
4. Build or pull a pinned minimal synthetic test image.
5. Create disposable runtime from the backend-neutral contract.
6. Mount only synthetic directories.
7. Deliver only synthetic one-time credential.
8. Deny host home and root `~/.hermes`.
9. Run ISO-EXP-001..020.
10. Run ISO-EXP-021..028 for network bypass and credential mount hardening.
11. Destroy runtime.
12. Verify no orphan runtime, socket, mount or credential remains.
13. Generate sanitized evidence pack.

## Non-goals

- No production profile.
- No real credentials.
- No Hermes core modification.
- No Phase 1B-C production integration.
- No claim that production isolation is ready.
