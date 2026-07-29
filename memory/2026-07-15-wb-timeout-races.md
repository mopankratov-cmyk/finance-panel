# 2026-07-15 — WB RNP/adverts timeout races

## Symptoms

- `/wb/rnp` for `Оптима — NORVIA / RIOBOX` could show a full red HTTP 504 state.
- `/wb/adverts` could show a 45-second timeout in the left campaign list even while the selected campaign details were already rendered from previous data.

## Root cause

- RNP snapshots were cached for only 1 hour. If the hourly warmup was delayed or failed after WB/DB throttling, the user-facing request could become the next cold heavy calculation and hit the serverless timeout.
- The RNP client cleared its current table before every refresh, so a same-scope retry timeout had no last-good UI to fall back to.
- The adverts client parsed the list API with raw `response.json()` and rendered `error` before existing rows, so a refresh timeout hid a valid last-good campaign list.

## Fix

- Increased the RNP snapshot last-good TTL to 12 hours while keeping the cron/warmup force-refresh behavior hourly.
- Keyed RNP and adverts data by cabinet/period so stale data is only reused for the same scope.
- Kept existing RNP/adverts data visible when a same-scope refresh times out, with an amber warning instead of a red full-screen/list blocker.
- Switched adverts list parsing to `readApiResponse` so non-JSON platform failures become readable API errors.

## Verification

- `npm test -- --test-name-pattern="WB RNP|WB adverts"` passed.
- `npm run lint -- components/wb/WbRnpPage.tsx components/wb/WbAdvertsPage.tsx lib/rnp/tableCache.ts tests/wb-rnp-cache.test.mts tests/wb-rnp-non-json-response.regression-1.test.mts tests/wb-adverts-scoped-timeout.regression-1.test.mts` passed.
- `npm run build` without env reached TypeScript and failed only on missing `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in existing `/api/opiu/warehouse`.
- `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npm run build` passed.
