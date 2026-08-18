import assert from "node:assert/strict";
import test from "node:test";

import { compactRnpTable, expandRnpTable } from "../lib/rnp/compactTable";

// У крупного кабинета ответ РНП весил 8.5 МБ, из них 3.8 МБ — ОДИНАКОВЫЕ
// подписи метрик, продублированные в каждом артикуле (данных всего 0.6 МБ).
// Подписи едут словарём; закон: разжатое равно исходному, а собственные
// пометки артикула (свой note — причина пробела) не теряются.

const metric = (field: string, extra: Record<string, unknown> = {}) => ({
  field,
  label: `Метрика ${field}`,
  kind: "int",
  source: "WB Статистика",
  note: "Общая пояснительная строка источника",
  daily: [1, null, 3],
  total: 4,
  forecast: null,
  ...extra,
});

const table = {
  shop_label: "Кабинет",
  period: [{ label: "12.08", period_type: "вт" }],
  summary: [metric("orders_count"), metric("drr", { kind: "pct" })],
  skus: [
    { nm: 1, metrics: [metric("orders_count"), metric("drr", { kind: "pct" })] },
    {
      nm: 2,
      metrics: [
        metric("orders_count", { note: "Своя причина пробела у этого SKU", qualityReason: "missing_cost" }),
        metric("drr", { kind: "pct", total: null }),
      ],
    },
  ],
};

test("разжатое равно исходному по значимым данным", () => {
  const restored = expandRnpTable(compactRnpTable(structuredClone(table)));
  // Пустые (null) поля по сети не едут: весь код читает их через `!= null`,
  // поэтому отсутствие ключа и null — одно и то же состояние «нет значения».
  const meaningful = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, v) => (v === null && key !== "0" ? undefined : v)));
  assert.deepEqual(meaningful(restored.skus), meaningful(table.skus));
  // Значения и подписи на месте.
  assert.equal(restored.skus[0].metrics[0].label, "Метрика orders_count");
  assert.deepEqual(restored.skus[0].metrics[0].daily, [1, null, 3]);
  assert.equal(restored.skus[0].metrics[0].total, 4);
});

test("дневной ряд с пропусками не теряет null-дни", () => {
  const compact = compactRnpTable(structuredClone(table));
  assert.deepEqual(compact.skus[0].metrics[0].daily, [1, null, 3]);
  const restored = expandRnpTable(compact);
  assert.deepEqual(restored.skus[0].metrics[0].daily, [1, null, 3]);
});

test("общие подписи уезжают из артикулов в словарь", () => {
  const compact = compactRnpTable(structuredClone(table));
  const first = compact.skus[0].metrics[0] as Record<string, unknown>;
  assert.equal(first.label, undefined, "label должен уехать в словарь");
  assert.equal(first.source, undefined);
  assert.equal(first.note, undefined);
  // Значения остаются на месте.
  assert.deepEqual(first.daily, [1, null, 3]);
  assert.equal(first.total, 4);
  assert.equal(compact.metric_dictionary.orders_count.label, "Метрика orders_count");
});

test("собственная пометка артикула не теряется", () => {
  const compact = compactRnpTable(structuredClone(table));
  const own = compact.skus[1].metrics[0] as Record<string, unknown>;
  assert.equal(own.note, "Своя причина пробела у этого SKU");
  const restored = expandRnpTable(compact);
  assert.equal(restored.skus[1].metrics[0].note, "Своя причина пробела у этого SKU");
  assert.equal(restored.skus[1].metrics[0].label, "Метрика orders_count");
});

test("ответ без словаря (старый формат) проходит насквозь", () => {
  const asIs = expandRnpTable(structuredClone(table));
  assert.deepEqual(asIs.skus, table.skus);
});

test("сжатие реально уменьшает объём", () => {
  const before = JSON.stringify(table).length;
  const after = JSON.stringify(compactRnpTable(structuredClone(table))).length;
  assert.ok(after < before, `сжатие не сработало: ${after} ≥ ${before}`);
});
