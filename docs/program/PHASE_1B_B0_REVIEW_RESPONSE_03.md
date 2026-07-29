# Phase 1B-B0 Review Response 03

Status: `PASS_FOR_OWNER_APPROVAL_PACKET`

Phase 1B-B0 Round 3 initially failed closed because no decoder was found on the
default system path. The continuation pass found an already present zstd
decoder in the bundled Codex runtime, downloaded the pinned Kata archive for
read-only verification, and completed the archive inspection without installing
dependencies or starting any runtime.

## What changed

- Added a Phase 1B-B0 command evidence schema:
  `security/schemas/phase_1b_b0_command_evidence.schema.json`.
- Added `tools/generate_phase_1b_b0_evidence.py`.
- Generated command evidence for existing local archive-inspection capabilities.
- Downloaded the pinned Kata release archive with `curl --http1.0` range
  requests after normal GET attempts hit local TLS transport errors.
- Verified the outer Kata archive SHA-256:
  `f63d54507d1f18635d94475077e4c2330de4d8e05cedf25f7c38f063b0e66a91`.
- Inspected the archive read-only with the existing zstd decoder and `tar`.
- Found expected kernel member:
  `opt/kata/share/kata-containers/vmlinux-6.18.15-186`.
- Recorded inner kernel SHA-256:
  `2fe4a58d2885d623bcb4d705900ac8c1d4f02371152da8126b3b00c8c47fc3a1`.
- Recorded inner kernel size: `16151040`.
- Added `security/evidence/phase-1b-b0/kata-archive-inspection.json`.
- Added `security/evidence/phase-1b-b0/evidence-pack-manifest.json`.
- Added `docs/security/phase_1b_b0_artifact_pin_registry.json`.
- Updated `tools/validate_installation_manifest.py` so operational review and
  synthetic-install validation load the committed artifact pin registry and fail
  closed unless it is `PINNED`.
- Current committed artifact pin registry status is:
  `PINNED`.
- Updated owner approval packet to:
  `OWNER_APPROVAL_REQUIRED`.
- Added the exact owner approval command to the packet. Codex did not execute
  that approval and did not proceed to Phase 1B-B1.
- Added R3 regression tests for the pinned artifact registry, evidence binding,
  evidence pack presence, Kata inspection success, and owner packet readiness.

## Why no longer blocked

The default system path still lacks `zstd`, `unzstd`, `zstdcat`, `7zz`, and
Python `zstandard`, but an already installed zstd executable exists in the
bundled Codex runtime:

```text
~/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/poppler/bin/zstd
```

Using that existing decoder is not an installation or dependency operation. The
archive was inspected through stdout; no archive contents were installed or
executed.

## Validation

Executed:

```text
python3 -m unittest tools.tests.test_installation_manifest
Ran 152 tests — OK

python3 -m unittest discover -s tools/tests -p 'test_*.py'
Ran 152 tests — OK

python3 tools/validate_release_trust_anchors.py docs/security/apple_container_release_trust_anchors.json
OK

python3 tools/validate_installation_manifest.py --mode review docs/program/PHASE_1B_INSTALLATION_MANIFEST.ready.json --json
PASS

git diff --check
OK
```

## Forbidden actions confirmation

Not performed:

- no installer execution;
- no `sudo`;
- no Apple Container startup;
- no VM/container startup;
- no service startup;
- no launchd/firewall/network changes;
- no production credentials;
- no owner approval;
- no Phase 1B-B1 work.

## Completion status

```text
PASS_FOR_OWNER_APPROVAL_PACKET
```
