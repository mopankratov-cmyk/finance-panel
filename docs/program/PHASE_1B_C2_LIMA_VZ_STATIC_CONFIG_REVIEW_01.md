# Phase 1B-C2 Lima-vz Static Config Review 01

Status: `STATIC_CONFIG_READY_RUNTIME_NOT_APPROVED`

C2 materializes and validates a Lima-vz synthetic VM config only. It does not
start Lima, create a VM, download the guest image, start a workload, touch
profiles, touch credentials, or change gateway.

## Config

Config:

```text
docs/program/PHASE_1B_C2_LIMA_VZ_SYNTHETIC_VM_CONFIG.yaml
```

Config SHA-256:

```text
ec4ee37801c5168f3522dbd58ab729e565918c684c415265d3079eb7a3a74008
```

## Validated invariants

- `vmType: "vz"`;
- `arch: "aarch64"`;
- exactly one pinned Ubuntu 24.04 minimal arm64 image;
- image URL uses date-specific `release-20260716`;
- image digest:
  `sha256:7e938df669e3b1923595eeda97aa28569350c5283e05a835cc912a2486a54934`;
- `mounts: []`;
- `additionalDisks: []`;
- `containerd.system: false`;
- `containerd.user: false`;
- `ssh.forwardAgent: false`;
- `ssh.loadDotSSHPubKeys: false`;
- `portForwards: []`;
- `networks: []`;
- `propagateProxyEnv: false`;
- `hostResolver.enabled: false`;
- `env: {}`;
- `param: {}`;
- `provision: []`;
- `upgradePackages: false`.

## Explicit non-goals

Not performed:

- no `limactl start`;
- no `limactl create`;
- no guest image download;
- no VM creation;
- no runtime healthcheck;
- no workload execution;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary.

## Residual blocker before C3

Lima default guest egress/NAT behavior is not yet proven to be blocked by
`networks: []`. The C2 config forbids explicit networks and host port forwards,
but that is not the same as a proven no-egress runtime policy.

Before any C3 runtime-start approval, add an explicit network-risk decision:

1. accept default Lima NAT/egress for synthetic-only boot, or
2. design a stronger network containment path, or
3. pause Lima runtime start until network isolation can be proven.

## Evidence

Evidence:

```text
security/evidence/phase-1b-c2/static-config-validation.json
```

Test command:

```text
python3 -m unittest discover -s tools/tests -p 'test_*.py'
```

Result:

```text
185 tests OK
```
