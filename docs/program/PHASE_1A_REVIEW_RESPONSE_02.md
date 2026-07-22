# Phase 1A Review Response 02

Reviewer verdict: `CHANGES_REQUESTED`.

## P1A-R2-01 Secret-shaped env values

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/env_policy.py`, `security/tests/test_safe_env_policy.py`
- Resolution: Final environment values are scanned with the generic detector and rejected with sanitized `EnvironmentPolicyError`.
- Tests: `SEC-PROT-023`
- Remaining limitations: Detector is a boundary guardrail, not permission to pass real secrets.

## P1A-R2-02 Evidence boundary

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/evidence.py`, `security/src/pankster_security_harness/redaction.py`, `security/tests/test_log_redaction.py`
- Resolution: Evidence redacts known synthetic sentinels but rejects unknown generic secret-shaped values, URL userinfo and private-key blocks.
- Tests: `SEC-PROT-024`, `SEC-PROT-025`, `SEC-PROT-026`
- Remaining limitations: Evidence remains synthetic-only.

## P1A-R2-03 TMPDIR write-before-validation

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/env_policy.py`, `security/tests/test_safe_env_policy.py`
- Resolution: `session_id` and path boundary are validated before `mkdir()`, including traversal and symlink parent checks.
- Tests: `SEC-PROT-027`, existing symlink escape test
- Remaining limitations: No production filesystem isolation is claimed.

## P1A-R2-04 Context-scoped Kanban env

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/env_policy.py`, `security/src/pankster_security_harness/runtime_context.py`, `security/tests/test_safe_env_policy.py`
- Resolution: Kanban env uses global catalog intersected with the current context allowlist.
- Tests: `SEC-PROT-028`, `SEC-PROT-029`, `SEC-PROT-030`
- Remaining limitations: Future Kanban names require policy version update.

## P1A-R2-05 Automated evidence generation

- Status: RESOLVED
- Changed files: `security/tools/generate_evidence.py`, `security/tests/test_generate_evidence.py`, `security/evidence/*.json`
- Resolution: Evidence is generated atomically from one timestamp/harness version and actual unittest counts; `--check` detects stale evidence.
- Tests: `SEC-PROT-031`, `SEC-PROT-032`
- Remaining limitations: Generator runs synthetic tests only.

## P1A-R2-06 Baseline observed contract

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/baseline.py`, baseline tests
- Resolution: `BaselineResult` now requires `observed: bool` and separate `observation: str`, with classification consistency validation.
- Tests: baseline result contract test plus `SEC-BL-001..006`
- Remaining limitations: Baseline remains synthetic characterization.

## P1A-R2-07 Profile ID validation

- Status: RESOLVED
- Changed files: `security/src/pankster_security_harness/runtime_context.py`, `security/tests/test_patch_contracts.py`
- Resolution: `profile_id` and `session_id` share the restricted safe identifier regex and reject slash, backslash, traversal, control characters and whitespace edges.
- Tests: focused profile/session ID negative tests
- Remaining limitations: Production identity issuance remains future Hermes core work.
