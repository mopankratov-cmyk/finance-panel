import assert from "node:assert/strict";
import test from "node:test";

import { wbCardImageUrl, wbCardImageUrlCandidates } from "../lib/wb/cardImage";

// Замер 2026-08-13 последовательными HEAD-запросами с ретраями (параллельные WB режет,
// и они дают ложные «фото нет»). Это подтверждённые точки, а не оценка формулы.
const CONFIRMED: Array<{ nm: number; basket: number; note: string }> = [
  { nm: 1338781109, basket: 45, note: "NORVIA NV-01-35, vol 13387 — раньше оценивался как 53" },
  { nm: 1338781112, basket: 45, note: "NORVIA NV-01-02, vol 13387" },
  { nm: 1239272678, basket: 44, note: "RIOBOX, vol 12392" },
  { nm: 1244157226, basket: 44, note: "vol 12441" },
  { nm: 896338446, basket: 39, note: "vol 8963" },
  { nm: 755558105, basket: 35, note: "vol 7555" },
];

test("URL миниатюры попадает в подтверждённый баскет с первой попытки", () => {
  for (const { nm, basket, note } of CONFIRMED) {
    const expected = `basket-${String(basket).padStart(2, "0")}.`;
    assert.ok(wbCardImageUrl(nm).includes(expected), `${nm}: ожидался ${expected} (${note}), получено ${wbCardImageUrl(nm)}`);
  }
});

test("перебор кандидатов всё равно содержит верный баскет", () => {
  for (const { nm, basket } of CONFIRMED) {
    const urls = wbCardImageUrlCandidates(nm);
    assert.ok(urls.some((u) => u.includes(`basket-${String(basket).padStart(2, "0")}.`)), `${nm}: верного баскета нет среди кандидатов`);
  }
});

// Клиент перебирает кандидатов по onError: каждый промах — отдельный запрос к WB.
// На списке из 60 карточек промахи превращаются в лавину, которую WB начинает резать,
// и часть миниатюр остаётся пустой даже там, где баскет угадан верно.
test("верный баскет стоит одним из первых кандидатов", () => {
  for (const { nm, basket } of CONFIRMED) {
    const urls = wbCardImageUrlCandidates(nm);
    const index = urls.findIndex((u) => u.includes(`basket-${String(basket).padStart(2, "0")}.`));
    assert.ok(index >= 0 && index <= 2, `${nm}: верный баскет на позиции ${index}, значит до него будет ${index} промахов`);
  }
});

// Проверка баскета у WB — сеть, поэтому здесь тестируем только контракт функции:
// она обязана вернуть URL на каждый nmID и не падать целиком, если WB не ответил.
test("резолвер отдаёт ссылку на каждую карточку даже без ответа WB", async (t) => {
  const { wbCardImageUrlsByNmIds } = await import("../lib/wb/cardImage");
  const original = globalThis.fetch;
  // WB «молчит»: все проверки падают — значит должен сработать откат на таблицу.
  globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });

  const nmIds = [1338781109, 1239272678, 755558105];
  const urls = await wbCardImageUrlsByNmIds(nmIds);
  assert.equal(urls.size, nmIds.length);
  for (const nm of nmIds) {
    assert.match(String(urls.get(nm)), /^https:\/\/basket-\d{2}\.wbbasket\.ru\/vol\d+\/part\d+\/\d+\/images\//, `нет ссылки для ${nm}`);
  }
  // Откат идёт на подтверждённую таблицу, а не на пустоту.
  assert.match(String(urls.get(1338781109)), /basket-45\./);
});
