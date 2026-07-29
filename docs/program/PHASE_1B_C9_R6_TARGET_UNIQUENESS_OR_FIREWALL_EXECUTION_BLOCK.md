# Phase 1B-C9 R6 Target Uniqueness or Firewall Execution Block

Status: `FIREWALL_EXECUTION_BLOCKED_NO_PF_VISIBILITY_PROOF`

C9 R5 R2 completed the manual/operator packet visibility step with sanitized
counts only. The operator did not provide raw tcpdump packet lines, packet
payloads, secrets, auth files, Keychain data, or environment values.

## Sanitized operator result

```text
packet_capture_performed: true
candidate_host_interface: utun4
target_ipv4_observed: false
source_target_packet_count: 0
destination_target_packet_count: 0
pre_nat_guest_source_observed: false
raw_packet_output_persisted: false
tcpdump_packets_captured: 0
tcpdump_packets_received_by_filter: 4482
tcpdump_packets_dropped_by_kernel: 0
```

The nonzero `tcpdump_packets_received_by_filter` counter is not treated as
directional packet evidence. The contract requires sanitized direction counts
and a boolean pre-NAT source observation. Those values remain zero/false.

## R6 decision

Do not prepare a privileged host firewall execution contract.

The required proof is still absent:

1. macOS packet visibility for `192.168.5.15` as a pre-NAT guest source was not
   confirmed.
2. Target uniqueness is not sufficient for a firewall rule because the host-side
   enforcement point for the guest private source is unproven.
3. A scoped `pfctl` rule could still be ineffective or affect the wrong traffic
   class.

## Still forbidden

- no `pfctl`;
- no edits to `/etc/pf.conf` or `/etc/pf.anchors/*`;
- no host firewall mutation;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary;
- no VM reclaim/delete without a separate owner approval.

## Result

```text
C9_R6_FIREWALL_EXECUTION_BLOCKED_NO_PRE_NAT_VISIBILITY_PROOF
```

## Next safe state

The Lima-vz path remains rejected as a standalone profile runtime backend. C10
through C15 remain blocked. The only remaining safe follow-up is a separate
reclaim-only closeout, if the owner wants to delete the synthetic test VM and
runtime artifacts.
