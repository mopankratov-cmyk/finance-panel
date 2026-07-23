# Phase 1C-A2 Profile Runtime Threat Model

Status: `THREAT_MODEL_COMPLETE_NO_RUNTIME_APPROVED`

Phase 1C A1 shortlisted remote sandboxes for threat modeling because Modal and
E2B expose explicit outbound network restriction primitives in official docs.
A2 does not approve either backend. It defines what must be true before a remote
sandbox can run Hermes profile-worker code.

## Protected assets

1. Root/default profile credentials.
2. Non-profile credentials such as Gitea, Supabase, Telegram, Anthropic, GLM,
   marketplace tokens, and deploy keys.
3. Per-profile model-auth.
4. User task payloads and files.
5. Terminal stdout/stderr, code-execution output, MCP payloads, and delegation
   messages.
6. Evidence packs, logs, journals, argv, and retry/reclaim metadata.
7. Gateway process state and default runtime environment.

## Adversaries

| Adversary | Goal |
| --- | --- |
| Malicious prompt or task payload | Exfiltrate credentials, widen environment, or force network access. |
| Compromised profile worker | Read host files, call unauthorized APIs, or leak data through logs/network. |
| Compromised tool/MCP subprocess | Bypass profile environment policy via child process inheritance. |
| Sandbox provider/control-plane issue | Expose payloads, logs, filesystem snapshots, or network metadata outside the intended trust boundary. |
| Operator/configuration error | Start sandbox with internet enabled, broad env, root auth fallback, or default profile credentials. |

## Required architecture boundaries

1. Sandbox receives no root/default auth material.
2. Sandbox receives no non-profile service credentials.
3. Sandbox receives no raw host environment.
4. Sandbox receives no unrestricted filesystem mount.
5. All network policy is deny-by-default before worker code starts.
6. Model calls should prefer a host-side model broker. If in-sandbox model calls
   are required, the sandbox receives only a per-profile, least-privilege
   model-auth token with no access to other provider credentials.
7. External service calls should go through a host-side capability broker with
   explicit per-profile operations, never through raw credentials in the sandbox.
8. Terminal, code execution, MCP, delegation, background processes, retry, and
   reclaim must inherit the same sanitized environment.
9. Policy load or verification failure must stop the profile worker before any
   user code or tool code runs.
10. Evidence must store only sanitized counts, booleans, hashes, and status
    codes unless raw payload capture is explicitly approved for a synthetic test.

## Data-flow decision

```text
REMOTE_SANDBOX_REQUIRES_HOST_SIDE_CREDENTIAL_AND_MODEL_BROKERS
```

Remote sandboxing can help with filesystem/process/network isolation, but it
does not by itself solve credential isolation. Credentials must remain outside
the sandbox unless a later gate proves a per-profile minimal model-auth path.

## Allowed next proof

A3 may define a synthetic proof contract with fake credentials only:

- create sandbox with deny-all egress;
- verify blocked outbound access before user code;
- verify no root auth fallback path is mounted or present;
- verify sanitized environment in terminal/code/MCP/delegation children;
- verify logs/evidence contain no secrets;
- verify fail-closed behavior when policy is absent or invalid.

## Still forbidden

- no provider API calls;
- no real credentials;
- no production profiles;
- no gateway/default runtime changes;
- no canary;
- no host firewall changes;
- no broad environment or auth file reads;
- no implementation of Hermes runtime changes before A3/A4 approval.

## A2 closeout

Phase 1C may proceed to A3 isolation proof contract. The architecture direction
is remote sandbox plus host-side brokers, not raw credentials or direct provider
tokens inside the sandbox.
