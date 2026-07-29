# PANKSTER Agent Platform — Phase 1E-A5

## Audit and rollback spec

Status: `AUDIT_AND_ROLLBACK_SPEC_COMPLETE_NO_IMPLEMENTATION_APPROVAL`

Decision: `AUDIT_ROLLBACK_CONTRACT_READY_FOR_IMPLEMENTATION_SCOPE_LOCK_NOT_CODE_OR_EXECUTION`

Phase 1E-A5 defines the future audit and rollback contracts. It does not approve implementation, production profile execution, sandbox execution, subprocess launch, provider/model API calls, real credential access, auth file reads, Keychain reads, gateway/profile/canary changes, dependency changes, OAuth refresh, or credential migration.

## Source dependency

1E-A5 depends on Phase 1E-A4:

- Evidence: `security/evidence/phase-1e-a4/runtime-adapter-launch-controller-spec.json`
- A4 evidence file SHA-256: `e4fc45b4def139997504998ff0b64cb85877a8d1199016c0f9e7abc0ae046781`
- A4 content SHA-256: `4946bd1cfb55e85e5e3afac7cbd8ccbb1f118430cdc5910e737418197c6385a7`
- A4 status: `RUNTIME_ADAPTER_LAUNCH_CONTROLLER_SPEC_COMPLETE_NO_IMPLEMENTATION_APPROVAL`

## Audit contract

- Audit required before grant issuance.
- Audit required before provider call.
- Audit unavailable fails closed.
- Audit events are secret-free.
- Audit records key names, not values.
- Audit IDs correlate attempt, grant, runtime, and policy.
- Audit write failure blocks runtime progress.
- Evidence secret scan required before write.

## Required audit events

- `policy.checked`
- `grant.requested`
- `grant.issued`
- `grant.denied`
- `grant.used`
- `model.requested`
- `model.denied`
- `model.completed`
- `model.failed`
- `runtime.launch.requested`
- `runtime.launch.denied`
- `runtime.launch.started`
- `runtime.destroy.requested`
- `runtime.destroyed`
- `rollback.requested`
- `rollback.completed`
- `credential.refresh.requested`
- `credential.refresh.denied`
- `credential.refresh.completed`

## Rollback contract

- Disable named-profile runtime without gateway change.
- Deny new grants immediately.
- Revoke attempt grants.
- Destroy or reclaim runtime if started.
- Preserve `NO_PROXY`/`no_proxy` behavior.
- Write secret-free rollback audit.
- Rollback unavailable fails closed for new runtime.

## Forbidden audit fields

- `api_key`
- `access_token`
- `refresh_token`
- `authorization_header`
- `raw_request_headers`
- `raw_response_headers`
- `provider_secret_value`
- `environment_value`
- `root_auth_json_content`
- `credential_pool`

## Required tests before code

- Audit unavailable blocks grant issue and provider call.
- Audit event schema rejects forbidden secret fields.
- Evidence writer scans before write.
- Rollback denies new grants immediately.
- Rollback revokes attempt grants.
- Rollback does not require gateway change.
- Rollback audit is secret-free.

## Next gate

Next gate: `PHASE_1E_A6_IMPLEMENTATION_SCOPE_LOCK`.
