# PANKSTER Agent Platform — Phase 1E-A2

## Credential broker detailed spec

Status: `CREDENTIAL_BROKER_DETAILED_SPEC_COMPLETE_NO_IMPLEMENTATION_APPROVAL`

Decision: `CREDENTIAL_BROKER_CONTRACT_READY_FOR_MODEL_BROKER_SPEC_NOT_CODE_OR_EXECUTION`

Phase 1E-A2 defines the future host-side credential broker contract. It does not approve implementation, production profile execution, sandbox execution, subprocess launch, provider/model API calls, real credential access, auth file reads, Keychain reads, gateway/profile/canary changes, dependency changes, OAuth refresh, or credential migration.

## Source dependency

1E-A2 depends on Phase 1E-A1:

- Evidence: `security/evidence/phase-1e-a1/real-runtime-threat-model.json`
- A1 evidence file SHA-256: `13da547bdd5d649b83887430b7486afb512872dc04b72b8a88ba00d13000e822`
- A1 content SHA-256: `2c9629a6389d94098fcb8e8938af4a377277ef3cd34f795f5fbbe6f5d882839b`
- A1 status: `REAL_RUNTIME_THREAT_MODEL_COMPLETE_NO_IMPLEMENTATION_APPROVAL`

## Credential broker contract

- Credential values are host-only.
- Profiles receive only grant references.
- Grant references are not bearer secrets.
- Grants are bound to profile, task, attempt, runtime identity, policy, purpose, TTL, and budget.
- Root auth fallback is disabled for named profiles.
- Root credential pool materialization is forbidden.
- Credential reference allowlist is required.
- Audit is required before grant issuance.
- Audit unavailable fails closed.
- Broker unavailable fails closed.

## Credential reference schema

Required fields:

- `credential_ref_id`
- `owner_principal_id`
- `provider_family`
- `allowed_profiles`
- `allowed_operations`
- `rotation_epoch`
- `policy_version`
- `status`

The schema stores references and metadata only. It must not store provider secret values.

## Grant schema

Required fields:

- `grant_id`
- `profile_id`
- `workflow_id`
- `task_id`
- `attempt_id`
- `runtime_identity_hash`
- `policy_version`
- `purpose`
- `provider_family`
- `model_allowlist`
- `operation_allowlist`
- `ttl_seconds`
- `budget`
- `sequence_policy`
- `audit_event_id`

## OAuth refresh future contract

- Owner-only.
- Compare-and-swap required.
- Worker refresh forbidden.
- Profile store secret write forbidden.
- Root pool materialization forbidden.
- Audit refresh events required.

## Denied paths

- Environment secret injection.
- argv secret injection.
- Logs or journal secret write.
- Evidence Pack secret write.
- Terminal child secret inheritance.
- MCP child secret inheritance.
- Delegation child secret inheritance.
- Retry/reclaim/restart grant scope widening.
- Root auth fallback for named profile.
- OAuth refresh from worker.

## Required tests before code

- Grant schema rejects secret fields.
- Credential reference schema never stores values.
- Issue grant fails when audit unavailable.
- Issue grant fails when credential ref owner mismatches profile policy.
- Root auth fallback disabled for named profiles.
- Root credential pool materialization forbidden.
- OAuth refresh owner-only compare-and-swap.
- Terminal, MCP, delegation, retry, reclaim, and restart receive only sanitized env and grant refs.

## Next gate

Next gate: `PHASE_1E_A3_MODEL_BROKER_DETAILED_SPEC`.
