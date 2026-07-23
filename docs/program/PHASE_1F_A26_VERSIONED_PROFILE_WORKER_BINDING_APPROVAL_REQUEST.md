# PANKSTER Agent Platform — Phase 1F-A26

## Versioned profile worker binding approval request

Status: `PHASE_1F_A26_VERSIONED_PROFILE_WORKER_BINDING_APPROVAL_REQUEST_COMPLETE_NO_IMPLEMENTATION`

Decision: `OWNER_APPROVAL_REQUEST_READY_FOR_FUTURE_PHASE_1F_A27_VERSIONED_PROFILE_WORKER_BINDING_CONTRACT_NOT_IMPLEMENTED`

A26 prepares the exact owner approval request for a future Phase 1F-A27 versioned profile worker binding pure contract layer. It does not implement code and does not approve profile worker runtime mutation, profile starts, runtime execution, gateway.py or web_server.py edits/imports, production profiles, real credentials, sandbox creation, subprocess launch, provider/model API calls, Hermes core changes, dependency changes, OAuth refresh, credential migration, canary, or deployment.

## Source dependency

A26 depends on Phase 1F-A25:

- Evidence: `security/evidence/phase-1f-a25/versioned-gateway-binding-contract-review.json`
- A25 evidence file SHA-256: `7df8dc7f6de9561930e1f3927a405e5b2b5a39edce82912279a01e8d9fe45151`
- A25 content SHA-256: `7bb87b1aa881fedc0c7ba2fafe2da88b857d54bafdb2f75e7df6f8de0efa87be`
- A25 verdict: `READY_FOR_PHASE_1F_A26_VERSIONED_PROFILE_WORKER_BINDING_APPROVAL_REQUEST_NOT_RUNTIME`

## Contract artifact

- Path: `docs/program/PHASE_1F_A26_VERSIONED_PROFILE_WORKER_BINDING_APPROVAL_REQUEST.ready.json`
- Schema: `pankster.phase1f-a26.versioned-profile-worker-binding-approval-request.v1`
- Contract state: `READY_FOR_OWNER_APPROVAL_NO_VERSIONED_PROFILE_WORKER_BINDING`
- Contract file SHA-256: `b44cf12eef5e40ef6b515ecece47cb61eaf91e8c4e427a7ba57025b445cf473e`
- Contract content SHA-256: `0c58baf2da38e215368478476b377edcfde5f9b68895201fec888b683a37795c`

## Exact owner approval string for the next gate

```text
APPROVE_PHASE_1F_VERSIONED_PROFILE_WORKER_BINDING_CONTRACT:p1f-20260723-versionedprofileworkerbindinga26:0c58baf2da38e215368478476b377edcfde5f9b68895201fec888b683a37795c
```

Approval command SHA-256:

```text
35f1206ca19250d2298f540edd23e7d6d066caa2ccd8090c60bd1c5dc1987796
```

## Scope if approved later

The approval string is for one future Phase 1F-A27 versioned profile worker binding pure contract implementation only:

- allowed: `tools/pankster_runtime_security/profile_worker_binding_phase1f_contracts.py`;
- allowed: `tools/tests/test_pankster_runtime_security_profile_worker_binding_phase1f_contracts.py`;
- allowed: local static validation and local unit tests;
- forbidden: Phase 1E hash-pinned files, files outside the versioned Phase 1F profile worker binding allowlist, profile worker runtime mutation, profile starts, `gateway.py` edits/imports, `web_server.py` edits/imports, runtime process launch, runtime execution, subprocess launch, sandbox launch, provider/model API calls, real credentials, auth files, Keychain, process environment secret reads, OAuth refresh, Hermes core changes, app/lib runtime changes, dependency or lockfile changes, production profiles, canary, and deployment.

## Tests

Expected A26 validation envelope:

- A25 validator: PASS.
- A26 validator tests: PASS, 5 tests.
- Full tools unittest discovery: PASS, 904 tests.

## Rollback

Rollback for this gate is to remove A26 approval request artifacts and return to the Phase 1F-A25 review state. No runtime, gateway, profile, credential, dependency, or production state is changed by this gate.

## Next gate

Next gate after exact owner approval: `PHASE_1F_A27_VERSIONED_PROFILE_WORKER_BINDING_CONTRACT_AFTER_OWNER_APPROVAL`.
