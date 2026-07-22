# ADR-012: Network Enforcement

Status: Proposed

## Context

Profile workers need fail-closed network modes: disabled, loopback-only and
restricted egress. No backend network enforcement has been proven on this host.

## Decision

Treat network isolation as `NETWORK_BOUNDARY_UNPROVEN` until Phase 1B-B proves
the selected experiment candidate can enforce:

- `NETWORK_DISABLED`;
- `LOOPBACK_ONLY` without host-loopback leakage;
- `RESTRICTED_EGRESS` through an audited allowlist proxy.

## Consequences

- Absence of enforcement denies runtime launch.
- Cross-host documentation is not enough for production approval.
- A proxy/firewall design may require separate owner approval if host-level
  changes are needed.
