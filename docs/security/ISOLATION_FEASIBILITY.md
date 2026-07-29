# Isolation Feasibility

Read-only probe only. No runtime was installed, started or configured.

Capability fields use `YES`, `NO`, `POSSIBLE`, `UNVERIFIED`, or
`NOT_APPLICABLE`. Command presence is not accepted as proof of isolation.

| option | installed | supported_on_host | filesystem_boundary | credential_boundary | network_policy | identity_separation | separate_identity_capability | read_only_mounts | operational_complexity | security_strength | evidence | recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| container | false | true | POSSIBLE | POSSIBLE | UNVERIFIED | POSSIBLE | UNVERIFIED | POSSIBLE | medium | potentially strong if configured; not proven by command presence | binary inventory only; no daemon or container started | UNAVAILABLE |
| docker | false | true | POSSIBLE | POSSIBLE | UNVERIFIED | POSSIBLE | UNVERIFIED | POSSIBLE | medium-high | potentially strong if configured; not proven by command presence | binary inventory only; no daemon or container started | UNAVAILABLE |
| podman | false | true | POSSIBLE | POSSIBLE | UNVERIFIED | POSSIBLE | UNVERIFIED | POSSIBLE | medium-high | potentially strong if configured; not proven by command presence | binary inventory only; no daemon or container started | UNAVAILABLE |
| colima | false | true | POSSIBLE | POSSIBLE | UNVERIFIED | POSSIBLE | UNVERIFIED | POSSIBLE | high | potentially strong for filesystem identity; network not validated | binary inventory only; VM not started | UNAVAILABLE |
| limactl | false | true | POSSIBLE | POSSIBLE | UNVERIFIED | POSSIBLE | UNVERIFIED | POSSIBLE | high | potentially strong for filesystem identity; network not validated | binary inventory only; VM not started | UNAVAILABLE |
| lima | false | true | POSSIBLE | POSSIBLE | UNVERIFIED | POSSIBLE | UNVERIFIED | POSSIBLE | high | potentially strong for filesystem identity; network not validated | binary inventory only; VM not started | UNAVAILABLE |
| nerdctl | false | true | POSSIBLE | POSSIBLE | UNVERIFIED | POSSIBLE | UNVERIFIED | POSSIBLE | medium-high | potentially strong if configured; not proven by command presence | binary inventory only; no daemon or container started | UNAVAILABLE |
| sandbox-exec | true | true | UNVERIFIED | UNVERIFIED | UNVERIFIED | NO | UNVERIFIED | UNVERIFIED | medium | command presence only; not a production isolation proof | command presence checked with `shutil.which`; no sandbox profile executed | DISCOVERED_BUT_UNVALIDATED |
| systemd-run | false | false | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | medium | unverified | binary inventory only | UNAVAILABLE |
| bwrap | false | false | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | medium | unverified | binary inventory only | UNAVAILABLE |
| firejail | false | false | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | medium | unverified | binary inventory only | UNAVAILABLE |

## Decision

- Recommended backend: none.
- Installed discovery: `sandbox-exec` is present, but unvalidated.
- Production isolation gate: `BLOCKED_ON_BACKEND_SELECTION`.
- Filesystem boundary: not proven.
- Credential boundary: not proven.
- Network boundary: not proven.
- Separate identity: `UNVERIFIED`.
- Blocking question: production isolation backend remains blocked until a backend proves filesystem, credential, network, identity and read-only mount boundaries together.

This does not declare production isolation ready.
