# Phase 1B-C9 R5 Packet Visibility Probe Approval Packet

Status: `OWNER_APPROVAL_REQUIRED`

C9 R4 found one host observation candidate for target `pc9r2`:

```text
target guest IPv4: 192.168.5.15
candidate host interface: utun4
```

C9 R4 still did not prove that macOS `pf` sees guest private source traffic
before NAT. C9 R5 is therefore a narrow packet-visibility probe.

It does not authorize `pfctl` or host firewall mutation.

## Allowed after owner approval

- packet capture metadata on `utun4` only;
- BPF filter: `host 192.168.5.15 and tcp and port 443`;
- max 8 packets;
- max 12 seconds;
- one synthetic TCP connect attempt from `pc9r2` to `1.1.1.1:443`;
- sanitized summary only: packet direction counts and whether `192.168.5.15`
  appears before NAT.

## Still forbidden

- no `pfctl`;
- no edits to `/etc/pf.conf` or `/etc/pf.anchors/*`;
- no host firewall state changes;
- no DNS probe;
- no raw packet payload persistence;
- no broad packet capture;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary;
- no VM reclaim/delete.

## Operator note

Packet capture may require admin/BPF privileges on macOS. The C9 R5 contract
allows a later runner to print an admin command, but does not allow automatic
privileged execution by Codex.

## Contract

Contract:

```text
docs/program/PHASE_1B_C9_R5_PACKET_VISIBILITY_PROBE_CONTRACT.ready.json
```

Contract content SHA-256:

```text
697deae9aeec4518a6edcd6d5986c1ae6dfda1d2cad5b096c8b2c1851d7c5928
```

Contract file SHA-256:

```text
22076ed3da419e7ed4901f0d0ea0aca25cff34d63c6073c649a9bd3420269026
```

Approval ID:

```text
p1b-20260722-limapktc9r5
```

Owner approval command:

```text
APPROVE_SYNTHETIC_LIMA_PACKET_VISIBILITY_PROBE:p1b-20260722-limapktc9r5:697deae9aeec4518a6edcd6d5986c1ae6dfda1d2cad5b096c8b2c1851d7c5928
```

Owner command hash:

```text
dda685c043396aef54cc560aee15dfc2859c6d47c41cbaee74ed5a5bc24543f6
```

## Why C9 R5 is still not firewall execution

C9 R5 only tests packet visibility. If `192.168.5.15` is not observed on `utun4`
before NAT, the host-firewall path remains blocked. If it is observed, a later
gate must still prove target uniqueness and prepare a separate rollback-safe
firewall execution contract.
