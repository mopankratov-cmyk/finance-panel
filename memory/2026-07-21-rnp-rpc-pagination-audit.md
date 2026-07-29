# DEBUG REPORT — RNP RPC pagination audit

- **Symptom:** RNP/Optima totals could be lower than Wildberries seller cabinet; related screens had blanks or incomplete SKU-derived aggregates.
- **Root cause:** Several user-facing code paths called Supabase RPC functions `rnp_report` / `rnp_daily_sku` directly. PostgREST/Supabase returns only the first page unless the caller explicitly ranges through all pages, so large ranges silently lost rows after 1,000.
- **Fix:** Added `lib/rnp/rpcLoaders.ts` with paged loaders and migrated all `app/` and `lib/` consumers of `rnp_report` / `rnp_daily_sku` to those loaders. Also fixed funnel sync SKU coverage, OPIU order region mapping, and token-health missing-scope status.
- **Evidence:** A production anon check before the fix showed a 2026-07-08..2026-07-21 direct `rnp_daily_sku` read returning 1,000 rows / ~4.66M ₽, while paged reads returned 6,167 rows / ~30.89M ₽. After the fix, direct RPC calls remain only inside `lib/rnp/rpcLoaders.ts`.
- **Regression test:** `tests/rnp-rpc-loaders.regression-1.test.mts` verifies pagination, allowlist preservation, user-facing direct-RPC absence, funnel SKU scope coverage, and token-health missing-scope failure.
- **Related:** Same class as prior WB scoped/timeout work: large cabinet data must use cached/paged database reads, not one-shot API/RPC calls.
- **Status:** DONE
