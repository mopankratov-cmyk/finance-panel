# Change Placement Matrix

Status: `awaiting_review`. “Upstream” is a proposal, not authorization to fork, patch, or submit.

| Requirement | Current location | Target location | Class | Dependencies | Security impact | Migration risk | Acceptance test | Upstream / no-fork assessment |
|---|---|---|---|---|---|---|---|---|
| Deterministic workflow state | Kanban SQLite owns task/run/event/recovery metadata; no complete business workflow source of truth exists | Dedicated Workflow Engine | SEPARATE_WORKFLOW_SERVICE | Schema, outbox, idempotency, adapter | High integrity | High | State transition replay/property tests | No Hermes fork; use adapter/plugin/API. |
| Process-specific workflow templates | No authoritative process DAG/template registry | Workflow Template Registry | WORKFLOW_TEMPLATE | ADR-009, versioning, schema and validator | High integrity | Medium | Per-template stage/dependency/gate validation and version-hash tests | No fork; Cockpit consumes the dynamic read model. |
| Workflow template registry | Skills/task conventions | Workflow Engine | WORKFLOW_TEMPLATE | Versioned schema and validator | Medium | Medium | Template hash and backward-compat tests | No fork. |
| Agent registry and `runtime_enabled` | Profile directory existence | Workflow Engine + runtime enforcement | SEPARATE_WORKFLOW_SERVICE | Stable profile IDs, policy versions | Critical | Medium | Disabled profile no-spawn on all paths | Hermes enforcement hook likely upstream core patch. |
| Immediate pre-spawn runtime gate | No check in Kanban dispatcher | Unified spawn factory | HERMES_CORE_PATCH | Agent Registry cache/API, fail-closed semantics | Critical | Medium | Race/retry/reclaim/restart gate tests | Upstream desirable; cannot be safely guaranteed by profile files/skill alone. |
| `RuntimeSecurityContext` | Fragmented ContextVars/env | Security Runtime | HERMES_CORE_PATCH | Context schema, propagation helper | Critical | High | Context equality across every child path | Upstream core patch likely required. |
| Unified spawn factory | Multiple `Popen` and env builders | Security Runtime | HERMES_CORE_PATCH | Runtime context, platform adapters | Critical | High | Static ban + path matrix tests | Upstream required for full coverage; plugin insufficient for hard-coded paths. |
| Profile OS isolation | Same UID/real HOME | Per-profile UID/container/ACL runtime | INFRASTRUCTURE | Container/runtime choice, mounts, network policy | Critical | High | Cross-profile filesystem/process denial | No fork if Hermes spawn hooks are added. |
| Isolated profile HOME | Host real HOME by default | Isolated runtime home | INFRASTRUCTURE | OS isolation and CLI config mounting | Critical | Medium | Root CLI/auth path unreadable | Config alone is insufficient under same UID. |
| Environment allowlist | Kanban full-copy; per-tool variants | Unified spawn factory policy | HERMES_CORE_PATCH | Runtime context and exact variable contract | Critical | High | Sentinel env A/B across all paths | Upstream desirable. |
| Mandatory denylist after all merges | Varies; MCP explicit env can add arbitrary keys | Unified spawn factory | HERMES_CORE_PATCH | Central secret-name registry | Critical | Medium | Explicit-env collision fails closed | Upstream desirable. |
| Preserve `NO_PROXY`/`no_proxy` | Missing in execute_code/MCP allowlists | Non-secret system baseline | HERMES_CORE_PATCH | Cross-platform env tests | Availability + isolation | Medium | Both spellings preserved without secret leakage | Small upstream patch, but validate all paths. |
| Disable root auth fallback for named profiles | `hermes_cli/auth.py` per-provider fallback | Auth policy / broker | HERMES_CORE_PATCH | Default-profile compatibility flag | Critical | High | Missing profile grant fails closed | Core patch required; no safe skill workaround. |
| Prevent root pool materialization | `load_pool` + writes | Credential broker/owner store | HERMES_CORE_PATCH | Credential ownership metadata | Critical | High | Fallback reads never create profile/root copies | Core patch required. |
| Separate profile auth | Optional profile `auth.json`; currently absent | Owner-scoped broker records | INFRASTRUCTURE | Vault/backend and migration tool | Critical | High | Profile sees only authorized model grant | Can avoid Hermes fork after broker integration hook. |
| Owner-only OAuth refresh | Source/write-through can update root | Credential Broker | INFRASTRUCTURE | CAS/versioned token rotation | Critical | High | Refresh modifies only owner record | Hermes auth adapter/core integration needed. |
| Minimal model auth | Parent key copied to child | Credential Broker leases | HERMES_PLUGIN | Runtime identity and provider adapter | Critical | Medium | Provider/model/purpose TTL enforcement | Plugin may work for model calls; core patch needed to remove legacy paths. |
| Delegation context propagation | Outer async copied; inner child/batch hops not | Context-aware executor wrapper | HERMES_CORE_PATCH | Runtime context and approval callbacks | Critical | Medium | Single/batch/background/nested equality tests | Upstream targeted patch. |
| Independent reviewer | Same task assignee + review skill | Workflow Review API | SEPARATE_WORKFLOW_SERVICE | Agent registry, conflict rules | High integrity | Medium | Reviewer cannot equal worker | No fork; Kanban adapter stops owning final review. |
| Immutable artifacts | Files/attachments/evidence conventions | Artifact API/store | SEPARATE_WORKFLOW_SERVICE | Content-addressed storage, retention | High integrity | Medium | Hash mismatch invalidates review | No fork. |
| Hash-bound Evidence Packs | Manual manifests | Workflow/Artifact service | SEPARATE_WORKFLOW_SERVICE | Artifact manifest schema | High integrity | Medium | Review references exact manifest hash | No fork. |
| Durable Human Gates | Tool/UI confirmations | Workflow Human Gate API | SEPARATE_WORKFLOW_SERVICE | Identity/authz, transition policy | Critical | Medium | Unauthorized/expired gate rejected | No fork. |
| Cockpit backend/BFF | Thin generic Hermes proxy | Narrow authenticated BFF | COCKPIT_BACKEND | User auth, Workflow APIs | Critical | Medium | Browser never receives Hermes/provider tokens | No Hermes fork. |
| Cockpit workflow visualization | Mixed live data and mocks | Read-model UI | COCKPIT_FRONTEND | Event stream/read API | Low | Low | UI derived only from event/read model | No fork. |
| Remove direct frontend LLM/PTY/control | Browser connects to dashboard WS/PTY | Backend execution APIs only | COCKPIT_FRONTEND | BFF and deprecation plan | High | Medium | Network test rejects direct dashboard calls | No fork. |
| Append-only audit/event stream | Kanban events + logs | Workflow event store | SEPARATE_WORKFLOW_SERVICE | Outbox, retention, PII policy | High | Medium | Ordered replay and tamper evidence | No fork. |
| Central redaction | Path-specific sanitizers | Security Runtime + observability | OPERATIONS | Structured logging and secret taxonomy | Critical | Medium | Logs/argv/checkpoints/Evidence Pack sentinel scan | Some upstream helpers, plus ops pipeline. |
| Profile persona/skills | Profile SOUL/skills | Versioned profile package | AGENT_PROFILE | Registry and change review | Medium | Low | Hash/version visible in attempt record | No fork. |
| Role-specific operating instructions | Skills and prompts | Signed/versioned skills | SKILL | Profile policy | Medium | Low | Skill cannot grant capabilities | No fork. |
| Eval datasets and promotion | Ad hoc evidence/canaries | Eval/Learning system | EVAL_SYSTEM | Sanitized traces, scorecards | Medium | Medium | Sandbox→shadow→canary gates | No fork. |
| Backup/rollback/runbooks | Fleet control room conventions | Operations | OPERATIONS | Retention and restore drills | High availability | Medium | Read-only restore verification | No fork. |

## Placement rule

A skill, SOUL, profile YAML, or Cockpit frontend must never be used to enforce a security invariant that can be bypassed by a direct process spawn, same-UID filesystem access, retry/reclaim path, or alternate API. Such invariants belong in Security Runtime, Workflow Engine, or infrastructure.
