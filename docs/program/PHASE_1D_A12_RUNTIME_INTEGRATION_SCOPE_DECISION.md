# PANKSTER Agent Platform — Phase 1D-A12

## Runtime integration scope decision

Status: `RUNTIME_INTEGRATION_SCOPE_DECISION_COMPLETE`

Decision: `CLOSE_PHASE_1D_AT_SYNTHETIC_BASELINE_REAL_RUNTIME_REQUIRES_PHASE_1E_ARCHITECTURE_GATE`

A12 closes the Phase 1D implementation scope at the synthetic runtime-security baseline. It does not approve production profile execution, sandbox execution, subprocess launch, provider/model API calls, real credential access, auth file reads, Keychain reads, gateway/profile/canary changes, dependency changes, OAuth refresh, or credential migration.

## Source dependency

A12 depends on Phase 1D-A11:

- Evidence: `security/evidence/phase-1d-a11/synthetic-preflight-execution-review.json`
- A11 evidence file SHA-256: `1abc4f8c84c0ceb84c464202307a6137737937f62962f3a00bfdece4c9b1523c`
- A11 content SHA-256: `df6e642748e5e09e8835ade9b805e2de6709a82137be1616cbce4e9653f09186`
- A11 verdict: `PASS_SYNTHETIC_DRY_RUN_REVIEW_NOT_PRODUCTION_READY`

## Decision

Phase 1D deliverable is the synthetic runtime-security baseline only.

Real runtime integration is out of scope for Phase 1D and requires a new Phase 1E architecture gate and owner approval.

## Accepted Phase 1D artifacts

- Policy schema validator.
- Environment sanitizer.
- Fake grant registry.
- Fake model broker.
- Fail-closed runtime adapter stubs.
- Synthetic preflight approval contract.
- Approved local synthetic dry-run evidence.
- Synthetic execution review.

## Blocked until Phase 1E

- Sandbox runtime integration.
- Host-side real credential broker.
- Real model broker provider calls.
- Profile runtime enablement.
- Gateway integration.
- OAuth refresh integration.
- Production deployment.

## Phase 1E entry requirements

- Authoritative architecture spec for real host-side credential broker.
- Threat model update for real runtime integration.
- Owner approval for any sandbox/process launch.
- Owner approval for any dependency or provider SDK use.
- Root auth fallback and credential materialization review before real credentials.
- Rollback plan before gateway or profile integration.
- Independent security review before production.

## Next gate

Next gate: `1D-A13_PHASE_1D_CLOSEOUT_PACKAGE`.
