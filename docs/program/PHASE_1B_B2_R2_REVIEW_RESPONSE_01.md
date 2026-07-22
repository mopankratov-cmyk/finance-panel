# Phase 1B-B2-R2 Review Response 01

Status: `START_FAILED_KERNEL_PROVISIONING_REQUIRED`

The owner approval command was received and matched the committed B2-R2
synthetic runtime-start contract:

```text
APPROVE_SYNTHETIC_RUNTIME_START:p1b-20260722-syntheticruntimeb2r2:6df0398b0f1c0a78e37d23e8bd1b1d2a156e0d8c555b6f055c9366c2affe3769
```

## Completed gates

- Created
  `docs/program/PHASE_1B_B2_R2_SYNTHETIC_RUNTIME_START_APPROVAL_RECORD.json`.
- Confirmed the R2 contract content hash:
  `6df0398b0f1c0a78e37d23e8bd1b1d2a156e0d8c555b6f055c9366c2affe3769`.
- Confirmed R2 binds the exact runtime command:
  `/usr/local/bin/container system start --disable-kernel-install --timeout 120`.
- Confirmed Apple Container CLI version:
  `container CLI version 1.1.0 (build: release, commit: 5973b9c)`.
- Confirmed current runtime status:
  `apiserver is not running and not registered with launchd`.

## Authorized next action

Only this action is authorized, and only from an administrator-authenticated
terminal:

```text
/usr/local/bin/container system start --disable-kernel-install --timeout 120
```

The prepared runner command is:

```bash
sudo /Library/Frameworks/Python.framework/Versions/3.14/bin/python3 \
  /Users/maksimpankratov/Projects/finance-panel/finance-panel-wt-phase-0-architecture-baseline/tools/phase_1b_b2_runtime_start_runner.py \
  --mode execute-start \
  --contract /Users/maksimpankratov/Projects/finance-panel/finance-panel-wt-phase-0-architecture-baseline/docs/program/PHASE_1B_B2_R2_SYNTHETIC_RUNTIME_START_CONTRACT.ready.json \
  --approval-record docs/program/PHASE_1B_B2_R2_SYNTHETIC_RUNTIME_START_APPROVAL_RECORD.json
```

## Forbidden actions confirmation

Not performed:

- no `container system start` by the agent;
- no workload container start;
- no OCI pull/login/build;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary;
- no Keychain credential creation.

Evidence:
`security/evidence/phase-1b-b2/r2-pre-start-summary.json`.

## Start failure

The owner ran the approved R2 admin command. It failed closed:

```json
{
  "command_result": {
    "returncode": 1,
    "stderr": "Launching container-apiserver...\nTesting access to container-apiserver...\nError: internalError: \"failed to get a response from apiserver: interrupted: \"XPC connection error: Connection invalid\"\"\nEnsure container system service has been started with `container system start`.",
    "stdout": ""
  },
  "mode": "execute-start",
  "reason": "RUNTIME_START_FAILED",
  "result": "DENIED"
}
```

Read-only checks after the failure showed:

- `container system status`:
  `apiserver is not running and not registered with launchd`;
- no `com.apple.container.apiserver` service in system or user launchd domains;
- no matching Apple Container runtime process;
- `container system kernel set --help` supports both `--recommended` download
  and `--tar <tar>` kernel provisioning flows.

R2 is therefore blocked. A retry would require a new B3 kernel provisioning
contract; B2-R2 does not authorize `--recommended`, local tar kernel install,
or another `container system start` retry.

Failure evidence:
`security/evidence/phase-1b-b2/r2-runtime-start-failure-01.json`.
