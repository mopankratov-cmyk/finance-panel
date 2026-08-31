import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("finance payout forecast uses synchronized cabinet data instead of revoked ENV tokens", () => {
  const source = read("../lib/opiu/forecast.ts");
  assert.match(source, /import \{ fetchForecastReportRows \} from "@\/lib\/opiu\/reportRows"/);
  assert.match(
    source,
    /fetchForecastReportRows\(iso\(historyStart\),\s*iso\(historyEnd\),\s*planArticles,\s*options\.signal,\s*cabinetId\)/,
  );
  // §2/§19: план и финансовый отчёт читаются по одному cabinet_id, без смешивания кабинетов.
  assert.match(source, /deriveWbPlanForMonth\(cabinetPlan,\s*monthKey\)/);
  assert.match(source, /sales_plan_v1\?\.wb\?\.\[cabinetId\]/);
  assert.doesNotMatch(source, /fetchSalesReport/);
  assert.doesNotMatch(source, /fetchSalesFromCache/);
});

test("WB unit rebuilds an impossible empty scoped snapshot from current RNP sources", () => {
  const source = read("../app/api/unit/table/route.ts");
  assert.match(source, /allowedNmIds\.size > 0 && scopedRows\.length === 0/);
  assert.match(source, /loadRnpDailySkuRows<ScopedUnitDailyRow>/);
  assert.match(source, /loadRnpReportRows<ScopedUnitReferenceRow>/);
  assert.match(source, /mergeScopedUnitPeriodRows\(allowedNmIds/);
});

test("supplies header counts the full stock catalog, not only reorder recommendations", () => {
  const source = read("../components/wb/WbSuppliesPage.tsx");
  assert.match(source, /data\.data\?\.catalog\.length \?\? data\.skus\.length/);
});

test("RNP warmup covers the same rolling week that opens in the UI", () => {
  const source = read("../app/api/sync/dashboard-cache/route.ts");
  assert.match(source, /timeZone:\s*"Europe\/Moscow"/);
  assert.match(source, /from:\s*shiftIsoDate\(to,\s*-\(days - 1\)\)/);
  // Ключ снимка — пара дат, поэтому греются ровно пресеты экрана: неделя,
  // две недели, месяц. Квартал не греется осознанно: он не помещается в
  // бюджет функции вместе с остальными.
  assert.match(source, /\[moscowTrailingWindow\(7\), moscowTrailingWindow\(14\), currentMoscowMonth\(\)\]/);
  const rnpPage = read("../components/wb/WbRnpPage.tsx");
  assert.match(rnpPage, /start\.setDate\(start\.getDate\(\) - 6\);/, "пресет «Неделя» — последние 7 дней");
  assert.match(rnpPage, /start\.setDate\(start\.getDate\(\) - 13\);/, "пресет «2 недели» — последние 14 дней");
});
