import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { wbDashboardWarmUrl } from "../lib/wb/dashboardWarmup";
import { resolveWbRatesForNm, type WbCommission } from "../lib/wb/commissions";

test("unit economics reads the synchronized commission snapshot before live WB reports", async () => {
  const source = await readFile(new URL("../lib/wb/commissions.ts", import.meta.url), "utf8");
  const cabinetFunction = source.slice(source.indexOf("export async function getWbCommissionForCabinet"), source.indexOf("async function getWbCommissionFromCache"));
  assert.match(cabinetFunction, /getWbCommissionFromCache\(cabinetId\)/);
  assert.ok(cabinetFunction.indexOf("getWbCommissionFromCache") < cabinetFunction.indexOf("getWbCabinet"));
  assert.match(source, /nmQuery = nmQuery\.eq\("cabinet_id", cabinetId\)/);
  assert.match(source, /overheadQuery = overheadQuery\.eq\("cabinet_id", cabinetId\)/);
});

test("unit economics includes extra WB charges and suppresses recommendations without factual inputs", async () => {
  const table = await readFile(new URL("../app/api/unit/table/route.ts", import.meta.url), "utf8");
  const solver = await readFile(new URL("../app/api/unit/price-solver/route.ts", import.meta.url), "utf8");
  assert.match(table, /resolveWbRatesForNm\(comm, r\.nm_id\)/);
  assert.match(table, /canCalculate = price > 0 && costKnown && rates\.factual/);
  assert.match(table, /targetPrice = canCalculate && den > 0/);
  assert.doesNotMatch(table, /const cost = Number\(r\.cost \?\? 0\)/);
  assert.match(solver, /расчёт цены на дефолтах отключён/);
});

test("zero per-SKU rates fall back to factual cabinet averages instead of masquerading as fact", () => {
  const commission: WbCommission = {
    byNm: new Map([[101, { pct: 0, acqPct: 0, extraPct: 3, rev: 10_000 }]]),
    avgPct: 21,
    avgAcqPct: 1.6,
    avgExtraPct: 4,
    overheadPct: 2,
  };

  assert.deepEqual(resolveWbRatesForNm(commission, 101), {
    commissionPct: 21,
    acquiringPct: 1.6,
    extraPct: 3,
    overheadPct: 2,
    marketplacePct: 26,
    factual: true,
    source: "mixed",
  });
});

test("unit economics refuses a zero-rate snapshot", () => {
  const commission: WbCommission = {
    byNm: new Map([[101, { pct: 0, acqPct: 0, extraPct: 0, rev: 0 }]]),
    avgPct: 0,
    avgAcqPct: 0,
    avgExtraPct: 0,
    overheadPct: 0,
  };

  assert.equal(resolveWbRatesForNm(commission, 101).factual, false);
  assert.equal(resolveWbRatesForNm(commission, 101).source, "missing");
});

test("hourly warmup prepares the unit table for every cabinet scope", () => {
  const url = new URL(wbDashboardWarmUrl("https://panel.test", "unit", { cabinetId: "cab-a", label: "Cab A" }));
  assert.equal(url.pathname, "/api/unit/table");
  assert.equal(url.searchParams.get("cabinet"), "cab-a");
  assert.equal(url.searchParams.get("refresh"), "1");
  assert.equal(url.searchParams.has("background"), false);
});
