# ADR-011: Credential Delivery

Status: Proposed

## Context

Phase 1A showed that credentials must not flow through global environment,
root auth fallback, argv, logs, shared host files, or common profile directories.

## Decision

Prototype task-scoped credential delivery with short-lived grant references and
one-time mounted files first. Evaluate inherited file descriptors and local
broker sockets after the file path is proven safe.

## Consequences

- Credentials are never placed in image layers, argv or global environment.
- Each grant must be revocable and cleaned after task completion.
- Reviewer runtimes receive no worker credentials.

## Open questions

- Whether Apple Container can support a safer FD-style injection primitive.
- Whether a backend-specific secret primitive exists and is auditable enough.
