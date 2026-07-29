# PANKSTER Agent Platform — Phase 1D-A1

## Implementation scope and branch contract

Status: `IMPLEMENTATION_SCOPE_AND_BRANCH_CONTRACT_COMPLETE_NO_CODE_APPROVAL`

Decision: `PHASE_1D_EXACT_SCOPE_LOCKED_FOR_FUTURE_PURE_IMPLEMENTATION_GATES`

A1 locks scope before any implementation code. It does not approve implementation code by itself, deployment, production profile execution, sandbox execution, provider API calls, gateway changes, dependency changes, Hermes core runtime changes, OAuth refresh, credential migration, or canary.

## Source dependency

A1 depends on Phase 1D-A0:

- Evidence: `security/evidence/phase-1d-a0/controlled-implementation-planning.json`
- A0 evidence file SHA-256: `5be6986909ef8213e65c2f42e5841a377af2caf2087ce79fa1a4855378d012b6`
- A0 content SHA-256: `346de53f0268a98d52dbd9805c1a1b8e9c7851f5dce92b122ec0879c10f109d9`
- A0 status: `CONTROLLED_IMPLEMENTATION_PLANNING_COMPLETE_NO_RUNTIME_APPROVAL`

## Branch contract

- Current branch: `phase/1c-runtime-isolation-architecture`
- Branch reuse is allowed for this phase.
- Direct push to `main` is forbidden.
- Force push is forbidden.
- New worktree is not required.
- Dirty worktree before each gate is forbidden.
- Each gate must be committed.
- Each gate should be pushed after commit.

## Future code allowlist

Future implementation gates may only introduce pure test/helper code under:

- `tools/pankster_runtime_security/`
- `tools/tests/test_pankster_runtime_security_*.py`

Exact proposed package files:

- `tools/pankster_runtime_security/__init__.py`
- `tools/pankster_runtime_security/feature_flags.py`
- `tools/pankster_runtime_security/policy_schema.py`
- `tools/pankster_runtime_security/environment_sanitizer.py`
- `tools/pankster_runtime_security/fake_grants.py`
- `tools/pankster_runtime_security/fake_model_broker.py`
- `tools/pankster_runtime_security/runtime_adapter_contracts.py`
- `tools/pankster_runtime_security/secret_scan.py`

Exact proposed test files:

- `tools/tests/test_pankster_runtime_security_feature_flags.py`
- `tools/tests/test_pankster_runtime_security_policy_schema.py`
- `tools/tests/test_pankster_runtime_security_environment_sanitizer.py`
- `tools/tests/test_pankster_runtime_security_fake_grants.py`
- `tools/tests/test_pankster_runtime_security_fake_model_broker.py`
- `tools/tests/test_pankster_runtime_security_runtime_adapter_contracts.py`
- `tools/tests/test_pankster_runtime_security_secret_scan.py`

Docs, evidence, and validators may continue under:

- `docs/program/PHASE_1D_*`
- `security/evidence/phase-1d-*`
- `tools/phase_1d_*`
- `tools/tests/test_phase_1d_*`

## Forbidden file scope

Future Phase 1D gates may not modify:

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

## Module permission matrix

| Module | First gate | Code allowed there | Runtime side effects | Network | Credential reads | Sandbox launch |
|---|---:|---:|---:|---:|---:|---:|
| feature flags | 1D-A2 | no | no | no | no | no |
| policy schema | 1D-A3 | yes | no | no | no | no |
| environment sanitizer | 1D-A4 | yes | no | no | no | no |
| fake grants and broker | 1D-A5 | yes | no | no | no | no |
| runtime adapter contracts | 1D-A6 | yes | no | no | no | no |

## Required pre-code checks

- A1 validator passes;
- working tree is clean;
- exact files match allowlist;
- forbidden files are unchanged;
- no dependency or lockfile changes;
- no env files changed;
- no secret-shaped values in new files;
- full tools tests pass.

## Fail-closed cases

- A0 dependency missing or hash-mismatched;
- current branch unknown;
- attempt to push `main`;
- dirty worktree before gate;
- future file outside allowlist;
- forbidden file changed;
- dependency or lockfile changed;
- env file changed;
- feature flag default true;
- runtime side effect detected;
- network client added;
- credential read path added;
- secret scan failed.

## Required tests

Validator tests:

- A1 requires A0 dependency hash;
- current branch contract matches;
- future code scope is exact files only;
- forbidden scope blocks app, lib, deps, env, gateway, and Hermes core;
- module permission matrix blocks side effects, network, credentials, and sandbox.

Future gate tests:

- A3 creates only policy schema files;
- A4 creates only environment sanitizer files;
- A5 creates only fake grants and broker files;
- A6 creates only runtime adapter contract files;
- all future gates keep forbidden files unchanged.

Security tests:

- no secret values in scope contract;
- no provider network clients in scope contract;
- no `auth.json` or Keychain paths as read targets;
- no gateway or profile start commands.

## Readiness finding

A1 locks the exact future scope. Future code gates still cannot start until A2 defines disabled feature flags and config behavior.

Runtime execution is not ready. Production is not ready.

## Rollback

Revert A1 and remain at 1D-A0 planning only.

## Next gate

Next gate: `1D-A2_FEATURE_FLAG_AND_CONFIG_SCAFFOLD_SPEC`.
