# PANKSTER Agent Platform — Phase 1C-A6 E2B SDK Offline Install Approval Packet

## Status

READY_FOR_OWNER_REVIEW

A5 produced a locked wheelhouse for `e2b==2.34.0`. A6 prepares a separate approval to install that SDK into a user-local isolated virtualenv from the locked wheelhouse only.

This packet does not approve sandbox creation or E2B API calls.

## Scope

- Package: `e2b==2.34.0`
- Wheelhouse: `/Users/maksimpankratov/.local/pankster/e2b-sdk-wheelhouse/2.34.0`
- Install target: `/Users/maksimpankratov/.local/pankster/e2b-sdk-venvs/2.34.0`
- Dependency source: local wheelhouse only
- Network dependency resolution: forbidden
- PyPI access: forbidden
- Global/system Python mutation: forbidden
- Offline SDK import verification: allowed
- Provider API calls / sandbox creation: forbidden

## Contract

- Path: `docs/program/PHASE_1C_A6_E2B_SDK_OFFLINE_INSTALL_CONTRACT.ready.json`
- Schema: `pankster.phase1c-a6.e2b-sdk-offline-install-contract.v1`
- Content SHA-256: `e1f79f661e639380d66a7148d973ee6983cf21f3b9c7d467c4fe9592ca724000`
- A5 wheelhouse manifest SHA-256: `bc505cb6c572a8455a3a4b7260aee6c422a8d31eec714e8a67d5fc0da7e63077`

## Exact owner approval string

```text
APPROVE_PHASE_1C_E2B_SDK_OFFLINE_INSTALL:p1c-20260722-e2bsdkinstalla6:e1f79f661e639380d66a7148d973ee6983cf21f3b9c7d467c4fe9592ca724000
```

Owner command SHA-256:

```text
130ec9330cc0600b237f498789ed778dd75f51e64f479d35855fbffc967870ac
```

## Required output of the future approved step

- virtualenv exists under the allowed user-local path;
- install command used `--no-index`;
- install command used only the locked A5 wheelhouse;
- `e2b==2.34.0` version is verified in the virtualenv;
- offline import verification succeeds without provider credential checks;
- no E2B API call is performed;
- no sandbox is created;
- sanitized evidence is written.

## Rollback

Rollback is limited to removing:

```text
/Users/maksimpankratov/.local/pankster/e2b-sdk-venvs/2.34.0
```

Rollback hash:

```text
54c77b53387fd2f135b6645fa52e17db90758f4c3f7dc759123cd7d459e95781
```

## Next gate

After A6 succeeds, A7 may request separate approval to rerun the A4 synthetic E2B proof using the installed SDK.

