# Network Policy Design

Status: design only. Phase 1B-A performs no firewall, daemon, VM or container
changes.

## Modes

| Mode | Intended behavior | Failure behavior |
| --- | --- | --- |
| `NETWORK_DISABLED` | Backend-native no-network, or guest interface disabled before worker start. No outbound network and no host-loopback access. | If backend cannot enforce, runtime launch is denied. |
| `LOOPBACK_ONLY` | Only guest `lo`; no host gateway and no vmnet interface. | If host loopback/gateway is reachable, runtime launch is denied. |
| `RESTRICTED_EGRESS` | Single route to policy proxy; DNS only through proxy; direct IP denied; IPv4/IPv6 denied outside allowlist; UDP/QUIC denied or controlled. | Proxy unavailable or policy load failure denies launch. |

## Restricted egress design

- DNS: resolve through the proxy or pinned resolver controlled by policy.
- Destination allowlist: service-level names and ports, never broad internet.
- Proxy architecture: runtime has route only to policy proxy; proxy performs
  allowlist check and logs destination metadata.
- Host-loopback blocking: prove `127.0.0.1` and host gateway addresses do not
  reach host services unless explicitly allowed for a synthetic test.
- Audit logs: destination, decision, policy hash, runtime ID, profile ID,
  session ID; never credential values.
- Fallback: if proxy cannot start or policy cannot load, runtime launch denied.

## Backend notes

| Backend | Network status |
| --- | --- |
| Apple Container CLI | `NETWORK_BOUNDARY_UNPROVEN`; must test disabled network, host loopback and allowlist proxy. |
| Lima VZ | `NETWORK_BOUNDARY_UNPROVEN`; VM networking exists but policy enforcement must be proven. |
| Colima | `NETWORK_BOUNDARY_UNPROVEN`; inherits Lima/container runtime complexity. |
| Docker Desktop + ECI | Partially documented controls, but PANKSTER still needs allowlist and host-loopback experiments. |
| Podman Machine | `NETWORK_BOUNDARY_UNPROVEN`; rootless machine helps but egress policy must be proven. |
| macOS users + ACL | Not sufficient without host firewall/proxy changes. |
| Full VM | Viable if network interface is disabled or routed only through proxy. |

## Acceptance criteria

- `NETWORK_DISABLED`: `curl`, DNS lookup and TCP connect to public IP fail.
- `LOOPBACK_ONLY`: guest-local service works; host loopback service fails.
- `RESTRICTED_EGRESS`: allowlisted synthetic endpoint works; non-allowlisted
  endpoint fails; logs show sanitized allow/deny decisions.
- No fallback to unrestricted egress.

## Apple network-disabled preflight

Before other Apple Container experiments, Phase 1B-B must run:

`ISO-PREFLIGHT-001 Apple network-disabled capability`

Checks:

- external interface absent or administratively down;
- no default route;
- DNS unavailable;
- public IP TCP connection fails;
- host gateway connection fails;
- host service alias fails;
- guest-local loopback still works;
- no host firewall changes.

Result handling:

- PASS: continue Apple Container experiments.
- FAIL: reject Apple candidate, delete Apple prototype state, move to Lima VZ
  approval flow.

A custom isolated network is not equivalent to `NETWORK_DISABLED` unless these
checks pass.
