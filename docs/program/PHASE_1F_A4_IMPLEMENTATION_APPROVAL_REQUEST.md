# PANKSTER Agent Platform — Phase 1F-A4

## Pure contract implementation approval request

Status: `PHASE_1F_A4_IMPLEMENTATION_APPROVAL_REQUEST_COMPLETE_NO_IMPLEMENTATION`

Decision: `OWNER_APPROVAL_REQUEST_READY_FOR_FUTURE_PHASE_1F_A5_PURE_CONTRACT_IMPLEMENTATION_NOT_IMPLEMENTED`

A4 prepares the exact owner approval request for a future Phase 1F-A5 pure contract-layer implementation. It does not implement code and does not approve runtime execution, production profile execution, sandbox execution, subprocess launch, provider/model API calls, real credential access, auth file reads, Keychain reads, gateway.py or web_server.py changes, profile worker runtime changes, Hermes core changes, dependency changes, OAuth refresh, credential migration, canary, deployment, or production profiles.

## Source dependency

A4 depends on Phase 1F-A3:

- Evidence: `security/evidence/phase-1f-a3/independent-security-review-before-code.json`
- A3 evidence file SHA-256: `0036515b606704da9a3cca43e0e5fdac384e1d059d493481ea2512d59389ecb2`
- A3 content SHA-256: `2b2f87a7b14714f7ecee3c200067100ed01871a810c60671b340536c18ea0b28`
- A3 verdict: `READY_FOR_PHASE_1F_A4_IMPLEMENTATION_APPROVAL_REQUEST_NOT_CODE`

## Contract artifact

- Path: `docs/program/PHASE_1F_A4_IMPLEMENTATION_APPROVAL_REQUEST.ready.json`
- Schema: `pankster.phase1f-a4.implementation-approval-request.v1`
- Contract state: `READY_FOR_OWNER_APPROVAL_NO_IMPLEMENTATION`
- Contract file SHA-256: `3aa1c2338a5bbb0370dc8d750ed267bcd7f9016b0a91566fbf6bc402a103d3a3`
- Contract content SHA-256: `9bb313bcd45c127d9ab46dbfadb6b5e6bfdb697578f6006cab99ce5b0813a491`

## Exact owner approval string for the next gate

```text
APPROVE_PHASE_1F_PURE_CONTRACT_IMPLEMENTATION:p1f-20260723-purecontracta4:9bb313bcd45c127d9ab46dbfadb6b5e6bfdb697578f6006cab99ce5b0813a491
```

Approval command SHA-256:

```text
33ba3199cb30290d25ec3ae66e186c290e729c3251136ea9b2f3feda9020c5b1
```

## Scope if approved later

The approval string is for one future Phase 1F-A5 pure contract-layer implementation only:

- allowed: `tools/pankster_runtime_security/runtime_integration_contracts.py`;
- allowed: `tools/pankster_runtime_security/runtime_adapter_binding_contracts.py`;
- allowed: `tools/tests/test_pankster_runtime_security_runtime_integration_contracts.py`;
- allowed: `tools/tests/test_pankster_runtime_security_runtime_adapter_binding_contracts.py`;
- allowed: local static validation and local unit tests;
- forbidden: files outside the A2 allowlist, profile starts, runtime execution, subprocess launch, sandbox launch, provider/model API calls, real credentials, auth files, Keychain, process environment secret reads, OAuth refresh, `gateway.py` changes, `web_server.py` changes, profile worker runtime changes, Hermes core changes, app/lib runtime changes, dependency or lockfile changes, production profiles, canary, and deployment.

## Next gate

Next gate: `PHASE_1F_A5_PURE_CONTRACT_IMPLEMENTATION_AFTER_OWNER_APPROVAL`.
