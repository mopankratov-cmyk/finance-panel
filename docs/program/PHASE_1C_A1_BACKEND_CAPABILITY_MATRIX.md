# Phase 1C-A1 Backend Capability Matrix

Status: `RESEARCH_COMPLETE_NO_BACKEND_APPROVED`

This is a read-only capability matrix for selecting the next isolation backend
after Phase 1B. It uses official/current documentation only and does not install
or start any backend.

## Source set

| Backend | Official source |
| --- | --- |
| Modal Sandbox | https://modal.com/docs/guide/sandbox-networking |
| E2B Sandbox | https://e2b.dev/docs/network/internet-access |
| Apple Container | https://github.com/apple/container |
| Lima | https://lima-vm.io/docs/config/network/ |
| Colima | https://colima.run/docs/configuration/ |
| OrbStack | https://docs.orbstack.dev/architecture |
| Docker Desktop ECI | https://docs.docker.com/enterprise/security/hardened-desktop/enhanced-container-isolation/ |

## Findings

| Candidate | Network isolation signal | A1 disposition |
| --- | --- | --- |
| Modal Sandbox | Official docs expose full outbound block, CIDR allowlist, and beta domain allowlist controls. Default outbound is open, so profile policy must explicitly configure deny/allow. | `SHORTLIST_REMOTE_SANDBOX_A2` |
| E2B Sandbox | Official docs expose `allowInternetAccess=false`, deny-all via `denyOut`, IP/CIDR/domain allowlists, and warn that blocked TCP connects may appear locally successful without application-level proof. | `SHORTLIST_REMOTE_SANDBOX_A2` |
| Apple Container | Official docs describe Linux containers as lightweight VMs on Mac, but A1 did not find a native per-container egress allowlist in the reviewed source set. | `HOLD_PENDING_NETWORK_POLICY_PROOF` |
| Lima | Official docs expose several network modes, but Phase 1B already rejected Lima-vz standalone for profile runtime after egress and failed host-firewall proof. | `REJECTED_BY_PHASE_1B_FOR_STANDALONE_PROFILE_RUNTIME` |
| Colima | Official docs expose shared/bridged network modes and reachable VM addresses, but not a native deny-by-default per-profile egress policy in the reviewed source set. | `HOLD_PENDING_NETWORK_POLICY_PROOF` |
| OrbStack | Official docs describe NAT/custom virtual networking and isolated machines, but also state Linux machines share one kernel and are not a substitute for a full VM against actively malicious code. | `HOLD_PENDING_SECURITY_MODEL_PROOF` |
| Docker Desktop ECI | Official docs show stronger container isolation and host/VM hardening, including network namespace sharing blocks. A1 did not find a profile-level outbound destination allowlist in ECI itself. | `HOLD_PENDING_EGRESS_POLICY_PROOF` |

## A1 recommendation

```text
SHORTLIST_REMOTE_SANDBOXES_FOR_A2_THREAT_MODEL
```

The best next path is to model remote sandboxes first, specifically Modal and
E2B, because both expose explicit outbound network restriction primitives in
their official docs. That does not approve either backend for implementation.
It only makes them candidates for A2 threat modeling.

## Required A2 questions

1. Can a remote sandbox run Hermes profile-worker workloads without exposing
   root credentials or default profile auth?
2. Can model-auth be scoped per profile while keeping all non-profile
   credentials outside the sandbox?
3. Can deny-by-default egress be configured before any worker code starts?
4. Can the system prove blocked egress using application-level checks, not only
   local TCP connect behavior?
5. What data leaves the host: prompts, files, stdout/stderr, tool calls,
   terminal output, MCP payloads, traces, logs, and artifacts?
6. What is the rollback path if the sandbox provider is unavailable or policy
   creation fails?

## Still forbidden

- no installs;
- no provider API calls;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary;
- no network probes;
- no `pfctl` or host firewall changes;
- no auth, Keychain, or environment value reads.

## A1 closeout

A1 does not select a backend. It narrows Phase 1C to an A2 threat-model pass for
remote sandbox candidates, with Modal and E2B as the initial short list.
