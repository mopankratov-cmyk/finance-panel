# Debug Report: Factory CLI HTTP Timeouts

- Symptom: autonomous stress/heartbeat tooling could appear to keep working while a single HTTP request was actually stuck.
- Root cause: `lib/factory/stressGraphRun.mjs` and `lib/factory/workerHeartbeat.mjs` did not enforce a hard per-request timeout for their own HTTP calls.
- Fix: `stressGraphRun` now supports `FACTORY_STRESS_REQUEST_TIMEOUT_MS` / `--request-timeout-ms`, clamps invalid timeout config, uses `AbortController`, and records request-level run failures into the JSON/Markdown report instead of aborting the whole stress run; `workerHeartbeat` now uses `AbortSignal.timeout(15_000)` and its daemon loop logs transient POST failures instead of exiting.
- Evidence: `node --check lib/factory/stressGraphRun.mjs && node --check lib/factory/workerHeartbeat.mjs`, `npm run test:factory`, and `npx tsc --noEmit` pass.
- Regression test: `lib/factory/cliTimeouts.test.mts`.
- Status: DONE_WITH_CONCERNS. Full HTTP stress still requires a normal runtime/CI because this sandbox blocks localhost bind with `listen EPERM`.
