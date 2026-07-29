# Phase 1B-A Review Response 01

This response addresses Phase 1B-A Review Round 2. Scope remains design-only.
No backend runtime was installed, no `sudo` was used, no VM/container was
started, no live Hermes runtime was changed, no credentials were read, no owner
approval was requested, and Phase 1B-B was not started.

## P1BA-R1-01 Weighted matrix arithmetic

Status: resolved.

Changed files:

- `docs/security/isolation_backend_matrix.json`
- `tools/validate_backend_matrix.py`
- `docs/security/ISOLATION_BACKEND_DECISION.md`

Resolution: the matrix is now machine-readable and recalculated by a
dependency-free validator. Weighted score and eligibility constraints are
separate.

Evidence:

- `python3 tools/validate_backend_matrix.py`

Remaining limitations: scores remain Phase 1B-A planning inputs, not empirical
security proofs.

## P1BA-R1-02 Decision level naming

Status: resolved.

Changed files:

- `docs/security/ISOLATION_BACKEND_DECISION.md`
- `docs/program/PHASE_1B_A_STATUS.yaml`
- `phase-1b-a-report.txt`
- ADRs

Resolution: Phase 1B-A now uses `PRIMARY_EXPERIMENT_CANDIDATE` and
`FALLBACK_EXPERIMENT_CANDIDATE`. The allowed result is
`PRIMARY_EXPERIMENT_CANDIDATE_SELECTED`,
`DISPOSABLE_PROTOTYPE_PLAN_READY`, and
`OWNER_APPROVAL_MANIFEST_NOT_READY`.

Evidence:

- terminology scan for rejected decision names.

Remaining limitations: no production backend has been approved.

## P1BA-R1-03 Process privileges

Status: resolved.

Changed files:

- `docs/security/PROFILE_RUNTIME_CONTRACT.md`

Resolution: the runtime contract now includes non-root execution, no privileged
mode, capability drop, no-new-privileges, namespace restrictions, no runtime or
SSH agent socket mounts, restricted proc/sys modes, seccomp policy and rlimits.
Unsupported mandatory settings produce `BACKEND_REJECTED`.

Evidence:

- contract review and relative-link validation.

Remaining limitations: backend support must be proven in Phase 1B-B.

## P1BA-R1-04 Dangerous host integrations

Status: resolved.

Changed files:

- `docs/security/ISOLATION_BACKEND_DECISION.md`
- `docs/security/PROFILE_RUNTIME_CONTRACT.md`

Resolution: prohibited Apple integrations are explicitly listed:
`container machine`, `container run --ssh`, `SSH_AUTH_SOCK`, automatic host home
sharing, host user mapping, runtime/XPC socket mounts, debug mode in credential
tests and floating OCI tags.

Evidence:

- policy appears in decision and runtime contract docs.

Remaining limitations: CLI flag availability must be confirmed after install.

## P1BA-R1-05 Immutable installation approval

Status: resolved.

Changed files:

- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json`

Resolution: owner approval is now gated on an immutable manifest and command
format `APPROVE_PRIMARY_BACKEND_INSTALL:<approval_id>:<manifest_content_sha256>`.
Current status is `NOT_READY_FOR_OWNER_APPROVAL`.

Evidence:

- schema/example JSON load and validation checks.

Remaining limitations: real release asset hashes must be filled and reviewed
before any approval request.

## P1BA-R1-06 Full supply chain inventory

Status: resolved.

Changed files:

- `docs/security/PHASE_1B_EXPERIMENT_PLAN.md`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: the plan now inventories signed installer, backend version, Linux
kernel, init/base filesystem, synthetic OCI image and digest, download hosts,
registry login prohibition, Keychain prohibition, and before/after filesystem
and service inventory.

Evidence:

- installation manifest fields and experiment plan review.

Remaining limitations: actual artifacts are intentionally not downloaded in
Phase 1B-A.

## P1BA-R1-07 Network-disabled preflight

Status: resolved.

Changed files:

- `docs/security/NETWORK_POLICY_DESIGN.md`
- `docs/security/PHASE_1B_ACCEPTANCE_MATRIX.md`

Resolution: `ISO-PREFLIGHT-001` must prove Apple network-disabled capability
before other Apple experiments. Failure rejects Apple and moves to Lima approval
flow.

Evidence:

- acceptance matrix includes preflight setup/action/expected/failure/evidence/cleanup.

Remaining limitations: no network experiment was run in Phase 1B-A.

## P1BA-R1-08 Credential mount hardening

Status: resolved.

Changed files:

- `docs/security/CREDENTIAL_DELIVERY_DESIGN.md`
- `docs/security/PHASE_1B_ACCEPTANCE_MATRIX.md`

Resolution: credential mount hardening now checks non-root execution, empty
capabilities, no-new-privileges, file ownership/mode, read-only mount, no guest
root escalation, no boot/init/runtime log exposure and post-teardown absence.

Evidence:

- `ISO-EXP-025..028` added.

Remaining limitations: one-time file delivery remains the initial prototype
path; FD/broker options are deferred until after file delivery proof.

## P1BA-R1-09 Threat model statuses

Status: resolved.

Changed files:

- `docs/security/ISOLATION_THREAT_MODEL.md`

Resolution: TH-03, TH-09, TH-10 and TH-13 are now `requires_experiment` with
`prototype_control_available: true` and `live_control_active: false` semantics
in the rationale. Phase 1A prototypes are not treated as live mitigations.

Evidence:

- threat model table review.

Remaining limitations: all target controls require Phase 1B-B evidence.

## P1BA-R1-10 Source classification

Status: resolved.

Changed files:

- `docs/security/ISOLATION_BACKEND_DECISION.md`

Resolution: README and documentation claims are classified as `DOCUMENTED`.
`SOURCE_CODE_CONFIRMED` is reserved for future tag/commit/file/line verified
behavior.

Evidence:

- source classification scan.

Remaining limitations: no source-code line-level verification was needed for
Round 2.

## P1BA-R1-11 Git hygiene

Status: resolved.

Changed files:

- review metadata files

Resolution: previous Phase 1A review artifacts were moved recoverably to
`/tmp/PANKSTER_PHASE_1A_REVIEW_ARTIFACTS_ARCHIVE`. Round 2 metadata and patch
are regenerated as Phase 1B-A artifacts.

Evidence:

- `git status --short`
- `phase-1b-a-git-status.txt`

Remaining limitations: user Desktop copies were not removed.
