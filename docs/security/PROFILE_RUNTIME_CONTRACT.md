# Profile Runtime Contract

This backend-neutral contract defines what Hermes must request from any
disposable profile runtime. Phase 1B-A does not implement this in Hermes core.

```yaml
profile_runtime:
  runtime_id: "rt_<opaque>"
  profile_id: "profile-a"
  session_id: "session_<opaque>"
  image_or_template: "pankster/hermes-worker-synthetic:<digest>"
  uid: 10001
  gid: 10001
  read_only_root: true
  workspace_mount:
    host_source: "/synthetic/profile-a/workspace"
    guest_target: "/workspace"
    mode: "rw"
    symlink_policy: "deny_escape"
  artifact_mount:
    host_source: "/synthetic/artifacts/<task>"
    guest_target: "/artifacts"
    mode: "ro"
  temp_mount:
    guest_target: "/tmp/pankster"
    mode: "rw"
    lifecycle: "destroy_on_teardown"
  credential_grants:
    - "grant:model:<opaque>"
  network_policy:
    mode: "NETWORK_DISABLED | LOOPBACK_ONLY | RESTRICTED_EGRESS"
    destinations: []
    dns: "disabled | pinned_resolver | proxy_resolved"
  cpu_limit: "2"
  memory_limit: "2GiB"
  process_limit: 256
  timeout: "1800s"
  environment_policy_version: "phase1a.v3"
  runtime_security_context_hash: "sha256:<canonical-contract>"
  process_security:
    run_as_non_root: true
    uid: 10001
    gid: 10001
    privileged: false
    capabilities_drop:
      - ALL
    capabilities_add: []
    no_new_privileges: true
    host_pid_namespace: false
    host_network_namespace: false
    host_ipc_namespace: false
    runtime_socket_mount: false
    ssh_agent_mount: false
    device_mounts: []
    proc_mode: restricted
    sys_mode: restricted
    seccomp_policy: pankster-default-v1
    rlimits:
      nofile: 1024
      nproc: 256
      core: 0
  filesystem_security:
    host_home_mount: false
    automatic_home_sharing: false
    root_hermes_mount: false
    mount_propagation: private
    workspace_options:
      - nosuid
      - nodev
    artifact_options:
      - ro
      - nosuid
      - nodev
      - noexec
    credential_options:
      - ro
      - nosuid
      - nodev
      - noexec
```

## Primary mapping: Apple Container CLI

| Abstract field | Apple Container implementation intent |
| --- | --- |
| `runtime_id` | Disposable container/VM name with opaque suffix. |
| `image_or_template` | OCI image pinned by digest; no credentials baked into image. |
| `uid` / `gid` | Non-root Linux UID inside guest; verify with `id -u` experiment. |
| `read_only_root` | Run with immutable image/rootfs if supported; otherwise fail Phase 1B-B. |
| `workspace_mount` | Single explicit writable mount for synthetic profile workspace. |
| `artifact_mount` | Explicit read-only mount; remount attempts must fail. |
| `temp_mount` | Guest tmpfs or disposable writable directory deleted on teardown. |
| `credential_grants` | One-time file or inherited FD delivered after authorization. |
| `network_policy` | Start with `NETWORK_DISABLED`; prove allowlist via proxy before `RESTRICTED_EGRESS`. |
| resource limits | CPU/memory/process limits if CLI exposes them; otherwise wrapper-level timeout and kill. |
| lifecycle | Create per task/session, record config hash, destroy on completion/crash. |

## Fallback mapping: Lima VZ

| Abstract field | Lima VZ implementation intent |
| --- | --- |
| `runtime_id` | Disposable Lima instance name. |
| `image_or_template` | Pinned Linux image/template with digest/checksum verification. |
| `uid` / `gid` | Dedicated non-root guest user per profile/session. |
| `read_only_root` | Immutable base image plus writable overlay/scratch if available. |
| `workspace_mount` | Lima mount with only profile workspace writable. |
| `artifact_mount` | Lima read-only mount. |
| `temp_mount` | Guest tmpfs or disposable disk path. |
| `credential_grants` | One-time file or broker over guest-only socket. |
| `network_policy` | Disabled network first; restricted egress via proxy or host firewall only after proof. |
| resource limits | Lima CPU/memory/disk config plus process limits inside guest. |
| lifecycle | `limactl start`/stop/delete in Phase 1B-B only, never in Phase 1B-A. |

## Contract invariants

- No inherited gateway environment except Phase 1A allowlisted variables.
- No credential values in environment, argv, image layer, common host file, or logs.
- No host runtime socket mounted into worker or reviewer.
- Reviewer runtime is separate from worker runtime and receives read-only frozen artifacts only.
- Retry and reclaim must use the same canonical contract hash unless owner explicitly approves a policy migration.

Any backend that cannot support an obligatory `process_security` or
`filesystem_security` field is rejected for the Phase 1B-B experiment:
`BACKEND_REJECTED`.

## Apple Container prohibited integrations

The Apple Container experiment must avoid host-convenience features that would
collapse the boundary:

- `container machine`: PROHIBITED
- `container run --ssh`: PROHIBITED
- `SSH_AUTH_SOCK` mount: PROHIBITED
- automatic host home sharing: PROHIBITED
- host user mapping: PROHIBITED
- host runtime/XPC socket mount: PROHIBITED
- container debug mode in credential tests: PROHIBITED
- floating OCI tags: PROHIBITED

Only disposable `container create/run` style operations with explicit mounts,
explicit image digest, explicit network mode and explicit worker UID are valid
for Phase 1B-B.
