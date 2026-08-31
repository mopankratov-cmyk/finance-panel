import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("OPiU reads exact WB finance rows and returns both date views", async () => {
  const source = await readFile(
    new URL("../lib/opiu/loadMonth.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /fetchReportRows\(dateFrom,\s*dateTo,\s*"sale",\s*brand\.cabinetId\)/);
  assert.match(source, /fetchReportRows\(dateFrom,\s*dateTo,\s*"report",\s*brand\.cabinetId\)/);
  assert.match(source, /rowsBySaleDate\(saleDateRows\)/);
  assert.match(source, /reportByReportDate/);
  assert.doesNotMatch(source, /\.from\("wb_sales"\)/);
  assert.doesNotMatch(source, /resolveWbRatesForNm/);
});

test("WB finance report sync is director-only, paginated and idempotent", async () => {
  const [route, sync, monitor, reportSync] = await Promise.all([
    readFile(
      new URL("../app/api/opiu/sync-report/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/opiu/syncReportRows.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/opiu/monitor/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/opiu/reportSync.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(route, /requireApiSession\(\["director"\]\)/);
  assert.match(route, /export const maxDuration = 300/);
  assert.match(route, /syncOpiuReportMonth\(month\)/);
  assert.match(route, /error instanceof OpiuReportCabinetNotFoundError/);
  assert.match(sync, /fetchWbReportPage/);
  assert.match(sync, /limit:\s*100_000/);
  assert.match(sync, /MAX_REPORT_PAGES\s*=\s*1_000/);
  assert.match(sync, /\.from\("wb_report_rows"\)/);
  assert.match(sync, /\.upsert\(chunk,\s*\{ onConflict: "cabinet_id,rrd_id" \}\)/);
  assert.match(reportSync, /resolveWbToken\(cabinet,\s*"statistics"\)/);
  assert.match(monitor, /export const maxDuration = 300/);
  assert.match(monitor, /syncOpiuReportPeriod\(reportPeriod,\s*b\.cabinetId\)/);
  assert.match(monitor, /opiuReportRefreshPeriod\(now\)/);
  assert.match(monitor, /key:\s*"wb-report-sync"/);
});
