# DEBUG REPORT — WB RNP scoped timeout

- Symptom: `/wb/rnp` for the scoped cabinet “Оптима — NORVIA / RIOBOX” returned HTTP 504 in production.
- Root cause hypothesis: cache miss on `/api/rnp/[shop]/table` forces live `buildRnpTable`; scoped cabinets had a small allowlist, but the code still called full-cabinet RPCs `rnp_daily_sku` and `rnp_report`, then applied `.in("nm_id", allowed)` outside the SQL function. PostgREST may execute the full function before filtering, making Optima/Retail scoped views as heavy as the whole seller.
- Fix: for non-null `allowedNmIds`, bypass full-cabinet RNP RPCs and read only allowed `nm_id` rows directly from `wb_orders`, `wb_sales`, `wb_advert_nm_daily`, `wb_stocks`, and `wb_cabinet_product_scope`, then aggregate in Node. Unscoped cabinets keep the existing RPC path.
- Evidence: added `tests/wb-rnp-scoped-fast-path.regression-1.test.mts`; full test suite passed 223/223; targeted lint passed; `next build --webpack` passed with local public Supabase env.
- Status: DONE.
