# DEBUG REPORT — WB sync red statuses

## Symptom

On `/sync`, several WB rows/cards were red or stale:

- `feedbacks` showed `WB 422` with partial coverage.
- `Продажи WB` showed a fatal `WB 429 Limited by global limiter` for Optima — NORVIA / RIOBOX.
- Retail Family `sales` was marked overdue even though the job had recently run.

## Root cause

- Feedbacks sync persisted WB pagination `skip` cursors. WB can reject an old non-zero `skip` with 400/422, but the route treated that as a permanent red sync error instead of resetting the cursor and re-reading from the first page.
- Sales sync wrote WB seller-wide global limiter 429 into `sync_log` as a fatal error. This is a transient provider limiter and should be a deferred retry/running state, matching existing funnel/advert-stats behavior.
- Sales sync did not persist `state.lastSyncedAt` on successful runs. If a run scanned no new rows, health fell back to the newest source table timestamp, making the source look stale.

## Fix

- Added `WbFeedbacksCursorError` for WB feedback 400/422 on saved non-zero `skip`.
- Feedbacks route now resets the affected `answered`/`unanswered` cursor once before surfacing a red error.
- Sales route now classifies WB global-limiter 429 as deferred/running and returns it in `deferred[]` without writing a fatal `sync_log` error.
- Sales route now saves `lastSyncedAt` on successful runs so health reflects the actual successful sync attempt.

## Evidence

- `npm run lint` — passed.
- `npm test` — 239/239 passed.
- `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy SUPABASE_SERVICE_ROLE_KEY=dummy CRON_SECRET=dummy npm run build` — passed.

## Regression tests

- `tests/wb-feedbacks-cursor-reset.regression-1.test.mts`
- `tests/wb-sync-status-classification.regression-1.test.mts`

## Status

DONE — fix implemented and verified locally. Production red statuses should clear on the next affected sync run or after pressing the relevant `Запустить`/`Повторить` button post-deploy.
