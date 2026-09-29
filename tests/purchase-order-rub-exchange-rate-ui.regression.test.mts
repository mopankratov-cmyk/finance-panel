import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Смена валюты заказа на RUB не сбрасывала курс — «Итого заказа» и баланс
// с поставщиком (/api/purchase-orders/settlements) считались с курсом,
// оставшимся от прежней валюты (например, 12.5 от CNY). Сервер
// (normalizePurchaseOrderPayload) теперь игнорирует курс для RUB и всегда
// сохраняет 1 — этот тест фиксирует, что форма визуально не показывает
// цифру, которая на «Итого» уже не влияет.

test("выбор RUB в селекторе валюты сбрасывает курс в форме и делает поле нередактируемым", async () => {
  const source = await readFile(new URL("../components/wb/WbPurchaseOrdersTab.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /exchangeRate: currency === "RUB" \? 1 : current\.exchangeRate/,
    "переключение селектора валюты на RUB должно сбрасывать курс в форме",
  );
  assert.match(
    source,
    /form\.currency === "RUB" \? <input type="number" readOnly value=\{1\}/,
    "поле курса для RUB должно быть нередактируемым и показывать 1, а не курс от прежней валюты",
  );
});
