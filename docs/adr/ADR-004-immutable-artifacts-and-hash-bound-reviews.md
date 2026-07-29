# ADR-004: Immutable Artifacts and Hash-Bound Reviews

- Status: Proposed

## Context

Current outputs are spread across task results, comments, workspaces, attachments, PRs, logs and manually assembled Evidence Packs. Review can become stale when an artifact changes after inspection.

## Decision

Artifacts are content-addressed and immutable. Each Evidence Pack is a versioned manifest of hashes, producer attempt, commands/tests, redaction status and policy versions. Reviews and Human Gates reference the exact manifest hash; any new artifact version requires a new review/gate decision.

## Alternatives

- Continue path-based mutable artifacts.
- Store only a final report document.
- Trust Git commit hashes without a workflow manifest.

## Consequences

- Adds storage, retention and garbage-collection requirements.
- Enables reproducibility, cache safety and tamper detection.
- Large/binary artifacts need efficient deduplication.

## Security implications

Hash binding prevents time-of-check/time-of-use substitution. Redaction must occur before an artifact is accepted, and manifests must never contain secret values.

## Open questions

- Which storage backend and retention classes are required?
- How are external PR/build artifacts attested and mirrored?
