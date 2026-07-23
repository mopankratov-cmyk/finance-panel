# PANKSTER Agent Platform — Phase 1E-A1

## Real runtime threat model

Status: `REAL_RUNTIME_THREAT_MODEL_COMPLETE_NO_IMPLEMENTATION_APPROVAL`

Decision: `REAL_RUNTIME_THREAT_MODEL_READY_FOR_CREDENTIAL_BROKER_SPEC_NOT_CODE_OR_EXECUTION`

Phase 1E-A1 defines the threat model for future real runtime integration. It does not approve implementation, production profile execution, sandbox execution, subprocess launch, provider/model API calls, real credential access, auth file reads, Keychain reads, gateway/profile/canary changes, dependency changes, OAuth refresh, or credential migration.

## Source dependency

1E-A1 depends on Phase 1E-A0:

- Evidence: `security/evidence/phase-1e-a0/real-runtime-architecture-planning.json`
- A0 evidence file SHA-256: `0f6053cf7f754f2dc11f4eab9190da4e49cfca24440193dd0b78042a64a71bf6`
- A0 content SHA-256: `884ad39df8a0de0fe51ebd1deabf2bfb5c8a38ab9ff16d62553f7d16ede0a143`
- A0 status: `REAL_RUNTIME_ARCHITECTURE_PLANNING_COMPLETE_NO_IMPLEMENTATION_APPROVAL`

## Protected assets

- Owner-scoped provider credentials.
- Root auth store and credential pools.
- Profile policy store.
- Grant registry state.
- Broker audit log.
- Runtime identity.
- Sanitized environment contract.
- `NO_PROXY`/`no_proxy` behavior.
- Evidence Packs and logs.

## Attacker models

- Malicious or compromised profile worker.
- Prompt-injected tool call attempting credential access.
- Compromised MCP/delegation/terminal child.
- Replay attacker with stale grant reference.
- Operator error enabling named profile too early.
- Network egress bypass from sandbox or process.

## Threats and required mitigations

- T1: credential exfiltration via environment or child process — mandatory denylist plus profile-specific allowlist for terminal, MCP, delegation, code execution, background, retry, and reclaim paths.
- T2: root auth fallback or pool materialization — named profiles disable root auth fallback and forbid root credential pool materialization.
- T3: OAuth refresh materializes profile or root credentials — owner-only host-side compare-and-swap refresh with no worker-visible secret output.
- T4: grant replay or cross-attempt use — bind grants to profile, task, attempt, runtime identity, policy version, budget, TTL, and sequence.
- T5: broker bypass via direct provider call — sandbox/process receives no provider secrets and network policy denies direct egress until separate approval.
- T6: audit or evidence secret leak — secret-free audit schema and scanner before evidence write.
- T7: retry/reclaim/restart scope expansion — preserve sanitized environment and attempt-bound grant semantics across lifecycle transitions.
- T8: missing or ambiguous policy allows runtime — fail closed on missing, stale, malformed, disabled, or ambiguous policy.

## Security requirements

- Fail-closed default.
- Audit required before grant issuance or provider call.
- Grant references are not bearer secrets.
- Real credentials remain host-only.
- Sandbox receives no provider secrets.
- Child process environments are sanitized.
- argv, logs, journal, and evidence are secret-free.
- Provider calls require policy and grant validation.
- Rollback must disable runtime without gateway change.

## Required tests before code

- Credential exfiltration path tests for env, argv, logs, journal, and evidence.
- Terminal, MCP, delegation, code execution, and background environment sanitizer tests.
- Root auth fallback disabled tests.
- Root credential pool materialization forbidden tests.
- OAuth refresh owner-only compare-and-swap tests.
- Grant replay/cross-attempt denial tests.
- Broker unavailable/audit unavailable fail-closed tests.
- Retry, reclaim, restart lifecycle preservation tests.

## Next gate

Next gate: `PHASE_1E_A2_CREDENTIAL_BROKER_DETAILED_SPEC`.
