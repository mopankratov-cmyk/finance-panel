# PANKSTER Agent Platform — Phase 1F-A12

## Versioned host adapter integration approval request

Status: `PHASE_1F_A12_VERSIONED_HOST_ADAPTER_INTEGRATION_APPROVAL_REQUEST_COMPLETE_NO_INTEGRATION`

Decision: `OWNER_APPROVAL_REQUEST_READY_FOR_FUTURE_PHASE_1F_A13_VERSIONED_HOST_ADAPTER_INTEGRATION_CONTRACT_REVIEW_NOT_INTEGRATED`

A12 prepares the exact owner approval request for a future Phase 1F-A13 versioned host adapter integration contract review gate. It does not integrate host adapter code and does not approve runtime execution, production profiles, real credentials, sandbox creation, subprocess launch, provider/model API calls, gateway.py or web_server.py changes, Hermes core changes, dependency changes, OAuth refresh, credential migration, canary, or deployment.

## Source dependency

A12 depends on Phase 1F-A11:

- Evidence: `security/evidence/phase-1f-a11/versioned-runtime-adapter-binding-contract-review.json`
- A11 evidence file SHA-256: `919de7e5741ac9502c7c933d74d6554d3b9b1ffc66c2212651355d7fc61de1bc`
- A11 content SHA-256: `1a20cd9ea4d7b08346318dfd4365f6524d74b68de467949da3975cfb1f16f4dc`
- A11 verdict: `READY_FOR_PHASE_1F_A12_VERSIONED_HOST_ADAPTER_INTEGRATION_APPROVAL_REQUEST_NOT_RUNTIME`

## Contract artifact

- Path: `docs/program/PHASE_1F_A12_VERSIONED_HOST_ADAPTER_INTEGRATION_APPROVAL_REQUEST.ready.json`
- Schema: `pankster.phase1f-a12.versioned-host-adapter-integration-approval-request.v1`
- Contract state: `READY_FOR_OWNER_APPROVAL_NO_HOST_ADAPTER_INTEGRATION`
- Contract file SHA-256: `5c1e126a105e5548550f4e128e85b31aa438957b6ed0df33fd40a6511e590e6c`
- Contract content SHA-256: `d1d3f9ce41b8358dd8dc204e363c50016d4509782f3dfa0b150fad337cda12f6`

## Exact owner approval string for the next gate

```text
APPROVE_PHASE_1F_VERSIONED_HOST_ADAPTER_INTEGRATION_CONTRACT:p1f-20260723-versionedhostadaptera12:d1d3f9ce41b8358dd8dc204e363c50016d4509782f3dfa0b150fad337cda12f6
```

Approval command SHA-256:

```text
bb620fda06f51261fec93d288ef8c09e6aad1c137057cd4eb0bc992ccd9211a6
```

## Scope if approved later

The approval string is for one future versioned host adapter integration contract review gate only:

- allowed: `docs/program/PHASE_1F_A13_VERSIONED_HOST_ADAPTER_INTEGRATION_CONTRACT_REVIEW.md`;
- allowed: `security/evidence/phase-1f-a13/versioned-host-adapter-integration-contract-review.json`;
- allowed: `tools/phase_1f_a13_versioned_host_adapter_integration_contract_review_validator.py`;
- allowed: `tools/tests/test_phase_1f_a13_versioned_host_adapter_integration_contract_review_validator.py`;
- allowed: local static validation and local unit tests;
- forbidden: runtime contract code edits, host adapter integration, runtime adapter binding, Hermes core changes, gateway.py changes, web_server.py changes, app/lib changes, subprocess launch, sandbox launch, provider/model API calls, real credentials, auth files, Keychain, process environment secret reads, OAuth refresh, profile start, production profiles, canary, dependency changes, and deployment.

## Tests

Expected A12 validation envelope:

- A12 validator tests: PASS, 5 tests.
- Full tools unittest discovery: PASS, 822 tests.

## Rollback

Rollback for this gate is to remove A12 approval request artifacts and return to the Phase 1F-A11 reviewed state. No runtime, gateway, profile, credential, dependency, or production state is changed by this gate.

## Next gate

Next gate after exact owner approval: `PHASE_1F_A13_VERSIONED_HOST_ADAPTER_INTEGRATION_CONTRACT_REVIEW_AFTER_OWNER_APPROVAL`.
