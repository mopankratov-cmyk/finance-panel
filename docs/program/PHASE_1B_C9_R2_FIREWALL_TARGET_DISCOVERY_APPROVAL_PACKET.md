# Phase 1B-C9 R2 Firewall Target Discovery Approval Packet

Status: `OWNER_APPROVAL_REQUIRED`

C9 approved the host-firewall research path, but firewall rules cannot be exact
until a disposable target VM exists and its guest IPv4 is known.

C9 R2 therefore authorizes only target discovery:

- start one new disposable synthetic Lima-vz VM named `pc9r2`;
- use isolated `LIMA_HOME=/Users/maksimpankratov/.local/pankster/runtime/lc9r2`;
- collect sanitized VM status, guest IPv4/subnet, route table, and before-firewall
  DNS/TCP egress markers.

It does not authorize `pfctl` execution or host firewall mutation.

## Still forbidden

- no `pfctl -f`, `pfctl -E`, `pfctl -X`, or `pfctl -F`;
- no edits to `/etc/pf.conf` or `/etc/pf.anchors/*`;
- no host firewall state changes;
- no host sync;
- no guest writes beyond the Lima VM creation/start mechanics;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary;
- no reuse of existing `pc3` as a production candidate.

## Contract

Contract:

```text
docs/program/PHASE_1B_C9_R2_FIREWALL_TARGET_DISCOVERY_CONTRACT.ready.json
```

Contract content SHA-256:

```text
3048d2668b5c224ec98bdb0cb1aca865f6fa5e8070e4432833c1c034db6c8b4d
```

Approval ID:

```text
p1b-20260722-limapftargetc9r2
```

Owner approval command:

```text
APPROVE_SYNTHETIC_LIMA_FIREWALL_TARGET_DISCOVERY:p1b-20260722-limapftargetc9r2:3048d2668b5c224ec98bdb0cb1aca865f6fa5e8070e4432833c1c034db6c8b4d
```

Owner command hash:

```text
eb0a90090b72a85b6f76c5d17c59c4a0953e4528d239c24b19396dd08622782d
```

## Why C9 R3 is separate

C9 R3 will be the first gate that may contain exact privileged `pfctl` commands.
It must be generated only after C9 R2 records the target guest IPv4 and verifies
that placeholders are resolved. This keeps the firewall rules exact and prevents
loading broad or guessed rules.
