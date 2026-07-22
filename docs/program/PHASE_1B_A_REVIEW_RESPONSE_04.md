# Phase 1B-A Review Response 04

This response addresses the Trusted Approval Final Gate review. Scope remains
Phase 1B-A only. No backend was installed, no `sudo` was used, no VM/container
was started, no live Hermes runtime was changed, no credentials were read, no
owner approval was requested, and Phase 1B-B was not started.

## P1BA-R4-01 Approval lifetime ordering

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: synthetic install validation now requires strict positive approval
lifetime: `approval.approved_at < approval.expires_at`. Existing manifest and
approval expiry invariants remain enforced.

Tests:

- `MANIFEST-039 Approval expires before approval rejected`
- `MANIFEST-040 Zero-lifetime approval rejected`
- `MANIFEST-041 Positive authorization lifetime accepted`

## P1BA-R4-02 Python type enforcement

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`

Resolution: Python now validates critical content lists without relying on
external JSON Schema. The validator rejects wrong types, nulls, nested lists,
empty lists, empty strings, whitespace/control characters, placeholder text and
secret-shaped values. Absence is represented with explicit `["NONE"]`.

Tests:

- `MANIFEST-042 Critical list field wrong type rejected`
- `MANIFEST-043 Empty required list rejected`
- `MANIFEST-044 Empty list item rejected`
- `MANIFEST-045 Control character in list item rejected`
- `MANIFEST-046 Explicit NONE marker accepted where allowed`

## P1BA-R4-03 Provenance validation

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL_RECORD.schema.json`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: approval provenance fields are strict bounded strings. The accepted
patterns are:

```text
approved_by: ^owner:[A-Za-z0-9._-]{1,128}$
authorization_event_id: ^hgate-[A-Za-z0-9._-]{8,128}$
authn_context: ^interactive-(owner|hardware-key|passkey|synthetic)$
```

Tests:

- `MANIFEST-047 Placeholder approved_by rejected`
- `MANIFEST-048 Placeholder authorization_event_id rejected`
- `MANIFEST-049 Control characters in provenance rejected`
- `MANIFEST-050 Invalid provenance identifier rejected`

## P1BA-R4-04 Authorization mode separation

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/security/PHASE_1B_EXPERIMENT_PLAN.md`
- `docs/program/PHASE_1B_A_STATUS.yaml`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: the CLI now exposes explicit modes: `review`,
`synthetic-install`, and `production-install`. Generic `install` mode is
removed. Synthetic install requires `interactive-synthetic`,
`synthetic_only = true`, `real_credentials_allowed = false`, and
`production_profiles_allowed = false`. Production install always blocks with
`BLOCKED_AUTHENTICATION_BACKEND_PENDING`.

Tests:

- `MANIFEST-051 Production install blocked while auth backend pending`
- `MANIFEST-052 Synthetic approval requires synthetic_only`
- `MANIFEST-053 Synthetic approval forbids real credentials`
- `MANIFEST-054 Synthetic approval forbids production profiles`
- `MANIFEST-055 Synthetic approval with exact owner command accepted`

## P1BA-R4-05 Release URL exact shape

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: release URLs must have exactly six decoded path segments:
`/<owner>/<repo>/releases/download/<tag>/<asset>`. Extra segments, encoded
slash/backslash, repeated slashes, dot segments, control characters and empty
asset basenames are rejected.

Tests:

- `MANIFEST-056 Nested release path rejected`
- `MANIFEST-057 Encoded slash rejected`
- `MANIFEST-058 Encoded backslash rejected`
- `MANIFEST-059 Dot segment rejected`
- `MANIFEST-060 Exact six-segment release URL accepted`

## P1BA-R4-06 Artifact metadata types

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: artifact fields now receive explicit Python type checks. Names are
bounded basenames, `resolved_download_hosts` is a non-empty unique string list,
`size_bytes` is an integer greater than zero with booleans rejected, signatures
are role-specific, and `oci_digest` is allowed only for the OCI role.

Focused test:

- `MANIFEST-061 Bool size_bytes rejected`

## P1BA-R4-07 Minimal review bundle

Status: resolved.

Changed files:

- `PANKSTER_PHASE_1B_A_MANIFEST.json` in the review bundle
- `phase-1b-a-review-bundle-sha256.txt` in the review bundle

Resolution: Round 5 uses an explicit allowlist. It does not include `docs/**`
wholesale, business documents, Phase 0 files, Phase 1A archives, `__pycache__`
or `.pyc` files.

## P1BA-R4-08 Git hygiene

Status: resolved.

Resolution: root review artifacts are staged in a temporary review bundle area
and copied into the zip, not left as intended product commit inputs. Existing
prior review artifacts are moved to `/tmp/PANKSTER_PHASE_1B_A_ARCHIVE`.

## Validation commands

Required commands:

```bash
python3 tools/validate_backend_matrix.py
python3 -m unittest discover -s tools/tests -p 'test_installation_manifest*.py' -v
python3 tools/validate_installation_manifest.py --mode template docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json
python3 -m compileall -q tools
git diff --check
```

Additional Round 5 checks include production-install blocker, synthetic-install
success/failure, bundle allowlist validation, no `__pycache__`, no unrelated
business documents, patch apply, manifest/checksum verification, secret-pattern
scan and absolute-local-path scan.
