# Phase 1B-A Review Response 07

This response addresses the Trust Anchor Finalization review. Scope remains
Phase 1B-A only. No backend was installed, no `sudo` was used, no VM/container
was started, no live Hermes runtime was changed, no credentials were read, no
owner approval was requested, and Phase 1B-B was not started.

## P1BA-R7-01 Semantic absence markers

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.schema.json`
- `docs/program/PHASE_1B_INSTALLATION_MANIFEST.example.json`

Resolution: the validator now defines canonical `ABSENCE_MARKERS` and
`is_absence_marker()`. Comparison uses Unicode NFC normalization, trim,
casefold and internal-whitespace collapse. The only canonical explicit marker
is exact `NONE`.

Tests:

- `MANIFEST-094 Lowercase none disclosure rejected`
- `MANIFEST-095 N/A disclosure rejected`
- `MANIFEST-096 Not-applicable disclosure rejected`
- `MANIFEST-097 Unknown disclosure rejected`

## P1BA-R7-02 Backend disclosure enforcement

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: Apple disclosure policy now uses explicit `allow_absence` rules.
`disk_changes`, `background_services` and `required_permissions` reject all
absence markers. `network_changes` accepts only exact `["NONE"]` as a sole
canonical marker; mixed `NONE` lists and ambiguous synonyms fail closed.

Tests:

- `MANIFEST-098 Canonical network NONE accepted alone`
- `MANIFEST-099 NONE mixed with another value rejected`

## P1BA-R7-03 Release trust-anchor registry

Status: resolved.

Changed files:

- `docs/security/apple_container_release_trust_anchors.json`
- `tools/validate_release_trust_anchors.py`
- `tools/validate_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: the machine-readable registry
`docs/security/apple_container_release_trust_anchors.json` now records the
Apple Container 1.1.0 installer trust-anchor entry. Because exact signer
identity and Team ID are not independently confirmed, the entry is deliberately
`DRAFT`, not `PINNED`.

Implication:

```text
OWNER_APPROVAL_MANIFEST_NOT_READY
```

## P1BA-R7-04 Exact signer pinning

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: review mode performs preliminary signer format checks and then
requires exact equality with a `PINNED` release trust anchor. Valid-looking but
unpinned signer values fail with `RELEASE_TRUST_ANCHOR_MISMATCH` or
`RELEASE_TRUST_ANCHOR_NOT_PINNED`.

Tests:

- `MANIFEST-107 Valid-looking unpinned signer rejected`
- `MANIFEST-108 Missing pinned trust anchor rejected`

## P1BA-R7-05 Exact Team ID pinning

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`
- `docs/program/PHASE_1B_INSTALLATION_APPROVAL.md`

Resolution: Team ID regex validation remains a preliminary check. Review mode
then requires exact equality with the pinned trust-anchor Team ID.

Tests:

- `MANIFEST-104 Fake-looking Team ID rejected`
- `MANIFEST-105 Team ID trust-anchor mismatch rejected`
- `MANIFEST-106 Exact pinned Team ID accepted`

## P1BA-R7-06 Generic signer rejection

Status: resolved.

Changed files:

- `tools/validate_installation_manifest.py`
- `tools/tests/test_installation_manifest.py`

Resolution: signer suffixes after `Developer ID Installer:` are normalized and
checked independently. Generic suffixes such as `Unknown`, `Unsigned`, `Fake`
and `Any Signer` are rejected before trust-anchor comparison.

Tests:

- `MANIFEST-100 Unknown signer rejected`
- `MANIFEST-101 Unsigned signer rejected`
- `MANIFEST-102 Fake signer rejected`
- `MANIFEST-103 Generic signer suffix rejected`

## P1BA-R7-07 Trust-anchor validator

Status: resolved.

Changed files:

- `tools/validate_release_trust_anchors.py`
- `tools/validate_installation_manifest.py`
- `docs/security/apple_container_release_trust_anchors.json`

Resolution: `tools/validate_release_trust_anchors.py` validates duplicate
entries, exact fields, canonical repository, strict semver, canonical asset
basename, allowed status, signer and Team ID format for pinned anchors,
placeholder/generic rejection for pinned anchors, timestamps, Unicode
control/format characters and secret-shaped values. `DRAFT` anchors can pass
registry validation but cannot satisfy installation manifest review mode.

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

Additional Round 8 checks include patch apply, manifest/checksum verification,
minimal bundle allowlist, source-version scan, secret-pattern scan and
absolute-local-path scan.
