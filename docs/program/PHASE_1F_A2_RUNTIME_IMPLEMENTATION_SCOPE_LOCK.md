# PANKSTER Agent Platform — Phase 1F-A2

## Runtime implementation scope lock

Status: `PHASE_1F_A2_RUNTIME_IMPLEMENTATION_SCOPE_LOCK_COMPLETE_NO_CODE`

Verdict: `READY_FOR_PHASE_1F_A3_INDEPENDENT_SECURITY_REVIEW_BEFORE_CODE_NOT_IMPLEMENTATION`

Decision: `PHASE_1F_RUNTIME_IMPLEMENTATION_SCOPE_LOCKED_FOR_INDEPENDENT_SECURITY_REVIEW_NOT_IMPLEMENTATION`

Phase 1F-A2 consumes the exact Phase 1F-A1 owner approval string and locks the future runtime integration implementation scope before any code change. It does not approve implementation, runtime execution, production profile execution, sandbox execution, subprocess launch, provider/model API calls, real credential access, auth file reads, Keychain reads, gateway.py or web_server.py changes, profile worker runtime changes, Hermes core changes, dependency changes, OAuth refresh, credential migration, canary, or deployment.

## Consumed owner approval

```text
APPROVE_PHASE_1F_RUNTIME_IMPLEMENTATION_SCOPE_LOCK:p1f-20260723-scopea1:082bc5f87eba718898e979b3e3b031f6792b248b321891d74a27c908b712a304
```

Approval command SHA-256:

```text
cbf30907ee949ca05f46b54b99e4f8dc827d1c60ee8c5a4e5a5900f23f116e6f
```

## Source dependency

A2 depends on Phase 1F-A1:

- Evidence: `security/evidence/phase-1f-a1/runtime-integration-owner-approval-request.json`
- A1 evidence file SHA-256: `b0b4769653371a239d678c8bb879a13281ab10484e87628697b56c19d93752cc`
- A1 content SHA-256: `555723638ab7600a4b42001c0009c5154c0312c66d56891187449ef0d0a58f93`
- A1 status: `PHASE_1F_A1_RUNTIME_INTEGRATION_OWNER_APPROVAL_REQUEST_COMPLETE_NO_SCOPE_LOCK`

## Future code allowlist after separate A4 owner approval

Future implementation is not approved by A2. If Phase 1F-A3 passes and a separate A4 owner approval is issued later, the only allowed future code scope is:

- `tools/pankster_runtime_security/runtime_integration_contracts.py`
- `tools/pankster_runtime_security/runtime_adapter_binding_contracts.py`
- `tools/tests/test_pankster_runtime_security_runtime_integration_contracts.py`
- `tools/tests/test_pankster_runtime_security_runtime_adapter_binding_contracts.py`

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

- Pure contract layer only.
- Independent security review before code is required.
- Separate A4 owner approval before any implementation code is required.
- Disabled-by-default behavior is required.
- Fail-closed behavior is required.
- No runtime side effects.
- No runtime process launch.
- No process environment secret reads.
- No `auth.json` or Keychain reads.
- No credential materialization.
- No network clients.
- No provider SDKs.
- No subprocess launch.
- No sandbox launch.
- No gateway integration.
- No web server integration.
- No dependency changes.
- Secret scan required.
- Full tools tests required.

## Separate approval required for

- Any implementation code after A3 independent security review.
- Any dependency or lockfile change.
- Any provider SDK use.
- Any network or provider/model API call.
- Any sandbox or subprocess launch.
- Any real credential read or OAuth refresh.
- Any gateway/web_server/profile/canary change.
- Any production deployment.

## Next gate

Next gate: `PHASE_1F_A3_INDEPENDENT_SECURITY_REVIEW_BEFORE_CODE`.
