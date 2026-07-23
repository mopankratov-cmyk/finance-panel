# PANKSTER Agent Platform — Phase 1F-A8

## Versioned runtime integration approval request

Status: `PHASE_1F_A8_VERSIONED_RUNTIME_INTEGRATION_APPROVAL_REQUEST_COMPLETE_NO_INTEGRATION`

Decision: `OWNER_APPROVAL_REQUEST_READY_FOR_FUTURE_PHASE_1F_A9_VERSIONED_RUNTIME_INTEGRATION_CONTRACT_REVIEW_NOT_INTEGRATED`

A8 prepares an owner approval request for the next review-only gate. It does not implement runtime integration, does not start profiles, does not launch subprocesses, sandboxes, canaries, or runtime processes, and does not approve provider/model API calls, real credentials, auth file reads, Keychain reads, OAuth refresh, gateway changes, Hermes core changes, dependency changes, deployment, or production profiles.

## Source dependency

- Source review: `security/evidence/phase-1f-a7/versioned-pure-contract-implementation-security-review.json`
- Source file SHA-256: `c4f1d7999b6f07584d94a1bd86e172ddb990a9e9b925f48603666c58807ebdbf`
- Source content SHA-256: `295f237c2672b11e7cc0078c9763ab097959ea63f9277c1defdf2404b2723400`
- Source verdict: `READY_FOR_PHASE_1F_A8_VERSIONED_RUNTIME_INTEGRATION_APPROVAL_REQUEST_NOT_RUNTIME`

## Approval request

Approval artifact:

- `docs/program/PHASE_1F_A8_VERSIONED_RUNTIME_INTEGRATION_APPROVAL_REQUEST.ready.json`
- File SHA-256: `5efa1373d5302cf78e0ac55a2d7d37a85c5089a682d615813a2dafe8ebdeb3d6`
- Contract content SHA-256: `774472c086ae4f81d7bddcb5eea14c441a4e33917d352d3d50cec5670e244978`

Owner approval command:

```text
APPROVE_PHASE_1F_VERSIONED_RUNTIME_INTEGRATION_CONTRACT:p1f-20260723-versionedruntimea8:774472c086ae4f81d7bddcb5eea14c441a4e33917d352d3d50cec5670e244978
```

Approval command SHA-256: `2ab0c7343832484e45e0ed2879dda99c940fe46111146ff20c31e47fe35ecf8a`

## Allowed future scope after exact owner approval

Only these A9 review artifacts are in scope:

- `docs/program/PHASE_1F_A9_VERSIONED_RUNTIME_INTEGRATION_CONTRACT_REVIEW.md`
- `security/evidence/phase-1f-a9/versioned-runtime-integration-contract-review.json`
- `tools/phase_1f_a9_versioned_runtime_integration_contract_review_validator.py`
- `tools/tests/test_phase_1f_a9_versioned_runtime_integration_contract_review_validator.py`

A9 remains review-only. It must not edit runtime contract code, gateway.py, web_server.py, app/lib runtime paths, Hermes core, dependencies, lockfiles, `.env` files, credentials, auth files, Keychain, OAuth refresh, provider/model clients, subprocess launch, sandbox launch, runtime process launch, profile starts, canary, deployment, or production profiles.

## Approval scope

Allowed:

- versioned runtime integration contract review artifacts only
- local static validation
- local unittest validation

Explicitly not allowed:

- runtime contract code changes
- runtime integration or execution
- subprocess, sandbox, profile, canary, or runtime process launch
- provider/model API calls
- real credential access or materialization
- auth file, Keychain, or process secret environment reads
- OAuth refresh
- gateway.py, web_server.py, app/lib runtime path, profile worker, Hermes core, dependency, lockfile, or `.env` changes
- deployment or production profiles

## Tests

Expected A8 validation envelope:

- A8 validator tests: PASS, 5 tests.
- Full tools unittest discovery: PASS, 802 tests.

## Rollback

Rollback for this gate is to remove A8 approval request artifacts and return to the Phase 1F-A7 reviewed state. No runtime, gateway, profile, credential, dependency, or production state is changed by this gate.

## Next gate

Next gate after exact owner approval: `PHASE_1F_A9_VERSIONED_RUNTIME_INTEGRATION_CONTRACT_REVIEW_AFTER_OWNER_APPROVAL`.
