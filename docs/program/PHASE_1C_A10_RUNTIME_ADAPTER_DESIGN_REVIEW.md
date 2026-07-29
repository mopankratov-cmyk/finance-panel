# PANKSTER Agent Platform — Phase 1C-A10

## Runtime adapter design review

Status: `DESIGN_REVIEW_COMPLETE_NO_IMPLEMENTATION_APPROVED`

Decision: `RUNTIME_ADAPTER_DESIGN_ACCEPTED_FOR_IMPLEMENTATION_PLANNING_NOT_PRODUCTION`

This is a design review only. It does not approve implementation, production profile execution, sandbox execution, provider API calls, gateway changes, Hermes core changes, OAuth refresh, credential migration, or canary.

## Source dependency

A10 depends on the A9 host-side model and credential broker specification:

- Evidence: `security/evidence/phase-1c-a9/host-side-model-and-credential-broker-spec.json`
- A9 evidence file SHA-256: `769d17a69d3c9dc9a8fa9969415a983fffc4d6d8a1b202c9b29f6ac3b62ea351`
- A9 content SHA-256: `c24d2b25bde9ec7c84126cbb37e88a2cfbffc0dceca2a534d83230d2dd42a469`
- A9 status: `SPEC_COMPLETE_NO_IMPLEMENTATION_APPROVED`

## Design position

The runtime adapter is the host-side control plane boundary between Hermes workflow orchestration and a future isolated sandbox runtime. It must be boring, narrow, policy-bound, and fail-closed.

The adapter must not become a credential transport layer. It may pass non-secret grant references, policy identifiers, runtime metadata, idempotency keys, sanitized artifact references, and sanitized outputs. It must not pass provider secret values, root auth paths, credential pools, authorization headers, refresh tokens, raw environments, or credential-bearing host paths.

## Required adapter components

### Runtime security context loader

Loads profile, workflow, task, attempt, policy version, grant IDs, runtime identity hash, and network policy before launch. Launch is denied when the runtime security context is missing or invalid.

### Environment sanitizer

Constructs sandbox and child-process environments from an allowlist plus mandatory denylist.

Preserved system keys:

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

Allowed `PANKSTER_*` runtime metadata:

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

The sanitizer applies to sandbox launch, terminal, code execution, delegation, MCP, background processes, retry, reclaim, and restart paths.

### Sandbox launcher

Launches a future E2B sandbox only after `RuntimeSecurityContext`, network policy, grant binding, sanitized environment, sanitized artifact boundary, and destroy guard are ready. A10 does not approve executing this launcher.

Default network policy is `deny_all`.

### Broker channel adapter

Forwards worker model/tool requests to host-side brokers using grant IDs and idempotency keys. It must not expose credentials. Every request must be policy-checked and audited by the host-side broker layer.

A10 does not approve implementing the broker channel.

### Artifact boundary

Exchanges inputs and outputs through sanitized artifact references or payload hashes. Root auth paths and provider secret files are forbidden. Shared credential-bearing host paths are forbidden by default.

### Lifecycle manager

Coordinates launch, heartbeat, timeout, retry, reclaim, restart, destroy, and cleanup with attempt binding.

Required lifecycle semantics:

- destroy is idempotent and audited;
- retry creates a new attempt and new grants;
- reclaim revalidates runtime identity before reuse;
- restart requires a new runtime identity and policy revalidation;
- timeout and destroy failure are fail-closed events.

### Evidence recorder

Records sanitized lifecycle, policy, broker, denial, retry, reclaim, and destroy evidence. Raw env, argv secret values, provider headers, root auth paths, and credential material are forbidden.

If evidence recording is unavailable, the adapter fails closed.

## Launch sequence

1. Load runtime security context.
2. Validate profile policy is present and enabled.
3. Validate network policy is present.
4. Request or load attempt-bound grants.
5. Build sanitized environment.
6. Verify no denylisted environment keys are present.
7. Prepare sanitized artifact boundary.
8. Prepare broker channel metadata without credentials.
9. Launch future sandbox only after separate implementation approval.
10. Record sanitized launch evidence.
11. Destroy sandbox idempotently on completion or failure.

## Child environment contract

- terminal: sanitized environment only;
- code execution: sanitized environment only;
- delegation: sanitized environment or unavailable fail-closed;
- MCP: sanitized environment or unavailable fail-closed;
- background process: sanitized environment only;
- retry: new attempt, new grants, sanitized environment;
- reclaim: revalidate runtime identity before reuse;
- restart: new runtime identity and policy revalidation required.

## Credential and file access contract

- Root `auth.json` read is forbidden.
- Root `auth.json` fallback is forbidden.
- Root credential pool materialization is forbidden.
- Profile auth store writes are forbidden in the adapter.
- OAuth refresh is forbidden in the adapter.
- Provider secrets are forbidden in env, argv, artifacts, and evidence.
- Host filesystem mounts default to none except explicit sanitized artifacts.

## Fail-closed cases

The runtime adapter must deny by default when:

- A9 spec is missing or hash-mismatched;
- runtime security context is missing;
- profile policy is missing or disabled;
- network policy is missing;
- grant is missing or expired;
- grant attempt mismatches;
- env denylist violation is detected;
- unexpected secret-shaped environment value is detected;
- broker channel is unavailable;
- artifact boundary is invalid;
- runtime identity mismatches during reclaim;
- destroy fails;
- evidence recorder is unavailable.

## Required tests before implementation approval

Unit tests:

- runtime security context required before launch;
- environment sanitizer preserves `NO_PROXY` and `no_proxy` and blocks denylist;
- sandbox launcher denies missing network policy;
- broker channel metadata contains no credentials;
- artifact boundary rejects root auth paths;
- lifecycle manager retry uses new attempt and grants;
- reclaim revalidates runtime identity;
- evidence recorder rejects raw env and secret values.

Synthetic integration tests:

- synthetic adapter launch receives only allowlisted env;
- synthetic child terminal env is sanitized;
- synthetic code execution env is sanitized;
- synthetic delegation and MCP are unavailable fail-closed or sanitized;
- synthetic retry, reclaim, and restart preserve security contract;
- synthetic destroy is idempotent and audited.

Security tests:

- adapter never reads root `auth.json`;
- adapter never materializes root credential pool;
- adapter never passes provider secrets to env, argv, artifacts, or evidence;
- adapter fails closed when broker or audit is unavailable;
- adapter logs, journal, argv, and evidence pass secret scanning.

## Design review result

A10 accepts the runtime adapter design for implementation planning only.

Production runtime remains not approved. Implementation remains not approved until A11, A12, A13, and A14 are complete.

## Rollback

Rollback for a future implementation is to disable the runtime adapter feature flag, reject named-profile launches, and keep the gateway unchanged.

## Next gate

Next gate: `A11_PRODUCTION_PROFILE_POLICY_CONTRACT`.
