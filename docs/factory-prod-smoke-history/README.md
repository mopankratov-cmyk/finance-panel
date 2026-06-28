# Factory Prod Smoke History

`lib/factory/prodSmoke.mjs` writes:

- latest report:
  - `docs/factory-latest-prod-smoke.json`
  - `docs/factory-latest-prod-smoke.md`
- archived history:
  - `docs/factory-prod-smoke-history/<timestamp>.json`
  - `docs/factory-prod-smoke-history/<timestamp>.md`

Default run:

```bash
CRON_SECRET=... node lib/factory/prodSmoke.mjs --base-url https://finance-panel-two.vercel.app --recipe 68
```

Optional write-path smoke:

```bash
CRON_SECRET=... node lib/factory/prodSmoke.mjs --base-url https://finance-panel-two.vercel.app --recipe 68 --trigger-run
```

Interpretation:

- `auth` means the production guard/session/secret is the blocker.
- `runtime` means the route itself is broken or timing out.
- `worker_infra` means the heartbeat/queue path is degraded, but this is not automatically an execution-path outage.
- `observability` means the read-only status layer is degraded.
- `provider` means an upstream AI/media dependency is degraded.
