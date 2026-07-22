# Phase 1A Review Response 01

Reviewer verdict: `CHANGES_REQUESTED`.

## P1A-R1-01 Review bundle

- Status: RESOLVED
- Changed files: `PANKSTER_PHASE_1A_MANIFEST.json`, `phase-1a.patch`, `phase-1a.diffstat`, `phase-1a-git-status.txt`, `phase-1a-report.txt`, `review-bundle-sha256.txt`
- Resolution: Added required review artifacts and Round 2 archive.
- Evidence: Manifest verification and bundle hash.
- Remaining limitations: Patch is for review only; no push or merge performed.

## P1A-R1-02 Isolation tests

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/isolation_probe.py`, `security/tests/test_filesystem_isolation_probe.py`, `docs/security/ISOLATION_FEASIBILITY.md`
- Resolution: Replaced truthy string checks with structured capability enums and blocked production recommendation unless all required boundaries are proven.
- Evidence: `SEC-ISO-001..004`.
- Remaining limitations: No isolation runtime was started or installed.

## P1A-R1-03 Safe spawn happy path

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/spawn_prototype.py`, `security/tests/test_safe_spawn_happy_path.py`
- Resolution: Added timeout, exit-code evidence, stderr assertion and schema-like event checks.
- Evidence: `SEC-PROT-015`.
- Remaining limitations: Fixture subprocess only; no Hermes profile spawn.

## P1A-R1-04 Credential grants

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/grants.py`, `security/src/pankster_security_harness/runtime_context.py`, `security/tests/test_patch_contracts.py`
- Resolution: Added strict grant reference validator and negative cases.
- Evidence: `SEC-PROT-020`.
- Remaining limitations: Broker semantics remain future Phase 1B/core work.

## P1A-R1-05 Environment policy

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/env_policy.py`, `security/tests/test_safe_env_policy.py`, `docs/security/SAFE_SPAWN_PROTOTYPE.md`
- Resolution: Removed wildcard Kanban allowlist, added profile-scoped TMPDIR and symlink escape rejection.
- Evidence: `SEC-PROT-017`, `SEC-PROT-018`, `SEC-PROT-019`.
- Remaining limitations: Future Kanban vars require policy version update.

## P1A-R1-06 Evidence minimization

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/env_policy.py`, `security/src/pankster_security_harness/redaction.py`, `security/tests/test_log_redaction.py`
- Resolution: Removed env values and redacted env values from evidence event contract; added generic secret-shape detector.
- Evidence: `SEC-PROT-021`, `SEC-PROT-022`.
- Remaining limitations: Detector is a guardrail, not a substitute for never serializing sensitive values.

## P1A-R1-07 Baseline classifications

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/baseline.py`, baseline tests
- Resolution: Added `BaselineResult` and removed no-op classification asserts.
- Evidence: `SEC-BL-001..006`.
- Remaining limitations: Baseline remains synthetic characterization.

## P1A-R1-08 Same-UID child test

- Status: RESOLVED
- Changed files: `security/tests/test_root_fallback_fixture.py`
- Resolution: Child subprocess now starts with synthetic profile env and reads synthetic root auth path.
- Evidence: `SEC-BL-002`.
- Remaining limitations: Same UID is modeled; no real home/auth paths touched.

## P1A-R1-09 Context isolation

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/runtime_context.py`, `security/tests/test_context_propagation.py`
- Resolution: Added background helper and reused-pool context bleed prevention test.
- Evidence: `SEC-PROT-016`.
- Remaining limitations: Python executor fixture only.

## P1A-R1-10 Runtime validation

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/runtime_context.py`, `security/tests/test_patch_contracts.py`
- Resolution: Added network policy validation, safe session ID, canonical workspace roots and strict grant validation.
- Evidence: runtime validation tests.
- Remaining limitations: Production context issuer not implemented in Phase 1A.

## P1A-R1-11 Evidence pack

- Status: RESOLVED
- Changed files: `security/evidence/*.json`, `security/tests/test_evidence_pack.py`
- Resolution: Added sanitized evidence JSON files with schema, timestamp, harness version, test IDs and synthetic-only scope.
- Evidence: evidence pack test, sentinel scan and secret-shaped scan.
- Remaining limitations: Evidence is generated from synthetic tests, not live runtime.
