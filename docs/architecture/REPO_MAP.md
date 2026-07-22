# Repository and Component Map

Status: `awaiting_review`. Owner values are `UNVERIFIED` where no authoritative ownership file was found.

| Component | Path | Purpose | Owner | Runtime | Data store | Secrets class | Modification policy |
|---|---|---|---|---|---|---|---|
| Hermes core/install | `<HERMES_SOURCE>` | Gateway, dashboard, Kanban, agents, tools, profiles, MCP, auth | Upstream Nous + local operator (`UNVERIFIED` split) | Python 3.11.15, Hermes 0.18.2 | Root/profile SQLite and filesystem | Critical model/platform/tool auth | Future core patches require isolated branch, upstream decision, full security tests; untouched in Phase 0. |
| Hermes runtime home | `<HERMES_HOME>` | Runtime config, auth, state, profiles, boards, logs | Local operator | Host filesystem + launchd processes | `state.db`, `kanban.db`, profile files | Critical | Operational state; never edit from product repo. |
| Named profiles | `<HERMES_HOME>/profiles/{content-director,dev-director}` | Persistent agent identities/config/persona/memory | Local operator | Same-UID Hermes workers | Per-profile files, optional `state.db` | Profile secrets and model auth | Keep `CREATED_BUT_DISABLED` by operational convention until runtime gate/isolation exists; untouched in Phase 0. |
| PANKSTER live Cockpit | `<COCKPIT_ROOT>` | Local UI and thin proxy to Hermes dashboard | Local operator (`UNVERIFIED`) | Python static/proxy server + browser JS | None authoritative | Dashboard session capability in memory/browser | Future changes belong to Cockpit frontend/backend classes; production files untouched in Phase 0. |
| Director Cockpit | `<USER_HOME>/Projects/rita-ai/director-cockpit` | Separate Next.js command center and agent/task APIs | Local operator (`UNVERIFIED`) | Next.js 16 / Vercel-style | Supabase | Telegram, model, Supabase classes | Treat as separate system unless an explicit consolidation ADR is approved. |
| Finance Panel | `<USER_HOME>/Projects/finance-panel/finance-panel` | Marketplace finance/ops product; includes product AI agent | Repository owner per `AGENTS.md` | Next.js | Supabase | Product DB and marketplace auth | Branch/PR only; Phase 0 changes documentation in isolated worktree. |
| Phase 0 worktree | `<REPO_ROOT>` | Architecture baseline artifacts | Current review task | Documentation only | Git | None | Only `docs/**`; no push/merge without authorization. |
| Content Factory | `<USER_HOME>/Projects/finance-panel/content-factory` | Separate content production system | `UNVERIFIED` | Application-specific | Application-specific | Publishing/model/media credentials | Out of scope and dirty before audit; do not touch. |
| PANKSTER vault | `<USER_HOME>/PANKSTER` | Obsidian knowledge/memory source; gbrain sync | Local operator | Git + VM ingestion script | Git/remote gbrain | Git transport credentials external to script | Content/ops repo; sync script is state-changing and was not run. |
| Fleet Control Room | `<USER_HOME>/fleet-control-room` | Policies, task specifications, evidence packs, rollback backups | Local operator | Filesystem/Git | Evidence and backup files | Sanitized operational evidence; may include sensitive metadata | Read-only during Phase 0. Future artifact migration must preserve hashes/provenance. |
| gbrain auth adapter | `<HERMES_HOME>/bin/gbrain-auth-adapter.py` | Local adapter used by Hermes MCP configuration | Local operator (`UNVERIFIED`) | Python/launchd on localhost `3132` | External/remote service | Auth adapter credential class | Infrastructure component; source/config not changed. |
| LaunchAgent definitions | `<USER_HOME>/Library/LaunchAgents/ai.hermes*.plist`, `ai.pankster.cockpit.plist` | Service lifecycle | Local operator | launchd | plist + logs | May contain env values | Metadata keys only were read; values and files must not be copied into repo. |
| Kanban databases | `<HERMES_HOME>/kanban.db`, `<HERMES_HOME>/kanban/boards/*/kanban.db` | Tasks, runs, events, assignments | Hermes Kanban | SQLite | Per-board DB | Task content may be sensitive | No Phase 0 queries or writes; future Workflow migration uses read-only export/shadow first. |
| Runtime logs | `<HERMES_HOME>/logs`, profile logs, Kanban logs | Diagnostics and worker output | Hermes/launchd | Filesystem | Log files | May contain task/error data | Values not inspected. Future centralized redaction and retention required. |
| Evidence/backups | `<USER_HOME>/fleet-control-room/evidence`, `backups` | Manual evidence and rollback convention | Local operator | Filesystem/Git | Files/archives/manifests | Sanitized evidence, potentially sensitive filenames/paths | Target Artifact API should ingest manifests without mutating originals. |
| PANKSTER sync script | `<USER_HOME>/PANKSTER/sync-gbrain.sh` | Commit/push vault to Gitea and GitHub backup | Local operator | zsh/cron-like external schedule | Git remotes | Git auth external | State-changing; inspected statically only, never run in Phase 0. |

## Code-location map inside Hermes

| Concern | Installed path | Evidence range |
|---|---|---|
| Profile CRUD/selection | `hermes_cli/profiles.py` | `39-69`, `815-870`, `949-987`, `2209-2225` |
| Gateway profile scopes | `gateway/run.py` | `1580-1647`, `9276-9407`, `9635-9661`, `18395-18528` |
| Profile secret ContextVar | `agent/secret_scope.py` | `31-204` |
| Auth/root fallback | `hermes_cli/auth.py` | `894-980`, `1205-1314`, `1403-1498` |
| Credential pools/OAuth | `agent/credential_pool.py` | `527-579`, `966-1079`, `2538-2600` |
| Kanban DB/state/dispatch | `hermes_cli/kanban_db.py` | `371-614`, `840-1227`, `3484-3924`, `7439-7904`, `8169-8414` |
| Delegation/subagents | `tools/delegate_tool.py` | `1066-1415`, `1780-2045`, `2602-2670`, `2847-2915` |
| Async delegation durability | `tools/async_delegation.py` | `83-320`, `438-749` |
| Context propagation | `tools/thread_context.py` | `1-120` |
| Terminal env/process | `tools/environments/local.py` | `199-615`, `1110-1177`, `1333-1401` |
| Background process registry | `tools/process_registry.py` | `689-826`, `1919-2010` |
| execute_code child | `tools/code_execution_tool.py` | `135-264`, `1320-1515` |
| MCP env/spawn/retry | `tools/mcp_tool.py` | `351-446`, `2212-2290`, `3794-4017` |
| File-tool secret guard | `agent/file_safety.py`, `tools/file_tools.py` | `191-300`, `1198-1207` |

## Modification ownership in the target

- Hermes integration and runtime-context hooks: `HERMES_CORE_PATCH` or `HERMES_PLUGIN`, depending on whether an existing stable hook can enforce all paths.
- Deterministic workflow state, artifacts, reviews, gates, events: `SEPARATE_WORKFLOW_SERVICE`.
- Cockpit safe commands/read models: `COCKPIT_BACKEND`; visualization only: `COCKPIT_FRONTEND`.
- UID/container/ACL, network policy, vault: `INFRASTRUCTURE`.
- Persona and role policy: `AGENT_PROFILE`; behavior instructions only: `SKILL`.
- Workflow definitions: `WORKFLOW_TEMPLATE`.
- Trace/evaluation promotion: `EVAL_SYSTEM`.
- Runbooks, backup, incident and rollback: `OPERATIONS`.
