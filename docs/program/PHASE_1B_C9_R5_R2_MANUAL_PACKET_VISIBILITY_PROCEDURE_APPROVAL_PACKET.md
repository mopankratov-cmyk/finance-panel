# Phase 1B-C9 R5 R2 Manual Packet Visibility Procedure Approval Packet

Status: `OWNER_APPROVAL_REQUIRED`

C9 R5 was owner-approved, but the unprivileged probe failed closed:

```text
PACKET_CAPTURE_PERMISSION_REQUIRED
```

C9 R5 R2 is a manual/operator procedure. It allows an administrator-authenticated
human terminal to run one scoped packet capture and one synthetic guest TCP
connect attempt. Codex must not execute privileged commands.

It still does not authorize `pfctl` or host firewall mutation.

## Allowed after owner approval

Manual operator command, terminal 1:

```bash
sudo /usr/sbin/tcpdump -n -tt -q -i utun4 -c 8 'host 192.168.5.15 and tcp and port 443'
```

Manual synthetic trigger, terminal 2:

```bash
env -i PATH=/Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin:/usr/bin:/bin HOME=/Users/maksimpankratov LANG=C LIMA_HOME=/Users/maksimpankratov/.local/pankster/runtime/lc9r2 /Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin/limactl shell --tty=false pc9r2 -- /bin/sh -lc "timeout 5 bash -lc 'exec 3<>/dev/tcp/1.1.1.1/443; exec 3>&-; exec 3<&-'"
```

The operator must return only sanitized facts:

```json
{
  "packet_capture_performed": true,
  "candidate_host_interface": "utun4",
  "target_ipv4_observed": true,
  "source_target_packet_count": 1,
  "destination_target_packet_count": 0,
  "pre_nat_guest_source_observed": true,
  "raw_packet_output_persisted": false
}
```

Do not paste raw tcpdump lines into chat or evidence.

## Still forbidden

- no Codex automatic privileged execution;
- no `pfctl`;
- no edits to `/etc/pf.conf` or `/etc/pf.anchors/*`;
- no host firewall state changes;
- no raw packet payload persistence;
- no broad packet capture;
- no DNS probe;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary;
- no VM reclaim/delete.

## Contract

Contract:

```text
docs/program/PHASE_1B_C9_R5_R2_MANUAL_PACKET_VISIBILITY_PROCEDURE_CONTRACT.ready.json
```

Contract content SHA-256:

```text
6c2a9e75d06ce1d43af1df2d3b0a581ef040ce71488c6d70d7705e0f89067a03
```

Contract file SHA-256:

```text
2eda566cc6ac8d9ca6b2b81fc4d21a78cdf965d62aaebcd22ba528714c808238
```

Approval ID:

```text
p1b-20260722-limapktr2c9r5
```

Owner approval command:

```text
APPROVE_SYNTHETIC_LIMA_MANUAL_PACKET_VISIBILITY_PROCEDURE:p1b-20260722-limapktr2c9r5:6c2a9e75d06ce1d43af1df2d3b0a581ef040ce71488c6d70d7705e0f89067a03
```

Owner command hash:

```text
4b24070d3e9d0a313b077b18d0c5be002dde4b1ef80974ebabc47a52318ed281
```

## Fail-closed rule

If the operator cannot run the manual capture, or if only raw packet output is
available, do not continue to C9 R6. Record the result as fail-closed.

