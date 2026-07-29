import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");
const toolbar = readFileSync(new URL("../components/wb/RnpOperatingToolbar.tsx", import.meta.url), "utf8");
const operations = readFileSync(new URL("../app/api/rnp/[shop]/operations/route.ts", import.meta.url), "utf8");
const table = readFileSync(new URL("../lib/rnp/buildTable.ts", import.meta.url), "utf8");

test("бренд и категория РНП приходят из товарных карточек", () => {
  assert.match(table, /loadCabinetPimRowsHourly/);
  assert.match(table, /brand: card\?\.brand \|\| cost\?\.brand/);
  assert.match(table, /subject: card\?\.subject \|\| cost\?\.category/);
  assert.match(toolbar, /aria-label="Бренд товара"/);
  assert.doesNotMatch(toolbar, /value=\{props\.cabinetId\}/);
  assert.match(page, /filterRnpProductFacets/);
  assert.match(page, /sortRnpProducts/);
});

test("теги фильтруют SKU, а журнал остаётся видимым после закрытия карточки", () => {
  assert.match(page, /activeTagIds\.length/);
  assert.match(page, /journalByNm/);
  assert.match(page, /journal=\{journalByNm\.get\(sku\.nm\) \?\? \[\]\}/);
  assert.match(operations, /loadJournalEntries/);
  assert.match(operations, /\.eq\("cabinet_id", cabinetId\)/);
  assert.doesNotMatch(operations, /nmParam/);
});
