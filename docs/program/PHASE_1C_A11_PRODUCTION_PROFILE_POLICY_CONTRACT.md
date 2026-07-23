# PANKSTER Agent Platform — Phase 1C-A11

## Production profile policy contract

Status: `PROFILE_POLICY_CONTRACT_COMPLETE_NO_PRODUCTION_APPROVAL`

Decision: `PRODUCTION_PROFILE_POLICY_CONTRACT_READY_FOR_SYNTHETIC_TEST_PLANNING_NOT_RUNTIME`

This is a policy contract only. It does not approve implementation, production profile execution, sandbox execution, provider API calls, gateway changes, Hermes core changes, OAuth refresh, credential migration, or canary.

## Source dependency

A11 depends on the A10 runtime adapter design review:

- Evidence: `security/evidence/phase-1c-a10/runtime-adapter-design-review.json`
- A10 evidence file SHA-256: `fd3aea723a55e95ca7abb5e4ca8f4d29a7d6f7983573613bc0663464f04ca9be`
- A10 content SHA-256: `9a69b9d6c9d9cdc8b7a9100b06fd1546038396b353181073e2abfe101a1bf7b2`
- A10 status: `DESIGN_REVIEW_COMPLETE_NO_IMPLEMENTATION_APPROVED`

## Policy position

Named production profiles must be explicitly declared, disabled by default, and unable to inherit root/default credentials. The default profile remains a compatibility path, not a credential source for named profiles.

No named profile may launch without a profile policy. Missing, disabled, ambiguous, stale, or malformed policy denies launch before any grant, sandbox, model call, terminal child, MCP child, delegation child, retry, reclaim, or restart path can run.

## Required profile policy schema

Each named profile policy requires:

- `profile_id`
- `enabled`
- `owner_principal_id`
- `policy_version`
- `runtime_backend`
- `network_policy_id`
- `model_provider_allowlist`
- `model_allowlist`
- `operation_allowlist`
- `grant_ttl_seconds_max`
- `budget`
- `rate_limits`
- `credential_reference_allowlist`
- `environment_policy_id`
- `artifact_policy_id`
- `audit_policy_id`
- `rollback_policy_id`

The policy schema must reject:

- `api_key`
- `access_token`
- `refresh_token`
- `authorization_header`
- `provider_secret_value`
- `root_auth_json_path`
- `root_credential_pool`
- `plaintext_credential`
- `environment_secret_value`

Default behavior:

- `enabled` defaults to false;
- missing policy denies;
- ambiguous policy denies;
- grant TTL upper bound is 900 seconds;
- grant policy versioning is monotonic and required.

## Profile states

### `default`

The default profile remains compatibility-only.

- Runtime isolation is not enabled by A11.
- Existing default gateway behavior is not changed by A11.
- It does not inherit named-profile credentials.
- It does not enable named production profile runtime.

### `dev-director`

`dev-director` remains `CREATED_BUT_DISABLED`.

- Runtime isolation is required before enablement.
- Root auth fallback is forbidden.
- Root credential pool materialization is forbidden.
- Separate profile auth store is required.
- Minimal model auth is required via broker grants only.
- Provider families, models, and operations are empty until a later approval.

### `content-director`

`content-director` remains `CREATED_BUT_DISABLED`.

- Runtime isolation is required before enablement.
- Root auth fallback is forbidden.
- Root credential pool materialization is forbidden.
- Separate profile auth store is required.
- Minimal model auth is required via broker grants only.
- Provider families, models, and operations are empty until a later approval.

## Minimal model-auth contract

Profiles receive only host-side broker grant references. A grant reference is not a bearer secret and is valid only with profile, workflow, task, attempt, purpose, provider family, model, operation, TTL, budget, policy version, runtime identity hash, and network policy binding.

Forbidden material:

- provider API key;
- provider access token;
- provider refresh token;
- authorization header;
- root `auth.json`;
- root credential pool;
- owner keychain reference;
- credential store path.

Replay, expiry, and owner mismatch deny.

## Credential policy

- Root `auth.json` fallback is forbidden for named profiles.
- Root credential pool materialization is forbidden.
- Named profiles require separate profile auth stores.
- Profile auth stores may not contain provider secret values in this contract.
- OAuth refresh by profile workers is forbidden.
- OAuth refresh by runtime adapter is forbidden.
- OAuth refresh requires future owner-only compare-and-swap.
- Credential reference allowlist is required.
- Credential value logging is forbidden.

## Environment policy

Preserve:

- `PATH`
- `HOME`
- `TMPDIR`
- `TMP`
- `TEMP`
- `LANG`
- `LC_ALL`
- `LC_CTYPE`
- `SHELL`
- `NO_PROXY`
- `no_proxy`

Allow explicit runtime metadata:

- `PANKSTER_PROFILE_ID`
- `PANKSTER_WORKFLOW_ID`
- `PANKSTER_TASK_ID`
- `PANKSTER_ATTEMPT_ID`
- `PANKSTER_POLICY_VERSION`
- `PANKSTER_GRANT_IDS`
- `PANKSTER_BROKER_MODE`
- `PANKSTER_NETWORK_POLICY`

Mandatory denylist:

- `*_KEY`
- `*_TOKEN`
- `*_SECRET`
- `*_PASSWORD`
- `AUTHORIZATION`
- `ANTHROPIC_*`
- `OPENAI_*`
- `GLM_*`
- `GITEA_*`
- `SUPABASE_*`
- `TELEGRAM_*`
- `E2B_API_KEY`

The denylist has precedence over allowlist and applies to sandbox launch, terminal, code execution, delegation, MCP, background processes, retry, reclaim, and restart.

## Network, budget, and audit policy

Network policy defaults to `deny_all`. Direct provider egress from sandbox is forbidden. Missing profile-specific network policy denies.

Budget policy is required before provider calls and includes maximum cost, token count, request count, wall-clock seconds, and retry count.

Audit policy is required. Audit events must be secret-free. If audit is unavailable, policy denies.

## Fail-closed cases

The policy layer must deny by default for:

- missing profile policy;
- disabled profile;
- unknown profile;
- ambiguous default profile inheritance;
- missing model allowlist;
- model not allowlisted;
- missing provider family allowlist;
- provider family not allowlisted;
- operation not allowlisted;
- missing budget;
- budget exceeded;
- missing network policy;
- credential reference not allowlisted;
- root auth fallback requested;
- root pool materialization requested;
- OAuth refresh requested by worker or adapter;
- environment denylist violation;
- audit unavailable.

## Required tests before implementation approval

Unit tests:

- profile policy schema rejects secret fields;
- missing profile policy denies launch;
- disabled profile denies launch;
- default profile does not inherit named policy;
- model allowlist is required and enforced;
- provider family allowlist is required and enforced;
- operation allowlist is required and enforced;
- budget is required and enforced before provider call;
- credential reference allowlist is required;
- environment denylist takes precedence over allowlist.

Synthetic integration tests:

- `dev-director` in `CREATED_BUT_DISABLED` denies runtime launch;
- `content-director` in `CREATED_BUT_DISABLED` denies runtime launch;
- synthetic profile receives grant reference without provider secret;
- synthetic default compatibility does not enable named profiles;
- synthetic budget denial records secret-free audit;
- synthetic OAuth refresh attempt by worker fails closed.

Security tests:

- named profiles cannot read root `auth.json`;
- named profiles cannot materialize root credential pool;
- provider secret never appears in env, argv, artifacts, or evidence;
- Telegram, Gitea, Supabase, Anthropic, and GLM env keys are denied;
- terminal, code execution, delegation, MCP, and background children are sanitized;
- retry, reclaim, and restart preserve policy and attempt binding.

## Design review result

A11 completes the profile policy contract for synthetic test planning only.

`dev-director` and `content-director` remain `CREATED_BUT_DISABLED`.

Production runtime remains not approved. Implementation remains not approved until A12, A13, and A14 are complete.

## Rollback

Rollback for a future implementation is to keep named profiles disabled, remove policy enablement flags, and preserve default gateway behavior.

## Next gate

Next gate: `A12_INTEGRATION_TEST_PLAN_WITH_SYNTHETIC_ONLY_FIXTURES`.
