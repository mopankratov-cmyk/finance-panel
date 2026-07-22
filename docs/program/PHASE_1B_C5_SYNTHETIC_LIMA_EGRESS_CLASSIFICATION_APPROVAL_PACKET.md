# Phase 1B-C5 Synthetic Lima Egress Classification Approval Packet

Status: `OWNER_APPROVAL_REQUIRED`

C5 would run bounded synthetic network-egress classification probes against the
already running Lima VM `pc3`.

This gate does not claim network isolation. It only classifies whether the
current Lima runtime has observable DNS/TCP egress under the synthetic VM
configuration already started in C3 and inspected in C4.

## Scope

Allowed:

- inspect `limactl list --format json pc3`;
- inspect guest route/resolver state without changing it;
- perform one DNS lookup classification for `example.com`;
- perform one outbound TCP connect classification to `1.1.1.1:443`;
- collect sanitized evidence containing only classification markers.

Forbidden:

- no HTTP request payloads;
- no `curl`, `wget`, package install, dependency install, or package manager;
- no `--preserve-env`;
- no host sync;
- no guest writes;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary.

## Contract

Contract:

```text
docs/program/PHASE_1B_C5_SYNTHETIC_LIMA_EGRESS_CLASSIFICATION_CONTRACT.ready.json
```

Contract content SHA-256:

```text
7172db2bdc66461dfa5f0e2c49fd9134833889fffa53a80f546b239da38f7d1d
```

Approval ID:

```text
p1b-20260722-limaegressc5
```

Owner approval command:

```text
APPROVE_SYNTHETIC_LIMA_EGRESS_CLASSIFICATION:p1b-20260722-limaegressc5:7172db2bdc66461dfa5f0e2c49fd9134833889fffa53a80f546b239da38f7d1d
```

Owner command hash:

```text
5a610034207cd178e1d75c327c9268ef39000e8f5d59eff7394d95e59dea232c
```

## Probe list

The approved probe list is intentionally small:

1. host `limactl list --format json pc3`;
2. guest route/resolver inspection;
3. guest DNS classification for `example.com`;
4. guest TCP classification for `1.1.1.1:443`.

## Output policy

Evidence must be sanitized:

- no raw host environment;
- no env values;
- no auth files;
- no Keychain;
- no secrets;
- no production profile data;
- no raw HTTP response body;
- only route/resolver text and bounded availability markers may be recorded.

## Result interpretation

- If DNS or TCP egress is observed, Lima default guest egress is available and
  PANKSTER must not claim no-egress isolation for this backend until a stronger
  containment design is implemented and separately approved.
- If egress is not observed, this bounded probe still does not by itself prove a
  production no-egress policy; production profile use remains blocked until an
  enforceable network policy exists.
