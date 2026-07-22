# Phase 1B-C9 R3 Host Firewall Execution Precheck

Status: `EXECUTION_CONTRACT_NOT_READY`

C9 R2 successfully started the disposable target VM `pc9r2` and recorded its
guest-side IPv4:

```text
192.168.5.15/24
```

The same C9 R2 evidence also confirmed that before any firewall rule, DNS and
TCP 443 egress are available.

## Why R3 cannot safely execute `pfctl` yet

The C9 research design expected that a scoped macOS `pf` anchor could block the
target guest IP. C9 R2 provides the guest-side IP, but two key facts remain
unproven:

1. macOS `pf` must be proven to see packets with source `192.168.5.15` before
   Lima/vz NAT translation.
2. `192.168.5.15` must be proven unique to the intended target VM for the
   duration of the experiment.

Without those proofs, a rule such as:

```text
block drop quick from 192.168.5.15 to any
```

could be ineffective if `pf` only sees post-NAT host traffic, or could affect a
broader class of Lima/vz traffic if the address is reused by multiple isolated
Lima homes.

## R3 fail-closed decision

Do not generate a privileged firewall execution contract yet.

Required next static work:

- design a read-only or minimally privileged way to prove `pf` packet visibility
  for Lima/vz guest traffic;
- prove target uniqueness or switch to a containment mechanism with a stronger
  selector than guest private IP;
- decide whether existing synthetic VM `pc3` must be reclaimed before any
  firewall test to reduce ambiguity;
- define rollback semantics before any `pfctl` command is approved.

## Still forbidden

- no `pfctl -f`, `pfctl -E`, `pfctl -X`, or `pfctl -F`;
- no edits to `/etc/pf.conf` or `/etc/pf.anchors/*`;
- no host firewall mutation;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary.

## Result

```text
C9_R3_BLOCKED_PENDING_PF_VISIBILITY_AND_TARGET_UNIQUENESS_PROOF
```
