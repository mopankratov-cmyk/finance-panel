# Phase 1B-A Review Response 02

This response addresses the Final Approval Contract review. Scope remains
Phase 1B-A only. No backend was installed, no `sudo` was used, no VM/container
was started, no live Hermes runtime was changed, no credentials were read, no
owner approval was requested, and Phase 1B-B was not started.

## P1BA-R2-01 Lima release correction

Status: resolved.

Changed files:

- `docs/security/ISOLATION_BACKEND_DECISION.md`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`
- `docs/program/PHASE_1B_A_REVIEW_RESPONSE_01.md`
- `phase-1b-a-report.txt`

Resolution: Lima release metadata now uses v2.1.1, asset
`lima-2.1.1-Darwin-arm64.tar.gz`, SHA-256
`b6b0e6701189cd8c4e549cc39e6d054dc681487798b9b774ad2cbd30c08b2bd8`,
size 35.5 MB and release commit `3f73aec`. It also records
`observed_latest_at: 2026-07-22` and
`must_reverify_before_approval: true`.

Tests:

- source version scan.

Remaining limitations: this is `CURRENTLY_OBSERVED`, not install approval.

## P1BA-R2-02 Containerization source correction

Status: resolved.

Changed files:

- `docs/security/ISOLATION_BACKEND_DECISION.md`

Resolution: the docs no longer claim any separate latest Containerization
release. They record only that Apple Container 1.1.0 declares an update to
Containerization 0.35.0. Separate latest Containerization status is
`UNVERIFIED`.

Tests:

- source version scan.

Remaining limitations: no separate Containerization release source was verified
in this phase.

## P1BA-R2-03 Non-self-referential content hash

Status: resolved.

Changed files:

- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json`
- `tools/validate_installation_manifest.py`

Resolution: the manifest is now an envelope with `manifest_content` and
`content_sha256`. The hash is computed only over canonicalized
`manifest_content`, not over the whole envelope. The template example carries a
real reproducible `content_sha256`, while remaining non-approvable because its
state is `TEMPLATE` and its content contains placeholders.

Tests:

- `MANIFEST-010 Content hash mismatch rejected`
- content hash reproduction validation.

Remaining limitations: the project uses a strict dependency-free canonical JSON
contract, not full RFC 8785.

## P1BA-R2-04 Approval record

Status: resolved.

Changed files:

- `docs/program/PHASE_1B_INSTALLATION_APPROVAL_RECORD.schema.json`
- `tools/validate_installation_manifest.py`

Resolution: approvals are separate records containing approval ID, manifest
content hash, decision, timestamps, owner command hash and record hash. Install
mode requires this record.

Tests:

- `MANIFEST-013 Approval hash mismatch rejected`
- `MANIFEST-014 Expired approval rejected`

Remaining limitations: no real owner approval record exists yet.

## P1BA-R2-05 Manifest states

Status: resolved.

Changed files:

- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`
- `tools/validate_installation_manifest.py`

Resolution: allowed states are `TEMPLATE`, `DRAFT`, `READY_FOR_REVIEW`,
`APPROVED`, `EXPIRED` and `REVOKED`. `APPROVED` is not trusted without a valid
approval record.

Tests:

- `MANIFEST-001 Template accepted only in template mode`
- `MANIFEST-002 Template rejected in review mode`
- `MANIFEST-012 Approved state without record rejected`

Remaining limitations: state transitions remain a future operational workflow.

## P1BA-R2-06 Strict validator

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: validator modes cover `template`, `review` and `install`.
Review mode rejects empty/floating versions, placeholders, bad hosts, invalid
expiry, excessive TTL, missing artifact roles and hash mismatches.

Tests:

- `MANIFEST-001..015`

Remaining limitations: validator checks metadata and hashes; it does not
download artifacts in Phase 1B-A.

## P1BA-R2-07 Backend version validation

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`

Resolution: Apple backend versions require strict semver. Lima versions require
strict `v?semver`. Generic strings such as `stable`, `latest`, `current`,
`release`, `main` and `master` are forbidden.

Tests:

- `MANIFEST-003 Empty version rejected`
- `MANIFEST-004 Floating version rejected`
- `MANIFEST-005 Capitalized Latest rejected`

Remaining limitations: actual latest re-verification occurs before owner
approval, not in Phase 1B-A.

## P1BA-R2-08 Full artifact descriptors

Status: resolved.

Changed files:

- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json`
- `tools/validate_installation_manifest.py`

Resolution: loose artifact fields were replaced with `artifacts[]`
descriptors covering role, name, version, source URL, resolved hosts, SHA-256,
size, signature type, expected signer, notarization requirement and
verification method. Apple requires roles `backend-installer`, `linux-kernel`,
`init-filesystem` and `synthetic-oci-manifest`.

Tests:

- `MANIFEST-011 Missing artifact role rejected`

Remaining limitations: descriptor values are templates until real artifacts are
pinned in a future review.

## P1BA-R2-09 Template cannot be approved

Status: resolved.

Changed files:

- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json`
- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: the example manifest remains `TEMPLATE`. Template mode passes;
review and install approval paths reject it.

Tests:

- `MANIFEST-001 Template accepted only in template mode`
- `MANIFEST-002 Template rejected in review mode`

Remaining limitations: none for Phase 1B-A.

## P1BA-R2-10 Source pinning semantics

Status: resolved.

Changed files:

- `docs/security/ISOLATION_BACKEND_DECISION.md`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: source rows separate `CURRENTLY_OBSERVED` from
`PINNED_FOR_APPROVAL`. Current observations never authorize installation.

Tests:

- source version scan.

Remaining limitations: future approval must reverify release sources and fill
the manifest with exact artifact hashes.

## P1BA-R2-11 Full base commit

Status: resolved.

Changed files:

- `PANKSTER_PHASE_1B_A_MANIFEST.json`
- `phase-1b-a.patch`

Resolution: the review manifest now records full 40-character `base_commit`,
`phase_1a_commit`, `repository_commit`, and branch name. Patch apply is checked
against the current index.

Tests:

- `git apply --check --cached phase-1b-a.patch`
- manifest checksum validation.

Remaining limitations: no push or PR was performed.
