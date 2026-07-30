import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { rotatingSyncTargets, stalestSyncTargets } from "../lib/sync/rotation";
import { mergeSklejkiPayloads, type SklejkiPayload } from "../lib/wb/sklejki";

test("finance screens use synced WB facts and the multi-cabinet Ozon resolver", async () => {
  const [marketplacePnl, wbLosses, opiuMonth, opiuReportRows] = await Promise.all([
    readFile(new URL("../app/api/opiu/mp/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/wb/losses/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/opiu/loadMonth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/opiu/reportRows.ts", import.meta.url), "utf8"),
  ]);
  assert.match(marketplacePnl, /loadWbCachedFinance/);
  assert.match(marketplacePnl, /getOzonCabinetScope/);
  assert.doesNotMatch(marketplacePnl, /fetchWbReportRows|getActiveOzonCreds/);
  assert.match(wbLosses, /loadWbCachedFinance/);
  assert.doesNotMatch(wbLosses, /fetchWbReportRows/);
  assert.match(opiuMonth, /fetchReportRows/);
  assert.match(opiuMonth, /from\("wb_orders"\)/);
  assert.doesNotMatch(opiuMonth, /fetchSalesReport|statistics-api\.wildberries\.ru/);
  assert.match(opiuReportRows, /from\("wb_report_rows"\)/);
  assert.doesNotMatch(opiuReportRows, /from\("wb_sales"\)/);
});

test("hourly long-running sync jobs rotate across cabinets", () => {
  const cabinets = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(rotatingSyncTargets(cabinets, { nowMs: 0 }), [{ id: "a" }]);
  assert.deepEqual(rotatingSyncTargets(cabinets, { nowMs: 60 * 60 * 1_000 }), [{ id: "b" }]);
  assert.deepEqual(rotatingSyncTargets(cabinets, { nowMs: 2 * 60 * 60 * 1_000 }), [{ id: "c" }]);
  assert.deepEqual(rotatingSyncTargets(cabinets, { requestedId: "b" }), [{ id: "b" }]);
  assert.deepEqual(rotatingSyncTargets(cabinets, { runAll: true }), cabinets);
});

test("stale-first rotation repairs missing and oldest cabinet caches before fresh ones", () => {
  const cabinets = [{ id: "missing" }, { id: "old" }, { id: "fresh" }];
  const timestamps = new Map<string, string | null>([
    ["old", "2026-07-14T00:00:00.000Z"],
    ["fresh", "2026-07-17T00:00:00.000Z"],
  ]);

  assert.deepEqual(stalestSyncTargets(cabinets, timestamps, 2), [
    { id: "missing" },
    { id: "old" },
  ]);
});

test("all-cabinet sklejki are merged from independent snapshots", () => {
  const payload = (id: number, total: number, covered: number): SklejkiPayload => ({
    groups_multi: [{ imt_id: id, shop_label: `cab-${id}`, category_label: "", skus: [] }],
    groups_solo: [],
    total_sku: total,
    multi_groups: 1,
    solo_skus: 0,
    covered,
  });
  const merged = mergeSklejkiPayloads([payload(1, 10, 8), payload(2, 20, 19)]);
  assert.equal(merged.total_sku, 30);
  assert.equal(merged.covered, 27);
  assert.equal(merged.multi_groups, 2);
  assert.deepEqual(merged.groups_multi.map((group) => group.imt_id), [1, 2]);
});
