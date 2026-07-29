# Phase 1B-C9 Host Firewall Research Approval Packet

Status: `OWNER_APPROVAL_REQUIRED`

C9 selects the host-firewall research path for Lima-vz after C5 proved guest
egress and C8 rejected Lima-vz as a standalone profile runtime backend.

This packet does not authorize `pfctl` execution or any host firewall mutation.
It authorizes the next research-prep step only: build an exact, separately
approved privileged experiment for a scoped macOS `pf` anchor.

## Why this exists

C5 observed DNS and TCP egress from the synthetic Lima VM. C7 identified a
host-side `pf` anchor as the only Lima-preserving path worth researching, but
C8 correctly required a separate privileged approval contract before any host
firewall change.

## Current approval scope

Allowed after approval:

- accept `HOST_FIREWALL_RESEARCH` as the selected path;
- prepare a future exact privileged execution contract;
- keep all work synthetic-only;
- require a new disposable VM for the actual firewall experiment;
- require rollback proof before any later profile worker test.

Still forbidden:

- no `pfctl -f`, `pfctl -E`, `pfctl -X`, or `pfctl -F`;
- no edits to `/etc/pf.conf` or `/etc/pf.anchors/*`;
- no host firewall state changes;
- no guest writes;
- no new VM start;
- no reclaim/delete;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary.

## Contract

Contract:

```text
docs/program/PHASE_1B_C9_HOST_FIREWALL_RESEARCH_CONTRACT.ready.json
```

Contract content SHA-256:

```text
360d4f746e7ef7cb225b8da333b7dec739c5d8d6175c24a89150dd34f2ddd2c5
```

Approval ID:

```text
p1b-20260722-limapfc9
```

Owner approval command:

```text
APPROVE_SYNTHETIC_LIMA_HOST_FIREWALL_RESEARCH:p1b-20260722-limapfc9:360d4f746e7ef7cb225b8da333b7dec739c5d8d6175c24a89150dd34f2ddd2c5
```

Owner command hash:

```text
e7ca5d2bd588c5d50d0596e97f9192da0d08f732290d8ee88f9510734ff9bb09
```

## Future execution constraints

The future privileged experiment must be a separate gate and must include:

- a new disposable Lima VM, not reused `pc3`;
- deterministic isolated `LIMA_HOME`;
- recorded guest IPv4 before firewall load;
- generated `pf` rules with no unresolved placeholders;
- syntax validation before load;
- use of scoped anchor `com.apple/pankster_phase1b_c9`;
- no edit to `/etc/pf.conf`;
- rollback command and rollback evidence;
- immediate C10 egress retest;
- proof that default gateway, production profiles, and real credentials were not
  touched.

## Expected next gate

If approved, the next deliverable is:

```text
PHASE_1B_C9_R2_HOST_FIREWALL_EXECUTION_CONTRACT
```

That later contract, not this packet, would contain exact privileged commands.
