# Phase 1C-A0 Runtime Isolation Backend Reselection

Status: `ARCHITECTURE_BASELINE_NOT_IMPLEMENTATION_READY`

Phase 1B closed the Lima-vz standalone path fail-closed:

- C5 observed outbound egress in the synthetic Lima-vz VM.
- C9 R6 blocked host-firewall execution because pre-NAT guest-source visibility
  was not proven.
- C16 reclaimed the synthetic `pc3` and `pc9r2` VMs after exact owner approval.

Phase 1C starts a new architecture path. It must not reuse the Phase 1B
assumption that a macOS host firewall rule can safely enforce per-profile
network policy for guest traffic.

## A0 verdict

```text
START_NEW_ARCHITECTURE_PATH_NOT_IMPLEMENTATION_READY
```

No runtime backend is approved for profile workers yet.

## Non-negotiable requirements

Any candidate backend must provide, or allow us to prove, all of the following
before profile runtime work resumes:

1. Native deny-by-default egress or a stronger equivalent enforcement point.
2. Per-profile allowlist policy for network destinations and protocols.
3. No dependency on packet-capture visibility as the enforcement proof.
4. No dependency on macOS `pf` seeing guest private source IP before NAT.
5. Per-profile filesystem boundary.
6. Separate profile auth store.
7. No root `auth.json` fallback for non-default profiles.
8. No materialization of root credential pools in profile workers.
9. Sanitized environment inheritance for terminal, code execution, delegation,
   MCP subprocesses, background processes, retry, and reclaim.
10. Fail-closed behavior when policy cannot be loaded, verified, or inherited.
11. Default profile compatibility without weakening non-default isolation.
12. Evidence that logs, argv, journals, and review artifacts do not contain
    secrets or raw credentials.

## Candidate classes

| Candidate class | A0 status | Reason |
| --- | --- | --- |
| Remote sandbox with provider-side network policy | `RESEARCH_REQUIRED` | Strong candidate if egress policy is native, auditable, and per-profile. Requires data residency, cost, latency, credential path, and failure-mode review. |
| Local VM with explicit virtual network policy | `RESEARCH_REQUIRED` | Strong candidate only if the backend exposes enforceable per-VM egress controls without relying on macOS `pf` packet visibility. |
| Local OS sandbox plus network extension or firewall API | `ARCHITECTURE_CHANGE_REQUIRED` | Possible, but must be designed as a first-class policy engine, not ad-hoc packet capture or broad host firewall mutation. |
| macOS container/runtime with opaque NAT | `REJECT_UNLESS_NATIVE_POLICY_PROVEN` | Phase 1B showed that file isolation alone is insufficient when network egress remains open and host-side enforcement is unproven. |
| Lima-vz standalone backend | `REJECTED_FOR_PROFILE_RUNTIME` | Closed fail-closed in Phase 1B; may remain only as historical synthetic evidence. |

## What Phase 1C must not do

- Do not start production profiles.
- Do not use real credentials.
- Do not restart or mutate the gateway/default runtime.
- Do not run canary.
- Do not use `pfctl` or host firewall mutation as a shortcut.
- Do not revive Phase 1B synthetic VMs.
- Do not read auth files, Keychain, or environment values for architecture
  research.
- Do not implement worker/runtime changes before the backend selection gate
  passes.

## Next gates

| Gate | Purpose | Allowed work |
| --- | --- | --- |
| `PHASE_1C_A1_BACKEND_CAPABILITY_MATRIX` | Compare candidate backends using official/current documentation and local constraints. | Read-only research, no installs, no runtime start. |
| `PHASE_1C_A2_PROFILE_RUNTIME_THREAT_MODEL` | Convert Phase 0/1B findings into explicit trust boundaries and attacker goals. | Documentation and evidence only. |
| `PHASE_1C_A3_ISOLATION_PROOF_CONTRACT` | Define the minimum proof required before any synthetic runtime execution. | Contract/validator/tests only. |
| `PHASE_1C_A4_OWNER_APPROVAL_PACKET` | Prepare a narrow approval packet if A1-A3 identify a safe synthetic candidate. | Approval prep only, no execution. |

## A0 closeout

Phase 1C may proceed to A1 research. It must remain architecture-only until a
candidate backend demonstrates native or directly enforceable network isolation
that does not depend on the failed Phase 1B host-firewall assumptions.
