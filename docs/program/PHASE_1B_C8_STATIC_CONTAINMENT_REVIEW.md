# Phase 1B-C8 Static Containment Review

Status: `DO_NOT_IMPLEMENT_EXISTING_VM_CONTAINMENT`

C8 statically reviews the C7 containment options against the Phase 1B security
requirements and C5 evidence.

## Verdict

```text
CHANGES_REQUIRED_BEFORE_C9
```

C9 synthetic containment implementation is not approved for the existing `pc3`
VM.

## Confirmed facts

- C5 observed guest default route, DNS availability, and TCP 443 reachability.
- Lima `networks: []` means no extra configured Lima networks, not no network.
- Proxy-only containment is insufficient because direct IP egress exists.
- Guest-side route/firewall changes are not a strong sandbox boundary.
- Host-side `pf` may be viable only as a new privileged synthetic experiment,
  but it has not been scoped, approved, implemented, or rollback-tested.

## Static review findings

### C8-F1: Standalone Lima-vz does not meet network isolation requirements

Severity: `BLOCKER`

The current backend can provide useful filesystem isolation signals, but C5
proves unrestricted outbound paths. This blocks `NETWORK_DISABLED`,
`LOOPBACK_ONLY`, and `RESTRICTED_EGRESS`.

Required change:

- select a backend with native enforced network isolation; or
- approve and prove a separate containment layer.

### C8-F2: Existing VM must not be mutated into production candidate state

Severity: `BLOCKER`

The running `pc3` VM is a synthetic evidence generator. Turning it into a
contained production-candidate runtime would mix experiment phases and weaken
evidence attribution.

Required change:

- future containment tests must use a new explicitly approved VM or backend
  instance with fresh start, containment, probe, and rollback evidence.

### C8-F3: Host firewall path needs a separate privileged approval contract

Severity: `HIGH`

A macOS `pf` anchor could be tested, but it changes host networking and must not
be implied by the current C5 approval.

Required change:

- create a new approval packet with exact commands, anchor name, rule hash,
  before/after inventory, and rollback proof.

### C8-F4: Direct-egress bypass blocks proxy-only restricted egress

Severity: `HIGH`

A policy proxy is useful only after direct egress is denied. C5 proves direct
TCP egress to a public IP works.

Required change:

- direct IP, DNS, UDP/QUIC, and host gateway bypass tests must fail before any
  restricted-egress profile policy can be accepted.

## Pipeline effect

The following gates are intentionally not executed:

- `C9_CONTAINMENT_IMPLEMENTATION_SYNTHETIC_ONLY`;
- `C10_CONTAINMENT_EGRESS_RETEST`;
- `C11_RUNTIME_SECURITY_CONTEXT_CONTRACT` for Lima production mapping;
- `C12_PROFILE_WORKER_SANDBOX_PROTOTYPE`;
- `C13_CREDENTIAL_ISOLATION_SYNTHETIC_TESTS`;
- `C14_MCP_AND_TERMINAL_SANDBOX_TESTS`;
- `C15_DEFAULT_PROFILE_COMPATIBILITY_REVIEW`;
- `C16_ROLLBACK_AND_RECLAIM_FINALIZATION`.

They remain blocked until either:

1. a new containment architecture is approved; or
2. a replacement backend is selected and proven; or
3. the owner approves a reclaim-only closeout.

## C8 conclusion

```text
LIMA_VZ_REJECTED_AS_STANDALONE_PROFILE_RUNTIME_BACKEND
```

Lima-vz may remain a research candidate for filesystem/process isolation, but
it is not approved for PANKSTER profile runtime use with real credentials.
