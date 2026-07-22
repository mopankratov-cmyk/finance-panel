# Phase 1B-C4 Synthetic Lima Post-start Probe Approval Packet

Status: `OWNER_APPROVAL_REQUIRED`

C4 would run bounded, read-only, non-network probes against the already running
synthetic Lima VM `pc3`.

## Scope

Allowed:

- inspect `limactl list --format json pc3`;
- run exact guest read-only shell commands listed in the contract;
- collect sanitized evidence;
- redact guest environment values.

Forbidden:

- no network probes;
- no `curl`, `wget`, `apt`, package install, or outbound request;
- no `--preserve-env`;
- no host sync;
- no guest writes;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary.

## Contract

Contract:

```text
docs/program/PHASE_1B_C4_SYNTHETIC_LIMA_POSTSTART_PROBE_CONTRACT.ready.json
```

Contract content SHA-256:

```text
32f674f863d88570c1ee55f49ac85cca2cd2779bcdd992f3f248813048a2f92a
```

Approval ID:

```text
p1b-20260722-limaprobesc4
```

Owner approval command:

```text
APPROVE_SYNTHETIC_LIMA_POSTSTART_PROBE:p1b-20260722-limaprobesc4:32f674f863d88570c1ee55f49ac85cca2cd2779bcdd992f3f248813048a2f92a
```

Owner command hash:

```text
cdc5c8639ed71c811c18fb3d744c3966d32fbf27f2b67988b126502b41be5089
```

## Probe list

The approved probe list is intentionally small:

1. host `limactl list --format json pc3`;
2. guest `/bin/uname -a`;
3. guest `/usr/bin/id`;
4. guest `/bin/mount`;
5. guest environment variable names with values redacted;
6. guest runtime binary lookup for `containerd`, `nerdctl`, `docker`;
7. guest check for absent host SSH agent socket;
8. guest check for absent `/Users` host path.

## Output policy

Evidence must be sanitized:

- no raw host environment;
- no env values;
- no auth files;
- no Keychain;
- no secrets;
- no production profile data.
