# PANKSTER Agent Platform — Phase 1F-A10

## Versioned runtime adapter binding approval request

Status: `PHASE_1F_A10_VERSIONED_RUNTIME_ADAPTER_BINDING_APPROVAL_REQUEST_COMPLETE_NO_BINDING`

Decision: `OWNER_APPROVAL_REQUEST_READY_FOR_FUTURE_PHASE_1F_A11_VERSIONED_RUNTIME_ADAPTER_BINDING_CONTRACT_REVIEW_NOT_BOUND`

A10 prepares the exact owner approval request for a future Phase 1F-A11 versioned runtime adapter binding contract review gate. It does not bind runtime code and does not approve runtime execution, production profiles, real credentials, sandbox creation, subprocess launch, provider/model API calls, gateway.py or web_server.py changes, Hermes core changes, dependency changes, OAuth refresh, credential migration, canary, or deployment.

## Source dependency

A10 depends on Phase 1F-A9:

- Evidence: `security/evidence/phase-1f-a9/versioned-runtime-integration-contract-review.json`
- A9 evidence file SHA-256: `a24e4bf7c91ceda7bcb6240173d0e42118f309d121cca813e5755767b7ee1ea2`
- A9 content SHA-256: `2a153514b127dc2262abaf85fa9a3e24dd5a9df4ff983ec19d89217883af8d64`
- A9 verdict: `READY_FOR_PHASE_1F_A10_VERSIONED_RUNTIME_ADAPTER_BINDING_APPROVAL_REQUEST_NOT_RUNTIME`

## Contract artifact

- Path: `docs/program/PHASE_1F_A10_VERSIONED_RUNTIME_ADAPTER_BINDING_APPROVAL_REQUEST.ready.json`
- Schema: `pankster.phase1f-a10.versioned-runtime-adapter-binding-approval-request.v1`
- Contract state: `READY_FOR_OWNER_APPROVAL_NO_RUNTIME_BINDING`
- Contract file SHA-256: `bb5cda5caa1eb4b6ac2a0875b399f98b8b06b2c02eeab38ac8c68c949ebac5b9`
- Contract content SHA-256: `e26e2bf740fed79f90c56f4fbe13fe4efcab861c2b8faf2546877094bda000dc`

## Exact owner approval string for the next gate

```text
APPROVE_PHASE_1F_VERSIONED_RUNTIME_ADAPTER_BINDING_CONTRACT:p1f-20260723-versionedadapterbindinga10:e26e2bf740fed79f90c56f4fbe13fe4efcab861c2b8faf2546877094bda000dc
```

Approval command SHA-256:

```text
f263bc157e01f321a277e2b99edc28e222b7f286586466fa157b1fd9857cd12c
```

## Scope if approved later

The approval string is for one future versioned runtime adapter binding contract review gate only:

- allowed: `docs/program/PHASE_1F_A11_VERSIONED_RUNTIME_ADAPTER_BINDING_CONTRACT_REVIEW.md`;
- allowed: `security/evidence/phase-1f-a11/versioned-runtime-adapter-binding-contract-review.json`;
- allowed: `tools/phase_1f_a11_versioned_runtime_adapter_binding_contract_review_validator.py`;
- allowed: `tools/tests/test_phase_1f_a11_versioned_runtime_adapter_binding_contract_review_validator.py`;
- allowed: local static validation and local unit tests;
- forbidden: runtime contract code edits, runtime adapter binding, Hermes core changes, gateway.py changes, web_server.py changes, app/lib changes, subprocess launch, sandbox launch, provider/model API calls, real credentials, auth files, Keychain, process environment secret reads, OAuth refresh, profile start, production profiles, canary, dependency changes, and deployment.

## Tests

Expected A10 validation envelope:

- A10 validator tests: PASS, 5 tests.
- Full tools unittest discovery: PASS, 812 tests.

## Rollback

Rollback for this gate is to remove A10 approval request artifacts and return to the Phase 1F-A9 reviewed state. No runtime, gateway, profile, credential, dependency, or production state is changed by this gate.

## Next gate

Next gate after exact owner approval: `PHASE_1F_A11_VERSIONED_RUNTIME_ADAPTER_BINDING_CONTRACT_REVIEW_AFTER_OWNER_APPROVAL`.
