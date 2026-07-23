# PANKSTER Agent Platform — Phase 1D-A0

## Controlled implementation planning

Status: `CONTROLLED_IMPLEMENTATION_PLANNING_COMPLETE_NO_RUNTIME_APPROVAL`

Decision: `PHASE_1D_SCOPE_READY_FOR_FEATURE_FLAGGED_IMPLEMENTATION_PLANNING_ONLY`

This starts Phase 1D planning. It does not approve implementation code by itself, deployment, production profile execution, sandbox execution, provider API calls, gateway changes, Hermes core runtime changes, OAuth refresh, credential migration, or canary.

## Source dependency

Phase 1D-A0 depends on the Phase 1C-A14 final implementation readiness review:

- Evidence: `security/evidence/phase-1c-a14/final-implementation-readiness-review.json`
- A14 evidence file SHA-256: `652284b5633d26eacc0c99c2b9f34471968f2a2f1bfdcfced6d02e0fb1505cf8`
- A14 content SHA-256: `dc7374fdb34401768683f09874833ec7c3f666a569b18515ee4960a064ff1400`
- A14 verdict: `READY_FOR_CONTROLLED_IMPLEMENTATION_PHASE_NOT_DEPLOYMENT`

## Planning principles

- implementation must be incremental;
- every runtime path must remain behind disabled feature flags;
- start with pure policy and sanitizer units;
- fake brokers precede real brokers;
- synthetic tests precede any sandbox execution;
- default gateway and default profile behavior remain unchanged;
- no real credentials until a later security gate;
- named profiles remain disabled;
- missing policy or missing flag fails closed.

## Allowed planning scope

A0 allows only planning:

- define Phase 1D gate sequence;
- define disabled-by-default feature flag names;
- define module boundaries for policy, broker, adapter, and sanitizer;
- define synthetic fixture boundaries;
- define secret scan requirements;
- define review checkpoints.

## Forbidden scope

A0 forbids:

- modifying Hermes core runtime behavior;
- starting gateway or canary;
- starting profiles;
- calling real model or provider APIs;
- reading `auth.json` or Keychain;
- writing profile provider secrets;
- performing OAuth refresh;
- enabling named profiles;
- deploying to production.

## Phase 1D gate sequence

1. `1D-A1_IMPLEMENTATION_SCOPE_AND_BRANCH_CONTRACT`
   - lock exact implementation files, branch rules, feature flags, and non-goals before code;
   - code not allowed.
2. `1D-A2_FEATURE_FLAG_AND_CONFIG_SCAFFOLD_SPEC`
   - specify disabled-by-default flags and config reads with no runtime behavior change;
   - code not allowed.
3. `1D-A3_POLICY_SCHEMA_VALIDATOR_IMPLEMENTATION`
   - implement pure profile policy schema validator and unit tests only;
   - code allowed under scope.
4. `1D-A4_ENVIRONMENT_SANITIZER_IMPLEMENTATION`
   - implement pure environment allowlist-denylist sanitizer and unit tests only;
   - code allowed under scope.
5. `1D-A5_FAKE_GRANT_REGISTRY_AND_BROKER_IMPLEMENTATION`
   - implement fake in-memory grant registry and fake model broker for synthetic tests only;
   - code allowed under scope.
6. `1D-A6_RUNTIME_ADAPTER_INTERFACE_STUBS`
   - implement interfaces and fail-closed stubs without sandbox launch;
   - code allowed under scope.
7. `1D-A7_SYNTHETIC_RUNNER_PREFLIGHT_CONTRACT`
   - prepare synthetic runner approval contract;
   - execution not allowed.
8. `1D-A8_IMPLEMENTATION_SECURITY_REVIEW`
   - review implemented pure units before any execution approval;
   - code not allowed.

## Default-disabled feature flags

- `PANKSTER_RUNTIME_ADAPTER_ENABLED=false`
- `PANKSTER_HOST_MODEL_BROKER_ENABLED=false`
- `PANKSTER_CREDENTIAL_BROKER_ENABLED=false`
- `PANKSTER_NAMED_PROFILE_RUNTIME_ENABLED=false`
- `PANKSTER_SYNTHETIC_RUNNER_ENABLED=false`

## Initial module boundaries

| Module | Allowed | Forbidden |
|---|---|---|
| policy schema validator | pure validation of JSON-like policy objects | credential reads, filesystem credential paths, network calls |
| environment sanitizer | derive sanitized key-value dictionaries from explicit inputs | reading process env wholesale in tests without sanitization |
| fake grant registry | opaque fake grants bound to profile, task, attempt, policy, and runtime identity | real secrets or bearer-token semantics |
| fake model broker | deterministic fake responses and denials | provider SDKs or network clients |
| runtime adapter stubs | fail-closed interfaces and typed contracts | sandbox launch or gateway integration |

## Required pre-implementation checks

- working tree clean before each gate;
- exact files listed before a code gate;
- no dependency or lockfile changes without a separate gate;
- no env or secret files touched;
- validators added for each gate;
- full tools tests pass;
- secret scan for new files passes.

## Fail-closed cases

- A14 dependency missing or hash-mismatched;
- code requested before scope gate;
- feature flag default true;
- module requires real credentials;
- module requires provider network;
- module reads `auth.json` or Keychain;
- named profile enablement requested;
- gateway change requested;
- dependency change requested without gate;
- secret scan failed.

## Required tests

Validator tests:

- A0 requires A14 dependency hash;
- A0 forbids runtime, deployment, provider, gateway, and profile scope;
- A0 declares gate sequence with code permissions;
- A0 feature flags default disabled;
- A0 module boundaries forbid credentials, network, and sandbox launch.

Future gate tests:

- A1 exact file scope required;
- A2 flags default disabled;
- A3 policy schema pure unit tests;
- A4 environment sanitizer denylist precedence;
- A5 fake broker secret-free;
- A6 runtime adapter stubs fail closed.

Security tests:

- no `auth.json` or Keychain access;
- no provider secret in new files;
- no gateway or profile start commands;
- no provider network clients in planning artifacts.

## Readiness finding

Phase 1C is complete. Phase 1D planning is ready.

Implementation code is not ready to start from A0 alone. Runtime execution is not ready. Production is not ready.

## Rollback

Remain on Phase 1C closeout and do not start Phase 1D code gates.

## Next gate

Next gate: `1D-A1_IMPLEMENTATION_SCOPE_AND_BRANCH_CONTRACT`.
