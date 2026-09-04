import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { humanizeApiError } from "../components/ui/ActionableError";

/**
 * Внешний селлер открыл вкладку «Конкуренты» и увидел «WB не загрузились —
 * проверьте интеграцию и свежесть синхронизации». Ни то ни другое сломано не
 * было: гейт ролей ответил 403, потому что путь /api/wb/competitors не попал в
 * разрешения роли. Человека при этом отправили чинить исправное.
 */
test("отказ по правам не выдаётся за поломку интеграции", () => {
  const copy = humanizeApiError("Внешнему селлеру доступна только WB-аналитика", "WB");
  assert.doesNotMatch(copy.title, /не загрузились/);
  assert.doesNotMatch(copy.action ?? "", /интеграц|синхрониз/i, "совет чинить сбор здесь вреден");
  assert.match(copy.detail, /Внешнему селлеру/, "текст сервера должен доехать до человека");
});

test("другие отказы по правам читаются так же", () => {
  for (const message of [
    "Нет доступа к кабинету",
    "Оператору склада доступен только модуль склада",
    "Менеджеру Ozon доступны модули Ozon и Склад",
    "Ошибка 403",
  ]) {
    const copy = humanizeApiError(message, "Данные");
    assert.doesNotMatch(copy.title, /не загрузились/, message);
    assert.doesNotMatch(copy.action ?? "", /интеграц|синхрониз/i, message);
  }
});

test("отказ по токену остаётся отказом по токену", () => {
  const copy = humanizeApiError("WB 401: access token withdrawn", "WB");
  assert.match(copy.title, /Токен WB/);
});

test("лимит частоты не путается с правами", () => {
  const copy = humanizeApiError("WB ответил 429: too many requests", "WB");
  assert.match(copy.title, /ограничил частоту/);
});

/**
 * Сам гейт: путь вкладки «Конкуренты» обязан быть в разрешениях селлера.
 * Роут для этого написан — requireApiSession пускает seller, кабинет держит
 * hasCabinetAccess, — не хватало только строки в proxy.ts.
 */
test("внешнему селлеру открыт мониторинг конкурентов своего кабинета", async () => {
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  const seller = proxy.slice(proxy.indexOf("function isSellerApiAllowed"));
  assert.match(seller, /pathname === "\/api\/wb\/competitors"/);
  assert.match(seller, /"\/api\/wb\/competitors"\)\s*return \["GET", "POST", "DELETE"\]\.includes\(method\)/);

  const route = await readFile(new URL("../app/api/wb/competitors/route.ts", import.meta.url), "utf8");
  // Открывать роль можно только там, где границу кабинета держит сам роут.
  assert.equal((route.match(/hasCabinetAccess\(cabinetId\)/g) ?? []).length, 3, "GET, POST и DELETE проверяют кабинет");
  assert.match(route, /requireApiSession\(\["director", "finance", "manager", "seller"\]\)/);
});
