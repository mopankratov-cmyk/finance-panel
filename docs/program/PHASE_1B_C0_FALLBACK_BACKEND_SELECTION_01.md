# Phase 1B-C0 Fallback Backend Selection 01

Status: `FALLBACK_BACKEND_SELECTED_INSTALL_CONTRACT_NOT_READY`

B4 closed the Apple Container CLI primary-backend path for the current
local-only pinned-artifact bootstrap contract. C0 selects the next backend
candidate only. It does not approve installation, runtime start, VM creation,
network access, production profile execution, or real credential use.

## Decision

Selected fallback candidate:

```text
lima-vz
```

Reason:

- Apple Container CLI `1.1.0` could not be progressed without authorizing a
  broader vendor bootstrap flow.
- Lima supports a macOS `vz` backend that uses Apple's Virtualization.framework.
- Lima can be installed from a pinned release archive instead of a system package
  manager.
- The fallback can be modeled as a VM-first isolation backend with a pinned guest
  image before any synthetic workload is allowed.

## Current authoritative release observation

Observed on: `2026-07-22T14:45:10Z`

- Lima latest release: `v2.2.0`
- Published: `2026-07-21T15:05:43Z`
- Backend installer artifact:
  `lima-2.2.0-Darwin-arm64.tar.gz`
- Installer artifact SHA-256:
  `bbdef91774885a0d05f7b048c4eb89ae2bcf3a0c252ae7ca7934e63df76d93c3`
- Installer artifact size:
  `37586365`
- SHA256SUMS artifact SHA-256:
  `7da5160ee9b22de8eec4222e581334ee6326881e20d5aa8eb29b22f897312a5f`

Prior Phase 1B docs referenced Lima `v2.1.1` as a fallback observation. That
observation is now stale and must not be used for approval.

## Candidate guest image

Preferred image candidate:

```text
Ubuntu 24.04 minimal cloud image, arm64/aarch64
```

Pinned source:

```text
https://cloud-images.ubuntu.com/minimal/releases/noble/release-20260716/ubuntu-24.04-minimal-cloudimg-arm64.img
```

Pinned digest:

```text
sha256:7e938df669e3b1923595eeda97aa28569350c5283e05a835cc912a2486a54934
```

Reason:

- minimal image reduces preinstalled guest surface for the first synthetic VM
  gate;
- image URL includes a date-specific release directory;
- digest is present in Lima's release-tagged Ubuntu 24.04 template.

Alternative image retained for later review only:

```text
Ubuntu 24.04 server cloud image, arm64/aarch64
sha256:7df0201546f75b8bcc1044594c806c35749421ad3c9bc1be2a3ab806cfae39cc
```

The server image is not selected for C0 because the first Lima gate should prove
VM isolation before adding containerd-oriented guest surface.

## Template policy

Allowed template source:

```text
https://raw.githubusercontent.com/lima-vm/lima/v2.2.0/templates/_images/ubuntu-24.04.yaml
```

Observed template SHA-256:

```text
abece69b9818b2b905d11bbeba84037dd6592d94fb3abdb58d01cb52c5e2f4e2
```

C1 must not consume mutable Lima template sources such as `master`, `main`, or
floating `release/` image URLs. If the selected template contains mutable image
fallbacks, the C1 materialized config must remove them or the gate must fail
closed.

Required static config invariants for the next gate:

- `vmType: "vz"`;
- native guest architecture only: `aarch64`;
- no writable default home-directory mount;
- no production repository mount;
- no host credential directory mount;
- no Docker/containerd socket exposure from host to guest;
- minimal explicit synthetic workspace mount only;
- explicit decision on port forwarding before any VM start;
- no automatic startup at login;
- no profile or gateway integration.

## Disallowed for C0

Not approved:

- Lima download by the agent;
- Lima installation;
- Homebrew/MacPorts/Nix dependency operation;
- VM creation or `limactl start`;
- guest image download;
- additional guest agent download;
- OCI pull/login/build;
- production profile start;
- real credential use;
- gateway/default runtime changes;
- canary;
- Apple Container retry.

## Next gate required

Before any Lima installation or runtime action, create a separate C1 approval
contract that includes:

1. a Lima-specific installation manifest schema or policy extension;
2. pinned installer archive hash and size;
3. pinned SHA256SUMS hash;
4. pinned guest-image URL and digest;
5. release-tagged template hash;
6. materialized Lima YAML with mutable fallbacks removed;
7. disclosure of disk paths, launch/background behavior, network behavior,
   socket behavior, mounts, and rollback;
8. package-manager bypass confirmation;
9. a validator that rejects unknown, stale, mutable, or unsigned inputs;
10. a separate owner approval phrase.

## Sources

- Lima releases: `https://github.com/lima-vm/lima/releases`
- Lima installation docs: `https://lima-vm.io/docs/installation/`
- Lima VZ docs: `https://lima-vm.io/docs/config/vmtype/vz/`
- Lima VM type docs: `https://lima-vm.io/docs/config/vmtype/`
- Release-tagged Ubuntu template:
  `https://github.com/lima-vm/lima/blob/v2.2.0/templates/_images/ubuntu-24.04.yaml`

## Recommendation

Proceed to C1 as:

```text
PREPARE_LIMA_VZ_INSTALL_APPROVAL_CONTRACT
```

Do not install or start Lima until C1 is reviewed and explicitly approved.
