# Factory Stress History

Timestamped stress-run reports are written here by default.

`lib/factory/stressGraphRun.mjs` still updates:

- `docs/factory-latest-stress.json`
- `docs/factory-latest-stress.md`

It also archives each run as:

- `docs/factory-stress-history/<generated_at>.json`
- `docs/factory-stress-history/<generated_at>.md`

Disable archive writes with:

```bash
FACTORY_STRESS_ARCHIVE=false node lib/factory/stressGraphRun.mjs
```
