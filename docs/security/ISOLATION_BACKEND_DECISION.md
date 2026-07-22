# Phase 1B-A Isolation Backend Decision

Status: `PRIMARY_EXPERIMENT_CANDIDATE_SELECTED + DISPOSABLE_PROTOTYPE_PLAN_READY + SYNTHETIC_INSTALL_APPROVAL_CONTRACT_READY + PRODUCTION_INSTALL_AUTHORIZATION_BLOCKED + APPROVAL_AUTHENTICATION_BACKEND_PENDING + OWNER_APPROVAL_MANIFEST_NOT_READY`

This document selects a candidate architecture for the next disposable
prototype phase. It does not install software, start a VM/container, modify
Hermes core, access credentials, or claim production isolation.

## Host inventory

Collected with read-only commands on 2026-07-22.

| Item | Value |
| --- | --- |
| macOS | 26.5.2, build 25F84 |
| Architecture | arm64 |
| `container` | not found |
| `limactl` / `lima` | not found |
| `colima` | not found |
| `docker` | not found |
| `podman` | not found |
| `qemu-*` | not found |
| `sandbox-exec` | `/usr/bin/sandbox-exec` |

`sandbox-exec` remains defense-in-depth only. It is not selected as a primary
production boundary because Phase 1A did not prove separate identity,
credential, network and filesystem isolation.

## Recommendation

Primary experiment candidate: Apple Container CLI / Apple Containerization stack.

Fallback experiment candidate: Lima with `vmType: vz`, configured as a
disposable profile VM with explicit mounts and no host-home writable default.
Lima is `APPROVAL_CONTRACT_NOT_READY` for installation manifests until a
separate guest-image, Lima template and synthetic OCI supply-chain contract is
designed.

Decision confidence: medium. The current host is Apple Silicon and macOS 26,
which matches the documented Apple Containerization requirements. However,
neither backend is installed and no isolation experiment has run yet, so all
security-boundary claims remain `EXPERIMENT_REQUIRED` until Phase 1B-B.

Production isolation ready: NO. Production backend approval: NO.
Owner approval manifest ready: NO. The Apple Container 1.1.0 release
trust-anchor entry exists only as `DRAFT` because exact installer signer
identity and Team ID have not been independently verified.

## Why Apple Container CLI is primary

Apple's container project is designed for Linux containers as lightweight VMs on
Mac and is optimized for Apple Silicon. The Containerization package states that
each Linux container executes inside its own lightweight VM and uses
Virtualization.framework on Apple Silicon. That architecture avoids a shared
host Docker socket as the default control plane and aligns with PANKSTER's need
for disposable per-profile runtimes.

The risk is maturity and operational unknowns: installation, network control,
volume semantics, lifecycle cleanup, logging, and credential delivery must all
be proven in synthetic experiments before production use.

## Why Lima VZ is fallback

Lima is a mature VM manager for macOS. Its docs state that `vz` uses Apple's
Virtualization.framework and is the default on modern macOS hosts. Lima also has
explicit mount configuration and documented read-only access to host files by
default. The tradeoff is that Lima is a VM substrate, not a complete profile
security product: PANKSTER must still design process identity, credential
injection, network enforcement and cleanup on top.

## Candidate assessment

Legend:

- `DOCUMENTED`: stated by official docs/source.
- `SOURCE_CODE_CONFIRMED`: confirmed by a repository tag/commit, file, line range and verified behavior.
- `EXPERIMENT_REQUIRED`: plausible but must be verified locally in Phase 1B-B.
- `UNVERIFIED`: no sufficient basis yet.

| Candidate | Decision | Security boundary summary | Claim status |
| --- | --- | --- | --- |
| Apple Container CLI / stack | PRIMARY_EXPERIMENT_CANDIDATE | Per-container lightweight VM architecture; OCI images; Apple Silicon/macOS 26 fit; requires install and experiments for mounts/network/secrets. | DOCUMENTED + EXPERIMENT_REQUIRED |
| Lima VZ | FALLBACK_EXPERIMENT_CANDIDATE + APPROVAL_CONTRACT_NOT_READY | General Linux VM with Virtualization.framework; configurable mounts; stronger isolation than same-UID host processes; network policy must be proven; installation approval is fail-closed pending guest-image/template supply-chain design. | DOCUMENTED + EXPERIMENT_REQUIRED |
| Colima | NOT_PRIMARY | Useful wrapper around Lima/container runtimes, but adds Docker-compatible daemon/socket surface and less direct control than Lima. | DOCUMENTED + EXPERIMENT_REQUIRED |
| Docker Desktop + ECI | ALTERNATE_ENTERPRISE_OPTION | ECI has strong documented user namespace, namespace blocking, protected mounts and socket controls, but requires Docker Desktop Business/Admin settings and introduces Docker daemon governance. | DOCUMENTED + EXPERIMENT_REQUIRED |
| Podman Machine | NOT_PRIMARY | Rootless machine management and VM-backed containers on macOS are documented; default Docker API compatibility and VM lifecycle need experiments. | DOCUMENTED + EXPERIMENT_REQUIRED |
| Separate macOS users + ACL + launchd | REJECT_AS_PRIMARY | Can improve host file permissions but lacks separate root filesystem/network boundary by itself and requires owner-approved user/launchd changes. | PARTIAL + UNVERIFIED |
| Full lightweight VM | VIABLE_BUT_HEAVIER | Strong conceptual boundary with dedicated guest; operationally heavier than Apple Container/Lima and still needs network/secret design. | EXPERIMENT_REQUIRED |
| VM/container + separate process identity | TARGET_PATTERN | Best long-term pattern: VM/container boundary plus non-root guest UID and task-scoped credentials. | EXPERIMENT_REQUIRED |

## Weighted score matrix

Weights: security boundary 30%, credential isolation 20%, network enforcement
15%, operational reliability 10%, Apple Silicon compatibility 10%, headless
automation 5%, performance 5%, maintenance complexity 5%.

Scores are 0..5. Weighted scores are arithmetic only and are validated by
`tools/validate_backend_matrix.py` against
`docs/security/isolation_backend_matrix.json`. Eligibility constraints are
separate from weighted score. Any score above 2 implies a concrete Phase 1B-B
experiment is defined, not that the capability is already proven.

| Backend | Security 30 | Creds 20 | Network 15 | Ops 10 | Apple 10 | Headless 5 | Perf 5 | Maint 5 | Weighted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Apple Container CLI | 4 | 3 | 2 | 2 | 5 | 3 | 4 | 2 | 3.25 |
| Lima VZ | 3 | 3 | 2 | 3 | 5 | 4 | 3 | 3 | 3.10 |
| Docker Desktop + ECI | 4 | 3 | 3 | 3 | 4 | 3 | 3 | 2 | 3.35 |
| Colima | 3 | 2 | 2 | 3 | 4 | 4 | 3 | 3 | 2.80 |
| Podman Machine | 3 | 3 | 2 | 3 | 4 | 3 | 3 | 3 | 2.95 |
| macOS users + ACL | 1 | 2 | 0 | 3 | 5 | 3 | 5 | 2 | 2.00 |
| Full lightweight VM | 4 | 3 | 3 | 2 | 4 | 3 | 2 | 2 | 3.20 |
| Combined VM/container + process identity | 4 | 4 | 3 | 2 | 4 | 3 | 3 | 2 | 3.45 |

Selection note: Docker Desktop + ECI and the combined target pattern score
higher than Apple Container. They are not selected for the first experiment
because eligibility constraints matter separately from weighted score. Docker
ECI requires Docker Business, administrator governance, sign-in/organization
dependency, a heavier Docker Desktop control plane, and higher licensing and
operational burden. The combined VM/container pattern is an architecture target,
not a directly installable backend. Apple Container is selected first because it
is the most direct Apple Silicon/macOS 26 experiment path for a disposable
per-profile runtime, while still requiring approval and synthetic proof.

## Eligibility constraints

| Backend | Constraints |
| --- | --- |
| Apple Container CLI | Must prove no automatic host home sharing, no `container machine`, no `--ssh`, no SSH agent mount, no runtime/XPC socket mount, pinned installer/kernel/init filesystem/image digest, and network-disabled preflight. |
| Lima VZ | Must prove mount/network policy, disable automatic writable home sharing, pin guest image checksum, and avoid runtime socket exposure. |
| Docker Desktop + ECI | Docker Business required; administrator governance; sign-in/organization dependency; heavier control plane; higher licensing and operational burden. |
| Colima | Wrapper indirection; Docker-compatible socket governance; network enforcement unproven. |
| Podman Machine | Machine lifecycle and socket exposure must be proven; network enforcement unproven. |
| macOS users + ACL | No separate root filesystem or network boundary without additional controls; requires owner-approved users/launchd. |
| Full lightweight VM | Heavier lifecycle; guest image and network policy must be built and proven. |
| Combined VM/container | Target pattern rather than installable product; requires backend-specific implementation after experiments. |

## Prohibited Apple Container integrations

The first Apple Container experiment may use only disposable `container
create/run` style flows with explicit configuration.

| Integration | Policy |
| --- | --- |
| `container machine` | PROHIBITED |
| `container run --ssh` | PROHIBITED |
| `SSH_AUTH_SOCK` mount | PROHIBITED |
| automatic host home sharing | PROHIBITED |
| host user mapping | PROHIBITED |
| host runtime/XPC socket mount | PROHIBITED |
| container debug mode in credential tests | PROHIBITED |
| floating OCI tags | PROHIBITED |

## Security capability comparison

| Capability | Apple Container | Lima VZ | Colima | Docker ECI | Podman Machine | macOS users | Full VM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Separate root filesystem | likely | yes | yes via Lima | yes | yes | no | yes |
| Read-only mounts | experiment | documented for Lima default home access | via Lima/container runtime | documented with ECI protections | experiment | ACL only | yes |
| Writable profile workspace only | experiment | configurable | configurable | configurable | configurable | partial | configurable |
| No root `~/.hermes` mount | design-required | design-required | design-required | design-required | design-required | ACL-required | design-required |
| Separate UID/identity | guest UID required | guest UID required | guest UID required | documented user namespace under ECI | rootless VM documented | host users only | guest UID required |
| No runtime socket exposure | design-required | design-required | harder with Docker socket compatibility | configurable ECI socket controls | design-required | n/a | design-required |
| Network restriction | unproven | unproven | unproven | partially documented via Desktop controls | unproven | host firewall required | possible |
| Resource limits | expected | configurable | documented CPU/memory/disk | Docker limits | Podman machine/container limits | host tools only | configurable |
| Headless lifecycle | experiment | documented CLI | documented CLI | possible but app/service-heavy | documented CLI | launchd-heavy | VM-manager-dependent |

## Decision gates for Phase 1B-B

The primary candidate may advance only if disposable synthetic experiments prove:

1. no host home, root `~/.hermes`, profile B data, gateway env, runtime socket or unrestricted loopback access;
2. writable access is limited to profile task workspace, temp and artifact bridge;
3. credentials are delivered by a task-scoped mechanism and disappear after completion;
4. network modes `NETWORK_DISABLED`, `LOOPBACK_ONLY` and `RESTRICTED_EGRESS` fail closed;
5. retry/reclaim preserves the same security policy hash;
6. teardown leaves no authoritative runtime or credential residue.

## Sources

Version claims are separated into `CURRENTLY_OBSERVED` and
`PINNED_FOR_APPROVAL`. `CURRENTLY_OBSERVED` never authorizes installation.

| Project | Release/tag | Published date | Commit | Asset | Asset SHA-256 | Retrieved at | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Apple Container CLI | 1.1.0 | UNVERIFIED | UNVERIFIED | container-1.1.0.pkg trust anchor DRAFT; signer identity and Team ID TO_BE_PINNED | UNVERIFIED | 2026-07-22 | CURRENTLY_OBSERVED + OWNER_APPROVAL_MANIFEST_NOT_READY |
| Apple Containerization dependency | Containerization 0.35.0 as declared by Apple Container 1.1.0 release | UNVERIFIED | UNVERIFIED | n/a | n/a | 2026-07-22 | CURRENTLY_OBSERVED |
| Apple Containerization latest release | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | 2026-07-22 | UNVERIFIED |
| Lima | v2.1.1 | UNVERIFIED | 3f73aec | lima-2.1.1-Darwin-arm64.tar.gz | b6b0e6701189cd8c4e549cc39e6d054dc681487798b9b774ad2cbd30c08b2bd8 | 2026-07-22 | CURRENTLY_OBSERVED |

Additional documentation sources:

| Source | Retrieved at | Claim supported | Status |
| --- | --- | --- | --- |
| https://github.com/apple/container, release page observed 1.1.0 | 2026-07-22 | Apple `container` is for Linux containers as lightweight VMs on Mac, optimized for Apple Silicon and OCI-compatible; install requires signed package and admin password. Apple Container 1.1.0 release declares an update to Containerization 0.35.0. | DOCUMENTED |
| https://opensource.apple.com/projects/container/ | 2026-07-22 | Apple Container uses Containerization to run a lightweight VM for each container. | DOCUMENTED |
| https://developer.apple.com/videos/play/wwdc2025/346/ | 2026-07-22 | Apple presents Containerization as open source Linux container support on Mac. | DOCUMENTED |
| https://lima-vm.io/docs/config/vmtype/vz/, page last modified 2026-02-20 | 2026-07-22 | Lima `vz` uses macOS Virtualization.framework and is default since Lima 1.0 on suitable macOS. | DOCUMENTED |
| https://github.com/lima-vm/lima/releases, v2.1.1 release observed | 2026-07-22 | Lima Darwin arm64 release archive and SHA-256 are available for future approval manifest pinning after re-verification. | DOCUMENTED |
| https://lima-vm.io/docs/examples/ | 2026-07-22 | Lima default access to the host home directory is read-only and writable access requires explicit config. | DOCUMENTED |
| https://github.com/abiosoft/colima | 2026-07-22 | Colima provides container runtimes on macOS using Lima and supports resource customization. | DOCUMENTED |
| https://podman.io/docs/installation | 2026-07-22 | Podman on Mac uses a guest Linux system/Podman machine and remote communication to service in VM. | DOCUMENTED |
| https://docs.podman.io/en/stable/markdown/podman-machine-start.1.html | 2026-07-22 | `podman machine start` starts a Linux VM; machine commands are rootless. | DOCUMENTED |
| https://docs.docker.com/enterprise/security/hardened-desktop/enhanced-container-isolation/ | 2026-07-22 | Docker ECI uses user namespaces, blocks host namespace sharing and protects sensitive mounts. | DOCUMENTED |
| https://docs.docker.com/enterprise/security/hardened-desktop/enhanced-container-isolation/config/ | 2026-07-22 | Docker ECI blocks Docker socket mounts by default and has socket exception controls. | DOCUMENTED |
| https://docs.docker.com/enterprise/security/hardened-desktop/enhanced-container-isolation/limitations/ | 2026-07-22 | Docker ECI has documented limitations and variable protection depending on backend/version. | DOCUMENTED |

Lima release metadata:

```yaml
version: v2.1.1
asset: lima-2.1.1-Darwin-arm64.tar.gz
sha256: b6b0e6701189cd8c4e549cc39e6d054dc681487798b9b774ad2cbd30c08b2bd8
size: 35.5 MB
release_commit: 3f73aec
observed_latest_at: 2026-07-22
must_reverify_before_approval: true
```
