# Phase 1B-B2 Synthetic Runtime Start Approval Packet

Status: `APPROVED_PENDING_ADMIN_START`

This packet prepares a separate approval for the first synthetic Apple Container
runtime service startup after Phase 1B-B1 installation. It does not authorize
workload containers, image pulls, production profiles, real credentials, gateway
changes, or canaries.

## Approval command

Exact owner approval command:

```text
APPROVE_SYNTHETIC_RUNTIME_START:p1b-20260722-syntheticruntimeb2:33e69d32cc068007d5de497665b9ef3671228033763d30836bf9298908aa5665
```

Do not treat this packet as approval by itself.

Owner approval was received and bound into:
`docs/program/PHASE_1B_B2_SYNTHETIC_RUNTIME_START_APPROVAL_RECORD.json`.

## Contract

- Contract:
  `docs/program/PHASE_1B_B2_SYNTHETIC_RUNTIME_START_CONTRACT.ready.json`
- Approval ID: `p1b-20260722-syntheticruntimeb2`
- Contract content SHA-256: `33e69d32cc068007d5de497665b9ef3671228033763d30836bf9298908aa5665`
- Approval record SHA-256:
  `43c654be9fb9f30b95d256f20f6f27cce8be2d7cf9f39ac671f8ba2d0b4ee3e4`
- Synthetic only: `true`
- Expires at: `2026-07-25T12:06:00Z`

## Allowed action

Only the following startup action is in scope:

```text
/usr/local/bin/container system start
```

Read-only follow-up checks are allowed:

- `/usr/local/bin/container system status`;
- `/usr/local/bin/container system version`;
- `/usr/local/bin/container --version`;
- process scan for Apple Container runtime services.

## Explicitly denied

- no `container run`;
- no workload `container create/start`;
- no OCI image pull/build/push/login;
- no production profiles;
- no real credentials;
- no Keychain credential creation;
- no gateway/default runtime change;
- no canary;
- no dependency changes;
- no database migrations.

## Required result state

After a successful B2 startup, the expected state is:

```text
SYNTHETIC_RUNTIME_SERVICES_STARTED_NO_WORKLOAD
```

Any workload or credential action requires a later, separate approval gate.
