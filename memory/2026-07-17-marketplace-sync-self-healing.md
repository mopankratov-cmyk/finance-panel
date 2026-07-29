# Marketplace sync self-healing — 2026-07-17

## Symptoms

- Ozon advertising cache was more than 14 hours old although the hourly job kept running.
- Optima WB orders/sales exceeded the 90-minute freshness SLA after seller-wide 429 responses.
- COSMOS advert statistics remained partial and selected campaigns could be 12+ hours old.
- Optima feedback history stayed at 50% coverage.
- Several commission caches were still dated 2026-07-14.
- The first all-cabinet Sklejki request took about 72 seconds.

## Root causes

1. Ozon async Performance UUIDs were discarded after 15 seconds; every cron run created fresh reports instead of resuming them.
2. Virtual WB cabinets belonging to one seller called supplier orders/sales separately, violating the one-request-per-seller limit. Orders also treated the global 429 as fatal and did not refresh `lastSyncedAt` after a successful empty run.
3. WB advert stats processed only one 50-campaign batch per cabinet per hour; COSMOS needed about 14 batches.
4. Feedback sync alternated answered/unanswered streams but allowed only six pages per hour, so a saved 145,000-row cursor needed many hours.
5. Commission rotation ignored cache age instead of repairing the stalest or missing cabinet first.
6. Dashboard warmup was cancelled while any long cursor was incomplete and could fetch the same WB Content catalogue concurrently for PIM and Sklejki.
7. A large WB Finance report could require more than five one-minute pages; Vercel killed the request at 300 seconds and the commission cursor and partial aggregate were lost.
8. Successful partial feedback and Ozon Performance runs left a six-minute `running` lease after returning, delaying an immediate continuation.
9. Ozon advertising permanently selected only the first 60 campaigns, so a completed run could still publish a partial cache.

## Fixes

- Persist and resume Ozon Performance report UUIDs and completed batch aggregates in sync state; recreate expired UUIDs automatically.
- Group WB supplier orders/sales by seller identity from cabinet metadata or JWT organization, fan one provider response into each product scope, classify global 429 as deferred, and record successful empty-run freshness.
- Process up to four WB fullstats batches per cabinet with a 300-second budget, exact mid-run cursor persistence, and hourly fair target ordering.
- Allow up to 30 feedback pages in a 300-second run and rotate cabinet priority.
- Select the stalest commission cache before the normal time-based fallback.
- Compose all-cabinet PIM from per-cabinet hourly snapshots, warm it once before dependent dashboards, keep warming from last-good facts while long cursors catch up, and scope Sklejki feedback queries by cabinet.
- Persist the WB Finance cursor and a compact per-SKU commission accumulator after every page; resume until the terminal 204 response, then publish the cache atomically.
- Release completed partial cursors as `pending`, while keeping `running` only during the active request, so manual and scheduled continuations can start immediately.
- Include all Ozon SKU campaigns, process at most four async report batches per run, and persist completed batch aggregates. Treat a completed zero-row report as a fresh health heartbeat.

## Verification

- Full Node regression suite: 279/279 passed.
- ESLint: passed.
- Next.js production build: passed with non-secret build-only Supabase placeholders because Vercel sensitive values are not exportable locally.
- Development server: ready; `/login` returned 200 and protected `/wb/adverts` returned the expected 307 redirect without a session.

## Status

LOCAL_VERIFIED. Production checks before the final cursor patch confirmed: Optima advertising statistics fresh at 100% (88 rows); Optima Sklejki contains all three windbreakers; Ozon 1933484 recovered to a fresh cache. The remaining commission/feedback/Ozon continuation changes require deployment and a final production pass.
