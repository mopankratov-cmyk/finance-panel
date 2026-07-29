# ADR-003: Worker/Reviewer Independence

- Status: Proposed

## Context

Current Kanban review dispatch uses the task assignee with an added review skill. A change in prompt or skill does not create independent identity or remove conflicts of interest.

## Decision

The Workflow Engine will assign review only when all mandatory independence constraints hold:

- `reviewer.principal_id != worker.principal_id`;
- `reviewer.profile_id != worker.profile_id`;
- `reviewer.model_policy_group != worker.model_policy_group`;
- for high-risk reviews, policy may additionally require a different `model_family` and/or `provider_family`.

The Agent Registry therefore records `model_policy_group`, `model_family`, `provider_family`, `review_risk_tier`, and `reviewer_eligibility` as versioned policy inputs.

A review references an exact worker attempt and immutable artifact manifest hash. The reviewer receives only the frozen artifact set, review brief, acceptance criteria, and sanitized Evidence Pack. It receives no mutable worker workspace and no hidden chain-of-thought or other hidden reasoning. The engine rejects self-review, same-profile review, same-policy-group review, stale-artifact review, and any additional risk-tier conflict.

## Alternatives

- Keep same-profile review with a different skill.
- Use temporary subagents as reviewers.
- Require only human review.

## Consequences

- Requires reviewer capacity and explicit assignment rules.
- May require a different model or provider family for high-risk work, increasing latency and cost.
- Makes review provenance and disagreement observable.
- Human escalation remains available for high-risk or inconclusive cases.

## Security implications

Independent identity reduces self-approval and prompt-contamination risk. It does not replace Human Gates for merge/deploy/publish.

## Open questions

- Which role combinations are independent enough for each risk tier?
- When is multi-reviewer quorum required?
