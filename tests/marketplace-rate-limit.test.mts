import { strict as assert } from "node:assert";
import test from "node:test";
import { humanizeApiError } from "../components/ui/ActionableError.tsx";

// 429 от маркетплейса — «зайдите позже», а не поломка. Раньше экран план-факта
// показывал сырой JSON Ozon и советовал проверить интеграцию: человек шёл чинить
// исправное.
test("429 от Ozon читается как ограничение частоты, а не как поломка интеграции", () => {
  const copy = humanizeApiError(
    'Ozon 429: {"code":8, "message":"rate limit exceeded for `seller-api` client, current max rate per sec.: 2"}',
    "План-факт",
  );
  assert.equal(copy.title, "Ozon ограничил частоту запросов");
  assert.match(copy.action ?? "", /подождите минуту/i);
  assert.doesNotMatch(copy.action ?? "", /интеграцию и свежесть/i);
});

test("429 от WB называет своего маркетплейса", () => {
  const copy = humanizeApiError("WB 429 too many requests", "РНП");
  assert.equal(copy.title, "Wildberries ограничил частоту запросов");
});

test("401 остаётся ошибкой токена, а не частоты", () => {
  const copy = humanizeApiError("Ozon 401 unauthorized", "Юнит");
  assert.equal(copy.title, "Токен API не работает");
});
