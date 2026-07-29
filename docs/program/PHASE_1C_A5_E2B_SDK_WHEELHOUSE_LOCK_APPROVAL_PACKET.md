# PANKSTER Agent Platform — Phase 1C-A5 E2B SDK Wheelhouse Lock Approval Packet

## Status

READY_FOR_OWNER_REVIEW

A4 accepted owner approval, but the execution attempt failed closed because the E2B Python SDK is not installed locally. A5 prepares the next safe dependency step: create a hash-locked wheelhouse only. It does not approve installing or importing the SDK.

## Scope

- Package: `e2b==2.34.0`
- Source: PyPI / PythonHosted only
- Action after exact approval: resolve/download wheelhouse and produce a hash manifest
- Installation: forbidden
- SDK import: forbidden
- Provider API calls: forbidden
- Sandbox creation: forbidden
- Real credentials / production profiles / gateway / canary: forbidden

## Contract

- Path: `docs/program/PHASE_1C_A5_E2B_SDK_WHEELHOUSE_LOCK_CONTRACT.ready.json`
- Schema: `pankster.phase1c-a5.e2b-sdk-wheelhouse-lock-contract.v1`
- Content SHA-256: `46c9ab5e52e015ddda80c7bfdcdac316cc1ca80140846b38e728a221e2972382`
- Primary wheel: `e2b-2.34.0-py3-none-any.whl`
- Primary wheel SHA-256: `873323571d18bf633be45e59fc6271410b30dfbc81e8df85e711f4f184c03fea`
- Wheelhouse path: `/Users/maksimpankratov/.local/pankster/e2b-sdk-wheelhouse/2.34.0`

## Exact owner approval string

```text
APPROVE_PHASE_1C_E2B_SDK_WHEELHOUSE_LOCK:p1c-20260722-e2bsdklocka5:46c9ab5e52e015ddda80c7bfdcdac316cc1ca80140846b38e728a221e2972382
```

Owner command SHA-256:

```text
898e885f11486daf94ead0382967d2f3515c507c2e750e061a815664ba153827
```

## Required output of the future approved step

- manifest listing every downloaded wheel;
- SHA-256 for every downloaded file;
- exact pinned package versions for all transitive dependencies;
- proof that no source distributions were downloaded;
- proof that no package was installed or imported;
- sanitized evidence only.

## Next gate

After A5 wheelhouse lock succeeds, A6 may request separate approval to install from that locked wheelhouse and rerun the A4 synthetic proof runner.

