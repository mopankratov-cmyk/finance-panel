# Phase 1B-A Review Response 06

This response addresses the Canonical Supply-Chain Gate review. Scope remains
Phase 1B-A only. No backend was installed, no `sudo` was used, no VM/container
was started, no live Hermes runtime was changed, no credentials were read, no
owner approval was requested, and Phase 1B-B was not started.

## P1BA-R6-01 Explicit URL port

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: `validate_github_release_url()` now requires the canonical GitHub
release origin:

- `parsed.scheme == "https"`
- `parsed.hostname == "github.com"`
- `parsed.port is None`
- `parsed.netloc == "github.com"`

Explicit ports, including `:443` and non-standard ports, are rejected. The JSON
Schema source URL regex remains anchored to `https://github.com/...`, so it
does not admit explicit ports at the structural-validation layer.

Tests:

- `MANIFEST-084 Explicit HTTPS port rejected`
- `MANIFEST-085 Nonstandard port rejected`

## P1BA-R6-02 Canonical release path

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: the current Apple release URL contract forbids percent-encoding in
the whole release path. The owner, repository, literal `releases/download`
segments, release tag and asset basename must appear in canonical unencoded
form and still match the manifest backend version and artifact name exactly.

Tests:

- `MANIFEST-086 Encoded repository owner rejected`
- `MANIFEST-087 Encoded repository name rejected`
- `MANIFEST-088 Encoded release tag rejected`
- `MANIFEST-089 Canonical unencoded release URL accepted`

## P1BA-R6-03 Apple signer identity

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: for `apple-container-cli` `backend-installer` artifacts in
`READY_FOR_REVIEW`, `expected_signer_identity` must match:

```text
^Developer ID Installer: .{1,180}$
```

It must not be `not_applicable`, a placeholder, a generic value such as
`unknown`, `unsigned` or `any signer`, contain leading/trailing whitespace, or
contain Unicode control/format characters. Template mode may still contain
`TO_BE_PINNED`.

Tests:

- `MANIFEST-090 Installer signer not_applicable rejected`
- `MANIFEST-091 Invalid Apple signer identity rejected`
- `MANIFEST-093 Valid Apple signer format accepted`

## P1BA-R6-04 Apple Team ID

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: for `apple-container-cli` `backend-installer` artifacts in
`READY_FOR_REVIEW`, `expected_signer_team_id` must match:

```text
^[A-Z0-9]{10}$
```

It must not be `not_applicable`, a placeholder, a repeating-character value or
a generic example ID. Template mode may still contain `TO_BE_PINNED`.

Tests:

- `MANIFEST-092 Invalid Apple Team ID rejected`
- `MANIFEST-093 Valid Apple signer format accepted`

## P1BA-R6-05 Schema authority wording

Status: resolved.

Changed files:

- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`
- `docs/program/PHASE_1B_A_REVIEW_RESPONSE_05.md`
- `docs/program/PHASE_1B_A_REVIEW_RESPONSE_06.md`

Resolution: the documentation no longer claims complete JSON Schema/Python
validator parity. It states that JSON Schema provides structural validation,
while the Python validator is authoritative for:

- duplicate raw keys;
- canonical URL rules;
- NFC-normalized duplicates;
- Unicode security categories;
- time relationships;
- backend-specific policies;
- approval authorization modes.

## Exact verification semantics

`READY_FOR_REVIEW` manifests pin the expected Apple installer signer identity
and Team ID. Phase 1B-B package verification must compare actual `pkgutil` and
`spctl` output against the exact values in the approved manifest. Pattern
validation alone does not establish trust. Signer mismatch requires:

```text
INSTALLATION_DENIED
```

This applies even if SHA-256 matches a package obtained from another source.

## Validation commands

Required commands:

```bash
python3 tools/validate_backend_matrix.py
python3 -m unittest discover -s tools/tests -p 'test_installation_manifest*.py' -v
python3 tools/validate_installation_manifest.py --mode template docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json
python3 -m compileall -q tools
git diff --check
```

Additional Round 7 checks include patch apply, manifest/checksum verification,
minimal bundle allowlist, source-version scan, secret-pattern scan and
absolute-local-path scan.
