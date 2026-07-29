# PANKSTER Agent Platform — Phase 1E-A29

## Profile worker binding approval request

Status: `PROFILE_WORKER_BINDING_APPROVAL_REQUEST_COMPLETE_NO_BINDING`

Decision: `OWNER_APPROVAL_REQUEST_READY_FOR_FUTURE_PROFILE_WORKER_BINDING_CONTRACT_NOT_BOUND`

A29 prepares the exact owner approval request for a future profile worker binding contract gate. It does not bind profile worker code and does not approve runtime execution, profile start, production, real credentials, sandbox creation, subprocess launch, provider/model API calls, gateway.py or web_server.py changes, Hermes core changes, dependency changes, OAuth refresh, credential migration, canary, or deployment.

## Source dependency

A29 depends on Phase 1E-A28:

- Evidence: `security/evidence/phase-1e-a28/gateway-binding-contract-review.json`
- A28 evidence file SHA-256: `ae9bf46a4eaf715c2db298113129e376ebeb3bb6d5f00678d377242bdf7d828b`
- A28 content SHA-256: `fde42871aa47f7c2ae5ece386999de72f33e9a90ff4f2ad3dd83289e4df3f887`
- A28 verdict: `READY_FOR_PROFILE_WORKER_BINDING_APPROVAL_REQUEST_NOT_RUNTIME`

## Contract artifact

- Path: `docs/program/PHASE_1E_A29_PROFILE_WORKER_BINDING_APPROVAL_REQUEST.ready.json`
- Schema: `pankster.phase1e-a29.profile-worker-binding-approval-request.v1`
- Contract state: `READY_FOR_OWNER_APPROVAL_NO_PROFILE_WORKER_BINDING`
- Contract file SHA-256: `1760aeb46befee958d69f9415ae0060857f1cf94697e982a66f41accbc367598`
- Contract content SHA-256: `9964d28734c59d60a025eb3079b88db337667a8a6de2cfc3296e25c82272a35e`

## Exact owner approval string for the next gate

```text
APPROVE_PHASE_1E_PROFILE_WORKER_BINDING_CONTRACT:p1e-20260723-profileworkerbindinga29:9964d28734c59d60a025eb3079b88db337667a8a6de2cfc3296e25c82272a35e
```

Approval command SHA-256:

```text
e5394a49b2b70ccc4ce0f5628fbbac1d18aa80c185e5cf8a883616250495afc4
```

## Scope if approved later

The approval string is for one future disabled-by-default local profile worker binding contract gate only:

- allowed: `tools/pankster_runtime_security/profile_worker_binding_contracts.py`;
- allowed: `tools/tests/test_pankster_runtime_security_profile_worker_binding_contracts.py`;
- allowed: local static validation and local unit tests;
- forbidden: profile worker runtime changes, profile starts, `gateway.py` changes, `web_server.py` changes, Hermes core changes, app/lib changes, subprocess launch, sandbox launch, runtime process launch, provider/model API calls, real credentials, auth files, Keychain, process environment secret reads, OAuth refresh, production profiles, canary, dependency changes, and deployment.

## Next gate

Next gate: `PHASE_1E_A30_PROFILE_WORKER_BINDING_CONTRACT_AFTER_OWNER_APPROVAL`.
