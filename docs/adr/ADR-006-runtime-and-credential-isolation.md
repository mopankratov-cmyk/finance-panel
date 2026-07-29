# ADR-006: Runtime and Credential Isolation

- Status: Proposed

## Context

Installed named profiles share UID and real HOME, may inherit gateway environment, can fall back to root auth, and use several child environment policies. Logical scoping is insufficient for adversarial isolation.

## Decision

Persistent named profiles will run behind a RuntimeSecurityContext and unified spawn factory in separate UID/container/ACL boundaries with isolated HOME, workspace mounts and network policy. Root fallback is disabled for named profiles. A Credential Broker issues short-lived profile/provider/model/purpose grants and performs owner-only OAuth refresh. The default profile may retain an explicit legacy compatibility policy.

## Alternatives

- Extend denylist-only filtering.
- Rely on profile filesystem permissions under one UID.
- Duplicate root auth into each profile.

## Consequences

- Highest migration cost and strongest compatibility risk.
- Requires infrastructure, provider adapters, policy versioning and rollback.
- Removes ambient CLI convenience for isolated named profiles unless explicitly brokered/mounted.

## Security implications

Compromise of one profile is bounded by OS, filesystem, network and credential capabilities. Missing context, missing grant, stale policy and disabled runtime fail closed.

## Open questions

- Container, separate UID, sandbox framework, or a layered combination?
- Which credential backend supports local-first operation and owner-scoped refresh?
