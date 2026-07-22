# Phase 1B-A Review Response 03

This response addresses the Approval Security Finalization review. Scope remains
Phase 1B-A only. No backend was installed, no `sudo` was used, no VM/container
was started, no live Hermes runtime was changed, no credentials were read, no
owner approval was requested, and Phase 1B-B was not started.

## P1BA-R3-01 Exact schema enforcement

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL_RECORD.schema.json`

Resolution: the Python validator now enforces exact field sets with
`MANIFEST_ENVELOPE_FIELDS`, `MANIFEST_CONTENT_FIELDS`, `ARTIFACT_FIELDS` and
`APPROVAL_RECORD_FIELDS`. Unknown and missing fields fail closed inside Python,
independent of any external JSON Schema validator.

Tests:

- `MANIFEST-016 Unknown envelope field rejected`
- `MANIFEST-017 Unknown content field rejected`
- `MANIFEST-018 Unknown artifact field rejected`
- `MANIFEST-019 Unknown approval record field rejected`

## P1BA-R3-02 Duplicate artifact roles

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: backend-specific role policy is now defined in
`BACKEND_ARTIFACT_POLICIES`. Apple manifests require exactly one
`backend-installer`, `linux-kernel`, `init-filesystem` and
`synthetic-oci-manifest`. Duplicate, missing and unknown roles are rejected.

Tests:

- `MANIFEST-020 Duplicate artifact role rejected`
- `MANIFEST-021 Exact Apple role cardinality enforced`

## P1BA-R3-03 Lima approval readiness

Status: resolved with fail-closed Variant B.

Changed files:

- `tools/validate_installation_manifest.py`
- `docs/security/ISOLATION_BACKEND_DECISION.md`
- `docs/security/PHASE_1B_EXPERIMENT_PLAN.md`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`
- `docs/program/PHASE_1B_A_STATUS.yaml`

Resolution: `APPROVABLE_BACKENDS` is now `{"apple-container-cli"}`. Lima remains
`FALLBACK_EXPERIMENT_CANDIDATE` but is marked
`APPROVAL_CONTRACT_NOT_READY` until a separate design pins backend installer,
guest image, Lima template and synthetic OCI supply chain.

Tests:

- `MANIFEST-022 Incomplete Lima manifest rejected`

## P1BA-R3-04 Artifact/backend binding

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`

Resolution: Apple artifact URLs must use `https`, no userinfo, no query, no
fragment, exact `github.com/apple/container` repository, exact release tag equal
to `backend_version`, URL basename equal to artifact `name`, no duplicate
resolved hosts, and the source host must be declared. Backend installer
`artifact.version` must equal `manifest_content.backend_version`.

Tests:

- `MANIFEST-023 Installer version mismatch rejected`
- `MANIFEST-024 Wrong GitHub repository rejected`
- `MANIFEST-025 Wrong release tag rejected`
- `MANIFEST-026 Asset basename mismatch rejected`
- `MANIFEST-027 URL userinfo rejected`
- `MANIFEST-028 URL query or fragment rejected`
- `MANIFEST-029 Source host must be declared`
- `MANIFEST-030 Floating artifact version rejected`
- `MANIFEST-031 OCI artifact without digest rejected`

## P1BA-R3-05 Exact owner command hash

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: the validator now derives
`APPROVE_PRIMARY_BACKEND_INSTALL:<approval_id>:<manifest_content_sha256>` and
requires `owner_command_hash` to equal that exact SHA-256. Syntactically valid
but arbitrary hashes are rejected.

Tests:

- `MANIFEST-032 Arbitrary owner command hash rejected`
- `MANIFEST-033 Exact owner command hash accepted`

## P1BA-R3-06 Approval provenance

Status: design complete, authentication backend pending.

Changed files:

- `docs/program/PHASE_1B_INSTALLATION_APPROVAL_RECORD.schema.json`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`
- `docs/program/PHASE_1B_A_STATUS.yaml`
- `tools/validate_installation_manifest.py`

Resolution: approval records now include `approved_by`,
`authorization_event_id`, `authorization_source` and `authn_context`. The only
accepted `authorization_source` is `pankster-human-gate`.

Remaining limitation:

```text
approval_record_trust:
DESIGN_COMPLETE_BUT_AUTHENTICATION_BACKEND_PENDING
```

Production install mode must not trust arbitrary local JSON until the Human Gate
authentication backend is implemented. Before then, any install flow is limited
to disposable synthetic install plus interactive owner confirmation.

## P1BA-R3-07 Manifest time window

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: review/install validation now accepts a testable `now` parameter.
Review mode rejects expired manifests. Install mode checks manifest creation,
approval time, approval expiry, manifest expiry and five-minute future clock
skew.

Tests:

- `MANIFEST-034 Expired manifest rejected`
- `MANIFEST-035 Approval after manifest expiry rejected`
- `MANIFEST-036 Approval expiry beyond manifest expiry rejected`
- `MANIFEST-037 Future approval timestamp rejected`
- `MANIFEST-038 Approval before manifest creation rejected`

## P1BA-R3-08 Approval state immutability

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`
- `docs/security/PHASE_1B_EXPERIMENT_PLAN.md`

Resolution: install mode expects an immutable `READY_FOR_REVIEW` manifest plus a
separate approval record. The manifest is not changed to authorize installation;
the approval decision is external and hash-bound to `manifest_content`.

## Validation commands

Required commands:

```bash
python3 tools/validate_backend_matrix.py
python3 -m unittest discover -s tools/tests -p 'test_installation_manifest*.py' -v
python3 tools/validate_installation_manifest.py --mode template docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json
python3 -m compileall -q tools
git diff --check
```

Additional checks in the Round 4 bundle include patch apply, checksum
verification, source-version scan, secret-pattern scan, absolute local path scan
and zip integrity verification.
