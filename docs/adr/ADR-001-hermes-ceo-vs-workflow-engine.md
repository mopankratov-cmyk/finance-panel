# ADR-001: Hermes CEO vs Workflow Engine

- Status: Proposed

## Context

Hermes currently combines goal handling, Kanban transitions, dispatch, execution and review behavior. Natural-language agents are useful for decomposition and judgment, but are not a deterministic source of truth for workflow state.

Kanban SQLite является durable source of truth для задач,
запусков, событий и recovery metadata. Полноценного business
workflow source of truth сейчас нет.

## Decision

Hermes CEO will accept goals, choose a versioned workflow, propose decomposition/assignment, consume Evidence Packs, and issue a final verdict. A separate Workflow Engine will exclusively own state transitions, retries, reclaim, artifacts, review validation, human gates, and audit events. Hermes CEO cannot directly merge, deploy, publish, or write the workflow database.

## Alternatives

- Keep Kanban and all transitions in Hermes.
- Make Cockpit the state-machine owner.
- Encode state policy in skills/prompts.

## Consequences

- Adds a service/API boundary and migration complexity.
- Enables deterministic replay, idempotency, policy enforcement and independent clients.
- Requires a compatibility adapter while existing Kanban remains active.

## Security implications

Compromising or confusing the CEO agent does not by itself authorize state transitions or protected actions. The Workflow Engine must authenticate every command and persist attributed decisions.

## Open questions

- Which datastore and hosting model will satisfy local-first availability and audit retention?
- Which current Kanban transitions need strict compatibility during migration?
