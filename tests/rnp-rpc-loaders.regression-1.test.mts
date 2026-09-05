import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadRnpDailySkuRows, loadRnpReportRows } from "../lib/rnp/rpcLoaders";

function fakeSupabaseRpc<Row extends Record<string, unknown>>(rows: Row[]) {
  const requested: Array<[number, number]> = [];
  const filters: Array<{ column: string; values: unknown[] }> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const db = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      let range: [number, number] = [0, 999];
      const query = {
        order() { return query; },
        range(from: number, to: number) {
          range = [from, to];
          requested.push(range);
          return query;
        },
        in(column: string, values: unknown[]) {
          filters.push({ column, values });
          return query;
        },
        then(resolve: (value: { data: Row[]; error: null }) => void) {
          return Promise.resolve({ data: rows.slice(range[0], range[1] + 1), error: null }).then(resolve);
        },
      };
      return query;
    },
  };

  return { db: db as never, requested, filters, rpcCalls };
}

test("loadRnpReportRows drains every RPC page instead of stopping at Supabase's first 1000 rows", async () => {
  const source = Array.from({ length: 2_305 }, (_, index) => ({ nm_id: index + 1, article: `A${index + 1}` }));
  const { db, requested, rpcCalls } = fakeSupabaseRpc(source);

  const rows = await loadRnpReportRows(db, null);

  assert.equal(rows.length, 2_305);
  assert.deepEqual(rows.at(-1), { nm_id: 2_305, article: "A2305" });
  assert.deepEqual(requested, [[0, 999], [1_000, 1_999], [2_000, 2_999]]);
  assert.deepEqual(rpcCalls.map((call) => call.name), ["rnp_report", "rnp_report", "rnp_report"]);
});

test("loadRnpDailySkuRows keeps cabinet and allowlist filters while paginating", async () => {
  const source = Array.from({ length: 1_005 }, (_, index) => ({
    d: "2026-07-18",
    nm_id: index + 1,
    orders_count: 1,
    orders_sum: 100,
  }));
  const { db, requested, filters, rpcCalls } = fakeSupabaseRpc(source);

  const rows = await loadRnpDailySkuRows(db, {
    from: "2026-07-01",
    to: "2026-07-31",
    cabinetId: "cab-1",
    allowedNmIds: new Set([1, 2, 3]),
  });

  assert.equal(rows.length, 1_005);
  assert.deepEqual(requested, [[0, 999], [1_000, 1_999]]);
  assert.equal(rpcCalls[0]?.name, "rnp_daily_sku");
  assert.deepEqual(rpcCalls[0]?.args, { p_from: "2026-07-01", p_to: "2026-07-31", p_cabinet: "cab-1" });
  assert.deepEqual(filters.map((filter) => filter.values), [[1, 2, 3], [1, 2, 3]]);
});

test("user-facing RNP consumers use paged loaders instead of direct RPC calls", async () => {
  const critical = [
    "../app/api/trends/route.ts",
    "../app/api/adverts/list/route.ts",
    "../app/api/abc/route.ts",
    "../app/api/design/prices/route.ts",
    "../app/api/lab/product-image/route.ts",
    "../app/api/lab/sku-list/route.ts",
    "../app/api/lab/video-storyboard/route.ts",
    "../app/api/planning/skus/route.ts",
    "../app/api/unit/calc-skus/route.ts",
    "../app/api/sklejki/route.ts",
    "../app/api/supplies/route.ts",
    "../app/api/rnp/[shop]/unit-econ/route.ts",
    "../app/api/seo/skus/route.ts",
    "../app/api/market/niches/route.ts",
    "../app/api/market/pulse/route.ts",
    "../lib/finance/wbCachedFinance.ts",
    "../lib/rnp/buildTable.ts",
    "../lib/rnp/buildRnp.ts",
    "../lib/agent/rules.ts",
  ];

  // Роуты, которым агрегат РНП не нужен ВОВСЕ. Требовать от них загрузчик
  // нельзя — они его не зовут; но запрет на голый `.rpc` остаётся в силе, иначе
  // «дешёвый» источник однажды тихо вернётся к тяжёлому.
  //
  // `ctrtest/adv-analysis` попал сюда 05.09.2026: ему от rnp_report нужны были
  // только артикул и остаток, а платил он полным агрегатом по четырём периодам
  // и на кабинете «Оптима» отдавал 500 по серверному statement timeout
  // (33,5 с). После перехода на прямые выборки — 200 за 3,6 с.
  const rpcFree = [
    "../app/api/ctrtest/adv-analysis/route.ts",
  ];

  for (const path of critical) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.rpc\("rnp_report"/, path);
    assert.doesNotMatch(source, /\.rpc\("rnp_daily_sku"/, path);
    assert.match(source, /loadRnp(?:Report|DailySku)Rows/, path);
  }

  for (const path of rpcFree) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.rpc\("rnp_report"/, path);
    assert.doesNotMatch(source, /\.rpc\("rnp_daily_sku"/, path);
    assert.doesNotMatch(source, /loadRnp(?:Report|DailySku)Rows/, path);
  }
});

test("funnel sync includes product-scope SKU before first stock or order", async () => {
  const source = await readFile(new URL("../app/api/sync/funnel/route.ts", import.meta.url), "utf8");

  assert.match(source, /from\("wb_cabinet_product_scope"\)/);
  assert.match(source, /SKU товарного контура для воронки/);
  assert.match(source, /\.\.\.productRows\.map\(\(r\) => r\.nm_id as number\)/);
});

test("token health fails when a required WB API category is missing", async () => {
  const source = await readFile(new URL("../app/api/sync/token-health/route.ts", import.meta.url), "utf8");

  assert.match(source, /missingScopes === 0/);
  assert.match(source, /Нет доступа к категориям WB API/);
});
