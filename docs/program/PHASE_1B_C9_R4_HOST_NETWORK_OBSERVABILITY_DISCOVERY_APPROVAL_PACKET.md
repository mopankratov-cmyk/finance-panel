# Phase 1B-C9 R4 Host Network Observability Discovery Approval Packet

Status: `OWNER_APPROVAL_REQUIRED`

C9 R3 blocks privileged firewall execution because C9 R2 did not prove two
host-side requirements:

- macOS `pf` sees Lima/vz packets with guest source `192.168.5.15` before NAT;
- `192.168.5.15` is unique to disposable target VM `pc9r2`.

C9 R4 is a narrower, non-mutating discovery step. It may collect sanitized host
network metadata needed to decide whether a later packet-visibility probe can be
scoped safely.

It does not authorize `pfctl`, packet capture, guest traffic generation, or host
firewall mutation.

## Allowed after owner approval

- `/sbin/ifconfig -a`;
- `/usr/sbin/netstat -rn -f inet`;
- `/sbin/route -n get 192.168.5.15`;
- sanitized evidence summarizing the host interface/route view.

## Still forbidden

- no `pfctl`;
- no `tcpdump` or packet capture;
- no edits to `/etc/pf.conf` or `/etc/pf.anchors/*`;
- no host firewall state changes;
- no guest commands or guest traffic generation;
- no host sync;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary;
- no VM reclaim/delete.

## Contract

Contract:

```text
docs/program/PHASE_1B_C9_R4_HOST_NETWORK_OBSERVABILITY_DISCOVERY_CONTRACT.ready.json
```

Contract content SHA-256:

```text
5fdbb97f712a83c4de1b7321cf388c5255d870dbbfe9524dec96138ed5d8e8c9
```

Contract file SHA-256:

```text
ce532fde373a206fbbe10396d794797107371ec05bab9cece7e88eea6582a043
```

Approval ID:

```text
p1b-20260722-limaobsc9r4
```

Owner approval command:

```text
APPROVE_SYNTHETIC_LIMA_HOST_NETWORK_OBSERVABILITY:p1b-20260722-limaobsc9r4:5fdbb97f712a83c4de1b7321cf388c5255d870dbbfe9524dec96138ed5d8e8c9
```

Owner command hash:

```text
a55ad60c41129171f3fba67d5fbf1ed3e9ff08dcc6962c2bd030692563843350
```

## Why this is not firewall execution

C9 R4 only asks whether host routing/interface metadata can identify a narrow
observation point for a later packet-visibility probe. If C9 R4 cannot produce
a scoped observation target, the pipeline must fail closed and continue to block
`pfctl`.

