# PANKSTER Agent Platform — Phase 1E-A38

## Profile runtime invocation approval request

Status: `PROFILE_RUNTIME_INVOCATION_APPROVAL_REQUEST_COMPLETE_NO_INVOCATION`

Decision: `OWNER_APPROVAL_REQUEST_READY_FOR_FUTURE_PROFILE_RUNTIME_INVOCATION_CONTRACT_NOT_INVOKED`

A38 prepares the exact owner approval request for a future profile runtime invocation contract gate. It does not invoke runtime and does not approve profile start, production, real credentials, sandbox creation, subprocess launch, provider/model API calls, gateway.py or web_server.py changes, profile worker runtime changes, Hermes core changes, dependency changes, OAuth refresh, credential migration, canary, or deployment.

## Source dependency

A38 depends on Phase 1E-A37:

- Evidence: `security/evidence/phase-1e-a37/profile-runtime-activation-execution-contract-review.json`
- A37 evidence file SHA-256: `5e570429cff04ccd6660222ea7d11705a812c52278662c7fa030a096b2a0370e`
- A37 content SHA-256: `f2c23751ae9658cf18e8601e4669986fea56418027498ffe94d6b0c9916b5f41`
- A37 verdict: `READY_FOR_PROFILE_RUNTIME_INVOCATION_APPROVAL_REQUEST_NOT_RUNTIME`

## Contract artifact

- Path: `docs/program/PHASE_1E_A38_PROFILE_RUNTIME_INVOCATION_APPROVAL_REQUEST.ready.json`
- Schema: `pankster.phase1e-a38.profile-runtime-invocation-approval-request.v1`
- Contract state: `READY_FOR_OWNER_APPROVAL_NO_PROFILE_RUNTIME_INVOCATION`
- Contract file SHA-256: `c30ef484eb275f5d04fb1e15fad7138483fc3ad99e7bd95161741ffed6991cdf`
- Contract content SHA-256: `970dc9311307a2b5ddfe5066bf6fa4f107c3121b40b1d47896db919ba5cec902`

## Exact owner approval string for the next gate

```text
APPROVE_PHASE_1E_PROFILE_RUNTIME_INVOCATION_CONTRACT:p1e-20260723-profileruntimeinvocationa38:970dc9311307a2b5ddfe5066bf6fa4f107c3121b40b1d47896db919ba5cec902
```

Approval command SHA-256:

```text
22367ad7063c43a8f2b401eb5b5f995927573deac6d42e7d3c3b683d23fb88fc
```

## Scope if approved later

The approval string is for one future disabled-by-default local profile runtime invocation contract gate only:

- allowed: `tools/pankster_runtime_security/profile_runtime_invocation_contracts.py`;
- allowed: `tools/tests/test_pankster_runtime_security_profile_runtime_invocation_contracts.py`;
- allowed: local static validation and local unit tests;
- forbidden: profile runtime invocation, profile runtime activation execution, profile runtime activation, profile starts, profile worker runtime changes, `gateway.py` changes, `web_server.py` changes, Hermes core changes, app/lib changes, subprocess launch, sandbox launch, runtime process launch, provider/model API calls, real credentials, auth files, Keychain, process environment secret reads, OAuth refresh, production profiles, canary, dependency changes, and deployment.

## Next gate

Next gate: `PHASE_1E_A39_PROFILE_RUNTIME_INVOCATION_CONTRACT_AFTER_OWNER_APPROVAL`.
