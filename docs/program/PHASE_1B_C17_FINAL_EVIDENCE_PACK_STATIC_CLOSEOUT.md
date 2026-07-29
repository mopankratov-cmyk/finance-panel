# Phase 1B-C17 Final Evidence Pack Static Closeout

Status: `SUPERSEDED_BY_C9_HOST_FIREWALL_RESEARCH_PATH`

This C17 pack originally closed the Lima-vz Phase 1B path at the static-review
boundary. It is now superseded by the owner-selected host-firewall research
path, which starts at C9 and now closes at C9 R6 with firewall execution
blocked fail-closed.

C8 still blocks profile/runtime/credential gates. C9 does not override that
blocker. C9 only approves the research path for scoped macOS `pf` containment.
C9 R2 was owner-approved and limited to starting a new disposable target VM and
discovering its guest IPv4; it did not authorize or perform firewall execution.
C9 R3 blocked privileged firewall execution until pf-visibility and
target-uniqueness proof exists. C9 R4 completed non-mutating host network
observability and found `utun4` as the candidate observation interface. C9 R5
was owner-approved for a scoped packet-visibility probe, but unprivileged
execution was denied by macOS packet-capture permissions before guest traffic
was generated. C9 R5 R2 completed a manual operator packet-visibility procedure
with sanitized counts only. The result did not confirm `192.168.5.15` as a
pre-NAT guest source on `utun4`, so C9 R6 blocks firewall execution fail-closed.
It still does not authorize Codex automatic privileged execution, `pfctl`, or
host firewall mutation.

## Final Phase 1B Lima-vz result

```text
LIMA_VZ_REJECTED_AS_STANDALONE_PROFILE_RUNTIME_BACKEND
```

The backend remains useful as research evidence:

- filesystem/host-mount isolation looked promising in C4;
- credential/profile/gateway safety was preserved by not using real credentials
  or production profiles;
- network isolation failed in C5.

## Gate chain

| Gate | Status | Result |
| --- | --- | --- |
| C0 fallback backend selection | complete | Lima-vz selected after Apple Container path blocked |
| C1 Lima-vz install | complete | user-local pinned backend installed |
| C2 static VM config | complete | no host mounts, no containerd, no port forwards, no explicit networks |
| C3 R2 runtime start | complete | one synthetic VM `pc3` started under isolated `LIMA_HOME` |
| C4 post-start probes | complete | local filesystem/host integration checks passed |
| C5 egress classification | complete | DNS and TCP 443 egress observed |
| C6 decision | complete | containment design required before profile runtime |
| C7 containment design | complete | do not mutate existing VM into containment candidate |
| C8 static review | complete | changes required before C9; standalone backend rejected |
| C9 host-firewall research prep | approved | no firewall execution authorized |
| C9 R2 target discovery | complete | `pc9r2` guest IPv4 `192.168.5.15/24` recorded; no firewall execution authorized or performed |
| C9 R3 pf-visibility/target-uniqueness review | complete | blocks privileged `pfctl`; requires proof before any firewall execution contract |
| C9 R4 host network observability discovery | complete | route to `192.168.5.15` observed via `utun4`; no `pfctl`, no packet capture, no guest traffic |
| C9 R5 packet visibility probe | blocked | owner-approved; unprivileged packet capture denied before guest traffic; manual/admin procedure required or fail closed |
| C9 R5 R2 manual packet visibility procedure | complete | sanitized operator result received; zero packets captured; no target/pre-NAT source visibility proof |
| C9 R6 target uniqueness/firewall execution block | complete | firewall execution blocked fail-closed; no pre-NAT visibility proof |
| C10-C15 | intentionally not executed | blocked because no firewall execution contract can be safely prepared for Lima-vz standalone containment |
| C16 reclaim-only closeout | complete | exact owner approval accepted; scoped synthetic `pc3` and `pc9r2` reclaimed; after inventory empty |

## C10-C15 blocked rationale

C10-C15 would be meaningful only after an approved containment architecture
exists. Running them now would create false confidence:

- a profile worker sandbox cannot be approved while outbound egress is open;
- credential isolation tests with network access would not represent the target
  threat model;
- MCP/terminal/delegation tests must inherit a proven runtime policy;

## What remains forbidden

- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary;
- no host firewall changes;
- no guest writes;
- no additional VM reclaim/delete without a separate approval;
- no model-auth materialization.

## Final safe state

The owner selected the C9 host-firewall research path:

```text
HOST_FIREWALL_RESEARCH
```

C9 R2 resolved the guest-side target IP, C9 R3 blocked `pfctl`, C9 R4 found
`utun4` as the host observation candidate, C9 R5 failed closed on unprivileged
packet-capture permissions, and C9 R5 R2 returned sanitized operator counts. The
sanitized C9 R5 R2 result did not show `192.168.5.15` as a visible pre-NAT
source, so C9 R6 blocks privileged firewall execution.

The final safe state is:

```text
STOP
```

The owner approved the reclaim-only closeout. Exact scoped delete commands were
executed for `pc3` and `pc9r2` only, after before-inventory confirmed both
targets. After-inventory for both isolated `LIMA_HOME` values returned no
remaining instances.

## C18 readiness

The previous C18 static-closeout packet is superseded by C9 path selection. A
reviewer should now verify:

- artifact hashes;
- C5 egress evidence;
- C8 blocker logic;
- absence of real credentials/profile/gateway changes;
- whether the C10-C15 skip is justified;
- whether C9 R2 correctly preserved owner approval and fail-closed behavior;
- whether C9 R3 correctly blocks privileged firewall execution pending
  pf-visibility and target-uniqueness proof;
- whether C9 R4 correctly recorded host observability without packet capture or
  firewall mutation;
- whether C9 R5 correctly fails closed when packet capture permission is not
  available without automatic privilege escalation;
- whether C9 R5 R2 correctly records sanitized operator evidence only;
- whether C9 R6 correctly blocks privileged firewall execution because pre-NAT
  source visibility is unproven.
