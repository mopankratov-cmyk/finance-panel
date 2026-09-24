import assert from "node:assert/strict";
import test from "node:test";
import { allowsProduct } from "../wb/productScope.ts";
import { balanceWbProductScope, buildBalanceWbArticleIndex } from "./balanceWbCatalog.ts";

test("Баланс включает весь собственный кабинет Retail Family", () => {
  const scope = balanceWbProductScope("Retail Family", {
    brandFilters: ["norvia"],
    allowedNmIds: [101],
  });

  assert.equal(allowsProduct(scope, 101), true);
  assert.equal(allowsProduct(scope, 202), true);
});

test("Баланс сохраняет ограничение агентского кабинета Оптима", () => {
  const original = { brandFilters: ["norvia", "riobox"], allowedNmIds: [101] };
  const scope = balanceWbProductScope("Оптима — NORVIA / RIOBOX", original);

  assert.equal(scope, original);
  assert.equal(allowsProduct(scope, 101), true);
  assert.equal(allowsProduct(scope, 202), false);
});

test("локальный каталог индексирует артикулы отдельно по кабинетам", () => {
  const index = buildBalanceWbArticleIndex([
    { cabinet_id: "retail", nm_id: 101, article: "NV-01" },
    { cabinet_id: "optima", nm_id: 101, article: "ESC-01" },
    { cabinet_id: "retail", nm_id: 202, article: null },
  ]);

  assert.equal(index.get("retail")?.get(101), "NV-01");
  assert.equal(index.get("optima")?.get(101), "ESC-01");
  assert.equal(index.get("retail")?.has(202), false);
});
