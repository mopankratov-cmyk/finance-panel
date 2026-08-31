import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../components/opiu/OpiuPage.tsx", import.meta.url),
  "utf8",
);

test("Opiu page delegates request ordering to the behavioral coordinator", () => {
  assert.match(source, /createOpiuRequestCoordinator/);
  assert.match(source, /coordinator\.loadReport\(month, false\)/);
  assert.match(source, /coordinator\.loadReport\(month, true\)/);
});

test("auto-load and refresh share the guarded report loader", () => {
  assert.match(source, /coordinator\.loadReport\(month, false\)/);
  assert.match(source, /coordinator\.loadReport\(month, true\)/);
  assert.doesNotMatch(source, /const handleRefresh = async \(\) =>/);
});

test("warehouse POST wiring captures its payload and has no abort signal", () => {
  assert.match(source, /coordinator\.saveWarehouse\(\{[\s\S]{0,200}?weekStart[\s\S]{0,200}?amount/);
  assert.match(source, /body: JSON\.stringify\(payload\)/);
  assert.doesNotMatch(source, /warehouseAbort/);
});

test("warehouse saving state is scoped by report month and boundary week", () => {
  assert.match(source, /const key = `\$\{payload\.month\}:\$\{payload\.weekStart\}`/);
  assert.match(source, /savingWeeks\.has\(`\$\{month\}:\$\{week\.weekStart\}`\)/);
});

test("report activity wiring always establishes mutually exclusive flags", () => {
  assert.match(
    source,
    /onReportStart: \(\{ refresh \}\) => \{[\s\S]*setLoading\(!refresh\);[\s\S]*setRefreshing\(refresh\);[\s\S]*\}/,
  );
  // На вкладке периода у экрана своя пара флагов, поэтому кнопка смотрит на
  // «активные» — они и есть refreshing/loading для отчётного месяца.
  assert.match(source, /const activeLoading = isRangeTab \? rangeLoading : loading;/);
  assert.match(source, /const activeRefreshing = isRangeTab \? rangeRefreshing : refreshing;/);
  assert.match(source, /disabled=\{activeRefreshing \|\| activeLoading/);
});
