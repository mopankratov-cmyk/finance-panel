# ADR-005: Human Authorization Gates

- Status: Proposed

## Context

Current approvals are distributed across terminal callbacks, UI confirmations and operational practice. Protected actions need durable authorization tied to the exact proposed change.

## Decision

The Workflow Engine will own Human Gate objects. A gate records actor identity, authorization scope, workflow/task/attempt, artifact manifest hash, decision, reason, policy version and expiry. Merge, deploy, publish, credential, profile-enable and other protected executors require a valid gate and cannot accept agent self-authorization.

## Alternatives

- Use chat text as approval.
- Keep browser confirm dialogs only.
- Let Hermes CEO decide all actions.

## Consequences

- Requires human authentication and authorization policy.
- Adds explicit waiting states and escalation UX.
- Improves auditability and revocation.

## Security implications

Approvals are replay-resistant, scope-bound and expire. The browser must not hold executor credentials; it submits decisions through the authenticated Cockpit backend.

## Open questions

- Which identity provider and assurance level are required locally and remotely?
- Which gates require two-person approval?
