# PANKSTER Agent Platform — Phase 2-A0

## Synthetic-only MVP scope approval request

Status: `PHASE_2_A0_SYNTHETIC_MVP_SCOPE_APPROVAL_REQUEST_COMPLETE_NO_IMPLEMENTATION`

Decision: `OWNER_APPROVAL_REQUEST_READY_FOR_FUTURE_PHASE_2_A1_SYNTHETIC_ONLY_MVP_IMPLEMENTATION_NOT_IMPLEMENTED`

Phase 2-A0 pivots from the long production-hardening ladder to a short synthetic-only MVP path. It prepares the exact owner approval request for a future Phase 2-A1 implementation. It does not implement the MVP and does not approve gateway start, production profiles, profile runtime execution, real credentials, auth files, Keychain, OAuth refresh, provider/model API calls, network calls, subprocess launch, sandbox creation, dependency changes, canary, or deployment.

## Source dependency

A0 depends on Phase 1F-A26:

- Evidence: `security/evidence/phase-1f-a26/versioned-profile-worker-binding-approval-request.json`
- A26 evidence file SHA-256: `96968d9dc8a6db01b6e54c2234683935c33815c70ff799d6b64921bcb3a69b6a`
- A26 content SHA-256: `163fc0b33591319bec8a980ced0dc9a6a1a79a6de524bd8ae5a10b71d6fdc799`

## Contract artifact

- Path: `docs/program/PHASE_2_A0_SYNTHETIC_MVP_SCOPE_APPROVAL_REQUEST.ready.json`
- Schema: `pankster.phase2-a0.synthetic-mvp-scope-approval-request.v1`
- Contract state: `READY_FOR_OWNER_APPROVAL_NO_SYNTHETIC_MVP_IMPLEMENTATION`
- Contract file SHA-256: `5043662bef7a4a653c2ebb68851b54d51f592c1668731ebcbae8f3244f951efd`
- Contract content SHA-256: `4f8794c9ca615e2d301c70cb30004fc08ae1fdc8e5ebe3a4cf5cdc48c9f82b96`

## Exact owner approval string for the next gate

```text
APPROVE_PHASE_2_SYNTHETIC_MVP_IMPLEMENTATION:p2-20260723-syntheticmvpa0:4f8794c9ca615e2d301c70cb30004fc08ae1fdc8e5ebe3a4cf5cdc48c9f82b96
```

Approval command SHA-256:

```text
8c559fd59bca0e3f0f499df142bf17ad548b54d9b7059ef02b5a25a4704c19ef
```

## Scope if approved later

The approval string is for one future Phase 2-A1 synthetic-only MVP implementation only:

- allowed: `tools/pankster_runtime_security/synthetic_mvp_runner_contracts.py`;
- allowed: `tools/tests/test_pankster_runtime_security_synthetic_mvp_runner_contracts.py`;
- required: fake credentials only, fake model broker only, synthetic profiles only;
- required: sanitized in-memory environment;
- required: terminal, code_execution, delegate_task, MCP surfaces are fake or fail-closed;
- forbidden: gateway start, production profiles, profile runtime execution, real credentials, auth files, Keychain, OAuth refresh, provider/model APIs, network calls, subprocess launch, sandbox creation, dependency/lockfile changes, `.env` changes, app/lib runtime edits, canary, and deployment.

## Tests

Expected A0 validation envelope:

- Phase 1F-A26 validator: PASS.
- A0 validator tests: PASS, 5 tests.
- Full tools unittest discovery: PASS, 909 tests.

## Next gate

Next gate after exact owner approval: `PHASE_2_A1_SYNTHETIC_ONLY_MVP_IMPLEMENTATION_AFTER_OWNER_APPROVAL`.
