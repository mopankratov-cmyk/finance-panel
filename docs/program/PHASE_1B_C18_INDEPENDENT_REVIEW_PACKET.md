# Phase 1B-C18 Independent Review Packet

Status: `READY_FOR_FINAL_REVIEW_AFTER_C16_RECLAIM_ONLY_CLOSEOUT`

This packet was prepared for static closeout review. It is now superseded by
the owner-selected C9 host-firewall research path. It remains useful as
historical context, but the current reviewer should include the C9, C9 R2, C9
R3, C9 R4, C9 R5, C9 R5 R2, C9 R6 fail-closed, and C16 reclaim-only closeout
artifacts.

## Review scope

Review the Phase 1B Lima-vz chain from C0 through C9 R6 firewall execution
blocking and C16 reclaim-only closeout.

Do not execute:

- production profiles;
- real credentials;
- gateway/default runtime changes;
- canary;
- host firewall changes;
- guest writes;
- any additional VM reclaim/delete;
- network probes beyond already recorded C5 evidence, C9 R2 before-firewall
  target-discovery markers, and C9 R4 non-mutating host route metadata.

## Evidence pack

C17 manifest:

```text
security/evidence/phase-1b-c17/final-evidence-pack-manifest.json
```

C17 manifest SHA-256 after C16 reclaim-only closeout:

```text
884865e938a7b55db28e93e9c133a5c38d246291efd9cd0b25660289cddae704
```

C17 closeout:

```text
docs/program/PHASE_1B_C17_FINAL_EVIDENCE_PACK_STATIC_CLOSEOUT.md
```

C17 closeout SHA-256:

```text
f0ce6638d55d700b69515d9d6229bd2866edf8727f529ff4d36afa74a0f7e95a
```

## Facts to verify

1. C2 static config does not claim that `networks: []` disables built-in Lima
   guest networking.
2. C3 R2 started only one synthetic VM `pc3` under isolated `LIMA_HOME`.
3. C4 confirmed no host mounts, no `/Users` mount, no SSH agent socket, no
   host sync, and no container runtime binaries in guest PATH.
4. C5 observed DNS and TCP 443 egress.
5. C6 correctly chose containment design before profile runtime approval.
6. C7 correctly rejected proxy-only containment and guest-only firewall as
   insufficient for a trusted profile boundary.
7. C8 correctly blocked C9-C16 for the existing VM.
8. C17 static closeout was superseded by the owner-selected C9 host-firewall
   research path.
9. C9 approves only the host-firewall research path.
10. C9 R2 was owner-approved, started disposable target VM `pc9r2`, and
    recorded guest IPv4 `192.168.5.15/24`.
11. C9 R2 recorded DNS and TCP 443 as available before firewall mutation.
12. C9 R2 did not authorize or perform `pfctl` or host firewall changes.
13. C9 R3 correctly blocks privileged firewall execution until pf-visibility
    and target-uniqueness proof exists.
14. C9 R4 was owner-approved and collected only non-mutating host route/interface
    metadata.
15. C9 R4 recorded `utun4` as the route interface for `192.168.5.15`.
16. C9 R4 did not authorize or perform `pfctl`, packet capture, guest traffic
    generation, production profiles, real credentials, gateway changes, canary,
    or reclaim.
17. C9 R5 prepares a separate owner gate for packet visibility only, scoped to
    `utun4` and `host 192.168.5.15 and tcp and port 443`.
18. C9 R5 still forbids `pfctl` and host firewall mutation.
19. C9 R5 owner approval was accepted and hashes to
    `dda685c043396aef54cc560aee15dfc2859c6d47c41cbaee74ed5a5bc24543f6`.
20. C9 R5 unprivileged execution was denied with
    `PACKET_CAPTURE_PERMISSION_REQUIRED`.
21. C9 R5 did not generate guest traffic because packet capture permission
    failed before the guest connect step.
22. C9 R5 printed a manual admin command but did not execute it.
23. C9 R5 R2 prepares a separate owner/operator approval gate for the manual
    packet visibility procedure.
24. C9 R5 R2 requires sanitized counts only and forbids pasting raw tcpdump
    output into chat or evidence.
25. C9 R5 R2 still forbids Codex automatic privileged execution, `pfctl`, and
    host firewall mutation.
26. C9 R5 R2 owner approval was accepted and hashes to
    `4b24070d3e9d0a313b077b18d0c5be002dde4b1ef80974ebabc47a52318ed281`.
27. C9 R5 R2 operator result was received as sanitized counts only:
    0 packets captured, 4482 packets received by filter, 0 dropped.
28. C9 R5 R2 did not include raw tcpdump lines or packet payloads.
29. C9 R5 R2 did not confirm `192.168.5.15` as source or destination in
    directional packet counts.
30. C9 R6 correctly blocks firewall execution because pre-NAT guest source
    visibility remains unproven.
31. C16 reclaim-only approval was accepted and scoped only to synthetic `pc3`
    under `lc3` and `pc9r2` under `lc9r2`.
32. C16 before inventory confirmed exactly `pc3` and `pc9r2`.
33. C16 executed exact delete commands only; no wildcard, broad path, `rm -rf`,
    default Lima home, `pfctl`, firewall, gateway, profile, credential, canary,
    network probe, auth, Keychain, environment dump, or evidence deletion.
34. C16 after inventory for both isolated `LIMA_HOME` values returned zero
    remaining instances.

## Required reviewer verdict

Return exactly one:

```text
APPROVE_PHASE_1B_CLOSEOUT_AFTER_C16_RECLAIM_ONLY
CHANGES_REQUIRED
BLOCKED
```

Use:

- `APPROVE_PHASE_1B_CLOSEOUT_AFTER_C16_RECLAIM_ONLY` only if the
  historical C0-C8 standalone rejection is still supported, C9 R2 target
  discovery is correctly recorded, C9 R3 is correctly blocked before privileged
  firewall execution, C9 R4 host observability is correctly recorded, C9 R5
  correctly failed closed when packet capture permission was unavailable, and
  C9 R5 R2 approval/result are correctly limited to manual owner/operator action
  with sanitized evidence, and C9 R6 correctly blocks firewall execution because
  pre-NAT visibility is unproven. Also require C16 reclaim-only execution to be
  limited to the exact approved synthetic targets with after-inventory empty.
- `CHANGES_REQUIRED` if the conclusion is directionally right but evidence,
  hashes, gate wording, or blocked-gate accounting needs correction.
- `BLOCKED` if the reviewer cannot verify the artifact chain or if any evidence
  suggests real credentials/profile/gateway/canary changes occurred.

## Questions for reviewer

1. Does C5 evidence conclusively block `NETWORK_DISABLED` and proxy-only
   `RESTRICTED_EGRESS` for the existing Lima-vz VM?
2. Is C8 correct to block C9-C16 rather than mutate `pc3`?
3. Are there any missing artifacts required before declaring the Lima-vz path
   rejected as standalone?
4. Does C9 R2 correctly preserve a hard boundary before any privileged `pf`
   execution while recording only the disposable target IP and before-firewall
   egress markers?
5. Is C9 R3 correct to require proof that macOS `pf` sees guest private source
   traffic before NAT and proof that `192.168.5.15` is unique to `pc9r2`?
6. Does C9 R4 correctly avoid privileged and mutating tools while collecting
   only enough host metadata to decide whether a later packet-visibility probe
   can be scoped?
7. Does C9 R5 correctly keep `pfctl` blocked while narrowly approving only
   packet visibility metadata if the owner separately approves it?
8. Does C9 R5 correctly avoid guest traffic generation when packet capture
   permission is unavailable?
9. Does C9 R5 R2 correctly require manual owner/operator action and sanitized
   results only before any C9 R6 reasoning?
10. Does C9 R5 R2 correctly interpret zero captured packets and zero direction
    counts as no pre-NAT target-source visibility proof?
11. Does C9 R6 correctly block privileged firewall execution and keep C10-C15
    blocked?
12. Does C16 correctly reclaim only the exact synthetic targets and preserve all
    non-reclaim hard gates?

## Expected primary-agent recommendation

The historical primary-agent recommendation was:

```text
APPROVE_STATIC_CLOSEOUT
```

Current recommendation:

```text
APPROVE_PHASE_1B_CLOSEOUT_AFTER_C16_RECLAIM_ONLY
```

Reason: C5 provides direct evidence of egress, C8 blocks production/runtime
gates, C9 approves only the research path, C9 R2 completed target discovery
without authorizing `pfctl`, and C9 R3 correctly fails closed before privileged
firewall execution. C9 R4 recorded `utun4` as an observation candidate without
packet capture or firewall mutation. C9 R5 was approved, but failed closed on
packet capture permissions before generating guest traffic. It still does not
authorize firewall changes. C9 R5 R2 completed a manual-only procedure with raw
packet output prohibited and Codex privileged execution still forbidden. The
sanitized operator result did not confirm target/pre-NAT source visibility, so
C9 R6 blocks privileged firewall execution and closes the C9 firewall path
fail-closed. C16 then executed the separately approved reclaim-only closeout for
`pc3` and `pc9r2`; after-inventory is empty for both isolated `LIMA_HOME`
values.
