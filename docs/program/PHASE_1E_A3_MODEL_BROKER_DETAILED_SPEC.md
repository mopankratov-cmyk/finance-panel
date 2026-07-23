# PANKSTER Agent Platform — Phase 1E-A3

## Model broker detailed spec

Status: `MODEL_BROKER_DETAILED_SPEC_COMPLETE_NO_IMPLEMENTATION_APPROVAL`

Decision: `MODEL_BROKER_CONTRACT_READY_FOR_RUNTIME_ADAPTER_SPEC_NOT_CODE_OR_EXECUTION`

Phase 1E-A3 defines the future host-side model broker contract. It does not approve implementation, production profile execution, sandbox execution, subprocess launch, provider/model API calls, real credential access, auth file reads, Keychain reads, gateway/profile/canary changes, dependency changes, OAuth refresh, or credential migration.

## Source dependency

1E-A3 depends on Phase 1E-A2:

- Evidence: `security/evidence/phase-1e-a2/credential-broker-detailed-spec.json`
- A2 evidence file SHA-256: `508bad56c1ad28b50dccabf571257660922ed4071e73a6e1790ff9f849b3671a`
- A2 content SHA-256: `f750f0ead6313a0c89ed7edd0c908c7c43b3c11324ec5c013171e919874159df`
- A2 status: `CREDENTIAL_BROKER_DETAILED_SPEC_COMPLETE_NO_IMPLEMENTATION_APPROVAL`

## Model broker contract

- Host-side only.
- Provider call requires valid policy, grant, and audit.
- Credential broker grant required.
- Model allowlist enforced before provider call.
- Operation allowlist enforced before provider call.
- Budget enforced before provider call.
- Idempotency required.
- Replay detection required.
- Raw provider headers never returned.
- Raw provider errors sanitized.
- Provider secret values never logged.
- Audit unavailable fails closed.
- Broker unavailable fails closed.

## Request schema

Required fields:

- `grant_id`
- `profile_id`
- `workflow_id`
- `task_id`
- `attempt_id`
- `runtime_identity_hash`
- `provider_family`
- `model`
- `operation`
- `sequence_id`
- `idempotency_key`
- `payload_ref_or_hash`
- `audit_context`

## Response schema

Allowed fields:

- `allowed`
- `reason`
- `sanitized_output_ref_or_payload`
- `usage`
- `finish_reason`
- `audit_event_id`
- `grant_usage_hash`

Forbidden response fields:

- `api_key`
- `access_token`
- `refresh_token`
- `authorization_header`
- `raw_request_headers`
- `raw_response_headers`
- `provider_secret_value`
- `root_auth_json_path`
- `credential_pool`

## Fail-closed cases

- Missing policy.
- Invalid grant.
- Expired grant.
- Attempt mismatch.
- Runtime identity mismatch.
- Model not allowlisted.
- Operation not allowlisted.
- Budget exceeded.
- Replay detected.
- Audit unavailable.
- Credential broker unavailable.
- Provider error sanitization failed.

## Required tests before code

- Provider call not attempted before policy, grant, and audit validation.
- Model and operation allowlists enforced before provider boundary.
- Budget and replay denied before provider boundary.
- Raw provider headers never appear in response, logs, or evidence.
- Provider errors sanitized without secret values.
- Broker unavailable and audit unavailable fail closed.

## Next gate

Next gate: `PHASE_1E_A4_RUNTIME_ADAPTER_LAUNCH_CONTROLLER_SPEC`.
