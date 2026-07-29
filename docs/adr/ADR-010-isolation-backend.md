# ADR-010: Isolation Backend

Status: Proposed

## Context

Hermes profiles need OS-level isolation beyond Phase 1A environment filtering.
The current host is macOS 26.5.2 on arm64. No candidate runtime is installed.

## Decision

Use Apple Container CLI / Apple Containerization stack as the primary Phase
1B-B disposable prototype experiment candidate. Use Lima VZ as fallback
experiment candidate.

## Consequences

- Installation requires owner approval.
- Production isolation remains blocked until synthetic experiments pass.
- Network enforcement and credential delivery remain explicit acceptance gates.
- This ADR is not production backend approval.

## Alternatives

- Docker Desktop + ECI: strong documented hardening, but adds subscription/admin
  settings and Docker socket governance.
- Colima: useful convenience wrapper but less direct control than Lima.
- Podman Machine: viable alternate but not selected for first prototype.
- macOS users + ACL: insufficient as primary boundary.
