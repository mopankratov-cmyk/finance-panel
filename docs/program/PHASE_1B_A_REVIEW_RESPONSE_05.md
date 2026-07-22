# Phase 1B-A Review Response 05

This response addresses the Manifest Parser Finalization review. Scope remains
Phase 1B-A only. No backend was installed, no `sudo` was used, no VM/container
was started, no live Hermes runtime was changed, no credentials were read, no
owner approval was requested, and Phase 1B-B was not started.

## P1BA-R5-01 Duplicate JSON keys

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: `load_json()` now uses `object_pairs_hook=reject_duplicate_keys`.
Duplicate keys are rejected before Python dict materialization for envelopes,
manifest content, artifacts, approval records and nested objects.

Tests:

- `MANIFEST-062 Duplicate envelope JSON key rejected`
- `MANIFEST-063 Duplicate content JSON key rejected`
- `MANIFEST-064 Duplicate artifact JSON key rejected`
- `MANIFEST-065 Duplicate approval JSON key rejected`

Remaining limitations: duplicate-key rejection is implemented in the Python
validator; JSON Schema alone cannot detect duplicates after parsing.

## P1BA-R5-02 Backend disclosure policy

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: `BACKEND_DISCLOSURE_POLICIES` now makes Apple disk changes,
background services and required permissions explicit. Apple
`network_changes = ["NONE"]` remains allowed for preflight disclosure where
network enforcement has not yet been applied. Lima remains fail-closed.

Tests:

- `MANIFEST-066 Apple disk changes cannot be NONE`
- `MANIFEST-067 Apple background services cannot be NONE`
- `MANIFEST-068 Apple permissions cannot be NONE`
- `MANIFEST-069 Apple preflight network changes may be NONE`

Remaining limitations: Phase 1B-A still does not authorize any install.

## P1BA-R5-03 Unicode control characters

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: `contains_forbidden_unicode()` rejects Unicode categories `Cc` and
`Cf`. The validator applies this to critical list items, artifact names and
versions, signer fields, verification policy IDs, URL decoded segments,
provenance fields, approval IDs and hostnames handled through string-list
validation.

Tests:

- `MANIFEST-070 DEL character rejected`
- `MANIFEST-071 C1 control character rejected`
- `MANIFEST-072 Zero-width character rejected`
- `MANIFEST-073 Bidirectional override rejected`
- `MANIFEST-074 Encoded DEL in release URL rejected`

Remaining limitations: printable Unicode is still allowed where the field
allows Unicode.

## P1BA-R5-04 Future manifest timestamp

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: `validate_manifest_times()` now rejects manifests whose
`created_at` is more than five minutes in the future relative to the supplied
`now`.

Tests:

- `MANIFEST-075 Future manifest creation rejected`
- `MANIFEST-076 Creation within clock skew accepted`

Remaining limitations: validator tests use injected `now`; CLI mode uses the
current system clock.

## P1BA-R5-05 Supply-chain verification contract

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: free-text `verification_method` is removed. Artifact descriptors
now use `verification_policy_id`, `expected_signer_identity` and
`expected_signer_team_id`. Role-specific policies are:

- `backend-installer`: `apple-container-installer-v1`
- `linux-kernel`: `apple-container-release-asset-sha256-v1`
- `init-filesystem`: `apple-container-release-asset-sha256-v1`
- `synthetic-oci-manifest`: `oci-digest-pinned-v1`

Tests:

- `MANIFEST-077 Unknown verification policy rejected`
- `MANIFEST-078 Apple installer requires signer identity`
- `MANIFEST-079 Apple installer requires team identifier`
- `MANIFEST-080 Weak free-text verification method rejected`
- `MANIFEST-081 Correct role-specific verification policy accepted`

Remaining limitations: exact Apple signer identity and team ID may remain
`TO_BE_PINNED` in `TEMPLATE`; `READY_FOR_REVIEW` rejects placeholders.

## P1BA-R5-06 Duplicate list entries

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`

Resolution: critical disclosure lists and `resolved_download_hosts` now reject
duplicate normalized values. NFC normalization is applied before comparison.

Tests:

- `MANIFEST-082 Duplicate critical list item rejected`
- `MANIFEST-083 Unicode-normalized duplicate rejected`

Remaining limitations: JSON Schema `uniqueItems` cannot model NFC-normalized
duplicates; Python validator remains authoritative.

## P1BA-R5-07 Schema alignment

Status: resolved.

Changed files:

- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`
- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: JSON Schema now provides the structural validation layer for
artifact field names, required fields, policy enums, primitive type
expectations, length limits and `additionalProperties: false` posture. The
approval document records Python as the authoritative validator for parser-level
and security-sensitive semantics.

Tests:

- `MANIFEST-001..083`
- template manifest validation
- manifest content hash reproduction

Remaining limitations: Python remains authoritative for duplicate raw JSON
keys, canonical URL rules, NFC-normalized duplicates, Unicode security
categories, time relationships, backend-specific policies and approval
authorization modes.

## Validation commands

Required commands:

```bash
python3 tools/validate_backend_matrix.py
python3 -m unittest discover -s tools/tests -p 'test_installation_manifest*.py' -v
python3 tools/validate_installation_manifest.py --mode template docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json
python3 -m compileall -q tools
git diff --check
```

Additional Round 6 checks include patch apply, manifest/checksum verification,
minimal bundle allowlist, source-version scan, secret-pattern scan and
absolute-local-path scan.
