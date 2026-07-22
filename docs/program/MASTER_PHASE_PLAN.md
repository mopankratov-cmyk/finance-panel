# PANKSTER Agent Platform Master Phase Plan

Status: `awaiting_review`. Only Phase 0 documentation exists. No later phase is started or approved.

| Phase | Name | High-level objective | Entry gate | Exit gate |
|---:|---|---|---|---|
| 0 | Architecture baseline | Verify installed current state, trust boundaries, target model, ADR proposals, and acceptance matrix | Read-only access and sanitized evidence rules | Owner review of this documentation; ADRs remain Proposed |
| 1 | Contracts and threat model | Approve workflow, runtime context, credential ownership, artifact, review, human-gate, and event schemas | Phase 0 approved; open questions resolved | Versioned specifications and test plans approved; no production cutover |
| 2 | Workflow shadow service | Implement deterministic workflow/event/outbox service in an isolated environment as a strictly read-only shadow of Kanban | Phase 1 contracts approved | Replay/idempotency tests pass; shadow comparisons produce sanitized evidence; no authoritative write or dispatch exists |
| 3 | Synthetic execution-control validation | Implement Agent Registry and execution-policy contracts only against synthetic fixtures, including explicit no-spawn checks | Read-only workflow shadow stable | Disabled-profile, stale-policy, retry and reclaim tests pass with synthetic identities and prove that no production process can spawn |
| 4 | Runtime isolation | Introduce RuntimeSecurityContext, unified spawn factory, environment policy, and UID/container/ACL isolation | Execution control stable; infrastructure choice approved | Cross-profile env/filesystem/network tests pass; default compatibility verified |
| 5 | Credential broker | Replace named-profile root fallback and raw child credential inheritance with owner-scoped leases and refresh | Runtime identity/isolation proven | Auth/pool/OAuth/minimal-model acceptance tests pass; rollback does not restore unsafe fallback |
| 6 | Artifacts, review, and human gates | Add immutable artifact manifests, independent reviews, protected-action authorization | Workflow and identity contracts stable | Hash-bound review and Human Gate tests pass; protected executors cannot bypass gates |
| 7 | Cockpit control plane | Build narrow Cockpit BFF, event read model, workflow/artifact/review/gate UI; remove direct browser control | Domain APIs stable | Browser receives no provider/dashboard credentials and calls no direct LLM/PTY endpoints |
| 8 | Migration and controlled rollout | Dual-run, reconcile, migrate ownership references, canary isolated profiles, and prepare rollback | All offline security gates green; explicit owner authorization | Controlled production acceptance with signed evidence and rollback drill |
| 9 | Eval-driven learning and operations | Establish sanitized traces, eval datasets, shadow/canary promotion, SLOs, backup and incident drills | Production architecture accepted and stable | Repeatable eval/promotion/rollback process; protected security policy remains non-self-modifying |

## Program invariants

- No phase begins automatically when the prior document is written.
- No phase transition is automatic; every entry gate requires a separate, explicit owner decision.
- Phase 2 is read-only shadow operation only: it cannot write Kanban, become authoritative, dispatch work, or start a profile.
- Phase 3 uses synthetic fixtures and mandatory no-spawn assertions only; it does not activate production identities or execution.
- No named profile receives production credentials, credential-store writes, or production execution before both Runtime Isolation and Credential Broker gates have passed.
- Security invariants cannot be implemented only in prompts, skills, SOUL, or frontend code.
- Named profiles fail closed; default-profile compatibility is explicit and test-bounded.
- No real credential is copied into a test, artifact, log, issue, or Evidence Pack.
- Workflow state, artifacts, reviews, gates, and runtime policy are versioned and attributable.
- Merge, deploy, publish, credential refresh, profile enablement, and canary require explicit later authorization.
- Every phase produces a rollback plan and sanitized evidence before any state-changing rollout.

## Proposed initial workflow template families

Per [ADR-009](../adr/ADR-009-process-specific-workflow-templates.md), Phase 1 may specify versioned contracts for `development-feature`, `bug-fix`, `long-form-content`, `ugc-video-ad`, `pinterest-batch`, and `research-report`. Each process may use a sequence or DAG with process-specific stages, workers, reviewers, artifacts, criteria, revision limits, dependencies and Human Gates. Phase 0 creates no production schema or loader.

## Phase 0 handoff questions

The following decisions are intentionally deferred: workflow datastore/hosting, OS isolation mechanism, credential backend, human identity provider, artifact storage/retention, and whether the separate director-cockpit is consolidated or remains independent.
