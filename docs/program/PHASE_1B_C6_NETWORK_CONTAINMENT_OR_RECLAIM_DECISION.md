# Phase 1B-C6 Network Containment or Reclaim Decision

Status: `CONTAINMENT_DESIGN_REQUIRED`

C5 successfully classified the already running synthetic Lima VM `pc3`.
The gate result was operationally successful, but the security classification is:

```text
EGRESS_OBSERVED
```

This means Lima-vz is not approved as a standalone no-egress isolation backend
for PANKSTER profile workers.

## Inputs

- C2 static config blocked explicit networks, port forwards, host resolver,
  proxy propagation, guest env, guest params, host mounts, and containerd.
- C3 R2 started exactly one synthetic VM under isolated
  `LIMA_HOME=/Users/maksimpankratov/.local/pankster/runtime/lc3`.
- C4 post-start probes confirmed no host mounts, no `/Users` mount, no SSH agent
  socket, no container runtime binaries in guest PATH, and no host sync.
- C5 network classification observed guest DNS and outbound TCP reachability.

## Decision

Proceed to network containment design before any profile-runtime approval.

The current backend may continue only as a synthetic research runtime. It is not
approved for:

- production profiles;
- real credentials;
- default gateway integration;
- canary;
- model-auth materialization;
- profile worker execution.

## Why reclaim is not the immediate next step

The C4 results are useful: Lima-vz appears promising for filesystem and host
credential isolation when configured with no mounts and no host sync. Reclaiming
immediately would discard a useful synthetic test bed before evaluating whether
network containment can be layered on safely.

Reclaim remains available as a separate owner-approved gate if C7/C8 conclude
that containment is too broad, too fragile, or would affect the host network.

## Required next work

Create a static containment design that answers:

1. Where is egress blocked: guest firewall, host firewall, Lima network config,
   proxy choke point, or a replacement backend?
2. What is the blast radius on the developer Mac?
3. Can containment be scoped to only `LIMA_HOME=.../lc3` and instance `pc3`?
4. How is rollback proven?
5. Can the policy preserve required internal Lima control traffic while denying
   profile-worker network egress?
6. What exact tests prove fail-closed behavior?

## Hard gates preserved

- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary;
- no host firewall changes without a new owner approval;
- no guest writes without a new owner approval;
- no VM reclaim/delete without a new owner approval.

## Outcome

Next gate:

```text
PHASE_1B_C7_NETWORK_CONTAINMENT_DESIGN
```

Expected result before implementation:

```text
PHASE_1B_C8_STATIC_CONTAINMENT_REVIEW
```
