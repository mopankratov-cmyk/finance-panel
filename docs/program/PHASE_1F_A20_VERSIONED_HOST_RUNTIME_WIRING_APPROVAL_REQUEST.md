# PANKSTER Agent Platform — Phase 1F-A20

## Versioned host runtime wiring approval request

Status: `PHASE_1F_A20_VERSIONED_HOST_RUNTIME_WIRING_APPROVAL_REQUEST_COMPLETE_NO_IMPLEMENTATION`

Decision: `OWNER_APPROVAL_REQUEST_READY_FOR_FUTURE_PHASE_1F_A21_VERSIONED_HOST_RUNTIME_WIRING_CONTRACT_NOT_IMPLEMENTED`

A20 prepares the exact owner approval request for a future Phase 1F-A21 versioned host runtime wiring pure contract layer. It does not implement code and does not approve runtime execution, gateway wiring, profile worker wiring, production profiles, real credentials, sandbox creation, subprocess launch, provider/model API calls, gateway.py or web_server.py changes, Hermes core changes, dependency changes, OAuth refresh, credential migration, canary, or deployment.

## Source dependency

A20 depends on Phase 1F-A19:

- Evidence: `security/evidence/phase-1f-a19/versioned-host-runtime-execution-contract-review.json`
- A19 evidence file SHA-256: `4481362d362fbf1c2c5f2ef0ab7f37fc7fb7e42bed9e8935f8c61ebea5b6f362`
- A19 content SHA-256: `41a2792e649683d4aae3b17e622c40a9a5253fd1fd504f7bafb55a2e15fcafb0`
- A19 verdict: `READY_FOR_PHASE_1F_A20_VERSIONED_HOST_RUNTIME_WIRING_APPROVAL_REQUEST_NOT_RUNTIME`

## Contract artifact

- Path: `docs/program/PHASE_1F_A20_VERSIONED_HOST_RUNTIME_WIRING_APPROVAL_REQUEST.ready.json`
- Schema: `pankster.phase1f-a20.versioned-host-runtime-wiring-approval-request.v1`
- Contract state: `READY_FOR_OWNER_APPROVAL_NO_VERSIONED_HOST_RUNTIME_WIRING`
- Contract file SHA-256: `f4d30d7b4ba5de08a8b6b4778728bfa50a06c3e8f04b8e4e748d8b1ea9cc3fa0`
- Contract content SHA-256: `03cea91919933aab63d54d5bcfdb0368489d149373bf281c0d88a6275bb19543`

## Exact owner approval string for the next gate

```text
APPROVE_PHASE_1F_VERSIONED_HOST_RUNTIME_WIRING_CONTRACT:p1f-20260723-versionedhostwiringa20:03cea91919933aab63d54d5bcfdb0368489d149373bf281c0d88a6275bb19543
```

Approval command SHA-256:

```text
1e32bf6bb16ca879f212bb79b9a44bdf960f7504fd6e997005311686444fa692
```

## Scope if approved later

The approval string is for one future Phase 1F-A21 versioned host runtime wiring pure contract implementation only:

- allowed: `tools/pankster_runtime_security/host_runtime_wiring_phase1f_contracts.py`;
- allowed: `tools/tests/test_pankster_runtime_security_host_runtime_wiring_phase1f_contracts.py`;
- allowed: local static validation and local unit tests;
- forbidden: Phase 1E hash-pinned files, files outside the versioned Phase 1F host runtime wiring allowlist, gateway/profile worker wiring, profile starts, runtime process launch, runtime execution, subprocess launch, sandbox launch, provider/model API calls, real credentials, auth files, Keychain, process environment secret reads, OAuth refresh, `gateway.py` changes, `web_server.py` changes, Hermes core changes, app/lib runtime changes, dependency or lockfile changes, production profiles, canary, and deployment.

## Tests

Expected A20 validation envelope:

- A19 validator: PASS.
- A20 validator tests: PASS, 5 tests.
- Full tools unittest discovery: PASS, 868 tests.

## Rollback

Rollback for this gate is to remove A20 approval request artifacts and return to the Phase 1F-A19 review state. No runtime, gateway, profile, credential, dependency, or production state is changed by this gate.

## Next gate

Next gate after exact owner approval: `PHASE_1F_A21_VERSIONED_HOST_RUNTIME_WIRING_CONTRACT_AFTER_OWNER_APPROVAL`.
