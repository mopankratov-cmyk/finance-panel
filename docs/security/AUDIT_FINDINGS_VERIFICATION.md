# Hermes v0.18.2 Audit Findings Verification

Status: `awaiting_review`. Installed source: `<HERMES_SOURCE>`, commit `97c67d585e3048c8b9a918d5382005566080903a`, package version 0.18.2.

No finding was validated by reading secret values or executing an exploit. “Can” means the installed structure permits the path when stated preconditions hold.

## Required preliminary findings

### AUD-01 — Profile home is a namespace, not a security boundary

- Status: `CONFIRMED`.
- verification_mode: `runtime_observation`.
- runtime_status: `VERIFIED`.
- Actual path: profile selection changes `HERMES_HOME`, config, persona, memory and session paths, but host subprocesses normally retain real user `HOME` and all observed processes run under the same UID.
- Evidence: `hermes_cli/profiles.py:39-53`; `hermes_constants.py:770-832`; sanitized process evidence `E-RUNTIME-01`; no container executable detected, `E-ISO-01`.
- Preconditions: named profile executes a tool or code path with host filesystem access.
- Affected: profile worker, terminal, execute_code, MCP, delegated child tools.
- Future control: per-profile UID/container/ACL, isolated HOME, mount/network policy.
- Phase 0 action: none.

### AUD-02 — Profile worker may inherit gateway environment

- Status: `CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `UNVERIFIED`.
- Actual path: gateway-embedded Kanban dispatcher calls `_default_spawn`; it initializes `env = dict(os.environ)`, overwrites profile/Kanban variables, removes only `HERMES_TUI`, then passes `env` to `Popen`.
- Evidence: `hermes_cli/kanban_db.py:8169-8355`, especially `8195-8284`, `8334-8342`.
- Preconditions: credential is present in gateway process environment and not overwritten before worker startup.
- Affected: all Kanban worker profiles, including `content-director` and `dev-director` if spawned.
- Future control: empty-base profile allowlist plus mandatory denylist in unified spawn factory.
- Phase 0 action: none.

### AUD-03 — Root credential fallback is possible

- Status: `CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `UNVERIFIED`.
- Actual path: in profile mode `_global_auth_file_path()` resolves root `auth.json`; provider reads and credential-pool reads fall back per provider when profile entries are absent.
- Evidence: `hermes_cli/auth.py:916-980`, `1205-1278`, `1403-1447`.
- Preconditions: named-profile `HERMES_HOME`; root store contains a provider absent from profile store.
- Affected: model provider/auth and credential pools.
- Future control: named-profile `root_fallback=off` default and brokered grants; explicit legacy policy only for default profile.
- Phase 0 action: none.

### AUD-04 — Same-UID worker can potentially read root auth/.env

- Status: `CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `UNVERIFIED`.
- Actual path: file tool blocks root/profile credential files, but source explicitly states terminal can bypass. Named profiles enable the `hermes-cli` composite, which includes terminal/process. Host subprocess HOME is the real user home.
- Evidence: `agent/file_safety.py:191-296`; `tools/file_tools.py:1198-1207`; `toolsets.py:29-81`; `hermes_constants.py:770-832`; `E-RUNTIME-01`.
- Preconditions: worker has terminal or equivalent local code execution and same-user filesystem permissions.
- Affected: root auth, `.env`, user CLI stores, project-local secrets.
- Future control: OS isolation and denied mounts; do not claim file-tool denylist as boundary.
- Phase 0 action: none; no bypass command executed.

### AUD-05 — OAuth refresh may write outside the profile-owned store

- Status: `CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `UNVERIFIED`.
- Actual path: provider state tracks its source path; rotated grants can be written back to the source. Credential pools deliberately write through refreshed Nous/OpenAI Codex/xAI state to root when the grant originated from root fallback.
- Evidence: `hermes_cli/auth.py:1205-1314`; `agent/credential_pool.py:527-579`, `966-1079`.
- Preconditions: named profile uses an OAuth grant resolved from root fallback and refresh occurs.
- Affected: root provider state and every profile sharing that grant.
- Future control: credential ownership records, owner-only refresh worker, versioned compare-and-swap, no root fallback for named profiles.
- Phase 0 action: none; refresh was not triggered.

### AUD-06 — Terminal, code, MCP and delegation use different env-policy paths

- Status: `CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `NOT_APPLICABLE`.
- Actual path: terminal uses provider blocklist plus passthrough; execute_code uses safe prefixes and secret substrings; MCP uses a small baseline plus explicit configured env; delegation is in-process and relies on ContextVars/child tool paths; Kanban uses full env copy.
- Evidence: `tools/environments/local.py:199-615`, `1110-1177`; `tools/code_execution_tool.py:135-264`, `1320-1407`; `tools/mcp_tool.py:351-446`, `2212-2277`; `tools/delegate_tool.py:1971-2013`, `2602-2635`; `hermes_cli/kanban_db.py:8195-8342`.
- Preconditions: respective tool/path is enabled.
- Affected: all child execution surfaces.
- Future control: one RuntimeSecurityContext and spawn factory, with path-specific capability adapters after the common policy.
- Phase 0 action: none.

### AUD-07 — Batch delegate_task may lose profile ContextVar

- Status: `PARTIALLY_CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `UNVERIFIED`.
- Actual path: background delegation outer executor now wraps the target with `propagate_context_to_thread`, so the broad earlier claim is not fully current. However `_run_single_child` submits `child.run_conversation` to another executor without the wrapper, and batch fan-out submits `_run_single_child` directly without it. A new executor thread begins with an empty ContextVar context.
- Evidence: positive helper semantics `tools/thread_context.py:1-120`; outer fix `tools/async_delegation.py:438-562`, `645-749`; missing wrappers `tools/delegate_tool.py:1971-2013`, `2602-2635`.
- Preconditions: profile scope is ContextVar-only; child tool resolves profile/environment state after the unwrapped hop.
- Affected: single, batch, background and nested child execution depending on the subsequent tool path.
- Future control: wrap every executor submit or use a context-aware executor enforced by RuntimeSecurityContext tests.
- Phase 0 action: none.

### AUD-08 — Disabled profile lacks mandatory runtime gate before spawn

- Status: `CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `UNVERIFIED`.
- Actual path: `profile.yaml` reads/writes only description metadata; `profiles_to_serve` scans valid directories; Kanban dispatch checks `profile_exists` but no enabled flag before normal or review spawn.
- Evidence: `hermes_cli/profiles.py:815-870`, `949-987`; `hermes_cli/kanban_db.py:7439-7904`.
- Preconditions: named profile directory exists and is assigned a dispatchable task, or multiplexing is enabled.
- Affected: `content-director`, `dev-director`, any future named profile.
- Future control: authoritative Agent Registry and fail-closed check immediately before spawn/reconnect/retry/reclaim.
- Phase 0 action: none; profiles were not started and remain `CREATED_BUT_DISABLED` by operational convention.

## Additional verified findings

### AUD-09 — Root credential pool can be materialized into active profile state

- Status: `PARTIALLY_CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `UNVERIFIED`.
- Actual path: `load_pool()` reads the per-provider merged fallback, seeds/normalizes/prunes/prioritizes, and on any `changed` condition calls `write_credential_pool()` for the active auth store. A guard limits only one auth-normalization condition, not all changes.
- Evidence: `agent/credential_pool.py:2538-2600`; `hermes_cli/auth.py:1403-1498`.
- Preconditions: fallback entries plus a change-producing seed/normalization/prune path.
- Affected: profile auth-store contents and credential provenance.
- Future control: reference-only borrowed rows and owner store IDs; never serialize borrowed secret payload into another store.
- Phase 0 action: none; `load_pool()` was not invoked by this audit.

### AUD-10 — Gateway-only Telegram token can reach a Kanban profile worker

- Status: `PARTIALLY_CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `UNVERIFIED`.
- Actual path: full gateway env copy reaches worker. Terminal sanitizer later has an unconditional bot-token denylist, but worker Python and any earlier/alternate child code possess the inherited process env. Background/terminal children then apply their own policy.
- Evidence: `hermes_cli/kanban_db.py:8195-8342`; terminal Tier-1 denylist `tools/environments/local.py:504-536`.
- Preconditions: `TELEGRAM_BOT_TOKEN` is present in gateway env; presence intentionally not inspected.
- Affected: named Kanban worker process.
- Future control: remove at dispatcher boundary, not only terminal-child boundary.
- Phase 0 action: none.

### AUD-11 — content-director can structurally reach Gitea/Supabase/model credentials

- Status: `PARTIALLY_CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `UNVERIFIED`.
- Actual path: root config structurally names Gitea and Supabase MCP servers; named profile config does not. A Kanban worker inherits gateway env, root auth fallback supplies model auth, and same-UID terminal can reach user/root stores. MCP itself loads the active profile config, so those root MCP definitions are not automatically present after correct profile `HERMES_HOME` selection.
- Evidence: safe structural config in `EVIDENCE_INDEX.md`; `hermes_cli/kanban_db.py:8195-8342`; `hermes_cli/auth.py:916-980`; `agent/file_safety.py:214-227`.
- Preconditions: corresponding credentials exist and profile has an enabled execution path; values/presence not inspected.
- Affected: `content-director` if spawned.
- Future control: isolated profile runtime, brokered grants, profile-local MCP policy, no root fallback.
- Phase 0 action: none.

### AUD-12 — execute_code and MCP omit NO_PROXY/no_proxy

- Status: `CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `UNVERIFIED`.
- Actual path: both hard allowlists preserve common system variables but contain neither spelling. Kanban/terminal full-copy policies may preserve them, yielding inconsistent behavior.
- Evidence: `tools/code_execution_tool.py:135-169`; `tools/mcp_tool.py:351-386`; targeted `rg -n 'NO_PROXY|no_proxy'` returned no matches in those files.
- Preconditions: local endpoints depend on bypassing a configured proxy.
- Affected: execute_code and stdio MCP child connectivity.
- Future control: exact non-secret baseline includes both spellings.
- Phase 0 action: none.

### AUD-13 — MCP explicit environment bypasses baseline allowlist

- Status: `CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `UNVERIFIED`.
- Actual path: `_build_safe_env` copies only safe process variables, then applies `env.update(user_env)`. Placeholders resolve through active profile secret scope, so configured secret injection is intentional but lacks a final mandatory denylist.
- Evidence: `tools/mcp_tool.py:426-446`, `3933-4017`.
- Preconditions: MCP config contains an explicit env entry or interpolated secret.
- Affected: stdio MCP subprocess and its descendants.
- Future control: per-server credential grants and final denylist/capability validation after interpolation.
- Phase 0 action: none.

### AUD-14 — No unified spawn factory

- Status: `CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `NOT_APPLICABLE`.
- Actual path: Kanban, terminal, process registry, execute_code, MCP, dashboard/service actions, and ACP transports construct their own subprocess policies or direct `Popen` calls.
- Evidence: spawn matrix in `docs/architecture/CURRENT_STATE.md`; static `rg` inventory recorded in `EVIDENCE_INDEX.md`.
- Preconditions: none.
- Affected: policy consistency, security reviewability, rollback.
- Future control: one spawn API required for named-profile-capable paths and a static check against bypasses.
- Phase 0 action: none.

### AUD-15 — Review worker independence is not enforced

- Status: `CONFIRMED`.
- verification_mode: `static_code`.
- runtime_status: `UNVERIFIED`.
- Actual path: review-column dispatch uses the task assignee and swaps skills to `sdlc-review`.
- Evidence: `hermes_cli/kanban_db.py:7824-7895`.
- Preconditions: task enters review.
- Affected: all Kanban reviews.
- Future control: Workflow Review API rejects reviewer=worker and binds verdict to artifact hash.
- Phase 0 action: none.

### AUD-16 — Cockpit is an active control surface, not a read model

- Status: `CONFIRMED`.
- verification_mode: `runtime_observation`.
- runtime_status: `VERIFIED`.
- Actual path: thin proxy forwards arbitrary `/api/*`; frontend polls and mutates Hermes and makes direct WS/PTY connections.
- Evidence: `<COCKPIT_ROOT>/serve.py:53-105`; `<COCKPIT_ROOT>/public/live.js:226-331`, `349-471`.
- Preconditions: local browser access to Cockpit/dashboard.
- Affected: gateway lifecycle, config, models, sessions, Kanban, terminal.
- Future control: authenticated narrow BFF; no dashboard token or PTY in browser; workflow-owned commands.
- Phase 0 action: none.

## Finding disposition summary

| Audit ID | Status |
|---|---|
| AUD-01 | CONFIRMED |
| AUD-02 | CONFIRMED |
| AUD-03 | CONFIRMED |
| AUD-04 | CONFIRMED |
| AUD-05 | CONFIRMED |
| AUD-06 | CONFIRMED |
| AUD-07 | PARTIALLY_CONFIRMED |
| AUD-08 | CONFIRMED |
| AUD-09 | PARTIALLY_CONFIRMED |
| AUD-10 | PARTIALLY_CONFIRMED |
| AUD-11 | PARTIALLY_CONFIRMED |
| AUD-12 | CONFIRMED |
| AUD-13 | CONFIRMED |
| AUD-14 | CONFIRMED |
| AUD-15 | CONFIRMED |
| AUD-16 | CONFIRMED |

No item is marked remediated. No implementation is authorized by this document.
