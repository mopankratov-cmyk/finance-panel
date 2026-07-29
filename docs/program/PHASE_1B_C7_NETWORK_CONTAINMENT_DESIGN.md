# Phase 1B-C7 Network Containment Design

Status: `DESIGN_COMPLETE_STATIC_REVIEW_REQUIRED`

C7 evaluates containment options after C5 proved that the current Lima-vz
synthetic VM has outbound DNS and TCP egress despite:

- `networks: []`;
- `portForwards: []`;
- `propagateProxyEnv: false`;
- `hostResolver.enabled: false`;
- `dns: []`.

## Required security outcome

PANKSTER profile workers require one of these enforceable network modes:

1. `NETWORK_DISABLED`: no guest outbound network, no DNS, no host gateway, no
   host-loopback reachability.
2. `LOOPBACK_ONLY`: guest loopback works, but host/external networks do not.
3. `RESTRICTED_EGRESS`: direct egress denied; only policy-proxy allowlisted
   destinations work; proxy/policy failure denies launch.

C5 demonstrated none of those modes. The current runtime is therefore
synthetic-only.

## Candidate designs

| Option | Design | Pros | Blocking problem |
| --- | --- | --- | --- |
| A | Guest-side firewall or route deletion inside VM before worker start | Narrow blast radius; no host firewall; easy rollback by deleting VM | Not a trustworthy boundary if the worker or toolchain can gain guest root, alter routes, replace firewall rules, use raw sockets, or run before policy is applied. Requires guest writes and boot-order proof. |
| B | Host-side macOS `pf` anchor blocking the Lima guest subnet/IP | Can block packets outside the guest; independent from guest process compromise | Requires privileged host firewall mutation. Current evidence has only dynamic guest subnet/IP, not an instance-stable identity. Risk of affecting host or other Lima traffic. Needs separate owner approval and rollback proof. |
| C | Restricted egress proxy only | Good audit model and allowlist semantics | Not sufficient unless direct IP/DNS/UDP/QUIC egress is blocked first. C5 proves direct TCP path exists. |
| D | Lima native no-network configuration | Would be the cleanest backend-native boundary | Local Lima 2.2.0 template documents built-in network behavior; C5 observed default route/DNS/TCP. No proven no-network knob exists in current artifacts. |
| E | Replace backend with one that supports native no-network or enforced network namespace | Stronger architectural fit | Requires new backend selection/artifact chain and fresh Phase 1B-style approval/evidence. |

## Recommended design direction

Do not implement C9 containment on the existing running `pc3` VM.

Instead, treat Lima-vz as:

```text
FILESYSTEM_ISOLATION_PROMISING_NETWORK_BOUNDARY_FAILED
```

and choose one of two future paths:

1. `BACKEND_REPLACEMENT`: select a backend with backend-native no-network or
   network namespace controls.
2. `HOST_FIREWALL_RESEARCH`: create a new owner-approved synthetic experiment
   that mutates macOS `pf` only through a scoped anchor, proves rollback, and
   proves no blast radius to host/default gateway.

Path 2 is not currently approved because it requires privileged host network
changes.

## Minimum viable future host-firewall experiment

This is a design sketch only. It is not approved for execution.

Preconditions:

- new disposable VM, not reused `pc3`;
- deterministic isolated `LIMA_HOME`;
- recorded guest IP/subnet;
- explicit `pf` anchor name, rule file, hash, and rollback command;
- before/after host network inventory;
- rollback verified before any profile work.

Expected tests:

- DNS to public domain denied;
- TCP to public IP denied;
- UDP/QUIC denied or no route;
- host gateway denied unless explicitly allowed for Lima control;
- guest loopback still works;
- SSH/control channel remains only as required for test orchestration;
- policy removal restores host network to pre-state;
- no gateway/default runtime/profile process affected.

Fail-closed criteria:

- if guest IP/subnet cannot be mapped deterministically to the intended VM,
  deny launch;
- if `pf` state cannot be loaded or verified, deny launch;
- if rollback cannot be proven, deny launch;
- if any public direct egress succeeds, reject containment.

## Non-goals

C7 does not authorize:

- host firewall changes;
- guest writes;
- new VM start;
- reclaim/delete;
- production profiles;
- real credentials;
- gateway/default runtime changes;
- canary.

## Result

C7 sends the design to C8 static review with this recommended verdict:

```text
DO_NOT_IMPLEMENT_EXISTING_VM_CONTAINMENT
```
