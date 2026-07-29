# Phase 1B-A Isolation Threat Model

Scope: disposable synthetic prototype design for Hermes profile workers and
reviewers. This is not a production claim.

Legend: `prevented`, `partially_mitigated`, `not_prevented`,
`requires_experiment`.

## Threat summary by selected architecture

Target architecture: Apple Container CLI primary; Lima VZ fallback; both with
non-root guest UID, no host home mount, task-scoped credential grants, explicit
mounts, no runtime socket exposure, and fail-closed network policy.

| Threat | Target result | Rationale / required experiment |
| --- | --- | --- |
| TH-01 Worker reads root auth.json | requires_experiment | Must prove root `~/.hermes` and host home are not mounted. |
| TH-02 Worker reads secrets of another profile | requires_experiment | Must prove only current profile synthetic grant is visible. |
| TH-03 Worker inherits gateway environment | requires_experiment | Prototype control available: true. Live control active: false. Phase 1B-B must prove runtime launch honors Phase 1A env policy. |
| TH-04 Worker accesses host loopback service | requires_experiment | macOS VM/container loopback semantics must be tested. |
| TH-05 Worker gets unrestricted internet egress | requires_experiment | Needs disabled/proxy/allowlist enforcement proof. |
| TH-06 Worker modifies immutable artifact | requires_experiment | Must prove artifact mount is read-only and cannot be remounted. |
| TH-07 Reviewer modifies worker workspace | requires_experiment | Reviewer must receive read-only snapshot in separate runtime. |
| TH-08 Worker gets runtime socket | requires_experiment | Must prove Docker/Podman/container/Lima control socket is absent. |
| TH-09 Child process exits workspace | requires_experiment | Prototype control available: true. Live control active: false. Mount boundary and child process behavior must be proven. |
| TH-10 Retry starts with different security policy | requires_experiment | Prototype control available: true. Live control active: false. Runtime security context hash must be proven through retry/reclaim. |
| TH-11 Orphan runtime after crash | requires_experiment | Needs crash/reclaim cleanup test. |
| TH-12 Credential persists after completion | requires_experiment | Depends on selected delivery primitive. |
| TH-13 Profile A reads TMPDIR Profile B | requires_experiment | Prototype control available: true. Live control active: false. OS mount/UID isolation proof pending. |
| TH-14 Root process inside guest gets host authority | requires_experiment | VM boundary likely helps, but host mounts/sockets must be absent. |
| TH-15 Malicious repository attacks mount boundary | requires_experiment | Must test symlinks, hardlinks, bind mounts and read-only artifact behavior. |

## Backend-level threat disposition

| Threat | Apple Container | Lima VZ | Colima | Docker ECI | Podman Machine | macOS users | Full VM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TH-01 | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | partially_mitigated | requires_experiment |
| TH-02 | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | partially_mitigated | requires_experiment |
| TH-03 | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment |
| TH-04 | requires_experiment | requires_experiment | requires_experiment | partially_mitigated | requires_experiment | not_prevented | requires_experiment |
| TH-05 | requires_experiment | requires_experiment | requires_experiment | partially_mitigated | requires_experiment | not_prevented | requires_experiment |
| TH-06 | requires_experiment | requires_experiment | requires_experiment | partially_mitigated | requires_experiment | partially_mitigated | requires_experiment |
| TH-07 | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | partially_mitigated | requires_experiment |
| TH-08 | requires_experiment | requires_experiment | requires_experiment | partially_mitigated | requires_experiment | not_prevented | requires_experiment |
| TH-09 | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment |
| TH-10 | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment |
| TH-11 | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | partially_mitigated | requires_experiment |
| TH-12 | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment |
| TH-13 | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment |
| TH-14 | requires_experiment | requires_experiment | requires_experiment | partially_mitigated | requires_experiment | not_prevented | requires_experiment |
| TH-15 | requires_experiment | requires_experiment | requires_experiment | requires_experiment | requires_experiment | partially_mitigated | requires_experiment |

## Required controls before production

- No host home mount by default.
- Explicit read-only repository snapshot and read-only artifact input mount.
- Single writable profile workspace mount.
- Profile-scoped temp mount.
- No root `~/.hermes`, profile auth store, Keychain, SSH agent or runtime socket.
- Non-root guest UID/GID for worker process.
- Task-scoped credential grant delivery, never environment/argv/image layer.
- Network fail-closed if enforcement mechanism is absent.
- Runtime security context hash recorded and reused on retry/reclaim.
- Crash cleanup and orphan detection evidence.
