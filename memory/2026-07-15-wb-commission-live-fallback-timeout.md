# DEBUG REPORT — WB RNP 504 and adverts 45s timeout

- **Symptom:** Production `/wb/rnp` for `Оптима — NORVIA / RIOBOX` returned HTTP 504, and `/wb/adverts` showed `Рекламный кабинет не ответил за 45 секунд` with an empty campaign list.
- **Root cause:** Both interactive dashboards requested `getWbCommissionForCabinet(..., 30)` during page load. If the synchronized commission cache was empty or still warming, that helper fell back to live Wildberries `reportDetailByPeriod` financial report fetching. That report can be large/slow and exceeded the UI/serverless request budget. The adverts route also read `advert_bid_changes` globally instead of cabinet-scoped.
- **Fix:** Added an explicit `allowLiveFallback` option to WB commission loading and disabled live WB financial-report fallback on interactive RNP/adverts screens. Added selected-cabinet DB indexes for the WB dashboard fact tables and scoped `advert_bid_changes` by `cabinet_id`.
- **Evidence:** `npm test` passed 236/236; `npm run lint` passed; `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npm run build` passed.
- **Regression tests:** `tests/wb-rnp-cache.test.mts`, `tests/wb-adverts-scoped-timeout.regression-1.test.mts`, `tests/wb-unit-factual-cache.regression-1.test.mts`.
- **Related:** Previous fixes kept last-good data and reduced live balance/report latency, but cold/no-commission-cache still triggered the slow financial-report path.
- **Status:** DONE.
