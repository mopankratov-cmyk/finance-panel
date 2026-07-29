# WB Finance report sync recovery — 2026-07-17

## Status

DONE. Production verification completed on `finance-panel-two.vercel.app`.

## Symptom

- WB commission snapshots stopped updating after 2026-07-14.
- The hourly sync first failed with `Unexpected end of JSON input`.
- After migrating the endpoint, manual runs exposed `429 Too Many Requests` and then a Vercel `504` at 60 seconds.

## Root cause

1. The legacy `statistics-api` detailed report endpoint was retired on 2026-07-15.
2. The replacement Finance API returns camelCase fields and uses HTTP 204 as the terminal pagination response.
3. The client parsed the terminal 204 as JSON and did not normalize the new response shape.
4. WB publishes the retry delay in `X-Ratelimit-Retry`; the generic retry helper ignored it.
5. The Finance endpoint allows one request per minute with burst 1. A successful first page plus the terminal pagination request therefore exceeds a 60-second serverless execution window.

## Fix

- PR #269: switched to `POST /api/finance/v1/sales-reports/detailed`, handled 204, requested only required fields, and normalized camelCase at the API boundary.
- PR #270: honored `X-Ratelimit-Retry` before generic `Retry-After` handling.
- PR #271: raised the commission and trigger route duration to 300 seconds.

## Regression coverage

- Terminal 204 does not attempt JSON parsing.
- Finance API request method, URL, request body, and normalized result are asserted.
- `X-Ratelimit-Retry` is converted from seconds to milliseconds.
- Both commission execution routes assert `maxDuration = 300`.
- Full test suite: 265 passing; TypeScript, ESLint, and development startup checks passed.

## Production evidence

- Deployment `finance-panel-o7xpc74a4-pankman-100-s-projects.vercel.app` is Ready and aliased to `finance-panel-two.vercel.app`.
- Manual CLERIN commission sync completed at 2026-07-17 15:40 MSK.
- Result: `commissions / ok`, 13 rows, 63.4 seconds; source status changed from `просрочено` to `свежо`.

## Related

- `memory/2026-07-15-wb-commission-live-fallback-timeout.md`
- `memory/2026-07-12-api-sync-integration-fixes.md`
