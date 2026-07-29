# Phase 1B-C16 Reclaim-Only Closeout Approval Packet

Status: `OWNER_APPROVAL_REQUIRED`

This packet prepares a reclaim-only closeout for the synthetic Lima-vz Phase 1B
instances. It does not approve profile runtime, real credentials, gateway
changes, canary, firewall changes, or any broad delete.

## Scope

Allowed targets only:

- `pc3` under `LIMA_HOME=/Users/maksimpankratov/.local/pankster/runtime/lc3`;
- `pc9r2` under `LIMA_HOME=/Users/maksimpankratov/.local/pankster/runtime/lc9r2`.

Allowed action after exact owner approval:

- collect before inventory for the exact targets;
- delete only those exact synthetic Lima instances using exact commands;
- collect after inventory;
- record sanitized closeout evidence.

## Still forbidden

- no wildcard deletes;
- no broad path deletes;
- no `rm -rf`;
- no default Lima home;
- no `pfctl`;
- no host firewall changes;
- no gateway/default runtime changes;
- no production profiles;
- no real credentials;
- no canary;
- no network probes;
- no reading auth files, Keychain, or environment values;
- no evidence deletion.

## Approval command

Return exactly:

```text
APPROVE_PHASE_1B_RECLAIM_ONLY_CLOSEOUT:p1b-20260722-reclaimonlyc16:315f08ddf8dd4220127b33e880074c49e012941bdc1365aad7db424a5daa473d
```

Approval command SHA-256:

```text
5817cdcdec8dd1664c4002cc3a3547e4804510130b907a9a9517141ce949f0ef
```

## Exact commands after approval

Before inventory for `pc3`:

```bash
env -i PATH=/Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin:/usr/bin:/bin HOME=/Users/maksimpankratov LANG=C LIMA_HOME=/Users/maksimpankratov/.local/pankster/runtime/lc3 /Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin/limactl list --format json pc3
```

Delete `pc3`:

```bash
env -i PATH=/Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin:/usr/bin:/bin HOME=/Users/maksimpankratov LANG=C LIMA_HOME=/Users/maksimpankratov/.local/pankster/runtime/lc3 /Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin/limactl delete --force pc3
```

After inventory for `lc3`:

```bash
env -i PATH=/Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin:/usr/bin:/bin HOME=/Users/maksimpankratov LANG=C LIMA_HOME=/Users/maksimpankratov/.local/pankster/runtime/lc3 /Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin/limactl list --format json
```

Before inventory for `pc9r2`:

```bash
env -i PATH=/Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin:/usr/bin:/bin HOME=/Users/maksimpankratov LANG=C LIMA_HOME=/Users/maksimpankratov/.local/pankster/runtime/lc9r2 /Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin/limactl list --format json pc9r2
```

Delete `pc9r2`:

```bash
env -i PATH=/Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin:/usr/bin:/bin HOME=/Users/maksimpankratov LANG=C LIMA_HOME=/Users/maksimpankratov/.local/pankster/runtime/lc9r2 /Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin/limactl delete --force pc9r2
```

After inventory for `lc9r2`:

```bash
env -i PATH=/Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin:/usr/bin:/bin HOME=/Users/maksimpankratov LANG=C LIMA_HOME=/Users/maksimpankratov/.local/pankster/runtime/lc9r2 /Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin/limactl list --format json
```

## Evidence handling

The execution result must record sanitized before/after inventory status,
return codes, and exact command hashes. Existing evidence packs must be
preserved. Do not paste secrets, auth files, Keychain output, or environment
values.
