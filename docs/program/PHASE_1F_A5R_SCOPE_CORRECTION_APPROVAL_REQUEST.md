# PANKSTER Agent Platform — Phase 1F-A5R

## Scope correction approval request

Status: `PHASE_1F_A5R_SCOPE_CORRECTION_APPROVAL_REQUEST_COMPLETE_NO_IMPLEMENTATION`

Decision: `OWNER_APPROVAL_REQUEST_READY_FOR_FUTURE_PHASE_1F_VERSIONED_PURE_CONTRACT_IMPLEMENTATION_NOT_IMPLEMENTED`

A5R records that the original A5 implementation path conflicts with existing Phase 1E hash-pinned review validators. The attempted A5 candidate stayed inside the A4 allowlist and its targeted tests passed, but the full tools suite correctly failed because Phase 1E review evidence pins SHA-256 hashes for those same runtime contract modules and tests.

The selected correction is to preserve the Phase 1E hash-pinned files and request a new owner approval for versioned Phase 1F pure contract-layer modules. A5R does not implement code and does not approve runtime execution, production profile execution, sandbox execution, subprocess launch, provider/model API calls, real credential access, auth file reads, Keychain reads, gateway.py or web_server.py changes, profile worker runtime changes, Hermes core changes, dependency changes, OAuth refresh, credential migration, canary, deployment, or production profiles.

## Source dependency

A5R depends on Phase 1F-A4:

- Evidence: `security/evidence/phase-1f-a4/implementation-approval-request.json`
- A4 evidence file SHA-256: `31bf23ea7019809bd6cc0db3dc85e01c5ea2e70b62dd6a2cbe1ed50ac9fed7ed`
- A4 content SHA-256: `b812cd16aa2f03a1e7c4e37b06581ec6520b576d979665befb146347020c2425`
- A4 status: `PHASE_1F_A4_IMPLEMENTATION_APPROVAL_REQUEST_COMPLETE_NO_IMPLEMENTATION`

## A5 attempt outcome

- Candidate committed: `false`
- Candidate pushed: `false`
- Candidate scope was A4 allowlist only: `true`
- Targeted candidate tests passed: `17`
- Full suite restored after candidate removal: `true`
- Governance conflict: Phase 1E review validators pin SHA-256 hashes of the same runtime contract modules and tests that Phase 1F-A4 allowed changing.

## Contract artifact

- Path: `docs/program/PHASE_1F_A5R_SCOPE_CORRECTION_APPROVAL_REQUEST.ready.json`
- Schema: `pankster.phase1f-a5r.scope-correction-approval-request.v1`
- Contract state: `READY_FOR_OWNER_APPROVAL_NO_VERSIONED_IMPLEMENTATION`
- Contract file SHA-256: `a3911bb35d7ebdddb2965f9324a40db19fe87fbe9308250439f2574e673d12ac`
- Contract content SHA-256: `e9624de2171e8b7c624ac3dd4ec40d46d79d80d81cb21085f35933176ce8cb14`

## Exact owner approval string for the next gate

```text
APPROVE_PHASE_1F_VERSIONED_PURE_CONTRACT_IMPLEMENTATION:p1f-20260723-versionedpurecontracta5r:e9624de2171e8b7c624ac3dd4ec40d46d79d80d81cb21085f35933176ce8cb14
```

Approval command SHA-256:

```text
51ee3b2dee1694ffada7ee9bd20391251f3b73a5fda6d79724b2f16c7bfd9ec4
```

## Scope if approved later

The approval string is for one future Phase 1F-A6 versioned pure contract-layer implementation only:

- allowed: `tools/pankster_runtime_security/runtime_integration_phase1f_contracts.py`;
- allowed: `tools/pankster_runtime_security/runtime_adapter_binding_phase1f_contracts.py`;
- allowed: `tools/tests/test_pankster_runtime_security_runtime_integration_phase1f_contracts.py`;
- allowed: `tools/tests/test_pankster_runtime_security_runtime_adapter_binding_phase1f_contracts.py`;
- allowed: local static validation and local unit tests;
- forbidden: Phase 1E hash-pinned runtime contract modules/tests, files outside the versioned Phase 1F allowlist, profile starts, runtime execution, subprocess launch, sandbox launch, provider/model API calls, real credentials, auth files, Keychain, process environment secret reads, OAuth refresh, `gateway.py` changes, `web_server.py` changes, profile worker runtime changes, Hermes core changes, app/lib runtime changes, dependency or lockfile changes, production profiles, canary, and deployment.

## Next gate

Next gate: `PHASE_1F_A6_VERSIONED_PURE_CONTRACT_IMPLEMENTATION_AFTER_OWNER_APPROVAL`.
