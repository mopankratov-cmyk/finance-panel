# Phase 1A Test Plan

Phase 1A verifies synthetic security behavior without reading real credentials,
starting profiles, or changing Hermes runtime.

## Test classes

| Class | Meaning |
| --- | --- |
| Baseline characterization | Confirms current unsafe behavior using synthetic fixtures. Passing means the vulnerability was reproduced. |
| Safe prototype | Confirms the proposed policy fails closed and preserves required non-secret runtime values. |
| Isolation feasibility | Records read-only host capability and avoids claiming isolation from binary presence alone. |

## Coverage

| Test ID | File | Expected classification |
| --- | --- | --- |
| SEC-BL-001 | `security/tests/test_baseline_env_inheritance.py` | BASELINE_VULNERABILITY_CONFIRMED |
| SEC-BL-002 | `security/tests/test_root_fallback_fixture.py` | BASELINE_VULNERABILITY_CONFIRMED |
| SEC-BL-003 | `security/tests/test_root_fallback_fixture.py` | BASELINE_VULNERABILITY_CONFIRMED |
| SEC-BL-004 | `security/tests/test_context_propagation.py` | BASELINE_PARTIALLY_CONFIRMED |
| SEC-BL-005 | `security/tests/test_disabled_profile_gate.py` | BASELINE_VULNERABILITY_CONFIRMED |
| SEC-BL-006 | `security/tests/test_no_proxy_preservation.py` | BASELINE_VULNERABILITY_CONFIRMED |
| SEC-PROT-001..014 | `security/tests/test_*.py` | PASS |
| SEC-PROT-015 | `security/tests/test_safe_spawn_happy_path.py` | PASS |
| SEC-PROT-016 | `security/tests/test_context_propagation.py` | PASS |
| SEC-PROT-017..019 | `security/tests/test_safe_env_policy.py` | PASS |
| SEC-PROT-020 | `security/tests/test_patch_contracts.py` | PASS |
| SEC-PROT-021 | `security/tests/test_log_redaction.py` | PASS |
| SEC-PROT-022 | `security/tests/test_evidence_pack.py` | PASS |
| SEC-PROT-023 | `security/tests/test_safe_env_policy.py` | PASS |
| SEC-PROT-024..026 | `security/tests/test_log_redaction.py` | PASS |
| SEC-PROT-027..030 | `security/tests/test_safe_env_policy.py` | PASS |
| SEC-PROT-031..032 | `security/tests/test_generate_evidence.py` | PASS |
| SEC-PROT-033..036 | `security/tests/test_log_redaction.py` | PASS |
| SEC-PROT-037..041 | `security/tests/test_generate_evidence.py` | PASS |
| SEC-PROT-042..052 | `security/tests/test_generate_evidence.py` | PASS |
| SEC-ISO-001..004 | `security/tests/test_filesystem_isolation_probe.py` | PASS |

## Registry and evidence source

Every required security control ID is mapped through
`security/src/pankster_security_harness/test_registry.py`.

- Required IDs: `SEC-BL-001..006`, `SEC-PROT-001..052`, `SEC-ISO-001..004`.
- Registry keys are module-qualified test identities, not short function names.
- Helper tests may execute without a SEC-ID, but they do not count as control PASS.
- Unknown, missing, or duplicate SEC-IDs fail evidence generation.
- `safe-prototype-results.json` is derived from actual `unittest` observations, including `test_identity` and `test_name`.
- `baseline-results.json` is derived from actual baseline test execution plus registered `BaselineResult` objects.
- Evidence generation refuses to write when the suite has any FAIL or ERROR, when `wasSuccessful()` is false, or when observation accounting differs from `unittest` `testsRun`.

## Evidence publication model

Evidence is published through a versioned generation pointer:

```text
security/evidence/current.json
security/evidence/generations/<pack_id>/
```

`current.json` contains the current `pack_id` and the SHA-256 of that
generation's manifest. Readers do not read arbitrary top-level JSON files.
Failed writes preserve the previous pointer. A failed write after generation
creation may leave an orphan generation, but it is not authoritative until the
pointer is swapped.

## Redaction and evidence boundary

`assert_no_sentinel()` and `assert_no_secret_shape()` validate a raw JSON/string
rendering of the checked object. They do not call redaction first. Known
synthetic sentinel redaction occurs only in `redact_value()` and
`sanitize_for_evidence()`.

`EvidenceEvent.event_type` now passes through the same evidence boundary as
payload:

- known synthetic sentinel in `event_type` becomes `[REDACTED_SENTINEL]`;
- generic secret-shaped material in `event_type` fails closed;
- nested sentinel structures are redacted before final raw assertions.

## Host-bound isolation evidence

`isolation-inventory.json` includes a sanitized host fingerprint with only:

- `system`
- `machine`
- `probe_version`

It intentionally excludes hostname, username, home path, serial numbers, device
IDs and other stable host identifiers.

Portable evidence checks compare baseline results, safe prototype results,
test summary, schemas, registry and policy version. Host-bound checks validate
the recorded inventory schema and decision. On a host fingerprint mismatch,
ordinary `--check` reports the mismatch but does not mark portable evidence
stale; `--check --require-same-host` fails closed.

## Command

```bash
cd security
PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Current result:

```text
Ran 66 tests in 0.225s
OK
```

## Required checks

- `compileall`
- `git diff --check`
- manifest verification
- evidence sentinel scan
- secret-shaped scan
- evidence values scan
- `PYTHONPATH=src python3 tools/generate_evidence.py --check`
- `PYTHONPATH=src python3 tools/generate_evidence.py --check --require-same-host`
- files-outside-allowed-scope check
