# Phase 1B-B1 Review Response 01

Status: `INSTALLER_EXECUTED_RUNTIME_NOT_STARTED`

The owner approval command was received and bound into a synthetic-only approval
record:

```text
APPROVE_PRIMARY_BACKEND_INSTALL:p1b-20260722-artifactpinningb0:c37a6f727d935d1eeb746ebabe6c58a0b19eb32822c0c73561dbb5b0e34f68aa
```

## Pre-install completed gates

- Created `docs/program/PHASE_1B_B1_SYNTHETIC_APPROVAL_RECORD.json`.
- Validated the immutable installation manifest in `synthetic-install` mode:
  `PASS`.
- Confirmed `production-install` remains denied:
  `BLOCKED_AUTHENTICATION_BACKEND_PENDING`.
- Initially confirmed Apple Container CLI was not installed at
  `/usr/local/bin/container`.
- Initially confirmed the signed installer was not executed.
- Confirmed `container system start` was not executed before install.

## Initial blocker

The current process is not root and non-interactive sudo is unavailable:

```text
current uid: 501
sudo -n true: password required
```

The Apple Container signed package declares `auth=root`; executing the install
requires macOS administrator authorization. This cannot be bypassed by the
agent and should not be simulated with an arbitrary local JSON record.

## Admin install result

The owner executed the printed admin command manually from an
administrator-authenticated terminal. The runner reported:

```json
{
  "container_system_start_executed": false,
  "installer_returncode": 0,
  "mode": "execute-install",
  "package_sha256": "0ca1c42a2269c2557efb1d82b1b38ac553e6a3a3da1b1179c439bcee1e7d6714",
  "production_install_state": "BLOCKED_AUTHENTICATION_BACKEND_PENDING",
  "production_profiles_allowed": false,
  "real_credentials_allowed": false,
  "result": "PASS",
  "synthetic_gate": "PASS"
}
```

Post-install read-only checks recorded:

- package receipt `com.apple.container-installer`, version `1.1.0`;
- `/usr/local/bin/container` exists and reports
  `container CLI version 1.1.0 (build: release, commit: 5973b9c)`;
- `/usr/local/bin/uninstall-container.sh` exists;
- no matching `container-apiserver`, `/usr/local/libexec/container`, or
  `container system start` process was observed.

Evidence:
`security/evidence/phase-1b-b1/post-install-summary.json`.

## Required next action

Do not start Apple Container yet. Runtime startup requires a separate synthetic
runtime-start approval gate.

The narrow handoff is documented in
`docs/program/PHASE_1B_B1_ADMIN_INSTALL_RUNBOOK.md`. The companion runner
`tools/phase_1b_b1_install_runner.py` is fail-closed: it validates the committed
manifest, synthetic-only approval record, package SHA-256, Apple package signer,
Team ID, and macOS install assessment before any installer execution. It does
not download packages, start Apple Container, start VMs/containers, create
credentials, or enable production profiles.

After installer execution, the correct state is:

```text
INSTALLER_EXECUTED_RUNTIME_NOT_STARTED
```

## Forbidden actions confirmation

Not performed:

- no installer execution by the agent;
- no `sudo` password prompt handling by the agent;
- no Apple Container startup;
- no VM/container startup;
- no `container system start`;
- no launchd/firewall changes;
- no Keychain credential creation;
- no production credentials;
- no production profile work.
