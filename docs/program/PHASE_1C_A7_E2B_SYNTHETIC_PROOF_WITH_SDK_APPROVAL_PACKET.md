# PANKSTER Agent Platform — Phase 1C-A7 E2B Synthetic Proof With SDK Approval Packet

## Status

READY_FOR_OWNER_REVIEW

A6 installed `e2b==2.34.0` into an isolated user-local virtualenv from the locked A5 wheelhouse. A7 prepares the separate owner approval needed to run exactly one synthetic E2B isolation proof with that SDK.

This packet does not approve execution by itself.

## Scope after exact approval

- Run the existing A4 proof runner with A6 venv Python.
- Allow one E2B control-plane API credential only through `E2B_API_KEY`.
- Create at most one synthetic E2B sandbox.
- Create sandbox with `allow_internet_access=false`.
- Pass only synthetic `PANKSTER_*` environment keys into the sandbox.
- Destroy the sandbox after the probe.
- Write sanitized evidence only.

Still forbidden:

- model provider credentials;
- production profiles;
- root `auth.json` / root credential pool;
- Gitea/Supabase/Telegram/Anthropic/OpenAI/GLM credentials;
- Keychain/auth file reads;
- gateway/canary/host-firewall changes;
- dependency download/install.

## Contract

- Path: `docs/program/PHASE_1C_A7_E2B_SYNTHETIC_PROOF_WITH_SDK_CONTRACT.ready.json`
- Schema: `pankster.phase1c-a7.e2b-synthetic-proof-with-sdk-contract.v1`
- Content SHA-256: `2537f7550e839bfdfc60ffa158de755185cb1e545e7311cb828439a207791d79`
- A6 install manifest SHA-256: `0737dcec1e4743d9f9af95b04007a5865d5cdb8781be313a9a6252057289f53b`

## Exact owner approval string

```text
APPROVE_PHASE_1C_E2B_SYNTHETIC_PROOF_WITH_SDK:p1c-20260722-e2bproofa7:2537f7550e839bfdfc60ffa158de755185cb1e545e7311cb828439a207791d79
```

Owner command SHA-256:

```text
abc50729f3ed6c6c302d2ef2d78882474d2d3ca74d09ae9a0cf246a74a386f22
```

## Required proof output

- A6 venv `e2b==2.34.0` is verified before provider call;
- runner process environment is allowlisted;
- sandbox is created with `allow_internet_access=false`;
- sandbox receives only synthetic `PANKSTER_*` keys;
- application-level outbound denial is observed;
- root auth is not readable from the sandbox;
- terminal/code child environments are sanitized;
- MCP/delegation child paths are sanitized or fail-closed;
- provider credential value is not printed;
- sandbox is destroyed after probe.

## Failure policy

- Missing `E2B_API_KEY`: fail closed before sandbox creation.
- SDK version mismatch: fail closed before provider call.
- Sandbox create failure: fail closed with sanitized error.
- Proof failure: fail closed and destroy sandbox.
- Sandbox destroy failure: block deployment review.

