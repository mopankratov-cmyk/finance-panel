# Phase 1B-A Review Response 08

This response addresses the Trusted Registry Root Gate review. Scope remains
Phase 1B-A only. No backend was installed, no `sudo` was used, no VM/container
was started, no live Hermes runtime was changed, no credentials were read, no
owner approval was requested, and Phase 1B-B was not started.

## P1BA-R8-01 CWD trust-root substitution

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: trust-anchor registry discovery is rooted at the validator file
location:

```text
PROJECT_ROOT = Path(__file__).resolve().parents[1]
```

Review and install modes do not use `os.getcwd()` and do not accept a
security-sensitive arbitrary registry path from the CLI.

Tests:

- `MANIFEST-109 Malicious CWD registry ignored`
- `MANIFEST-110 Review cannot use CWD-controlled PINNED anchor`
- `MANIFEST-111 Synthetic install cannot use CWD-controlled PINNED anchor`

## P1BA-R8-02 Canonical registry path

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: `resolve_trusted_registry_path()` requires an absolute path that
exists, is a regular file and resolves exactly to:

```text
docs/security/apple_container_release_trust_anchors.json
```

Evidence exposes only the project-relative path, never the absolute local path.

Tests:

- `MANIFEST-112 Committed registry path is canonical`

## P1BA-R8-03 Registry symlink handling

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: the trusted path helper rejects symlinks for `docs`,
`docs/security` and the registry file itself. Symlink rejection is explicit:

```text
TRUST_ANCHOR_REGISTRY_SYMLINK_REJECTED
```

Tests:

- `MANIFEST-113 Registry symlink rejected`

## P1BA-R8-04 Registry SHA-256

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/validate_release_trust_anchors.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: registry digest is computed from raw committed bytes after
canonical path resolution, not from a reserialized Python object. JSON evidence
contains:

```json
{
  "trust_anchor_registry_path": "docs/security/apple_container_release_trust_anchors.json",
  "trust_anchor_registry_sha256": "<64 hex>",
  "trust_anchor_schema_version": "pankster.release-trust-anchors.v1"
}
```

## P1BA-R8-05 Approval digest binding

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL_RECORD.schema.json`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`
- `docs/security/PHASE_1B_EXPERIMENT_PLAN.md`

Resolution: approval records now require `trust_anchor_registry_sha256`.
`synthetic-install` compares the approval record value with the actual
committed registry digest. Mismatch fails closed:

```text
TRUST_ANCHOR_REGISTRY_HASH_MISMATCH
```

Tests:

- `MANIFEST-114 Registry hash mismatch rejected`
- `MANIFEST-115 Exact committed registry hash accepted`

## P1BA-R8-06 Malicious CWD regression tests

Status: resolved.

Changed files:

- `tools/tests/test_installation_manifest.py`

Resolution: regression tests create a temporary malicious CWD containing its
own `docs/security/apple_container_release_trust_anchors.json` with a pinned
`Developer ID Installer: Evil Corp` / `EVIL123456` anchor. Validators are
invoked by absolute script path from that CWD. Review and synthetic-install do
not return PASS because the committed project registry remains authoritative
and currently `DRAFT`.

Tests:

- `MANIFEST-109`
- `MANIFEST-110`
- `MANIFEST-111`

## P1BA-R8-07 Git base provenance

Status: resolved in review artifact generation.

Bundle manifest fields:

- `base_commit`
- `phase_1a_commit`
- `repository_commit`
- `branch`
- `working_tree_state`

Current provenance:

```text
base_commit: fa088e24b6e87a92f98b056049f0d1a9b7007b74
phase_1a_commit: fa088e24b6e87a92f98b056049f0d1a9b7007b74
repository_commit: null
working_tree_state: UNCOMMITTED_REVIEW
branch: phase/1b-a-isolation-backend-selection
```

`repository_commit` is intentionally `null` because Phase 1B-A files are still
uncommitted review material.

## P1BA-R8-08 Patch reproducibility

Status: resolved in review artifact generation.

The Round 9 bundle records:

- base commit;
- branch;
- HEAD;
- working-tree status;
- patch SHA-256;
- `git apply --check` result against a temporary checkout of `base_commit`.

The previous empty-repository patch check remains an additional check, not a
replacement for the base-commit check.

## Validation commands

Required commands:

```bash
python3 tools/validate_backend_matrix.py
python3 tools/validate_release_trust_anchors.py docs/security/apple_container_release_trust_anchors.json
python3 -m unittest discover -s tools/tests -p 'test_installation_manifest*.py' -v
python3 tools/validate_installation_manifest.py --mode template docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json
python3 -m compileall -q tools
git diff --check
```

Additional Round 9 checks include malicious-CWD review and synthetic probes,
registry symlink regression tests, registry digest mismatch tests, JSON-output
sanitization, full base-commit patch apply, bundle checksum verification,
secret-pattern scan and absolute-local-path scan.
