# PANKSTER Agent Platform — Phase 1C-A9

## Host-side model and credential broker specification

Status: `SPEC_COMPLETE_NO_IMPLEMENTATION_APPROVED`

Decision: `HOST_SIDE_MODEL_AND_CREDENTIAL_BROKER_REQUIRED_BEFORE_PRODUCTION_RUNTIME`

This document is an architecture contract only. It does not approve implementation, production profile execution, provider API calls, sandbox execution, gateway changes, Hermes core changes, or credential migration.

## Scope

Phase 1C-A8 proved that the selected E2B synthetic runtime can run an isolated synthetic proof with provider credentials kept out of the sandbox. A9 defines the host-side broker architecture required before production runtime can be considered.

The required architecture is:

1. the host retains all real model and service credentials;
2. the sandbox receives no provider secret values;
3. grants are non-secret opaque references bound to profile, attempt, policy, runtime identity, purpose, TTL, and budget;
4. model calls are performed by a host-side model broker after policy approval;
5. missing or invalid policy fails closed;
6. audit events are secret-free and sufficient for replay-resistant evidence.

## Non-approval statement

A9 explicitly does not approve:

- implementation in Hermes core;
- production profile execution;
- real provider API calls;
- sandbox start;
- gateway restart;
- OAuth refresh in a real credential store;
- root `auth.json` fallback;
- root credential pool materialization.

## Required components

### Policy Engine

The Policy Engine validates profile, workflow, task, attempt, provider family, model, operation, budget, TTL, runtime state, runtime identity, network policy, and policy version before any grant is issued or any model broker call is made.

If policy is missing, stale, malformed, disabled, or ambiguous, the result is denial. The denial is audited without secret values.

### Credential Broker

The Credential Broker holds owner-scoped credential references on the host and issues attempt-scoped non-secret grant references. It must never write, copy, or expose provider secret values into sandbox environment variables, argv, logs, Evidence Packs, mounted files, MCP subprocesses, terminal subprocesses, delegation children, or profile-local storage.

OAuth refresh is permitted only as a future host-side owner operation with compare-and-swap semantics. A profile worker must not perform refresh and must not receive refreshed credential material.

### Grant Registry

The Grant Registry tracks grant lifecycle, expiry, revocation, replay detection, usage counters, budget, and attempt binding. Grant references use the shape `grant_opaque_<uuid4_hex>`.

Grant references are not bearer secrets. A grant is valid only when it is matched with runtime identity, profile, attempt, policy version, purpose, provider family, model allowlist, operation allowlist, TTL, and budget.

### Host-side Model Broker

The Model Broker runs on the host side, never inside the sandbox. It receives model requests containing only grant references, attempt identifiers, model/provider choices, operation names, idempotency keys, and input artifact references or payload hashes.

Before any provider call, it must enforce policy, grant validity, model allowlist, operation allowlist, budget, idempotency, replay protection, and audit availability. It returns sanitized result payloads or artifact references, usage, finish reason, audit event ID, and grant usage hash.

The Model Broker response must never include provider secret values, authorization headers, raw request headers, or raw response headers.

### Runtime Adapter Interface

The Runtime Adapter Interface starts future sandboxes with an allowlisted environment and forwards model/tool requests to the host broker channel. A9 does not approve the broker channel implementation.

The sandbox runtime contract preserves required system variables such as `PATH`, `HOME`, `TMPDIR`, `TMP`, `TEMP`, `LANG`, `LC_ALL`, `LC_CTYPE`, `SHELL`, `NO_PROXY`, and `no_proxy`, plus explicit `PANKSTER_*` runtime metadata. It denies sensitive environment patterns such as `*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `AUTHORIZATION`, `ANTHROPIC_*`, `OPENAI_*`, `GLM_*`, `GITEA_*`, `SUPABASE_*`, `TELEGRAM_*`, and `E2B_API_KEY`.

### Audit Sink

The Audit Sink records broker decisions and lifecycle events without secret values. If the audit sink is unavailable, the broker must fail closed before issuing grants or making provider calls.

Required audit events include:

- `grant.requested`
- `grant.issued`
- `grant.denied`
- `grant.used`
- `grant.revoked`
- `grant.expired`
- `model.requested`
- `model.denied`
- `model.completed`
- `model.failed`
- `credential.refresh.requested`
- `credential.refresh.completed`
- `credential.refresh.denied`
- `sandbox.destroyed`

## Required model-call flow

1. Workflow orchestration creates or loads `RuntimeSecurityContext`.
2. Runtime requests a grant for a specific profile, workflow, task, attempt, provider family, model allowlist, operation allowlist, TTL, budget, purpose, policy version, runtime identity, and network policy.
3. Policy Engine validates the request before grant creation.
4. Credential Broker issues a non-secret `grant_opaque_<uuid4_hex>` reference bound to that context.
5. Sandbox receives only allowlisted environment variables, grant IDs, policy IDs, and task metadata.
6. Worker asks the host-side Model Broker to perform an approved operation. A9 does not approve the transport mechanism.
7. Model Broker validates the grant and policy again before any provider call.
8. Model Broker performs the provider call on the host using eligible owner-scoped credentials.
9. Broker records secret-free audit evidence and returns sanitized response or artifact reference.
10. Grant usage counters and budgets are updated; expired or replayed grants are denied.

## Credential invariants

- Root `auth.json` fallback is disabled for named production profiles.
- Root credential pool materialization is forbidden.
- Provider keys, tokens, refresh tokens, authorization headers, and root credential pools are forbidden in sandbox env, argv, logs, Evidence Packs, terminal subprocesses, code execution subprocesses, MCP subprocesses, background subprocesses, delegation children, retry, reclaim, and restart paths.
- Profile workers receive only minimal model authorization via non-secret grants and policy-bound broker access.
- OAuth refresh remains owner-only, host-side, compare-and-swap, and cannot write refreshed credentials into profile auth stores.
- `NO_PROXY` and `no_proxy` are preserved when sanitizing runtime environments.

## Fail-closed cases

The broker system must deny by default for:

- missing profile policy;
- invalid policy version;
- disabled runtime;
- missing grant;
- expired grant;
- grant attempt mismatch;
- grant profile mismatch;
- grant replay detection;
- model not allowlisted;
- operation not allowlisted;
- budget exceeded;
- broker unavailable;
- OAuth refresh conflict;
- credential owner mismatch;
- sandbox destroy failure;
- audit sink unavailable.

## Required tests before implementation approval

Unit tests:

- grant schema rejects secret fields;
- grant reference is not usable without runtime identity binding;
- missing policy fails closed;
- model allowlist is enforced before provider call;
- budget is enforced before provider call;
- OAuth refresh is owner-only compare-and-swap;
- audit event contains no secret values;
- sandbox environment allowlist and denylist are enforced.

Synthetic integration tests:

- sandbox receives only grant references and policy IDs;
- fake model broker returns response without provider key;
- sandbox cannot call provider directly with deny-all network policy;
- retry and reclaim preserve grant attempt binding;
- expired grant blocks replay.

Security tests:

- argv, logs, and Evidence Packs pass secret scanning;
- root auth fallback is disabled for named profiles;
- root credential pool materialization is forbidden;
- MCP, terminal, code execution, and delegation children do not receive provider credentials.

## Rollback

Rollback for an attempted future implementation is to disable the broker feature flag and reject named-profile runtime grants. Rollback must not require gateway changes.

## Next gate

Next gate: `A10_RUNTIME_ADAPTER_DESIGN_REVIEW`.
