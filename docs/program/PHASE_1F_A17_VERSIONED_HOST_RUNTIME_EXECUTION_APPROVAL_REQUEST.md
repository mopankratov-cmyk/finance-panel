# PANKSTER Agent Platform — Phase 1F-A17

## Versioned host runtime execution approval request

Status: `PHASE_1F_A17_VERSIONED_HOST_RUNTIME_EXECUTION_APPROVAL_REQUEST_COMPLETE_NO_IMPLEMENTATION`

Decision: `OWNER_APPROVAL_REQUEST_READY_FOR_FUTURE_PHASE_1F_A18_VERSIONED_HOST_RUNTIME_EXECUTION_CONTRACT_NOT_IMPLEMENTED`

A17 prepares the exact owner approval request for a future Phase 1F-A18 versioned host runtime execution pure contract layer. It does not implement code and does not approve runtime execution, production profiles, real credentials, sandbox creation, subprocess launch, provider/model API calls, gateway.py or web_server.py changes, Hermes core changes, dependency changes, OAuth refresh, credential migration, canary, runtime binding, profile worker binding, or deployment.

## Source dependency

A17 depends on Phase 1F-A16:

- Evidence: `security/evidence/phase-1f-a16/versioned-host-adapter-implementation-security-review.json`
- A16 evidence file SHA-256: `230a13061b5d3ef9c78dff21764ed271d6707c5ab2ecc93326378df874ecb029`
- A16 content SHA-256: `673235b74a66348a6211e1a367e99994c80bd32bce10ee25ce3c5103c23b5c92`
- A16 verdict: `READY_FOR_PHASE_1F_A17_VERSIONED_HOST_RUNTIME_EXECUTION_APPROVAL_REQUEST_NOT_RUNTIME`

## Contract artifact

- Path: `docs/program/PHASE_1F_A17_VERSIONED_HOST_RUNTIME_EXECUTION_APPROVAL_REQUEST.ready.json`
- Schema: `pankster.phase1f-a17.versioned-host-runtime-execution-approval-request.v1`
- Contract state: `READY_FOR_OWNER_APPROVAL_NO_VERSIONED_HOST_RUNTIME_EXECUTION`
- Contract file SHA-256: `d03b8063616ecbbb155771f59ca34e9e366fe44f6ca0164bb996e3fe09098764`
- Contract content SHA-256: `7383f93e884b125ba42bf4945e4ac3869ed29b5ae01ce15cb68a097d167061ab`

## Exact owner approval string for the next gate

```text
APPROVE_PHASE_1F_VERSIONED_HOST_RUNTIME_EXECUTION_CONTRACT:p1f-20260723-versionedhostruntimea17:7383f93e884b125ba42bf4945e4ac3869ed29b5ae01ce15cb68a097d167061ab
```

Approval command SHA-256:

```text
9d3bb163ea13f7f6dea71c7755a586685652cab2b034452ce1bbcf229c351755
```

## Scope if approved later

The approval string is for one future Phase 1F-A18 versioned host runtime execution pure contract implementation only:

- allowed: `tools/pankster_runtime_security/host_runtime_execution_phase1f_contracts.py`;
- allowed: `tools/tests/test_pankster_runtime_security_host_runtime_execution_phase1f_contracts.py`;
- allowed: local static validation and local unit tests;
- forbidden: Phase 1E hash-pinned files, files outside the versioned Phase 1F host runtime allowlist, gateway/profile worker binding, profile starts, runtime process launch, runtime execution, subprocess launch, sandbox launch, provider/model API calls, real credentials, auth files, Keychain, process environment secret reads, OAuth refresh, `gateway.py` changes, `web_server.py` changes, Hermes core changes, app/lib runtime changes, dependency or lockfile changes, production profiles, canary, and deployment.

## Tests

Expected A17 validation envelope:

- A16 validator: PASS.
- A17 validator tests: PASS, 5 tests.
- Full tools unittest discovery: PASS, 850 tests.

## Rollback

Rollback for this gate is to remove A17 approval request artifacts and return to the Phase 1F-A16 review state. No runtime, gateway, profile, credential, dependency, or production state is changed by this gate.

## Next gate

Next gate after exact owner approval: `PHASE_1F_A18_VERSIONED_HOST_RUNTIME_EXECUTION_CONTRACT_AFTER_OWNER_APPROVAL`.
