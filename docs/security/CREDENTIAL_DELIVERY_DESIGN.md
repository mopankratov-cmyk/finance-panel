# Credential Delivery Design

Status: design only. No live broker or credential integration is implemented in
Phase 1B-A.

## Flow

```text
Hermes / Workflow Engine
  -> authorization decision
  -> short-lived grant reference
  -> runtime injection
  -> task process
  -> revocation / cleanup
```

The runtime receives grant references and task-scoped material only. It never
receives the root credential pool, all model credentials, or credentials for
another profile.

## Prohibited channels

- Global environment variables.
- Command-line arguments.
- Image layers.
- Shared host files.
- Common profile directories.
- Logs, journals, argv snapshots, evidence packs.

## Candidate mechanisms

| Mechanism | Exposure surface | Revocation | Cleanup | Logging risk | Compatibility | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| Mounted one-time file | File visible inside runtime; host path must be private and unmounted after task. | Revoke grant and delete/unmount file. | Delete host temp source and guest mount. | Low if path/value never logged; medium if tools list files. | Apple Container and Lima likely; must test. | Primary prototype mechanism. |
| Inherited file descriptor | No named guest path if supported by launcher. | Close FD and revoke grant. | Process exit closes FD. | Low; FD number can leak but not value. | Backend support uncertain. | Preferred if Apple Container/Lima can pass FD safely. |
| Local broker socket | Socket can enforce per-request policy; socket itself must be isolated. | Broker revokes grant immediately. | Remove socket and kill broker. | Medium; request logs must be sanitized. | Works if guest/host socket bridge is safe. | Use for multi-call credentials after file/FD proof. |
| Guest-side ephemeral store | Secret exists only inside guest tmpfs. | Delete store and destroy runtime. | Runtime teardown. | Medium; guest root may read unless UID/permissions enforced. | Broad. | Acceptable only with proven guest UID and tmpfs cleanup. |
| Backend-specific secret primitive | Depends on backend. | Backend-managed. | Backend-managed. | Low if mature. | Unknown for Apple Container; Docker has more patterns. | Evaluate during Phase 1B-B, not initial path. |

## Recommended Phase 1B-B path

1. Use synthetic credential sentinel only.
2. Authorize a single `grant:model:<opaque>` for a synthetic task.
3. Materialize it as a one-time file mounted inside the runtime at a path like
   `/run/pankster/grants/model`.
4. Ensure file owner is the worker UID, mode is `0400`, parent directory is not
   writable by other users.
5. Prove it does not appear in environment, argv, logs, evidence, image layer or
   artifact exports.
6. Delete/unmount on task completion and prove subsequent process cannot read it.

Additional hardening checks for the mounted one-time file:

- worker runs non-root;
- effective capabilities are empty;
- `no_new_privileges` is enabled;
- file owner matches worker UID;
- file mode is `0400`;
- parent directory is not writable by other users;
- credential mount is read-only, `nosuid`, `nodev`, `noexec`;
- guest root escalation is unavailable;
- credential is absent from boot/init logs;
- credential is absent from runtime inspect output;
- credential is absent from unified logs;
- credential is absent after teardown.

## Reviewer credential policy

Reviewers receive no worker credentials. A reviewer runtime may receive its own
model policy grant only if needed for review, never a worker task grant. The
reviewer workspace is a read-only frozen snapshot plus separate temp root.
