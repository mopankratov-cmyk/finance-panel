# PANKSTER Agent Platform — Phase 1D-A2

## Feature flag and config scaffold spec

Status: `FEATURE_FLAG_AND_CONFIG_SCAFFOLD_SPEC_COMPLETE_NO_CODE_APPROVAL`

Decision: `FEATURE_FLAGS_AND_CONFIG_RULES_READY_FOR_PURE_UNIT_IMPLEMENTATION_NOT_RUNTIME`

A2 specifies disabled-by-default flags and pure config parsing rules. It does not approve implementation code by itself, deployment, production profile execution, sandbox execution, provider API calls, gateway changes, dependency changes, Hermes core runtime changes, OAuth refresh, credential migration, or canary.

## Source dependency

A2 depends on Phase 1D-A1:

- Evidence: `security/evidence/phase-1d-a1/implementation-scope-and-branch-contract.json`
- A1 evidence file SHA-256: `a18a115f6fb8ea133f11c8636b8d910a902f5317bb33da23e3338cb29147e27d`
- A1 content SHA-256: `80c77343c615d5e3a4cb7dc48569e8aa40a24254e4689032d72471f3c82e1035`
- A1 status: `IMPLEMENTATION_SCOPE_AND_BRANCH_CONTRACT_COMPLETE_NO_CODE_APPROVAL`

## Flag definitions

All Phase 1D runtime-isolation flags default to false:

- `PANKSTER_RUNTIME_ADAPTER_ENABLED`
- `PANKSTER_HOST_MODEL_BROKER_ENABLED`
- `PANKSTER_CREDENTIAL_BROKER_ENABLED`
- `PANKSTER_NAMED_PROFILE_RUNTIME_ENABLED`
- `PANKSTER_SYNTHETIC_RUNNER_ENABLED`

Accepted true values are `1`, `true`, `yes`, and `on`.

Accepted false values are `0`, `false`, `no`, `off`, and empty string.

Parsing is case-insensitive and trims surrounding whitespace.

Invalid values deny. They must not silently become true.

## Config source contract

Future pure units accept explicit mappings only. They must not read process environment directly in unit tests, `.env` files, root `auth.json`, Keychain, network, or mutable filesystem state.

Unknown flags may be ignored with a warning. Missing flags use the default false value. Invalid flags deny.

## Gate dependency rules

- Runtime adapter requires runtime adapter, host model broker, and credential broker flags.
- Named-profile runtime requires named-profile runtime and runtime adapter flags.
- Synthetic runner requires synthetic runner flag.
- Production-profile enablement is not defined in A2 and remains forbidden.

## Next allowed implementation files

A3 may implement only the pure policy schema validator files. The feature flag rules in A2 remain a contract for later gates and must not be implemented as runtime behavior by A2.

- `tools/pankster_runtime_security/__init__.py`
- `tools/pankster_runtime_security/policy_schema.py`
- `tools/tests/test_pankster_runtime_security_policy_schema.py`

Phase validators may continue under:

- `tools/phase_1d_*`
- `tools/tests/test_phase_1d_*`

## Forbidden files

A2 and the next scaffold must not modify:

- `app/`
- `components/`
- `lib/`
- package files or lockfiles;
- `.env*`
- `.gitea/`
- `.github/`
- `gateway.py`
- `web_server.py`
- `agent/conversation_loop.py`

## Required future behavior

- all flags default false;
- parser is case-insensitive;
- parser trims surrounding whitespace;
- invalid values return denied state, not true;
- unknown flags do not enable any capability;
- enabled named-profile runtime requires runtime adapter enabled;
- runtime adapter requires host and credential broker flags;
- no process env read in unit tests;
- no secret values logged.

## Fail-closed cases

- A1 dependency missing or hash-mismatched;
- flag default true;
- invalid flag value;
- named-profile runtime enabled without runtime adapter;
- runtime adapter enabled without brokers;
- synthetic runner enabled without explicit future execution approval;
- process environment read detected;
- env file read detected;
- `auth.json` or Keychain read detected;
- network call detected;
- forbidden file changed;
- secret scan failed.

## Required tests

Validator tests:

- A2 requires A1 dependency hash;
- all flags default false;
- config source is explicit mapping only;
- invalid values fail closed;
- A2 forbids runtime, deployment, provider, gateway, and profile scope.

Future feature flag unit tests:

- parse true and false values case-insensitively;
- missing flags default false;
- invalid values return denied;
- unknown flags do not enable capabilities;
- named-profile runtime requires runtime adapter;
- runtime adapter requires host and credential brokers.

Security tests:

- no process env read in pure unit tests;
- no `auth.json` or Keychain access;
- no provider network clients;
- no secret values in feature flag outputs.

## Readiness finding

A2 completes feature flag and config scaffold planning. After A2, A3 may implement the pure policy schema validator gate under the A1 scope.

Runtime execution is not ready. Production is not ready.

## Rollback

Revert A2 spec and keep all Phase 1D feature flags undefined or false.

## Next gate

Next gate: `1D-A3_POLICY_SCHEMA_VALIDATOR_IMPLEMENTATION`.
