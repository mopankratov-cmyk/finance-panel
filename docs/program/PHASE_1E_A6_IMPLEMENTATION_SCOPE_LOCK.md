# PANKSTER Agent Platform — Phase 1E-A6

## Implementation scope lock

Status: `IMPLEMENTATION_SCOPE_LOCK_COMPLETE_NO_CODE_APPROVAL`

Decision: `PHASE_1E_FUTURE_CODE_SCOPE_LOCKED_FOR_INDEPENDENT_SECURITY_REVIEW_NOT_IMPLEMENTATION`

Phase 1E-A6 locks the future code scope before any implementation. It does not approve implementation, production profile execution, sandbox execution, subprocess launch, provider/model API calls, real credential access, auth file reads, Keychain reads, gateway/profile/canary changes, dependency changes, OAuth refresh, or credential migration.

## Source dependency

1E-A6 depends on Phase 1E-A5:

- Evidence: `security/evidence/phase-1e-a5/audit-and-rollback-spec.json`
- A5 evidence file SHA-256: `e45d5843d78ff903f1fb363dbe6a214e17e78bfb9cdd19ce4570a180aeee4162`
- A5 content SHA-256: `9d24699742c36b8adb5daf8fe0b0f9b8a581eddb973279760c10a59ec085764d`
- A5 status: `AUDIT_AND_ROLLBACK_SPEC_COMPLETE_NO_IMPLEMENTATION_APPROVAL`

## Future code allowlist

- `tools/pankster_runtime_security/credential_broker_contracts.py`
- `tools/pankster_runtime_security/model_broker_contracts.py`
- `tools/pankster_runtime_security/audit_contracts.py`
- `tools/pankster_runtime_security/runtime_launch_contracts.py`
- `tools/pankster_runtime_security/rollback_contracts.py`
- `tools/pankster_runtime_security/secret_scan.py`
- `tools/tests/test_pankster_runtime_security_credential_broker_contracts.py`
- `tools/tests/test_pankster_runtime_security_model_broker_contracts.py`
- `tools/tests/test_pankster_runtime_security_audit_contracts.py`
- `tools/tests/test_pankster_runtime_security_runtime_launch_contracts.py`
- `tools/tests/test_pankster_runtime_security_rollback_contracts.py`
- `tools/tests/test_pankster_runtime_security_secret_scan.py`

## Forbidden file scope

- `app/`
- `components/`
- `lib/`
- `middleware.ts`
- `proxy.ts`
- `next.config.js`
- `next.config.mjs`
- `package.json`
- lockfiles
- `.env*`
- `.gitea/`
- `.github/`
- `gateway.py`
- `web_server.py`
- `agent/conversation_loop.py`
- Hermes core runtime files outside this repository.

## Future code constraints

- Pure contracts first.
- No runtime side effects.
- No process env reads.
- No `auth.json` or Keychain reads.
- No network clients.
- No provider SDKs.
- No subprocess launch.
- No sandbox launch.
- No gateway integration.
- No dependency changes.
- Secret scan required.
- Full tools tests required.

## Separate approval required for

- Any dependency or lockfile change.
- Any provider SDK use.
- Any network or provider/model API call.
- Any sandbox or subprocess launch.
- Any real credential read or OAuth refresh.
- Any gateway/profile/canary change.
- Any production deployment.

## Next gate

Next gate: `PHASE_1E_A7_INDEPENDENT_SECURITY_REVIEW_BEFORE_CODE`.
