# Phase 1A Decision Log

## DEC-1A-001: Keep Phase 1A standalone

- Decision: Build the harness under `security/` as a standalone Python stdlib package.
- Reason: Phase 1A must not patch or import live Hermes runtime code.
- Consequence: The harness models known credential and context paths through fixtures and contracts, not through live profile execution.

## DEC-1A-002: Use unittest runner

- Decision: Use `python3 -m unittest discover` with `PYTHONPATH=src`.
- Reason: The host Python does not include pytest and Phase 1A forbids dependency installation.
- Consequence: Tests remain dependency-free and reproducible on the current Mac.

## DEC-1A-003: Treat sandbox-exec as discovered but unvalidated

- Decision: Record `sandbox-exec` as `DISCOVERED_BUT_UNVALIDATED`, not production-ready isolation.
- Reason: It is installed on this Mac, but command presence does not prove credential, filesystem and network isolation for Hermes workers.
- Consequence: Production isolation gate is `BLOCKED_ON_BACKEND_SELECTION`.

## DEC-1A-004: Use finite Kanban environment allowlist

- Decision: Remove `HERMES_KANBAN_*` wildcard and allow only documented Kanban variables.
- Reason: Wildcards can accidentally admit future sensitive variables.
- Consequence: Adding a new Kanban variable requires policy version change, a focused test and a decision-log entry.

## DEC-1A-005: Minimize evidence

- Decision: Evidence records env keys and value metadata, not values or redacted values.
- Reason: Redacted values can still leak shape, length or operational hints.
- Consequence: Evidence remains useful for audit without serializing secret-bearing payloads.

## DEC-1A-006: Fail closed on secret-shaped values

- Decision: Reject generic secret-shaped environment and evidence values instead of redacting unknown material.
- Reason: Unknown real secrets should not be transformed into artifacts when generation can safely stop.
- Consequence: Evidence generation and environment construction fail with sanitized errors naming only the field/key.

## DEC-1A-007: Scope Kanban environment per context

- Decision: Use global Kanban name catalog plus per-context allowlist grants.
- Reason: A globally known Kanban variable should not automatically enter every profile/run environment.
- Consequence: Policy version advanced to `phase1a.v3`.

## DEC-1A-008: Generate evidence automatically

- Decision: Generate `security/evidence/*.json` through `security/tools/generate_evidence.py`.
- Reason: Manual JSON edits caused stale counts and weaken reproducibility.
- Consequence: `--check` detects stale evidence and exits non-zero.

## DEC-1A-009: Assertions validate raw evidence representation

- Decision: Make sentinel and generic secret-shape assertions render raw objects before checking.
- Reason: An assertion that calls redaction first can mask the material it is supposed to detect.
- Consequence: Redaction remains limited to `redact_value()` and `sanitize_for_evidence()`; assertion helpers never sanitize their input.

## DEC-1A-010: Apply evidence boundary to event type

- Decision: Sanitize `EvidenceEvent.event_type` with the same boundary as payload.
- Reason: Event type is an evidence sink and can carry sentinel or secret-shaped material.
- Consequence: Known synthetic sentinels in event type are redacted, while generic secret-shaped event types fail closed.

## DEC-1A-011: Evidence results come from actual test execution

- Decision: Build baseline, safe prototype and isolation result rows from actual `unittest` observations plus explicit baseline registrations.
- Reason: Static PASS catalogs can falsely mark controls as passing when tests are missing or failing.
- Consequence: Evidence generation fails on suite failure, missing registered tests, unknown SEC tests, missing SEC-IDs, duplicate SEC-IDs, or missing `BaselineResult` records.

## DEC-1A-012: Separate portable and host-bound evidence

- Decision: Add a sanitized host fingerprint to isolation inventory and keep it minimal.
- Reason: Isolation capability evidence is partly host-specific, while test, schema and policy evidence should remain portable.
- Consequence: The fingerprint contains only `system`, `machine`, and `probe_version`; `--check` is read-only and can report host mismatch without treating portable evidence as stale.

## DEC-1A-013: Write evidence atomically

- Decision: Publish evidence through versioned generations and atomically swap `security/evidence/current.json`.
- Reason: Sequential replacement of four JSON files can expose mixed generations to readers.
- Consequence: Readers follow `current.json -> generations/<pack_id>/`; failed writes preserve the old pointer and may leave only non-authoritative orphan generations.

## DEC-1A-014: Use module-qualified test execution identity

- Decision: Identify each test execution by module-qualified identity plus short test name.
- Reason: Short function names can collide and silently overwrite a failed observation with a later PASS.
- Consequence: Duplicate execution identities fail closed, while identical short names in different modules remain distinct.

## DEC-1A-015: Split portable and host-bound evidence verification

- Decision: Make ordinary `--check` verify portable evidence and revalidate recorded host inventory, while strict same-host comparison is opt-in.
- Reason: Host command inventory is not portable across OS/hardware and should not make portable evidence appear stale.
- Consequence: Host fingerprint mismatch reports `HOST_FINGERPRINT_MISMATCH` and succeeds for portable verification unless `--require-same-host` is set.
