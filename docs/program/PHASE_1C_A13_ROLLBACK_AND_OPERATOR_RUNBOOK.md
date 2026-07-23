# PANKSTER Agent Platform — Phase 1C-A13

## Rollback and operator runbook

Status: `ROLLBACK_AND_OPERATOR_RUNBOOK_COMPLETE_NO_DEPLOYMENT_APPROVAL`

Decision: `OPERATOR_RUNBOOK_READY_FOR_FINAL_IMPLEMENTATION_READINESS_REVIEW_NOT_DEPLOYMENT`

This is a runbook contract only. It does not approve implementation, deployment, test execution, sandbox execution, production profile execution, provider API calls, gateway changes, Hermes core changes, OAuth refresh, credential migration, or canary.

## Source dependency

A13 depends on the A12 synthetic-only integration test plan:

- Evidence: `security/evidence/phase-1c-a12/synthetic-integration-test-plan.json`
- A12 evidence file SHA-256: `d275ee7d47304545793debf12ce0b5820df1bf04705f15073518e83f872a33cf`
- A12 content SHA-256: `267dc67342d617abc79c7736e9b08e29b4fbd8c69a9e0615a9627be02dd167de`
- A12 status: `SYNTHETIC_INTEGRATION_TEST_PLAN_COMPLETE_NO_EXECUTION_APPROVAL`

## Operator principles

- feature flags default disabled;
- named profiles remain disabled until explicit owner approval;
- rollback must not restart gateway;
- rollback must preserve default profile behavior;
- operator commands must not contain or print secrets;
- uncertain state fails closed;
- evidence is required before and after each state change;
- manual approval is required before execution steps.

## Default feature flag state

All future runtime-isolation feature flags default to disabled:

- runtime adapter;
- host model broker;
- credential broker;
- named profile runtime;
- synthetic runner;
- production profiles.

## Operator preflight checks

Before any future execution, the operator must confirm:

- branch and commit;
- gateway is not targeted;
- default profile is unchanged;
- named profiles are disabled;
- no real credentials are in the plan;
- provider API calls are not approved;
- `auth.json` and Keychain access are not approved;
- there is no pending unreviewed diff;
- evidence directory is sanitized;
- secret scan passed.

## Future enablement sequence

1. Obtain explicit owner approval for synthetic execution.
2. Enable synthetic runner only.
3. Run synthetic fixture plan in isolated home.
4. Collect sanitized Evidence Pack.
5. Review fail-closed denials.
6. Disable synthetic runner.
7. Perform independent security review.
8. Only then consider implementation gate.

## Rollback sequence

1. Stop accepting new named-profile launches.
2. Disable named-profile runtime feature flag.
3. Disable runtime adapter feature flag.
4. Disable host model broker feature flag.
5. Disable credential broker feature flag.
6. Revoke unexpired grants.
7. Destroy or mark sandboxes reclaim-required.
8. Preserve sanitized evidence.
9. Verify default gateway still serving.
10. Verify default profile behavior unchanged.
11. Record rollback decision.

## Emergency stop conditions

Stop immediately and fail closed if any of these are detected:

- provider secret in env, argv, logs, or evidence;
- root `auth.json` read;
- root credential pool materialization;
- OAuth refresh by worker or adapter;
- gateway restart attempt;
- production profile launch without owner approval;
- direct provider egress from sandbox;
- broker audit unavailable;
- sandbox destroy failure;
- unknown runtime identity on reclaim.

## Operator command policy

A13 contains no executable operator commands. Future commands must not print secrets, read `auth.json`, read Keychain, restart gateway, start profiles, call providers, or rely on ambiguous paths.

## Evidence Pack requirements

Future evidence packs must include commit, branch, feature flag state, profile state, policy version, opaque or hashed grant IDs, runtime identity hash, network policy ID, sanitized env key list only, denylist check result, secret scan result, and rollback verification result.

## Rollback verification

Rollback is complete only when:

- named-profile runtime disabled;
- runtime adapter disabled;
- host model broker disabled;
- credential broker disabled;
- no unexpired runtime grants remain;
- no production sandboxes are running;
- gateway was not restarted by runbook;
- default profile smoke check is unchanged;
- evidence secret scan passed.

## Required tests before implementation approval

Unit tests:

- feature flags default disabled;
- rollback disables all runtime flags;
- operator command policy forbids secret, auth, Keychain, gateway, profile, and provider actions;
- Evidence Pack requires sanitized env key list only;
- emergency stop conditions cover secret, root, OAuth, gateway, provider, and destroy failures.

Synthetic integration tests:

- rollback disables named-profile runtime;
- rollback revokes grants;
- rollback preserves default profile state;
- synthetic Evidence Pack contains no secret values;
- uncertain state fails closed.

Security tests:

- runbook contains no secret values;
- rollback commands do not include `auth.json`, Keychain, or provider calls;
- Evidence Pack secret scan is required;
- manual approval is required before execution steps.

## Design review result

A13 completes the rollback and operator runbook for final implementation readiness review only.

Deployment remains not approved. Production runtime remains not approved. Implementation remains not approved until A14 is complete.

## Rollback

Use the runbook rollback sequence and keep all runtime feature flags disabled.

## Next gate

Next gate: `A14_FINAL_IMPLEMENTATION_READINESS_REVIEW`.
