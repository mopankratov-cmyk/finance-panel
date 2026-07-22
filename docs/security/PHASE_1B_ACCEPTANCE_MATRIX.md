# Phase 1B-B Experimental Acceptance Matrix

All tests use synthetic directories, synthetic sentinels and disposable runtimes.

| Test | Setup | Action | Expected | Failure signal | Evidence | Cleanup |
| --- | --- | --- | --- | --- | --- | --- |
| ISO-EXP-001 Root home unavailable | Create synthetic root auth decoy outside mounts. | Worker attempts read. | Read fails. | Any file content visible. | exit code, sanitized path class. | Destroy runtime. |
| ISO-EXP-002 Profile A cannot read Profile B | Create profile A/B dirs. | A reads B path. | Permission/path denied. | B sentinel visible. | denied event. | Remove dirs. |
| ISO-EXP-003 Gateway env absent | Host env includes synthetic gateway sentinel. | Worker prints env keys only. | Sentinel/key absent unless allowlisted. | Sentinel/key present. | sanitized env key list. | Destroy runtime. |
| ISO-EXP-004 Only granted synthetic credential visible | Grant one model sentinel. | Worker lists grant store metadata. | Only grant reference/material for task. | Any extra grant. | grant metadata hash. | Revoke grant. |
| ISO-EXP-005 Credential absent from argv | Start worker with grant. | Inspect process argv inside guest. | No credential value. | Sentinel in argv. | argv metadata. | Kill process. |
| ISO-EXP-006 Credential removed after completion | Finish task. | New process reads grant path. | Missing/denied. | Grant still readable. | cleanup probe. | Delete runtime. |
| ISO-EXP-007 Workspace boundary enforced | Mount profile workspace only. | Symlink/path traversal to host. | Denied. | Host file visible. | path probe result. | Remove mounts. |
| ISO-EXP-008 Read-only artifact enforced | Mount artifact read-only. | Worker writes/remounts. | Write/remount denied. | Write succeeds. | fs probe. | Destroy runtime. |
| ISO-EXP-009 Reviewer cannot write worker data | Reviewer gets frozen snapshot. | Reviewer writes worker path. | Denied. | Write succeeds. | reviewer probe. | Destroy reviewer runtime. |
| ISO-EXP-010 Profile-scoped TMPDIR | Set temp mount per profile. | A reads B tmp. | Denied. | B tmp visible. | tmp path metadata. | Delete tmp. |
| ISO-EXP-011 Host loopback unavailable | Start synthetic host loopback service. | Worker connects to host loopback. | Denied unless policy allows. | Connect succeeds. | network deny log. | Stop host service. |
| ISO-EXP-012 Network disabled enforced | Runtime policy disabled. | DNS/public TCP connect. | Fails. | Any connect succeeds. | network probe. | Destroy runtime. |
| ISO-EXP-013 Restricted egress allowlist | Start allowlist proxy. | Connect allowed and denied endpoints. | Allowed works, denied fails. | Policy bypass. | proxy audit log. | Stop proxy. |
| ISO-EXP-014 Runtime socket unavailable | Backend socket exists on host. | Worker searches/mounts socket path. | Not visible. | Socket visible/usable. | socket probe. | Destroy runtime. |
| ISO-EXP-015 Resource limits enforced | Set CPU/memory/process limits. | Stress synthetic process. | Limit enforced. | Host overload/no limit. | resource telemetry. | Kill workload. |
| ISO-EXP-016 Timeout terminates process | Set short timeout. | Worker sleeps. | Terminated and reclaimed. | Process survives. | lifecycle event. | Cleanup orphan. |
| ISO-EXP-017 Crash cleanup | Kill launcher mid-task. | Reclaim routine runs. | Runtime/credential removed or orphan flagged. | Orphan authoritative runtime. | reclaim log. | Delete orphan. |
| ISO-EXP-018 Retry preserves same policy | Record policy hash. | Retry task. | Same hash. | Hash drift. | runtime contract hash. | Destroy retry runtime. |
| ISO-EXP-019 Runtime config hash recorded | Canonicalize contract. | Launch runtime. | Hash in audit/evidence. | Missing/mismatch. | evidence JSON. | Destroy runtime. |
| ISO-EXP-020 Full uninstall/rollback | Install prototype backend. | Run rollback. | No service/socket/runtime dirs. | Residue remains. | before/after inventory. | Manual review if residue. |
| ISO-EXP-021 Direct IP bypass denied | Restricted egress through proxy. | Connect directly to non-allowlisted public IP. | Denied. | Direct IP succeeds. | proxy/network deny log. | Destroy runtime. |
| ISO-EXP-022 IPv6 bypass denied | IPv6 available on host. | Connect to non-allowlisted IPv6 target. | Denied or no IPv6 route. | IPv6 bypass succeeds. | route and connect probe. | Destroy runtime. |
| ISO-EXP-023 UDP/QUIC bypass denied | Restricted egress through proxy. | Send UDP/QUIC to public endpoint. | Denied or explicitly proxied/controlled. | UDP/QUIC bypass succeeds. | packet/proxy metadata. | Destroy runtime. |
| ISO-EXP-024 Proxy unavailable fails closed | Restricted egress configured, proxy stopped. | Launch worker. | Launch denied. | Worker starts with direct egress. | launch denial event. | Restore proxy. |
| ISO-EXP-025 Effective capabilities empty | Worker launched non-root. | Inspect effective capabilities. | Empty or minimal documented set. | Unexpected capabilities. | capability snapshot. | Destroy runtime. |
| ISO-EXP-026 No privilege escalation | `no_new_privileges` required. | Attempt privilege escalation. | Denied. | Escalation succeeds. | denial event. | Destroy runtime. |
| ISO-EXP-027 Credential absent from boot/init logs | Synthetic mounted credential. | Inspect boot/init/runtime logs. | No credential value. | Sentinel appears. | sanitized log scan. | Destroy runtime. |
| ISO-EXP-028 Credential mount cannot be remounted | Credential file mounted read-only. | Attempt remount/write/change mode. | Denied. | Remount/write succeeds. | fs denial event. | Destroy runtime. |

## Network preflight

| Test | Setup | Action | Expected | Failure signal | Evidence | Cleanup |
| --- | --- | --- | --- | --- | --- | --- |
| ISO-PREFLIGHT-001 Apple network-disabled capability | Apple runtime with requested disabled network; no host firewall changes. | Inspect routes/interfaces, DNS, public TCP, host gateway, host alias, and guest loopback. | No external interface/default route/DNS/public TCP/host gateway/host alias; guest loopback works. | Any host/external reachability or firewall mutation. | route table, interface state, connect results. | Destroy runtime; reject Apple candidate on FAIL. |
