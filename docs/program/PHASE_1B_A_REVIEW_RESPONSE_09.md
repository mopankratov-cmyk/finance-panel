# Phase 1B-A Review Response 09

This response addresses the Authoritative API Final Gate review. Scope remains
Phase 1B-A only. No backend was installed, no `sudo` was used, no VM/container
was started, no live Hermes runtime was changed, no credentials were read, no
owner approval was requested, and Phase 1B-B was not started.

## P1BA-R9-01 Programmatic registry injection

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: public operational validators no longer accept `trust_anchors`,
`trust_anchor_registry_metadata`, `registry_snapshot`, `registry_path` or other
registry override parameters. Programmatic attacker registry injection is not
part of the public authorization API.

Tests:

- `MANIFEST-116 Public review API rejects registry injection`
- `MANIFEST-117 Public synthetic API rejects registry injection`

## P1BA-R9-02 Safe public API

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: the operational public signatures are:

```python
validate_review_manifest(manifest, *, now=None)
validate_synthetic_install(record, manifest, *, now=None)
```

Both wrappers always call `load_release_trust_anchor_registry()` and therefore
use the committed project registry.

Tests:

- public signature inspection in `MANIFEST-116`
- public signature inspection in `MANIFEST-117`
- `MANIFEST-120 Public API always loads committed registry`

## P1BA-R9-03 Immutable RegistrySnapshot

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: trust-anchor state is represented as an immutable
`RegistrySnapshot` with:

- anchors;
- project-relative path;
- raw SHA-256;
- schema version;
- `source_kind`.

The authoritative loader creates snapshots with:

```text
COMMITTED_PROJECT_REGISTRY
```

Unit tests may build snapshots with:

```text
TEST_FIXTURE
```

## P1BA-R9-04 Authoritative source-kind enforcement

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: operational `PASS` is allowed only when
`registry_snapshot.source_kind == COMMITTED_PROJECT_REGISTRY`. Attempting to
convert test-fixture validation into operational authorization fails with:

```text
NON_AUTHORITATIVE_TRUST_REGISTRY
```

Tests:

- `MANIFEST-121 Synthetic approval cannot bind attacker metadata`
- `MANIFEST-123 Private core is not exposed as operational authorization`

## P1BA-R9-05 Test-only validation result

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: test-only helpers return:

```json
{
  "result": "TEST_ONLY_PASS",
  "authoritative": false,
  "registry_source_kind": "TEST_FIXTURE"
}
```

They are private helpers, are not called by the CLI, and do not produce normal
`PASS`.

Tests:

- `MANIFEST-118 Test fixture cannot produce operational PASS`
- `MANIFEST-119 Test fixture result marked non-authoritative`

## P1BA-R9-06 CLI/public API equivalence

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: CLI review and synthetic-install modes call only public
operational wrappers. The CLI has no custom registry, test registry,
registry override or trust-anchor injection flags.

Tests:

- `MANIFEST-122 CLI and public API use identical registry digest`

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

Additional Round 10 checks include programmatic attacker registry probes,
programmatic attacker metadata probes, public signature inspection,
`TEST_FIXTURE` source-kind assertions, committed-registry `DRAFT` denial,
malicious-CWD probes, registry symlink regressions, registry digest mismatch,
full base-commit patch apply, manifest/checksum verification and sanitized
bundle scans.
