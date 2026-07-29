# PANKSTER Agent Platform — Phase 1F-A1

## Runtime integration owner approval request

Status: `PHASE_1F_A1_RUNTIME_INTEGRATION_OWNER_APPROVAL_REQUEST_COMPLETE_NO_SCOPE_LOCK`

Decision: `OWNER_APPROVAL_REQUEST_READY_FOR_FUTURE_PHASE_1F_A2_SCOPE_LOCK_NOT_IMPLEMENTATION`

A1 prepares the exact owner approval request for a future Phase 1F-A2 runtime implementation scope lock. It does not prepare the scope lock and does not approve runtime integration implementation, profile start, production, real credentials, sandbox creation, subprocess launch, provider/model API calls, gateway.py or web_server.py changes, profile worker runtime changes, Hermes core changes, dependency changes, OAuth refresh, credential migration, canary, deployment, or runtime execution.

## Source dependency

A1 depends on Phase 1F-A0:

- Evidence: `security/evidence/phase-1f-a0/runtime-integration-planning.json`
- A0 evidence file SHA-256: `72449b19d3a764449f8e97412ef9deb9589c4ac3639532431eaea64539b6d5bd`
- A0 content SHA-256: `7d6a0ce18b9c20055fd5372e7f27a1977743cd191a28488187ce49713bc102b4`
- A0 verdict: `PHASE_1F_PLANNING_ONLY_NOT_READY_FOR_RUNTIME_OR_PRODUCTION`

## Contract artifact

- Path: `docs/program/PHASE_1F_A1_RUNTIME_INTEGRATION_OWNER_APPROVAL_REQUEST.ready.json`
- Schema: `pankster.phase1f-a1.runtime-integration-owner-approval-request.v1`
- Contract state: `READY_FOR_OWNER_APPROVAL_NO_RUNTIME_SCOPE_LOCK`
- Contract file SHA-256: `5d17961e68f4b63f444d2b44f338a92149c429a5ca1e5241b42d6bdcd5424783`
- Contract content SHA-256: `082bc5f87eba718898e979b3e3b031f6792b248b321891d74a27c908b712a304`

## Exact owner approval string for the next gate

```text
APPROVE_PHASE_1F_RUNTIME_IMPLEMENTATION_SCOPE_LOCK:p1f-20260723-scopea1:082bc5f87eba718898e979b3e3b031f6792b248b321891d74a27c908b712a304
```

Approval command SHA-256:

```text
cbf30907ee949ca05f46b54b99e4f8dc827d1c60ee8c5a4e5a5900f23f116e6f
```

## Scope if approved later

The approval string is for one future Phase 1F-A2 runtime implementation scope lock only:

- allowed: `docs/program/PHASE_1F_A2_RUNTIME_IMPLEMENTATION_SCOPE_LOCK.md`;
- allowed: `security/evidence/phase-1f-a2/runtime-implementation-scope-lock.json`;
- allowed: `tools/phase_1f_a2_runtime_implementation_scope_lock_validator.py`;
- allowed: `tools/tests/test_phase_1f_a2_runtime_implementation_scope_lock_validator.py`;
- allowed: local static validation and local unit tests;
- forbidden: runtime integration implementation, profile runtime execution, profile starts, profile worker runtime changes, `gateway.py` changes, `web_server.py` changes, Hermes core changes, app/lib runtime changes, subprocess launch, sandbox launch, runtime process launch, provider/model API calls, real credentials, auth files, Keychain, process environment secret reads, OAuth refresh, production profiles, canary, dependency changes, and deployment.

## Next gate

Next gate: `PHASE_1F_A2_RUNTIME_IMPLEMENTATION_SCOPE_LOCK_AFTER_OWNER_APPROVAL`.
