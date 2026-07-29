# PANKSTER Agent Platform — Phase 1C-A12

## Integration test plan with synthetic-only fixtures

Status: `SYNTHETIC_INTEGRATION_TEST_PLAN_COMPLETE_NO_EXECUTION_APPROVAL`

Decision: `SYNTHETIC_ONLY_INTEGRATION_TEST_PLAN_READY_NOT_RUNTIME_EXECUTION`

This is a test plan only. It does not approve implementation, test execution, sandbox execution, production profile execution, provider API calls, gateway changes, Hermes core changes, OAuth refresh, credential migration, or canary.

## Source dependency

A12 depends on the A11 production profile policy contract:

- Evidence: `security/evidence/phase-1c-a11/production-profile-policy-contract.json`
- A11 evidence file SHA-256: `4f4a035776c085a930a43a8f50d03b94895cde12b874efd3d265514edce20f93`
- A11 content SHA-256: `2861465540563590d895cb99d2d1b40ce8e45512133102687c03c62c294d21cd`
- A11 status: `PROFILE_POLICY_CONTRACT_COMPLETE_NO_PRODUCTION_APPROVAL`

## Test plan position

All integration tests must use synthetic fixtures. They must not require real credentials, provider APIs, production profiles, gateway restart, canary, root `auth.json`, Keychain, OAuth refresh, or production sandbox execution.

The synthetic runner is not approved by A12. A future execution gate must separately approve any runner command.

## Fixture inventory

Synthetic-only fixtures:

- profiles: disabled dev-director, disabled content-director, enabled test profile;
- credentials: fake non-secret provider reference, expired grant, replayed grant, owner-mismatch grant;
- models: fake allowed model and fake denied model;
- operations: model, tool, terminal, code execution, delegation, MCP, and background process paths;
- artifacts: sanitized input/output refs, root-auth trap path, credential-pool trap path;
- network modes: `deny_all` and fake broker channel only.

The fixture inventory must contain no secret values.

## Planned suites

### Policy contract suite

- disabled named profiles deny launch;
- missing profile policy denies launch;
- default profile compatibility does not enable named profiles;
- model/provider/operation allowlists are enforced;
- budget is required and enforced before fake provider call;
- credential reference allowlist is required.

### Runtime adapter suite

- runtime security context required before launch;
- sanitized env preserves `NO_PROXY` and `no_proxy`;
- mandatory denylist blocks sensitive keys even if otherwise allowlisted;
- sandbox launch metadata contains only runtime keys and grants;
- artifact boundary rejects root auth and pool paths;
- evidence recorder rejects raw env.

### Broker suite

- fake broker accepts valid attempt-bound grant;
- fake broker denies expired, replayed, owner-mismatch, and not-allowlisted grants;
- fake broker response contains no provider secret.

### Child process suite

- terminal child receives sanitized env;
- code execution child receives sanitized env;
- delegation child is sanitized or unavailable fail-closed;
- MCP child is sanitized or unavailable fail-closed;
- background process child receives sanitized env.

### Lifecycle suite

- retry uses new attempt and new grants;
- reclaim revalidates runtime identity;
- restart uses new runtime identity and policy revalidation;
- destroy is idempotent and audited;
- destroy failure fails closed.

### Secret regression suite

- root auth trap path is not read;
- root credential pool trap path is not materialized;
- OAuth refresh attempt by worker or adapter is denied;
- env, argv, logs, journal, and evidence pass secret scan;
- Telegram, Gitea, Supabase, Anthropic, GLM, and E2B env keys are denied.

## Required assertions

- all tests use synthetic fixtures;
- real provider credentials are not required;
- provider API calls are not allowed;
- sandbox execution is not approved by this plan;
- production profile launch is not allowed;
- gateway changes are not allowed;
- Hermes core changes are not approved by A12;
- raw env capture is not allowed;
- secret values in expected outputs are not allowed.

## Execution gate requirements

Before any future synthetic runner may execute:

- owner approves the synthetic test execution contract;
- runner uses isolated synthetic home;
- runner blocks network or uses fake broker only;
- runner prints no secret values;
- runner does not start gateway, profiles, or canary;
- runner does not read `auth.json` or Keychain;
- runner outputs sanitized Evidence Pack.

## Fail-closed cases

The test plan rejects:

- fixture containing secret-shaped value;
- test requiring real provider credential;
- provider network call attempt;
- gateway restart attempt;
- production profile launch attempt;
- `auth.json` read attempt;
- Keychain read attempt;
- OAuth refresh attempt;
- root pool materialization attempt;
- expected output containing secret value;
- unavailable evidence recorder.

## Design review result

A12 completes the synthetic-only integration test plan. It does not approve execution.

Production runtime remains not approved. Implementation remains not approved until A13 and A14 are complete.

## Rollback

Rollback is to not execute any synthetic runner and retain architecture docs only.

## Next gate

Next gate: `A13_ROLLBACK_AND_OPERATOR_RUNBOOK`.
