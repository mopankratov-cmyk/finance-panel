import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COLLECTION_WEEKDAYS, hasScheduledCollector, longestGapDays, staleAfterMs } from "../lib/assortment/collectorSchedule.ts";
import { crawlStatus, effectiveAccessStatus } from "../lib/assortment/coverage.ts";
import { BRIGHTDATA_TARGETS } from "../lib/assortment/brightdataCatalog.ts";
import { RU_SHOPS } from "../lib/assortment/ruShops.ts";
import { ZALANDO_SOURCES, ZALANDO_WEEKDAYS_UTC } from "../lib/assortment/zalando.ts";

const DAY = 24 * 3600 * 1000;

test("Самый длинный промежуток между запусками за неделю (с переходом через воскресенье)", () => {
  assert.equal(longestGapDays([0, 1, 2, 3, 4, 5, 6]), 1, "ежедневно");
  assert.equal(longestGapDays([3, 6]), 4, "ср и сб: сб→ср 4 суток");
  assert.equal(longestGapDays([1, 4]), 4, "пн и чт: чт→пн 4 суток");
  assert.equal(longestGapDays([2, 5]), 4);
  assert.equal(longestGapDays([3]), 7, "раз в неделю");
  assert.equal(longestGapDays([0]), 7);
  assert.equal(longestGapDays([]), 7);
  assert.equal(longestGapDays([6, 0]), 6, "сб и вс: вс→сб 6 суток");
});

test("Порог «давно не запускался» — по расписанию источника, не фиксированные двое суток", () => {
  assert.equal(staleAfterMs("S014") / DAY, 2.5, "ежедневный Shopify");
  assert.equal(staleAfterMs("S046") / DAY, 5.5, "ASOS: ср и сб");
  assert.equal(staleAfterMs("S001") / DAY, 8.5, "Zara: раз в неделю");
  assert.equal(staleAfterMs("S135") / DAY, 8.5, "Pompa: по воскресеньям");
  assert.equal(staleAfterMs("S999") / DAY, 2, "источник вне таблицы — прежнее поведение");
  assert.equal(staleAfterMs("") / DAY, 2);
});

const HOURS = 3600 * 1000;
const now = Date.parse("2026-10-05T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

test("Недельные источники не краснеют в норме, а настоящая тишина — краснеет", () => {
  // Zara собрана 4 суток назад (в среду, сегодня понедельник) — это норма: раньше красило «давно не запускался».
  const zara = { sourceId: "S001", lastAttemptAt: ago(4 * DAY), lastSuccessAt: ago(4 * DAY), lastError: null };
  assert.equal(crawlStatus(zara, now)?.failing, false);
  // Те же 4 суток у ежедневного Shopify — уже тишина.
  const shopify = { sourceId: "S014", lastAttemptAt: ago(4 * DAY), lastSuccessAt: ago(4 * DAY), lastError: null };
  assert.equal(crawlStatus(shopify, now)?.failing, true);
  assert.match(crawlStatus(shopify, now)?.text ?? "", /давно не запускался/);
  // Zara молчит больше недели с запасом — красим.
  const silent = { sourceId: "S001", lastAttemptAt: ago(9 * DAY), lastSuccessAt: ago(9 * DAY), lastError: null };
  assert.equal(crawlStatus(silent, now)?.failing, true);
  // Ошибка всегда красная, какой бы ни был порог.
  assert.equal(crawlStatus({ sourceId: "S001", lastAttemptAt: ago(HOURS), lastSuccessAt: ago(DAY), lastError: "HTTP 403" }, now)?.failing, true);
  // Нет попыток — источник не обходится.
  assert.equal(crawlStatus({ sourceId: "S001", lastAttemptAt: null, lastSuccessAt: null, lastError: null }, now), null);
});

const src = (sourceId: string, accessStatus: "auto_verified" | "partial" | "manual_only" | "untested" | "disabled" | "unavailable", over: { accessNote?: string | null; lastSuccessAt?: string | null } = {}) => ({
  sourceId, accessStatus, accessNote: over.accessNote ?? null, lastSuccessAt: over.lastSuccessAt ?? null,
});

test("Статус по факту: паспорт этапа 0 отстал от жизни (живые случаи прода 04.10)", () => {
  // Uniqlo в паспорте «только вручную 403 Akamai», а собирается набором — работает.
  assert.equal(effectiveAccessStatus(src("S003", "manual_only", { lastSuccessAt: ago(DAY) }), now), "auto_verified");
  // ASOS и H&M в паспорте «не проверено», собираются по средам и субботам.
  assert.equal(effectiveAccessStatus(src("S046", "untested", { lastSuccessAt: ago(2 * DAY) }), now), "auto_verified");
  assert.equal(effectiveAccessStatus(src("S007", "untested", { lastSuccessAt: ago(2 * DAY) }), now), "auto_verified");
  // Zara в паспорте «частично, только sitemap», а собирается готовым набором.
  assert.equal(effectiveAccessStatus(src("S001", "partial", { lastSuccessAt: ago(4 * DAY) }), now), "auto_verified");
});

test("«Автосбор проверен» без сборщика — это «только вручную» (Charles & Keith)", () => {
  const note = "HTML /us/, атрибут data-ga, пауза 10 с; цена отбрасывается";
  assert.equal(effectiveAccessStatus(src("S028", "auto_verified", { accessNote: note }), now), "manual_only");
  // Mango с проверкой на бота остаётся как записано.
  assert.equal(effectiveAccessStatus(src("S002", "manual_only"), now), "manual_only");
  // Не обещанного — не трогаем.
  assert.equal(effectiveAccessStatus(src("S055", "untested"), now), "untested");
});

test("Shopify-источник (по products.json в паспорте): работает, пока собирает; замолчал — «частично»", () => {
  const note = "Shopify products.json; коллекции women, new-arrivals";
  assert.equal(effectiveAccessStatus(src("S014", "auto_verified", { accessNote: note, lastSuccessAt: ago(HOURS) }), now), "auto_verified");
  assert.equal(effectiveAccessStatus(src("S014", "auto_verified", { accessNote: note, lastSuccessAt: ago(10 * DAY) }), now), "partial", "давно ничего не собрал — «проверен» фактом не подтверждено");
  assert.equal(effectiveAccessStatus(src("S014", "auto_verified", { accessNote: note, lastSuccessAt: null }), now), "partial", "ни одного успешного сбора");
});

test("Отключённое и недоступное источники остаются как есть", () => {
  assert.equal(effectiveAccessStatus(src("S025", "disabled"), now), "disabled", "DeMellier: robots запрещает");
  assert.equal(effectiveAccessStatus(src("S001", "unavailable", { lastSuccessAt: ago(HOURS) }), now), "unavailable");
});

// --- защита от расхождения таблицы с настоящими расписаниями сборщиков ---

test("Таблица расписаний сверена с сайтами РФ: дни совпадают с RU_SHOPS.weekdaysUtc", () => {
  for (const shop of RU_SHOPS) {
    assert.ok(hasScheduledCollector(shop.sourceId), `${shop.sourceId} (${shop.name}) нет в COLLECTION_WEEKDAYS — добавьте дни, иначе на экране «Источники» он будет краснеть в норме`);
    assert.deepEqual([...COLLECTION_WEEKDAYS[shop.sourceId]].sort(), [...shop.weekdaysUtc].sort(), `${shop.sourceId} ${shop.name}`);
  }
});

test("Таблица расписаний сверена с Zalando и Bright Data (дни из кронов vercel.json)", () => {
  for (const s of ZALANDO_SOURCES) {
    assert.deepEqual([...COLLECTION_WEEKDAYS[s.sourceId] ?? []].sort(), [...ZALANDO_WEEKDAYS_UTC].sort(), `${s.sourceId} ${s.name}`);
  }
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  const trigger = vercel.crons.find((c) => c.path.startsWith("/api/sync/assortment-brightdata?phase=trigger"));
  assert.ok(trigger, "в vercel.json есть крон запуска Bright Data");
  const cronDays = trigger.schedule.split(" ")[4].split(",").map(Number);
  for (const t of BRIGHTDATA_TARGETS) {
    const expected = t.weekdayUtc != null ? [t.weekdayUtc] : cronDays;
    assert.ok(hasScheduledCollector(t.sourceId), `${t.sourceId} нет в COLLECTION_WEEKDAYS`);
    assert.deepEqual([...COLLECTION_WEEKDAYS[t.sourceId]].sort(), [...expected].sort(), `${t.sourceId} (${t.method})`);
  }
  const crawl = vercel.crons.find((c) => c.path === "/api/sync/assortment-crawl");
  assert.equal(crawl?.schedule.split(" ").slice(2).join(" "), "* * *", "Shopify-обход ежедневный — таблица держит его как EVERY_DAY");
  const market = vercel.crons.find((c) => c.path === "/api/sync/assortment-ru-market");
  assert.deepEqual(COLLECTION_WEEKDAYS.S128, [Number(market?.schedule.split(" ")[4])], "«Рынок РФ» — по понедельникам");
});
