# Phase 1B-B3 Kernel Provisioning Approval Packet

Status: `APPROVED_PENDING_LOCAL_ARTIFACT`

B2-R2 proved that Apple Container services do not become healthy without an
additional kernel provisioning step. B3 prepares a local-artifact-only kernel
provisioning gate.

## Approval command

Exact owner approval command:

```text
APPROVE_SYNTHETIC_KERNEL_PROVISION:p1b-20260722-kernelprovisionb3:cce75c7117000907305e9cd125502c4631554fe20e9f00789715e03a8d88d3cd
```

Do not treat this packet as approval by itself.

Owner approval was received and bound into:
`docs/program/PHASE_1B_B3_KERNEL_PROVISIONING_APPROVAL_RECORD.json`.

## Contract

- Contract:
  `docs/program/PHASE_1B_B3_KERNEL_PROVISIONING_CONTRACT.ready.json`
- Approval ID: `p1b-20260722-kernelprovisionb3`
- Contract content SHA-256: `cce75c7117000907305e9cd125502c4631554fe20e9f00789715e03a8d88d3cd`
- Approval record canonical SHA-256:
  `61832977d318d933ef407e2033f734e2728b322043c93118c92a595f7c5467a7`
- Synthetic only: `true`
- Runtime start after provisioning: not authorized
- Expires at: `2026-07-25T12:06:00Z`

## Required local artifact

- File name: `kata-static-3.28.0-arm64.tar.zst`
- Expected archive SHA-256:
  `f63d54507d1f18635d94475077e4c2330de4d8e05cedf25f7c38f063b0e66a91`
- Expected archive size: `596775193`
- Expected kernel member:
  `opt/kata/share/kata-containers/vmlinux-6.18.15-186`
- Expected inner kernel SHA-256:
  `2fe4a58d2885d623bcb4d705900ac8c1d4f02371152da8126b3b00c8c47fc3a1`
- Expected inner kernel size: `16151040`

## Authorized action

Only after local artifact validation:

```text
/usr/local/bin/container system kernel set --arch arm64 --tar <verified-local-kata-archive> --binary opt/kata/share/kata-containers/vmlinux-6.18.15-186
```

## Explicitly denied

- no `container system kernel set --recommended`;
- no remote URL passed to `--tar`;
- no network download by the runner;
- no `container system start`;
- no workload containers;
- no OCI pull/login/build;
- no production profiles;
- no real credentials;
- no gateway/canary;
- no Keychain credential creation.
