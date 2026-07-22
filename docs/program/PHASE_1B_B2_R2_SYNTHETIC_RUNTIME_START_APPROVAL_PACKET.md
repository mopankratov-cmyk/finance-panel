# Phase 1B-B2-R2 Synthetic Runtime Start Approval Packet

Status: `APPROVED_PENDING_ADMIN_START`

B2-R1 failed closed with `RUNTIME_START_FAILED rc=1`. Read-only diagnostics
showed Apple Container CLI `system start` has an implicit kernel install policy
prompt by default:

```text
--enable-kernel-install/--disable-kernel-install
Specify whether the default kernel should be installed or not (default: prompt user)
```

B2-R2 removes that ambiguity. It authorizes only a non-interactive service
startup attempt with kernel install explicitly disabled:

```text
/usr/local/bin/container system start --disable-kernel-install --timeout 120
```

## Approval command

Exact owner approval command:

```text
APPROVE_SYNTHETIC_RUNTIME_START:p1b-20260722-syntheticruntimeb2r2:6df0398b0f1c0a78e37d23e8bd1b1d2a156e0d8c555b6f055c9366c2affe3769
```

Do not treat this packet as approval by itself.

Owner approval was received and bound into:
`docs/program/PHASE_1B_B2_R2_SYNTHETIC_RUNTIME_START_APPROVAL_RECORD.json`.

## Contract

- Contract:
  `docs/program/PHASE_1B_B2_R2_SYNTHETIC_RUNTIME_START_CONTRACT.ready.json`
- Approval ID: `p1b-20260722-syntheticruntimeb2r2`
- Contract content SHA-256: `6df0398b0f1c0a78e37d23e8bd1b1d2a156e0d8c555b6f055c9366c2affe3769`
- Approval record canonical SHA-256:
  `5a9bbf94393597a25b4fec2a75b4161e80fb2963c38f15af6dd81a22e09dba46`
- Synthetic only: `true`
- Kernel install: explicitly disabled
- Expires at: `2026-07-25T12:06:00Z`

## Explicitly denied

- no implicit kernel install prompt;
- no default kernel install;
- no `container run`;
- no workload `container create/start`;
- no OCI image pull/build/push/login;
- no production profiles;
- no real credentials;
- no Keychain credential creation;
- no gateway/default runtime change;
- no canary.
