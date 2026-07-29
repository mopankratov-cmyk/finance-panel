import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("API uses only the period report and passes both dates", async () => {
  const source = await read("app/api/unit/table/route.ts");
  assert.match(source, /parseUnitPeriodQuery/);
  assert.match(source, /rpc\("unit_report_period",\s*\{\s*p_cabinet,\s*p_from:\s*period\.from,\s*p_to:\s*period\.to\s*\}\)/);
  assert.doesNotMatch(source, /rpc\("rnp_report"/);
  assert.doesNotMatch(source, /advertCoverage|wb_sync_state|advert[_A-Za-z]*state/i);
  assert.match(source, /periodFrom:\s*period\.from/);
  assert.match(source, /periodTo:\s*period\.to/);
  assert.match(source, /timezone:\s*UNIT_PERIOD_TIMEZONE/);
  assert.match(source, /"Заказы"/);
  assert.doesNotMatch(source, /Заказы\/мес|за 30 дней/);
});

test("UI applies two draft date inputs and fetches only applied dates", async () => {
  const source = await read("components/wb/WbUnitPage.tsx");
  assert.equal((source.match(/type="date"/g) ?? []).length, 2);
  assert.match(source, />Применить</);
  assert.match(source, /title="Unit fact"/);
  assert.doesNotMatch(source, /Unit fact (?:неделя|месяц)/i);
  assert.match(source, /from=\$\{encodeURIComponent\(appliedPeriod\.from\)\}/);
  assert.match(source, /to=\$\{encodeURIComponent\(appliedPeriod\.to\)\}/);
  assert.match(source, /\[cabinetId,[^\]]*appliedPeriod\.from,[^\]]*appliedPeriod\.to/);
});

test("migration is period-only and keeps prohibited advert/snapshot semantics out", async () => {
  const sql = await read("supabase/migrations/20260718_wb_unit_period_report.sql");
  assert.match(sql, /unit_report_period/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /revoke execute .* from public, anon, authenticated/i);
  assert.match(sql, /grant execute .* to service_role/i);
  assert.doesNotMatch(sql, /replace_wb_stocks_snapshot|wb_sync_state|advertCoverage|\bdelete\b/i);
});

test("stock and advert sync routes stay independent from unit period semantics", async () => {
  const stocks = await read("app/api/sync/stocks/route.ts");
  const advertStats = await read("app/api/sync/advert-stats/route.ts");

  for (const source of [stocks, advertStats]) {
    assert.doesNotMatch(source, /unit_report_period|parseUnitPeriodQuery|replace_wb_stocks_snapshot|advertCoverage/i);
  }

  assert.match(stocks, /chunkedUpsert\("wb_stocks", rows, "cabinet_id,nm_id,warehouse"\)/);
  assert.match(advertStats, /chunkedUpsert\("wb_advert_stats", dayRows, "cabinet_id,advert_id,date"\)/);
  assert.match(advertStats, /chunkedUpsert\("wb_advert_nm_daily", nmRows, "cabinet_id,nm_id,date"\)/);
});
