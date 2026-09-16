import assert from "node:assert/strict";
import test from "node:test";
import { combineMonthlySources } from "./monthlySourceFallback.ts";

test("сбой маркетплейсов не скрывает доступные факты ДДС", () => {
  const result = combineMonthlySources(
    { data: null, error: "WB и Ozon временно недоступны" },
    { data: { shared: { office: { amount: 100, status: "complete" } }, companies: [{ id: "c1", name: "Компания", groupName: "Группа" }] }, error: null },
  );
  assert.equal(result.error, null);
  assert.equal(result.data?.shared?.office.amount, 100);
  assert.equal(result.data?.companies?.[0].id, "c1");
});

test("сбой ДДС не скрывает доступный финансовый отчёт маркетплейсов", () => {
  const result = combineMonthlySources(
    { data: { wb: { revenue_before_spp: 1000, commission: 0, acquiring: 0, ad: 0, other: 0, cogs: 0, packaging: 0, logistics: 0, storage: 0, penalty: 0 } }, error: null },
    { data: null, error: "ДДС временно недоступен" },
  );
  assert.equal(result.error, null);
  assert.equal(result.data?.wb?.revenue_before_spp, 1000);
});

test("полный сбой оставляет экран ошибки с обеими причинами", () => {
  const result = combineMonthlySources(
    { data: null, error: "Маркетплейсы недоступны" },
    { data: null, error: "ДДС недоступен" },
  );
  assert.equal(result.data, null);
  assert.match(result.error ?? "", /Маркетплейсы недоступны.*ДДС недоступен/);
});
