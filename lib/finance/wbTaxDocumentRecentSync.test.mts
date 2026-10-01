import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../../app/api/sync/wb-tax-documents/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../components/taxes/TaxesPage.tsx", import.meta.url), "utf8");

test("WB tax documents use a rolling 60-day window instead of a yearly backfill", () => {
  assert.match(route, /const LOOKBACK_DAYS = 60/);
  assert.match(route, /recentWindow\(\)/);
  assert.doesNotMatch(route, /previousMonth|backfillComplete/);
});

test("WB tax document listing paginates the recent window", () => {
  assert.match(route, /listWbDocumentCategories\(token\)/);
  assert.match(route, /isTaxDocumentCategory\(\{ name: category\.name, category: category\.title \}\)/);
  assert.match(route, /listWbDocuments\(token, from, to, page \* PAGE_SIZE, category\.name\)/);
  assert.match(route, /MAX_LIST_PAGES_PER_CATEGORY = 20/);
});

test("tax page always shows document sync totals and cabinet diagnostics", () => {
  assert.match(page, /setDocumentSyncNotice/);
  assert.match(page, /налоговых документов \$\{totals\.matched\}/);
  assert.match(page, /Результат загрузки УПД WB/);
  assert.match(page, /Получить УПД из WB за 60 дней/);
  assert.match(page, /причины проверки/);
});

test("WB tax sync excludes cabinets outside the tax reporting scope before API calls", () => {
  assert.match(route, /filter\(\(cabinet\) => companies\.has\(cabinet\.id\)\)/);
  assert.match(route, /excludedCabinets: cabinets\.length - relevantCabinets\.length/);
});
