# PANKSTER Agent Platform — Phase 1C-A4 E2B Synthetic Isolation Proof Approval Packet

## Status

READY_FOR_OWNER_REVIEW

This packet does not approve execution by itself. It prepares the exact owner approval needed to run one synthetic E2B isolation proof in a later step.

## Scope

- Backend: `e2b_sandbox`
- Mode: synthetic-only isolation proof
- Provider API calls: forbidden before exact owner approval
- Production profiles: forbidden
- Real credentials: forbidden
- Gateway/default runtime/canary: forbidden
- Host firewall changes: forbidden
- Dependency installation: forbidden

## Contract

- Path: `docs/program/PHASE_1C_A4_E2B_SYNTHETIC_ISOLATION_PROOF_CONTRACT.ready.json`
- Schema: `pankster.phase1c-a4.e2b-synthetic-isolation-proof-contract.v1`
- Content SHA-256: `0764a641d0e2b9dfea863eb3ce28703706ba5688d38328b7c06e6fcb85574314`
- Source A3 contract file SHA-256: `c94508c6d18eea0da01726f8cf277e655d9190cdf7da0bd8dc608a93416e315c`

## Exact owner approval string

```text
APPROVE_PHASE_1C_E2B_SYNTHETIC_ISOLATION_PROOF:p1c-20260722-e2bproofa4:0764a641d0e2b9dfea863eb3ce28703706ba5688d38328b7c06e6fcb85574314
```

Approval command SHA-256:

```text
8588f01605d122707be0a39f58640d5fa35e2302148dedbf9bc42d824e2494b9
```

## Required proof properties

The subsequent execution gate must prove all of the following using sanitized evidence only:

- sandbox is created with deny-all outbound policy before user code;
- application-level outbound denial is observed;
- sandbox receives only allowlisted synthetic environment keys;
- sandbox cannot read root `auth.json`;
- terminal/code-execution child environments are sanitized;
- MCP/delegation child environments are sanitized, or unavailable in fail-closed mode;
- absent/invalid network policy fails closed before sandbox creation;
- logs/evidence do not contain secrets;
- sandbox is destroyed after the probe.

## Non-goals

This packet does not install dependencies, start production runtimes, enable production profiles, read credential files, print environment values, or call E2B APIs.

