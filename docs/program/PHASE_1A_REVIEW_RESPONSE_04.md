# Phase 1A Review Response 04

This response addresses the Final Evidence Gate correction round for Phase 1A.
Scope remains synthetic-only. No live Hermes runtime, credentials, profiles,
gateway, Kanban database, launchd jobs, production integrations, dependency
operations, network calls, model calls, commits, deployment actions, or Phase
1B work were performed.

## P1A-R4-01 Test identity collision

Status: resolved.

Changed files:

- `security/src/pankster_security_harness/test_registry.py`
- `security/tools/generate_evidence.py`
- `security/tests/_loader.py`
- `security/tests/test_generate_evidence.py`

Resolution: test observations and registry entries now use module-qualified
test execution identities. Short names are retained only as display metadata.
Duplicate execution identities fail closed instead of overwriting earlier
results.

Tests:

- `SEC-PROT-042 Duplicate short names do not collide`
- `SEC-PROT-045 Failure cannot be overwritten by later PASS`

Remaining limitations: identity is module-qualified for the current unittest
function-test harness; future class-based tests must preserve unique unittest
IDs.

## P1A-R4-02 wasSuccessful fail-closed

Status: resolved.

Changed files:

- `security/tools/generate_evidence.py`
- `security/tests/test_generate_evidence.py`

Resolution: evidence generation checks `run["successful"]` and refuses to
build evidence even if a malformed summary claims zero failures.

Tests:

- `SEC-PROT-043 unsuccessful suite rejected even with failed count zero`

Remaining limitations: this is a generator-level guard, not a production Hermes
runtime control.

## P1A-R4-03 Observation accounting

Status: resolved.

Changed files:

- `security/tools/generate_evidence.py`
- `security/tests/test_generate_evidence.py`

Resolution: summary accounting is derived from `unittest` result fields:
`testsRun`, `failures`, `errors`, `skipped`, and `wasSuccessful()`. Generation
requires `passed + failed + errors + skipped == tests_run` and observation count
equal to `testsRun`.

Tests:

- `SEC-PROT-044 observation count must equal testsRun`

Remaining limitations: helper tests can remain unregistered, but they are
included in accounting and do not count as security-control PASS.

## P1A-R4-04 Cross-host portable check

Status: resolved.

Changed files:

- `security/tools/generate_evidence.py`
- `security/tests/test_generate_evidence.py`

Resolution: ordinary `--check` compares portable artifacts and validates the
recorded host inventory. If the host fingerprint differs, it reports
`HOST_FINGERPRINT_MISMATCH` and does not compare host-bound options against the
current machine. `--check --require-same-host` fails closed on mismatch.

Tests:

- `SEC-PROT-046 Cross-host check does not report stale evidence`

Remaining limitations: cross-host mode intentionally does not prove current-host
isolation capability.

## P1A-R4-05 Host inventory revalidation

Status: resolved.

Changed files:

- `security/tools/generate_evidence.py`
- `security/tests/test_generate_evidence.py`

Resolution: recorded host inventory is revalidated for schema, enum values,
secret/path absence, internal decision consistency, and fail-closed production
gate.

Tests:

- `SEC-PROT-047 Same-host check detects changed host inventory`
- `SEC-PROT-048 Recorded host inventory decision is revalidated`

Remaining limitations: Phase 1A still records binary inventory only; it does
not execute isolation backends.

## P1A-R4-06 Atomic evidence generations

Status: resolved.

Changed files:

- `security/tools/generate_evidence.py`
- `security/evidence/README.md`
- `security/tests/test_evidence_pack.py`
- `security/tests/test_generate_evidence.py`

Resolution: evidence is published as a full generation under
`security/evidence/generations/<pack_id>/` with a generation manifest. The only
authoritative publication step is an atomic replacement of `current.json`.

Tests:

- `SEC-PROT-052 Successful pointer swap exposes one complete generation`

Remaining limitations: orphan generations are allowed after interrupted writes
and can be cleaned later by a separate maintenance task.

## P1A-R4-07 Crash recovery tests

Status: resolved.

Changed files:

- `security/tools/generate_evidence.py`
- `security/tests/test_generate_evidence.py`

Resolution: injected failure points verify that the old pointer survives
failure before generation rename, after generation creation, and during pointer
creation.

Tests:

- `SEC-PROT-049 Failure before generation rename preserves old current`
- `SEC-PROT-050 Failure after generation creation but before pointer swap preserves old current`
- `SEC-PROT-051 Failure during pointer creation preserves old current`

Remaining limitations: tests simulate local filesystem failures; they do not
model disk corruption outside Python's control.

## Current validation result

```text
cd security
PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py' -v
Ran 66 tests
OK

PYTHONPATH=src python3 tools/generate_evidence.py --check
PORTABLE_EVIDENCE_OK
HOST_INVENTORY_OK
```

## Final Phase 1A readiness statement

- `HARNESS_READY`
- `SAFE_POLICY_PROTOTYPE_READY`
- `PRODUCTION_ISOLATION_BACKEND_BLOCKED`

This response does not claim `PRODUCTION_SECURE`.
