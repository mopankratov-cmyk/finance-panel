# PANKSTER Agent Platform — Phase 1F-A23

## Versioned gateway binding approval request

Status: `PHASE_1F_A23_VERSIONED_GATEWAY_BINDING_APPROVAL_REQUEST_COMPLETE_NO_IMPLEMENTATION`

Decision: `OWNER_APPROVAL_REQUEST_READY_FOR_FUTURE_PHASE_1F_A24_VERSIONED_GATEWAY_BINDING_CONTRACT_NOT_IMPLEMENTED`

A23 prepares the exact owner approval request for a future Phase 1F-A24 versioned gateway binding pure contract layer. It does not implement code and does not approve runtime execution, gateway.py or web_server.py edits/imports, gateway runtime mutation, profile worker wiring, production profiles, real credentials, sandbox creation, subprocess launch, provider/model API calls, Hermes core changes, dependency changes, OAuth refresh, credential migration, canary, or deployment.

## Source dependency

A23 depends on Phase 1F-A22:

- Evidence: `security/evidence/phase-1f-a22/versioned-host-runtime-wiring-contract-review.json`
- A22 evidence file SHA-256: `068d1c0905bfd4c17fb5251abc0a3df5625450551a1a4eb9ee64b0ab96940050`
- A22 content SHA-256: `7eefbec3c0264a8bd1a366535b6127e3b369485811ef82e8df165a9d05774aa4`
- A22 verdict: `READY_FOR_PHASE_1F_A23_VERSIONED_GATEWAY_BINDING_APPROVAL_REQUEST_NOT_RUNTIME`

## Contract artifact

- Path: `docs/program/PHASE_1F_A23_VERSIONED_GATEWAY_BINDING_APPROVAL_REQUEST.ready.json`
- Schema: `pankster.phase1f-a23.versioned-gateway-binding-approval-request.v1`
- Contract state: `READY_FOR_OWNER_APPROVAL_NO_VERSIONED_GATEWAY_BINDING`
- Contract file SHA-256: `a6373df3002d9bb4ba77a0f0ce8f95585ec9c13615dc731f86a2f5e1db6664b9`
- Contract content SHA-256: `90cd625299d5ed3e4c914e6c2b241c33f916ef0ea36b96ba41a264a65c892309`

## Exact owner approval string for the next gate

```text
APPROVE_PHASE_1F_VERSIONED_GATEWAY_BINDING_CONTRACT:p1f-20260723-versionedgatewaybindinga23:90cd625299d5ed3e4c914e6c2b241c33f916ef0ea36b96ba41a264a65c892309
```

Approval command SHA-256:

```text
8156b3883d2a46fe4714c67672b75940504c60903fddb192d2d06dbc94208df4
```

## Scope if approved later

The approval string is for one future Phase 1F-A24 versioned gateway binding pure contract implementation only:

- allowed: `tools/pankster_runtime_security/gateway_binding_phase1f_contracts.py`;
- allowed: `tools/tests/test_pankster_runtime_security_gateway_binding_phase1f_contracts.py`;
- allowed: local static validation and local unit tests;
- forbidden: Phase 1E hash-pinned files, files outside the versioned Phase 1F gateway binding allowlist, `gateway.py` edits/imports, `web_server.py` edits/imports, gateway runtime mutation, profile worker wiring, profile starts, runtime process launch, runtime execution, subprocess launch, sandbox launch, provider/model API calls, real credentials, auth files, Keychain, process environment secret reads, OAuth refresh, Hermes core changes, app/lib runtime changes, dependency or lockfile changes, production profiles, canary, and deployment.

## Tests

Expected A23 validation envelope:

- A22 validator: PASS.
- A23 validator tests: PASS, 5 tests.
- Full tools unittest discovery: PASS, 886 tests.

## Rollback

Rollback for this gate is to remove A23 approval request artifacts and return to the Phase 1F-A22 review state. No runtime, gateway, profile, credential, dependency, or production state is changed by this gate.

## Next gate

Next gate after exact owner approval: `PHASE_1F_A24_VERSIONED_GATEWAY_BINDING_CONTRACT_AFTER_OWNER_APPROVAL`.
