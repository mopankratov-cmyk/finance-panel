# Phase 1B-C1 Lima-vz Install Approval Packet

Status: `OWNER_APPROVAL_REQUIRED`

This packet is for fallback backend artifact installation only.

It does not approve:

- Lima runtime start;
- VM creation;
- guest image download;
- `limactl start`;
- production profiles;
- real credentials;
- gateway/default runtime changes;
- canary;
- Apple Container retry.

## Manifest

Manifest:
`docs/program/PHASE_1B_C1_LIMA_VZ_INSTALLATION_MANIFEST.ready.json`

Manifest content SHA-256:

```text
c06a8aa4c7738ccb1bdea97ebf60f0037a426d5ca0a00ac43bf7c730556be0d9
```

Approval ID:

```text
p1b-20260722-limavzc1
```

Owner approval command:

```text
APPROVE_FALLBACK_BACKEND_INSTALL:p1b-20260722-limavzc1:c06a8aa4c7738ccb1bdea97ebf60f0037a426d5ca0a00ac43bf7c730556be0d9
```

Owner command hash:

```text
274a0617ff2628509a490b98f579fe8dedf76b6dda3df1fe015d7fc77cdc9e88
```

## Scope

Approved action, if the owner later provides the exact approval command:

```text
Download and verify the pinned Lima v2.2.0 Darwin arm64 archive and extract it
to /Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0.
```

Package managers are out of scope. `/usr/local` is out of scope. Any PATH change
must be explicit and reversible.

## Pinned inputs

- `lima-2.2.0-Darwin-arm64.tar.gz`
  - SHA-256:
    `bbdef91774885a0d05f7b048c4eb89ae2bcf3a0c252ae7ca7934e63df76d93c3`
  - size: `37586365`
- `SHA256SUMS`
  - SHA-256:
    `7da5160ee9b22de8eec4222e581334ee6326881e20d5aa8eb29b22f897312a5f`
  - size: `1396`
- release-tagged template `ubuntu-24.04.yaml`
  - SHA-256:
    `abece69b9818b2b905d11bbeba84037dd6592d94fb3abdb58d01cb52c5e2f4e2`
  - size: `3403`
- future guest-image candidate:
  `ubuntu-24.04-minimal-cloudimg-arm64.img`
  - SHA-256:
    `7e938df669e3b1923595eeda97aa28569350c5283e05a835cc912a2486a54934`
  - size from HEAD: `227737600`

The guest image is pinned for reproducibility, but C1 install does not download
it. Guest image download belongs to a later runtime/materialization gate.

## Required operator checks before approval

- The owner understands this switches away from the paused Apple Container path.
- The owner accepts GitHub-release SHA-256 verification instead of Apple package
  notarization for Lima.
- The owner accepts user-local extraction under
  `/Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0`.
- The owner understands no VM will be started by this approval.

## Rollback

Rollback hash:

```text
411853bfb264f590b29109946206d6673e52e78b68914d5abde2f0bca82e3724
```

Rollback text:

```text
Remove /Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0 and remove any shell PATH reference added by the manual operator. Do not touch Apple Container, gateway, profiles, credentials, or repositories.
```

## Next gate after install

After installation, a separate C2 gate must materialize a Lima YAML and prove
static invariants before any runtime action:

- `vmType: "vz"`;
- architecture `aarch64`;
- no default writable home mount;
- no production repo mount;
- no host credential directory mount;
- no host runtime socket exposure;
- no auto-start;
- explicit port-forwarding policy;
- mutable Ubuntu fallback URLs removed.
