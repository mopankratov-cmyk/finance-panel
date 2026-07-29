# Phase 1B-B4 Vendor Behavior Review 01

Status: `BACKEND_DECISION_REQUIRED`

B2-R2 and B3 together show that Apple Container CLI `1.1.0` is blocked under
the current local-only, pinned-artifact bootstrap contract.

## Confirmed local behavior

- Installed CLI:
  `container CLI version 1.1.0 (build: release, commit: 5973b9c)`.
- Current status:
  `apiserver is not running and not registered with launchd`.
- `container system start --disable-kernel-install --timeout 120` attempted to
  launch `container-apiserver`, but healthcheck failed with XPC
  `Connection invalid`.
- `container system kernel set --tar <verified-local-kata-archive> --binary ...`
  also failed with XPC `Connection invalid` and told the operator to start the
  system service first.

## External source correlation

Official Apple Container command reference says:

- `container system start` starts container services and optionally installs a
  default kernel.
- `--enable-kernel-install/--disable-kernel-install` controls default-kernel
  installation, with the default behavior being to prompt the user.
- `container system status` health-checks the API server.
- `container system kernel set` installs or updates the Linux kernel used by
  the runtime.

Upstream Apple Container issue/discussion context also shows:

- first-run kernel download integrity has been an explicit upstream concern;
- kernel resource management UX has been described as disjointed, including
  new-install `system start` downloading a kernel when a default kernel is
  missing.

## Assessment

The primary Apple Container backend is not safely progressable under the
current constraints:

```text
local pinned tar kernel provisioning
without apiserver
without vendor/default kernel download
without another system start retry
```

The key failed assumption was that `container system kernel set --tar` could
provision the kernel independently before service startup. In practice, the
installed CLI uses the same apiserver XPC path and fails when apiserver is not
registered.

## Decision options

1. `AUTHORIZE_VENDOR_BOOTSTRAP_FLOW`

   Authorize a new explicit contract for:

   ```text
   container system start --enable-kernel-install
   ```

   This is not a small retry. It authorizes Apple Container's vendor bootstrap
   path and likely network/default-kernel behavior.

2. `PAUSE_APPLE_CONTAINER_BACKEND`

   Stop Apple Container backend work and open/track vendor behavior before any
   more local runtime attempts.

3. `SWITCH_TO_FALLBACK_BACKEND_SELECTION`

   Move to the fallback backend path, starting with a separate Lima-vz
   supply-chain and install contract. This avoids continuing to expand Apple
   Container privileges around an unhealthy bootstrap path.

## Recommendation

Recommended decision:

```text
SWITCH_TO_FALLBACK_BACKEND_SELECTION_OR_PAUSE_APPLE_CONTAINER
```

Do not run another Apple Container runtime/kernel command without a new,
explicit B4 approval contract.

## Forbidden actions confirmation

Not performed:

- no `container system start` retry;
- no `container system start --enable-kernel-install`;
- no kernel provisioning retry;
- no recommended kernel download;
- no remote tar kernel install;
- no workload container start;
- no OCI pull/login/build;
- no production profiles;
- no real credentials;
- no gateway/default runtime changes;
- no canary;
- no Keychain credential creation.

Evidence:
`security/evidence/phase-1b-b4/vendor-behavior-review-summary.json`.
