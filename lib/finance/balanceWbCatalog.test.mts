import assert from "node:assert/strict";
import test from "node:test";
import { allowsProduct } from "../wb/productScope.ts";
import { balanceWbProductScope, buildBalanceWbCatalogIndex } from "./balanceWbCatalog.ts";

test("Retail Family включает только NORVIA и Heaton", () => {
  const scope = balanceWbProductScope("Retail Family", {
    brandFilters: ["norvia"],
    allowedNmIds: [101],
  });

  assert.equal(allowsProduct(scope, 101, "NORVIA"), true);
  assert.equal(allowsProduct(scope, 202, "Heaton"), true);
  assert.equal(allowsProduct(scope, 101, "RIOBOX"), false);
  assert.equal(allowsProduct(scope, 101, "Чужой бренд"), false);
});

test("Оптима включает NORVIA, Heaton и RIOBOX", () => {
  const original = { brandFilters: ["norvia", "riobox"], allowedNmIds: [101] };
  const scope = balanceWbProductScope("Оптима — NORVIA / RIOBOX", original);

  assert.equal(allowsProduct(scope, 101, "NORVIA"), true);
  assert.equal(allowsProduct(scope, 202, "Heaton"), true);
  assert.equal(allowsProduct(scope, 303, "RIOBOX"), true);
  assert.equal(allowsProduct(scope, 101, "Чужой бренд"), false);
});

test("локальный каталог индексирует артикулы отдельно по кабинетам", () => {
  const index = buildBalanceWbCatalogIndex([
    { cabinet_id: "retail", nm_id: 101, article: "NV-01", brand: "NORVIA" },
    { cabinet_id: "optima", nm_id: 101, article: "ESC-01", brand: null },
    { cabinet_id: "retail", nm_id: 202, article: null },
  ]);

  assert.deepEqual(index.get("retail")?.get(101), { article: "NV-01", brand: "norvia" });
  assert.deepEqual(index.get("optima")?.get(101), { article: "ESC-01", brand: "riobox" });
  assert.equal(index.get("retail")?.has(202), false);
});
