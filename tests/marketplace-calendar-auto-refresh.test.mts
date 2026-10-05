import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("фоновые финансовые синки обновляют опубликованный календарь WB и Ozon", () => {
  const wb = read("app/api/sync/opiu-report/route.ts");
  const ozon = read("app/api/sync/ozon-accruals/route.ts");
  const refresh = read("lib/opiu/marketplaceCalendarRefresh.ts");

  assert.match(wb, /refreshPublishedMarketplacePayouts\(\{ marketplace: "wb", cabinetId \}\)/);
  assert.match(ozon, /refreshPublishedMarketplacePayouts\(\{[\s\S]*marketplace: "ozon"/);
  assert.match(refresh, /fetchWbFinanceReportSummaries/);
  assert.match(refresh, /report\.forPaySum/);
  assert.match(refresh, /loadOzonCashFlowReports/);
  assert.match(refresh, /rowsAfterConfirmedReports/);
  assert.match(refresh, /\.in\("status", \["planned", "done"\]\)/);
});

test("ошибка автообновления не маскируется успешным Ozon cron", () => {
  const ozon = read("app/api/sync/ozon-accruals/route.ts");
  assert.match(ozon, /status: calendarError \? 502 : 200/);
});
