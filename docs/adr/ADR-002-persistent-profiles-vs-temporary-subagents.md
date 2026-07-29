# ADR-002: Persistent Profiles vs Temporary Subagents

- Status: Proposed

## Context

Hermes supports named filesystem profiles and in-process `delegate_task` children. Both can be called “agents,” but they have different durability, identity and isolation properties.

## Decision

Persistent profiles represent durable employees with registered identity, versioned persona/config/skills/memory and isolated runtime boundaries. Temporary subagents are bounded children of one attempt, inherit an explicit subset of parent capability, and are neither durable workers nor security principals. Workflow assignment targets persistent profiles; decomposition internals may use temporary subagents.

## Alternatives

- Treat every subagent as a persistent worker.
- Use only profiles and prohibit delegation.
- Treat profile directories as sufficient isolation.

## Consequences

- Clarifies lifecycle, UI, audit and retry semantics.
- Requires an Agent Registry and explicit runtime context.
- Keeps fast in-process delegation for low-risk short tasks.

## Security implications

Temporary subagents cannot serve as independent reviewers and must not receive raw ambient credentials. Persistent profiles require OS isolation before cross-profile security claims.

## Open questions

- What maximum nested delegation depth and budget should be permitted per workflow class?
- Which profile state is portable across runtime hosts?
