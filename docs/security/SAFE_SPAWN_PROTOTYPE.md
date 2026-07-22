# Safe Spawn Prototype

The Phase 1A prototype is not wired into Hermes. It defines patch contracts for
a later core change.

## RuntimeSecurityContext

`RuntimeSecurityContext` is a frozen dataclass with:

- `profile_id`
- `session_id`
- `runtime_enabled`
- `profile_home`
- `workspace_roots`
- `env_allowlist`
- `env_required`
- `env_denylist`
- `credential_grants`
- `network_policy`
- `policy_version`

Validation now enforces:

- network policy in `disabled`, `loopback`, `restricted`
- safe `profile_id` and `session_id`
- absolute and canonical workspace roots
- strict credential grant references
- no allowlist/denylist collision
- env allowlist names must exist in the global catalog
- current policy version `phase1a.v3`

## Credential grants

Only references are accepted:

- `grant:model:<opaque-id>`
- `grant:mcp:<opaque-id>`
- `grant:service:<opaque-id>`

Grant references must be ASCII, short, whitespace-free, limited to allowed grant
types, and must not look like raw tokens, bearer values, URLs with userinfo, or
password/key material.

## Environment policy

The builder starts from an empty dict. It copies only names allowed by the
current context and present in the global catalog:

- `PATH`
- `HOME`
- `TMPDIR`
- `LANG`
- `LC_ALL`
- `SHELL`
- `NO_PROXY`
- `no_proxy`
- `HERMES_HOME`
- `HERMES_KANBAN_DB`
- `HERMES_KANBAN_TASK_ID`
- `HERMES_KANBAN_RUN_ID`
- `HERMES_KANBAN_PROFILE_ID`

There is no `HERMES_KANBAN_*` wildcard. Adding a new Kanban variable requires a
policy version change, test coverage, and decision-log entry.

The global catalog defines which Kanban names can ever be used. The context
defines which of those are allowed for a specific profile/run. A profile can
deny all Kanban variables or allow only a selected subset.

`TMPDIR` is created as:

```text
<profile_home>/runtime/<session_id>/tmp
```

The `session_id` is validated before any directory is created. The path must be
absolute, inside the profile boundary, and not a symlink escape. Different
profiles or sessions receive different directories.

After building the environment, the policy scans allowed values for generic
secret-shaped material and fails closed with `EnvironmentPolicyError` without
echoing the rejected value.

## Spawn checks

Before the fixture subprocess starts, the prototype verifies:

- `runtime_enabled == true`
- policy version is current
- cwd is inside an allowed workspace root
- environment passed validation
- credential grants are references only
- subprocess timeout is set

The subprocess prints sorted environment keys. Sanitized evidence includes only
metadata, env keys, value provenance metadata, argv metadata, exit code and stderr
status. It does not include environment values.

Evidence events redact known synthetic sentinels, but unknown generic
secret-shaped values fail closed instead of being serialized.

The evidence boundary applies to both event payloads and `event_type`.
Assertions validate raw rendered objects, so a nested sentinel cannot be hidden
by pre-redaction. Redaction is allowed only in `redact_value()` and
`sanitize_for_evidence()`.

Evidence generation is also fail-closed:

- it runs the actual `unittest` suite and records per-test observations;
- it records module-qualified `test_identity` plus short `test_name`;
- it maps observations to explicit SEC-IDs through the registry;
- it refuses unknown, missing, or duplicate SEC-IDs;
- it refuses to write if any test FAILs or ERRORs, if `wasSuccessful()` is
  false, or if observation count and `testsRun` diverge;
- it publishes evidence through `current.json -> generations/<pack_id>/` and
  atomically swaps only the small pointer after the generation manifest and all
  evidence JSON files validate.

`isolation-inventory.json` carries only a sanitized host fingerprint
(`system`, `machine`, `probe_version`) so host-bound evidence can be separated
from portable checks without exposing hostname, username, home path, serial
number, or device identifiers.

Ordinary `--check` verifies portable evidence and validates the recorded host
inventory. If the host fingerprint differs, it reports the mismatch without
comparing host-bound command inventory against the current machine. Strict
`--check --require-same-host` fails on that mismatch.

## Context propagation

The prototype wraps thread hops with `copy_context().run(...)` for:

- single thread
- batch fan-out
- background-style call
- nested thread hop
- reused thread-pool calls

The negative fixture confirms an unwrapped thread loses the profile context. The
reused-pool fixture confirms profile A, profile B and unset context do not bleed
across worker reuse, including after an exception.
