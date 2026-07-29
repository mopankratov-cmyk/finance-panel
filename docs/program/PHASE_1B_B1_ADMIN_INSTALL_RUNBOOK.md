# Phase 1B-B1 Admin Install Handoff Runbook

Status: `BLOCKED_ADMIN_AUTHORIZATION_REQUIRED`

This runbook is the narrow owner/admin handoff for the Apple Container CLI
backend installer approved for Phase 1B-B1 synthetic isolation work.

## Scope

Allowed:

- validate the committed Phase 1B installation manifest;
- validate the synthetic-only owner approval record;
- validate the local Apple signed package by path, SHA-256, signer, Team ID, and
  macOS install assessment;
- run the signed package installer only from an administrator-authenticated
  terminal.

Forbidden:

- no package download by the runner;
- no `container system start`;
- no VM/container/runtime startup;
- no production profiles;
- no real credentials;
- no Keychain credential creation;
- no gateway/default-runtime changes.

## Approved artifact

- Package: `container-1.1.0-installer-signed.pkg`
- Expected SHA-256:
  `0ca1c42a2269c2557efb1d82b1b38ac553e6a3a3da1b1179c439bcee1e7d6714`
- Expected signer:
  `Developer ID Installer: Apple Inc. - Containerization (UPBK2H6LZM)`
- Expected Team ID: `UPBK2H6LZM`
- Manifest approval command:
  `APPROVE_PRIMARY_BACKEND_INSTALL:p1b-20260722-artifactpinningb0:c37a6f727d935d1eeb746ebabe6c58a0b19eb32822c0c73561dbb5b0e34f68aa`

## Operator steps

From this repository checkout:

```bash
python3 tools/phase_1b_b1_install_runner.py --mode preflight
```

Expected current non-admin state:

```text
BLOCKED_ADMIN_AUTHORIZATION_REQUIRED
```

After placing the approved package at a local path, validate it without
installing:

```bash
python3 tools/phase_1b_b1_install_runner.py \
  --mode package-check \
  --pkg /absolute/path/to/container-1.1.0-installer-signed.pkg
```

If and only if `package-check` returns `PASS`, print the exact admin command:

```bash
python3 tools/phase_1b_b1_install_runner.py \
  --mode print-admin-command \
  --pkg /absolute/path/to/container-1.1.0-installer-signed.pkg
```

Run the printed command manually from an administrator-authenticated terminal.
The command will still fail closed unless it is running as root and all gates
pass.

## Post-install boundary

Successful installer execution does not authorize runtime startup. After
install, Phase 1B-B1 remains limited to synthetic-only follow-up checks until a
separate approval explicitly authorizes any startup action.
