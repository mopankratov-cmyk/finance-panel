# 2026-07-15 — WB adverts timeout on scoped Optima cabinet

## Symptom

The WB adverts dashboard for `Оптима — NORVIA / RIOBOX` showed a client timeout:
`Рекламный кабинет не ответил за 45 секунд`.

## Root cause

`/api/adverts/list` still did two slow operations inside the interactive page request:

1. It fetched live WB advert balance without a per-request timeout.
2. It called full-cabinet `rnp_report` and only filtered the scoped NORVIA/RIOBOX SKU after the RPC returned.

For a scoped cabinet this made the adverts screen pay for unrelated seller data and allowed a slow WB balance response to hold the whole API response.

## Fix

- Added `lib/adverts/scopedReport.ts` to build advert economics from only allowlisted SKU facts for scoped cabinets.
- Switched `/api/adverts/list` to use the scoped report path when `requestAllowedNmIds()` returns a set.
- Added a 5 second timeout to the live WB advert balance fetch; balance now degrades to `null` instead of blocking the page.

## Verification

- `npm test -- tests/wb-adverts-scoped-timeout.regression-1.test.mts`
- `npx eslint app/api/adverts/list/route.ts lib/adverts/scopedReport.ts tests/wb-adverts-scoped-timeout.regression-1.test.mts`
- `npm run build`
