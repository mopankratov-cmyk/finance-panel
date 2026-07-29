# PANKSTER Agent Platform — Phase 1E-A0

## Real runtime architecture planning

Status: `REAL_RUNTIME_ARCHITECTURE_PLANNING_COMPLETE_NO_IMPLEMENTATION_APPROVAL`

Decision: `PHASE_1E_REAL_RUNTIME_ARCHITECTURE_SCOPE_DEFINED_FOR_THREAT_MODEL_NOT_CODE_OR_EXECUTION`

Phase 1E-A0 starts planning for real runtime integration. It does not approve implementation, production profile execution, sandbox execution, subprocess launch, provider/model API calls, real credential access, auth file reads, Keychain reads, gateway/profile/canary changes, dependency changes, OAuth refresh, or credential migration.

## Source dependency

1E-A0 depends on Phase 1D-A13:

- Evidence: `security/evidence/phase-1d-a13/phase-1d-closeout-package.json`
- A13 evidence file SHA-256: `415a65e12669ea132eb122138e7a1a8372be6feacb34ec06d4491f3e0117024e`
- A13 content SHA-256: `df1a30a56cd6cdd07cff13bd34422367968a00afc552ea54bd3296beb70d5418`
- A13 verdict: `PHASE_1D_SYNTHETIC_BASELINE_COMPLETE_NOT_PRODUCTION_READY`

## Architecture components

- Host-side policy engine.
- Host-side credential broker.
- Host-side grant registry.
- Host-side model broker.
- Runtime adapter boundary.
- Sandbox/process launch controller.
- Audit sink.
- Rollback controller.
- Secret scanner.
- Profile policy store.

## Trust boundaries

- Real credentials remain host-only and owner-scoped.
- Sandbox receives only sanitized environment and non-secret grant references.
- All model/provider operations cross host-side policy and grant validation.
- Audit records are secret-free and fail closed if unavailable.
- Named profiles remain disabled until explicit future approval.

## Required invariants

- Root auth fallback disabled for named profiles.
- Root credential pool materialization forbidden.
- Profile worker receives no provider secret values.
- Terminal, MCP, and delegation children receive sanitized environments.
- `NO_PROXY`/`no_proxy` preserved in sanitized environments.
- OAuth refresh remains owner-only compare-and-swap in future design.
- Audit unavailable fails closed before grant issuance or provider call.
- Missing policy fails closed.

## Forbidden in 1E-A0

- Implementation code.
- Sandbox or subprocess launch.
- Provider/model API call.
- Real credential read.
- `auth.json` or Keychain read.
- Gateway/profile/canary start.
- Dependency or lockfile change.
- Credential migration.
- OAuth refresh.
- Production deployment.

## Planned gate sequence

1. `PHASE_1E_A1_REAL_RUNTIME_THREAT_MODEL`
2. `PHASE_1E_A2_CREDENTIAL_BROKER_DETAILED_SPEC`
3. `PHASE_1E_A3_MODEL_BROKER_DETAILED_SPEC`
4. `PHASE_1E_A4_RUNTIME_ADAPTER_LAUNCH_CONTROLLER_SPEC`
5. `PHASE_1E_A5_AUDIT_AND_ROLLBACK_SPEC`
6. `PHASE_1E_A6_IMPLEMENTATION_SCOPE_LOCK`
7. `PHASE_1E_A7_INDEPENDENT_SECURITY_REVIEW_BEFORE_CODE`

## Next gate

Next gate: `PHASE_1E_A1_REAL_RUNTIME_THREAT_MODEL`.
