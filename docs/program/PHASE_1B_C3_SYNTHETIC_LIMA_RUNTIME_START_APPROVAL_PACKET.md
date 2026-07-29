# Phase 1B-C3 Synthetic Lima Runtime Start Approval Packet

Status: `OWNER_APPROVAL_REQUIRED`

C3 is the first gate that would create and start a Lima VM. It is not approved
by this packet alone.

## What this approval would allow

If the owner provides the exact approval command below, C3 may:

- download the pinned Ubuntu 24.04 minimal arm64 guest image;
- verify its SHA-256 digest;
- create an isolated `LIMA_HOME`;
- start exactly one synthetic Lima-vz VM named `pankster-synthetic-c3`;
- use the validated C2 config.

## What remains forbidden

- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary;
- no host mounts;
- no host credential directory mounts;
- no host container runtime socket exposure;
- no containerd;
- no port forwards;
- no shell PATH modification.

## Network risk decision

Required owner decision:

```text
ACCEPT_DEFAULT_LIMA_NAT_EGRESS_FOR_SYNTHETIC_BOOT_ONLY
```

Reason:

- C2 forbids explicit Lima networks and host port forwards.
- C2 disables proxy environment propagation and host resolver.
- Lima's installed default template still documents built-in networking
  behavior, including built-in SLIRP network references and DNS behavior.
- Therefore C3 cannot claim no outbound network. It can only claim synthetic
  boot with default Lima guest egress accepted.

This is acceptable only if the owner is comfortable with outbound guest network
for a synthetic, credential-free VM boot.

## Contract

Contract:

```text
docs/program/PHASE_1B_C3_SYNTHETIC_LIMA_RUNTIME_START_CONTRACT.ready.json
```

Contract content SHA-256:

```text
a89e57eae079123ba540a47b440b29f2fd9d4496a26e5119d29729cb2d9404b2
```

Approval ID:

```text
p1b-20260722-limaruntimec3
```

Owner approval command:

```text
APPROVE_SYNTHETIC_LIMA_RUNTIME_START:p1b-20260722-limaruntimec3:a89e57eae079123ba540a47b440b29f2fd9d4496a26e5119d29729cb2d9404b2
```

Owner command hash:

```text
d21d99d83fff49143361b47241d8a532116fe2c503230c860b045c5b4724895c
```

## Pinned runtime inputs

- Lima prefix:
  `/Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0`
- `limactl` SHA-256:
  `f19a4fca3875e1017a5285672be4a62699c1e55918fb6a7afce86a14199e10d9`
- C2 config SHA-256:
  `ec4ee37801c5168f3522dbd58ab729e565918c684c415265d3079eb7a3a74008`
- Guest image:
  `https://cloud-images.ubuntu.com/minimal/releases/noble/release-20260716/ubuntu-24.04-minimal-cloudimg-arm64.img`
- Guest image SHA-256:
  `7e938df669e3b1923595eeda97aa28569350c5283e05a835cc912a2486a54934`

## Isolated runtime state

C3 must use:

```text
LIMA_HOME=/Users/maksimpankratov/.local/pankster/runtime/lima-home-synthetic-c3
```

It must not use default `~/.lima`.

## Required post-start checks

If C3 is later approved and started, collect sanitized evidence:

- `limactl list` for the isolated `LIMA_HOME`;
- VM status;
- no host mounts in effective config;
- no port forwards in effective config except Lima internal SSH behavior;
- no production credentials or profile env;
- gateway unchanged;
- reclaim/stop command available.

## Rollback

Stop/delete only the isolated synthetic instance and remove only the isolated
`LIMA_HOME` after evidence is captured. Do not touch the installed Lima archive
unless a separate rollback gate asks for it.
