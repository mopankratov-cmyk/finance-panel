# Phase 1B-B0 Owner Approval Packet

Status: `OWNER_APPROVAL_REQUIRED`

This packet prepares the immutable installation approval input for a disposable
synthetic Apple Container experiment. It does not authorize installation by
itself; installation remains blocked until the owner separately issues the
exact approval command below through the trusted Human Gate.

Current Phase 1B-B0 status:

```text
ARTIFACT_PIN_REGISTRY_PINNED
INSTALLATION_MANIFEST_READY_FOR_OWNER_APPROVAL
```

## Approval command

Exact owner approval command:

```text
APPROVE_PRIMARY_BACKEND_INSTALL:p1b-20260722-artifactpinningb0:c37a6f727d935d1eeb746ebabe6c58a0b19eb32822c0c73561dbb5b0e34f68aa
```

Do not treat this packet as approval by itself.
Do not approve after the expiry below without repeating Phase 1B-B0 artifact
verification and receiving an independent B0 `PASS`.

## Immutable manifest

- Approval ID: `p1b-20260722-artifactpinningb0`
- Manifest: `docs/program/PHASE_1B_INSTALLATION_MANIFEST.ready.json`
- Manifest content SHA-256: `c37a6f727d935d1eeb746ebabe6c58a0b19eb32822c0c73561dbb5b0e34f68aa`
- Trust-anchor registry SHA-256: `44d3f97eb272524f4bc8d5ef0ae9c92c883553387889a0d5d0e4b7d476b7e82b`
- Artifact-pin registry status:
  `PINNED`
- Artifact-pin registry SHA-256:
  `ad894db48f6e27c33dede57ddc3c74e988e6a73b10008aba315b04f0e056d497`
- Evidence-pack manifest SHA-256:
  `5c776fc8032b6020e2ae7e5a7ebfc11b00f5a4ce8020227b44a26ab6f44b94f5`
- Created at: `2026-07-22T12:06:00Z`
- Expires at: `2026-07-25T12:06:00Z`
- TTL: `72h`

## Backend

- Backend: `apple-container-cli`
- Version: `1.1.0`
- Repository: `apple/container`
- Release tag: `1.1.0`
- Release commit: `5973b9cc626a3e7a499bb316a958237ebe14e2ed`
- Package URL:
  `https://github.com/apple/container/releases/download/1.1.0/container-1.1.0-installer-signed.pkg`
- Package SHA-256:
  `0ca1c42a2269c2557efb1d82b1b38ac553e6a3a3da1b1179c439bcee1e7d6714`
- Package identifier: `com.apple.container-installer`
- Package version: `1.1.0`
- Exact signer:
  `Developer ID Installer: Apple Inc. - Containerization (UPBK2H6LZM)`
- Team ID: `UPBK2H6LZM`
- Notarization result: `accepted`, source `Notarized Developer ID`

## Runtime artifacts

- Linux kernel artifact:
  - Source URL:
    `https://github.com/kata-containers/kata-containers/releases/download/3.28.0/kata-static-3.28.0-arm64.tar.zst`
  - Kernel binary path from Apple Container source:
    `opt/kata/share/kata-containers/vmlinux-6.18.15-186`
  - Version: `3.28.0+vmlinux-6.18.15-186`
  - SHA-256:
    `f63d54507d1f18635d94475077e4c2330de4d8e05cedf25f7c38f063b0e66a91`
  - Size: `596775193`
  - Inner kernel SHA-256:
    `2fe4a58d2885d623bcb4d705900ac8c1d4f02371152da8126b3b00c8c47fc3a1`
  - Inner kernel size: `16151040`

- Init filesystem artifact:
  - Image: `ghcr.io/apple/containerization/vminit:0.35.0`
  - Linux/arm64 manifest digest:
    `sha256:04cd14f8e6ec9617611429aaf2a91a841b27ff9eae847acaca48430f58c5e57d`
  - Layer digest:
    `sha256:e3b2b9d347c2e5834d9fe5b4d615f5c0632c485d785e64f5c6b4c9b179ac168f`
  - Manifest size: `409`

- Synthetic OCI image:
  - Image: `registry.k8s.io/pause:3.10`
  - Linux/arm64 digest:
    `sha256:e50b7059b633caf3c1449b8da680d11845cda4506b513ee7a2de00725f0a34a7`
  - Layer digest:
    `sha256:75e060e453aa927883755f715daa02fb335ea7f148a8ab249f779be796d4bb7e`
  - Manifest size: `501`

## Installation disclosures

- Disk changes:
  - Signed installer declares install-location `/usr/local`.
  - Signed package payload installs `/usr/local/bin/container`,
    `/usr/local/bin/container-apiserver`, update/uninstall scripts, and
    `/usr/local/libexec/container/plugins/**`.
  - Runtime may create Apple Container configuration/data/kernel/init/cache
    state only after a separately approved synthetic startup.

- Background services:
  - Package includes core plugin service configs under
    `/usr/local/libexec/container/plugins/**/config.toml`.
  - Service configs declare `loadAtBoot=true` and `runAtLoad=false`.
  - `container system start` would start container-apiserver and related core
    services; Phase 1B-B0 did not start them.

- Required permissions:
  - Package metadata declares `auth=root`.
  - Any future installation requires administrator authorization.
  - Phase 1B-B0 did not request administrator authorization.

- Network changes:
  - `NONE` for installation-time network configuration changes.
  - Runtime still uses network for OCI pulls and container networking if later
    approved and started.

## Rollback plan

Rollback plan hash:
`bf9d20be0aa5623ea817fd74d06762e69293047669c6a6c604a53b3e4f0f52d5`

If a future installation is approved, stop Apple Container services if running,
run the vendor uninstall script from `/usr/local/bin/uninstall-container.sh`,
remove `/usr/local/bin/container`, `/usr/local/bin/container-apiserver`,
`/usr/local/libexec/container`, and remove only synthetic runtime data created
by the experiment. Phase 1B-B0 itself performs no installation; rollback for B0
is deleting generated review artifacts if the owner rejects them.

## Known risks

- The Kata kernel archive has no independent Apple package signature; Phase B0
  pins its SHA-256, exact URL, expected kernel member path, inner kernel
  SHA-256, and inner kernel size.
- Archive inspection used an already present local zstd decoder from the Codex
  bundled runtime; no decoder was installed.
- GHCR and registry.k8s.io manifest pinning uses digest verification, not an
  authenticated registry login.
- Approval expires after 72 hours and must be regenerated if stale.

## Evidence

Sanitized evidence is under `security/evidence/phase-1b-b0/`.

No quarantine absolute path, cookies, authorization headers, credentials,
Keychain data, or full logs are included.
