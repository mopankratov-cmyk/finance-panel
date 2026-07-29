# Phase 1B-B3 Review Response 01

Status: `KERNEL_PROVISION_FAILED_VENDOR_BEHAVIOR_REVIEW_REQUIRED`

B2-R2 failed because Apple Container's apiserver did not become registered or
healthy. B3 prepares a separate local-artifact-only kernel provisioning gate.

## Completed gates

- Created
  `docs/program/PHASE_1B_B3_KERNEL_PROVISIONING_CONTRACT.ready.json`.
- Created
  `docs/program/PHASE_1B_B3_KERNEL_PROVISIONING_APPROVAL_PACKET.md`.
- Added fail-closed runner:
  `tools/phase_1b_b3_kernel_provision_runner.py`.
- Added runner tests:
  `tools/tests/test_phase_1b_b3_kernel_provision_runner.py`.
- Confirmed Apple Container CLI version:
  `container CLI version 1.1.0 (build: release, commit: 5973b9c)`.
- Confirmed B3 preflight result:
  `OWNER_APPROVAL_REQUIRED`.
- Received owner approval and created
  `docs/program/PHASE_1B_B3_KERNEL_PROVISIONING_APPROVAL_RECORD.json`.
- Checked `~/Downloads` and `~/Desktop`; the required local Kata archive was
  not present.
- Owner downloaded the required local Kata archive.
- Artifact-check passed: outer archive SHA/size and inner kernel SHA/size match
  the B3 contract.

## Contract summary

The only future provisioning action prepared by this gate is:

```text
/usr/local/bin/container system kernel set --arch arm64 --tar <verified-local-kata-archive> --binary opt/kata/share/kata-containers/vmlinux-6.18.15-186
```

The runner must first verify the local archive:

- archive SHA-256:
  `f63d54507d1f18635d94475077e4c2330de4d8e05cedf25f7c38f063b0e66a91`;
- archive size: `596775193`;
- inner kernel SHA-256:
  `2fe4a58d2885d623bcb4d705900ac8c1d4f02371152da8126b3b00c8c47fc3a1`;
- inner kernel size: `16151040`.

## Forbidden actions confirmation

Not performed:

- no kernel provisioning;
- no `container system kernel set --recommended`;
- no remote `--tar` URL;
- no network download by the runner;
- no `container system start`;
- no workload container start;
- no OCI pull/login/build;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary;
- no Keychain credential creation.

Approval command:

```text
APPROVE_SYNTHETIC_KERNEL_PROVISION:p1b-20260722-kernelprovisionb3:cce75c7117000907305e9cd125502c4631554fe20e9f00789715e03a8d88d3cd
```

Evidence:
`security/evidence/phase-1b-b3/pre-approval-summary.json`.

Post-approval evidence:
`security/evidence/phase-1b-b3/pre-provision-summary.json`.

Artifact-check evidence:
`security/evidence/phase-1b-b3/artifact-check-summary.json`.

## Kernel provisioning failure

The owner ran the approved B3 admin command. It failed closed:

```json
{
  "command_result": {
    "returncode": 1,
    "stderr": "Error: interrupted: \"XPC connection error: Connection invalid\"\nEnsure container system service has been started with `container system start`.",
    "stdout": ""
  },
  "mode": "execute-provision",
  "reason": "KERNEL_PROVISION_FAILED",
  "result": "DENIED"
}
```

Read-only checks after the failure showed:

- `container system status`:
  `apiserver is not running and not registered with launchd`;
- no `com.apple.container.apiserver` service in system or user launchd domains;
- no matching Apple Container runtime process.

This means B3's local-tar provisioning assumption was wrong: `container system
kernel set` also depends on the apiserver XPC service. The correct next state is
not another retry. A new B4 vendor-behavior/backend review gate is required to
decide whether to authorize `container system start --enable-kernel-install`,
use vendor-supported bootstrap flow, or abandon Apple Container CLI for the
fallback backend.

Failure evidence:
`security/evidence/phase-1b-b3/kernel-provision-failure-01.json`.
