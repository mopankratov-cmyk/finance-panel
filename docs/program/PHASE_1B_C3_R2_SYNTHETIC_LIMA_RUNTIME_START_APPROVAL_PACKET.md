# Phase 1B-C3 R2 Synthetic Lima Runtime Start Approval Packet

Status: `OWNER_APPROVAL_REQUIRED`

C3 R1 was denied before VM creation because the approved `LIMA_HOME` and
instance name produced a Lima SSH socket path longer than macOS
`UNIX_PATH_MAX=104`.

R2 changes only the runtime path/name:

- `LIMA_HOME`: `/Users/maksimpankratov/.local/pankster/runtime/lc3`
- instance name: `pc3`
- estimated socket path length: `80`

All C2 security invariants remain unchanged.

## What this approval would allow

If the owner provides the exact approval command below, C3 R2 may:

- download the pinned Ubuntu 24.04 minimal arm64 guest image;
- verify its SHA-256 digest;
- create isolated `LIMA_HOME=/Users/maksimpankratov/.local/pankster/runtime/lc3`;
- start exactly one synthetic Lima-vz VM named `pc3`;
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

Required owner decision remains:

```text
ACCEPT_DEFAULT_LIMA_NAT_EGRESS_FOR_SYNTHETIC_BOOT_ONLY
```

C2 forbids explicit Lima networks, port forwards, proxy environment propagation,
host resolver, guest env, guest params, host mounts, and containerd. C3 R2 still
does not claim no egress because Lima default networking behavior may allow
outbound guest network during synthetic boot.

## Contract

Contract:

```text
docs/program/PHASE_1B_C3_R2_SYNTHETIC_LIMA_RUNTIME_START_CONTRACT.ready.json
```

Contract content SHA-256:

```text
ca488375aab8af38f144ab98a9ec1382a6df8d03f5248f215d5c2024753d4e7e
```

Approval ID:

```text
p1b-20260722-limaruntimec3r2
```

Owner approval command:

```text
APPROVE_SYNTHETIC_LIMA_RUNTIME_START:p1b-20260722-limaruntimec3r2:ca488375aab8af38f144ab98a9ec1382a6df8d03f5248f215d5c2024753d4e7e
```

Owner command hash:

```text
c2adfb0d878af1c0f6ff2afaf3c258a061e6c3f4bd289cf59527ce8dc796db7d
```

## Required post-start checks

If C3 R2 is later approved and started, collect sanitized evidence:

- `limactl list` for the isolated `LIMA_HOME`;
- VM status;
- no host mounts in effective config;
- no port forwards in effective config except Lima internal SSH behavior;
- no production credentials or profile env;
- gateway unchanged;
- reclaim/stop command available.
