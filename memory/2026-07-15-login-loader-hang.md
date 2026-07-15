# DEBUG REPORT — login stuck on "Загрузка..."

## Symptom

In `IMG_6328.mp4`, a user logs into `finance-panel-two.vercel.app` and after pressing "Войти" sees the full-screen spinner "Загрузка..." for the rest of the recording instead of the dashboard launcher.

## Root cause

The app shell gated every non-login page on legacy `FinanceProvider` hydration. The launcher `/` and operational dashboards do not need legacy finance tables, but they were still blocked while the provider loaded `accounts`, `payments`, and `loans` directly from Supabase in the browser. If those client requests hang on a workstation/network, the app remains on the global loader.

There was also no client-side timeout for the finance bootstrap, so a stuck Supabase request could keep a real finance page spinning indefinitely.

## Fix

- Added `needsFinanceHydration()` so only legacy finance-backed pages (`/accounts`, `/calendar`, `/loans`, `/payments`) show the finance hydration gate.
- `AppLayout` no longer blocks `/`, `/sync`, WB, Ozon, and other non-finance screens on legacy finance hydration.
- Added a 12-second timeout around the finance bootstrap so finance pages surface a readable error instead of an endless spinner.

## Evidence

- `npm run lint` — passed.
- `npm test` — 242/242 passed.
- `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy SUPABASE_SERVICE_ROLE_KEY=dummy CRON_SECRET=dummy npm run build` — passed.

## Regression test

- `tests/login-loader.regression-1.test.mts`

## Status

DONE — root cause found, fix implemented, regression test added, full verification passed locally.
