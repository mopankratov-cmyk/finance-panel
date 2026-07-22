# Phase 1B-C9 R3 PF Visibility and Target Uniqueness Review

Status: `PF_EXECUTION_BLOCKED`

C9 R2 completed target discovery for the disposable Lima-vz VM `pc9r2`:

```text
guest IPv4: 192.168.5.15/24
default gateway: 192.168.5.2
before-firewall DNS: AVAILABLE
before-firewall TCP 443: AVAILABLE
```

That resolves the placeholder in the original C9 firewall-rule template, but it
does not prove the rule would be correct or scoped on macOS.

## Review verdict

Do not approve privileged `pfctl` execution yet.

The C9 R2 evidence is sufficient to identify a guest-side target address. It is
not sufficient to prove either required host-side condition:

1. macOS `pf` sees Lima/vz guest traffic with source `192.168.5.15` before NAT.
2. `192.168.5.15` is unique to `pc9r2` and will not match another Lima/vz VM or
   a broader NAT domain during the experiment.

## Why this remains blocked

A host firewall rule such as:

```text
block drop quick from 192.168.5.15 to any
```

is only safe if the packet filter evaluates packets before the guest source is
translated, and only if that address is uniquely bound to the intended synthetic
target. Without those proofs, the rule could be ineffective or overbroad.

## Minimum safe next gate

Prepare a separate owner-approved host network observability discovery gate.
That gate may collect non-mutating host network metadata needed to decide
whether a later packet-visibility probe can be scoped safely.

The next gate must still forbid:

- `pfctl`;
- `/etc/pf.conf` edits;
- `/etc/pf.anchors/*` edits;
- `tcpdump` or packet capture;
- guest traffic generation;
- production profiles;
- real credentials;
- gateway/default runtime changes;
- canary;
- reclaim/delete.

## Result

```text
C9_R3_BLOCK_PF_EXECUTION_PREPARE_C9_R4_OBSERVABILITY_DISCOVERY
```

