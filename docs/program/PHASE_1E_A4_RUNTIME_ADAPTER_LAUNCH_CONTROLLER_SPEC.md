# PANKSTER Agent Platform — Phase 1E-A4

## Runtime adapter launch controller spec

Status: `RUNTIME_ADAPTER_LAUNCH_CONTROLLER_SPEC_COMPLETE_NO_IMPLEMENTATION_APPROVAL`

Decision: `RUNTIME_ADAPTER_LAUNCH_CONTROLLER_CONTRACT_READY_FOR_AUDIT_ROLLBACK_SPEC_NOT_CODE_OR_EXECUTION`

Phase 1E-A4 defines the future launch controller contract. It does not approve implementation, production profile execution, sandbox execution, subprocess launch, provider/model API calls, real credential access, auth file reads, Keychain reads, gateway/profile/canary changes, dependency changes, OAuth refresh, or credential migration.

## Source dependency

1E-A4 depends on Phase 1E-A3:

- Evidence: `security/evidence/phase-1e-a3/model-broker-detailed-spec.json`
- A3 evidence file SHA-256: `e7782da90d7ea486822d8a669a2d02eca7a0fe06d35b8c90b9072e343aa5c39d`
- A3 content SHA-256: `0200b623f0e232f3261515127924c0ecc2868c7e90b22aec4dce30efb5dc7db5`
- A3 status: `MODEL_BROKER_DETAILED_SPEC_COMPLETE_NO_IMPLEMENTATION_APPROVAL`

## Launch controller contract

- Launch requires explicit owner approval.
- Launch requires valid profile policy.
- Launch requires runtime identity.
- Launch requires network policy.
- Launch requires audit sink availability.
- Launch requires sanitized environment.
- Launch requires no provider secret in env, argv, mounts, logs, or evidence.
- Launch receives grant references only.
- Launch is forbidden when policy is missing or disabled.
- Destroy is required on failure.
- Retry/reclaim/restart must revalidate context.
- Rollback disables runtime without gateway change.

## Environment contract

- Preserve `NO_PROXY` and `no_proxy`.
- Enforce mandatory sensitive denylist.
- Enforce profile-specific allowlist.
- Sanitize terminal, MCP, delegation, code execution, and background environments.
- Ignore unknown keys.
- Denylist has precedence.

## Lifecycle states

- `requested`
- `preflight_validated`
- `environment_sanitized`
- `grant_refs_attached`
- `launch_denied_or_started`
- `running`
- `reclaim_requested`
- `retry_requested`
- `destroy_requested`
- `destroyed`
- `rollback_disabled`

## Fail-closed cases

- Missing owner approval.
- Missing or disabled policy.
- Invalid runtime identity.
- Missing network policy.
- Audit unavailable.
- Sanitizer denied sensitive key.
- Provider secret detected.
- Grant missing or unbound.
- Broker unavailable.
- Destroy failure.
- Retry/reclaim context mismatch.
- Rollback unavailable.

## Required tests before code

- Launch denied without exact owner approval.
- Launch denied when policy missing, disabled, or stale.
- Sanitized env preserves `NO_PROXY`/`no_proxy` and denies secrets.
- Terminal, MCP, delegation, code execution, and background envs sanitized.
- Retry/reclaim/restart revalidate attempt-bound context.
- Destroy attempted on launch failure.
- Rollback disables runtime without gateway change.

## Next gate

Next gate: `PHASE_1E_A5_AUDIT_AND_ROLLBACK_SPEC`.
