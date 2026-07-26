import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("WB RNP exposes reusable filter presets without a database dependency", () => {
  const source = readFileSync(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");

  assert.ok(source.includes("RNP_FILTER_PRESETS_STORAGE_KEY"));
  assert.ok(source.includes("SYSTEM_FILTER_PRESETS"));
  assert.ok(source.includes("Дефицит / остатки"));
  assert.ok(source.includes("Высокий ДРР"));
  assert.ok(source.includes("window.localStorage.setItem(RNP_FILTER_PRESETS_STORAGE_KEY"));
  assert.ok(source.includes("window.localStorage.getItem(RNP_FILTER_PRESETS_STORAGE_KEY"));
  assert.ok(source.includes("Сохранить текущий срез"));
  assert.ok(source.includes("applyFilterPreset"));
});

test("WB RNP user presets can restore cabinet, category, period, sort and chart metric", () => {
  const source = readFileSync(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");

  assert.ok(source.includes("cabinetId,"));
  assert.ok(source.includes("category,"));
  assert.ok(source.includes("from: range.from"));
  assert.ok(source.includes("to: range.to"));
  assert.ok(source.includes("sortField,"));
  assert.ok(source.includes("sortDirection,"));
  assert.ok(source.includes("compareMetric,"));
  assert.ok(source.includes("setCabinetId(nextCabinet)"));
  assert.ok(source.includes("setRange({ from: preset.from, to: preset.to"));
  assert.ok(source.includes("setCategory(matchingPresetCategory(preset, categories))"));
  assert.ok(source.includes('setSortField(preset.sortField ?? "orders_sum")'));
});
