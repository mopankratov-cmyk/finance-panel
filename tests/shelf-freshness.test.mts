import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatMskShort,
  missedSlotsLabel,
  SHELF_SLOT_GRACE_MINUTES,
  SHELF_SLOT_HOURS_MSK,
  shelfFreshness,
  shelfSlotStartsBetween,
  shelfStallSummary,
  type ShelfFreshnessFacts,
} from "../lib/shelf/freshness";
import { SHELF_ALERT_PREFIX, shelfAlertPlan, shelfRecoveredTelegram, shelfStallTelegram } from "../lib/shelf/freshnessAlert";

/**
 * Сборщик «Полок» на Mac mini с 21.09 по 01.10.2026 не доставил ни одного
 * снимка (907 падений `fetch failed` подряд в его логе), и панель молчала девять
 * дней. Свежесть теперь меряется пропущенными слотами 10:00 / 18:00 / 22:00 МСК,
 * и о застое пишет Telegram.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const at = (iso: string) => Date.parse(iso);
const facts = (overrides: Partial<ShelfFreshnessFacts> = {}): ShelfFreshnessFacts => ({
  activeWatches: 145,
  lastCollectedAt: "2026-09-21T19:35:11Z",
  lastIngestAt: "2026-09-21T19:35:12Z",
  snapshots: 12_000,
  ...overrides,
});

test("слоты — 10:00 / 18:00 / 22:00 по Москве, это 07:00 / 15:00 / 19:00 UTC", () => {
  assert.deepEqual(
    shelfSlotStartsBetween(at("2026-09-21T19:35:12Z"), at("2026-09-22T19:00:00Z")).map((ms) => new Date(ms).toISOString()),
    ["2026-09-22T07:00:00.000Z", "2026-09-22T15:00:00.000Z", "2026-09-22T19:00:00.000Z"],
  );
  // Полуинтервал (after, until]: слот ровно в момент последнего снимка уже покрыт.
  assert.deepEqual(shelfSlotStartsBetween(at("2026-09-22T07:00:00Z"), at("2026-09-22T07:00:00Z")), []);
  // Московская полночь — 21:00 UTC: снимок в 22:30 UTC — уже следующий день по Москве.
  assert.equal(new Date(shelfSlotStartsBetween(at("2026-09-21T22:30:00Z"), at("2026-09-22T12:00:00Z"))[0]).toISOString(), "2026-09-22T07:00:00.000Z");
  assert.deepEqual(shelfSlotStartsBetween(Number.NaN, at("2026-09-22T12:00:00Z")), []);
});

test("простой 21.09–01.10.2026: 27 пропущенных слотов к утру 01.10", () => {
  const freshness = shelfFreshness(facts(), at("2026-10-01T08:24:00Z"));
  assert.equal(freshness.state, "stalled");
  // 22.09–30.09 по три слота; 10:00 первого октября ещё в запасе на сбор.
  assert.equal(freshness.missedSlots, 27);
  assert.equal(freshness.firstMissedSlotAt, "2026-09-22T07:00:00.000Z");
  assert.equal(freshness.nextSlotAt, "2026-10-01T15:00:00.000Z");
  assert.equal(
    shelfStallSummary(freshness, at("2026-10-01T08:24:00Z")),
    "последний снимок 21.09, 22:35 МСК (10 дн назад), пропущено 27 слотов начиная с 22.09, 10:00",
  );
});

test("тревога — со второго часа после пропущенного слота, не раньше", () => {
  const graceEnd = at("2026-09-22T07:00:00Z") + SHELF_SLOT_GRACE_MINUTES * 60_000;
  // Ночная пауза 22:00→10:00 — 12 часов, это штатно.
  assert.equal(shelfFreshness(facts(), at("2026-09-22T06:59:00Z")).state, "ok");
  // Слот 10:00 начался, но круг идёт до получаса — запас ещё не вышел.
  assert.equal(shelfFreshness(facts(), graceEnd - 60_000).state, "ok");
  const late = shelfFreshness(facts(), graceEnd + 60_000);
  assert.equal(late.state, "stalled");
  assert.equal(late.missedSlots, 1);
  // Слот, собранный с опозданием (mini проснулся в 13:05), покрыт.
  assert.equal(shelfFreshness(facts({ lastCollectedAt: "2026-09-22T10:05:00Z", lastIngestAt: "2026-09-22T10:05:01Z" }), at("2026-09-22T12:00:00Z")).state, "ok");
  // Внеплановый доскок новичка в 09:50 МСК слот 10:00 не покрывает.
  assert.equal(shelfFreshness(facts({ lastCollectedAt: "2026-09-22T06:50:00Z", lastIngestAt: "2026-09-22T06:50:01Z" }), at("2026-09-22T09:30:00Z")).missedSlots, 1);
});

test("опора — самое позднее из «собрано» и «принято»: ушедшие часы mini не дают ложной тревоги", () => {
  const skewed = shelfFreshness(facts({ lastCollectedAt: "2026-09-20T07:10:00Z", lastIngestAt: "2026-09-22T15:20:00Z" }), at("2026-09-22T17:30:00Z"));
  assert.equal(skewed.state, "ok");
  assert.equal(skewed.missedSlots, 0);
});

test("нечего отслеживать или снимков ещё не было — не застой", () => {
  assert.equal(shelfFreshness(facts({ activeWatches: 0 }), at("2026-10-01T08:24:00Z")).state, "idle");
  const awaiting = shelfFreshness(facts({ lastCollectedAt: null, lastIngestAt: null, snapshots: 0 }), at("2026-10-01T08:24:00Z"));
  assert.equal(awaiting.state, "awaiting");
  assert.equal(awaiting.missedSlots, 0);
});

test("подписи по-русски", () => {
  assert.equal(missedSlotsLabel(1), "пропущен 1 слот");
  assert.equal(missedSlotsLabel(3), "пропущено 3 слота");
  assert.equal(missedSlotsLabel(11), "пропущено 11 слотов");
  assert.equal(missedSlotsLabel(21), "пропущен 21 слот");
  assert.equal(missedSlotsLabel(27), "пропущено 27 слотов");
  // Карточка «Последний сбор»: сегодня — время, раньше — дата (по Москве).
  assert.equal(formatMskShort("2026-10-01T15:30:00Z", at("2026-10-01T18:00:00Z")), "18:30");
  assert.equal(formatMskShort("2026-09-21T19:35:12Z", at("2026-10-01T08:24:00Z")), "21.09");
  // 23:30 МСК 30.09 — это 20:30 UTC того же дня, а 01:00 МСК 01.10 — уже другой день.
  assert.equal(formatMskShort("2026-09-30T20:30:00Z", at("2026-09-30T22:00:00Z")), "30.09");
});

test("тревога: одно сообщение на простой, восстановление — второе", () => {
  const now = at("2026-09-22T09:15:00Z");
  const stalled = shelfFreshness(facts(), now);
  const key = `${SHELF_ALERT_PREFIX}2026-09-21T19:35:12.000Z`;

  const first = shelfAlertPlan(stalled, []);
  assert.deepEqual(first, { send: "stalled", openKey: key, resolveKeys: [], stalledAfter: null });
  // Следующий прогон того же простоя — без повтора.
  assert.equal(shelfAlertPlan(stalled, [key]).send, null);
  // Прошлый простой закончился и сменился новым между прогонами — старый закрывается молча.
  const older = `${SHELF_ALERT_PREFIX}2026-09-18T19:30:00.000Z`;
  assert.deepEqual(shelfAlertPlan(stalled, [older]).resolveKeys, [older]);
  assert.equal(shelfAlertPlan(stalled, [older]).send, "stalled");

  const recovered = shelfFreshness(facts({ lastCollectedAt: "2026-10-01T08:41:00Z", lastIngestAt: "2026-10-01T08:41:01Z" }), at("2026-10-01T09:15:00Z"));
  assert.deepEqual(shelfAlertPlan(recovered, [key]), { send: "recovered", openKey: null, resolveKeys: [key], stalledAfter: "2026-09-21T19:35:12.000Z" });
  assert.equal(shelfAlertPlan(recovered, []).send, null, "без открытой тревоги «снова идёт» не пишем");
  // Отслеживать стало нечего — тревога закрывается без «снова идёт».
  assert.deepEqual(shelfAlertPlan(shelfFreshness(facts({ activeWatches: 0 }), now), [key]), { send: null, openKey: null, resolveKeys: [key], stalledAfter: "2026-09-21T19:35:12.000Z" });

  const text = shelfStallTelegram(stalled, now);
  assert.match(text, /^🚨 <b>Сбор «Полок» встал<\/b>\nПоследний снимок 21\.09, 22:35 МСК \(14 ч назад\), пропущен 1 слот начиная с 22\.09, 10:00\.\n/);
  assert.doesNotMatch(text.replace(/<\/?b>/g, ""), /[<>&]/, "HTML-разметка Telegram: в тексте не должно быть сырых <, >, &");
  assert.match(shelfRecoveredTelegram(recovered, "2026-09-21T19:35:12.000Z", at("2026-10-01T09:15:00Z")), /снова идёт.*\nПоследний снимок 01\.10, 11:41 МСК \(меньше часа назад\)\. Простой начался после снимка 21\.09, 22:35 МСК\./s);
});

test("крон сторожа стоит через запас после каждого слота и отвечает на GET", () => {
  const config = JSON.parse(read("../vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
  const cron = config.crons.find((item) => item.path === "/api/sync/shelf-freshness");
  assert.ok(cron, "крона сторожа нет в vercel.json");
  const [minute, hours] = cron.schedule.split(" ");
  // Слот МСК − 3 ч (UTC) + запас на сбор = час проверки по UTC.
  const expected = SHELF_SLOT_HOURS_MSK.map((hour) => (hour - 3 + SHELF_SLOT_GRACE_MINUTES / 60 + 24) % 24);
  assert.deepEqual(hours.split(",").map(Number), expected);
  assert.ok(Number(minute) > 0, "проверка чуть позже конца запаса, а не ровно в него");

  const route = read("../app/api/sync/shelf-freshness/route.ts");
  assert.match(route, /export async function GET\(/);
  assert.match(route, /checkCronAuth\(request\)/);
  assert.match(route, /loadShelfFreshnessFacts\(db, null\)/, "сторож смотрит на сборщик целиком, а не на один кабинет");
  // Сначала Telegram, потом отметка: иначе упавшая отправка навсегда «отмечена».
  assert.ok(route.indexOf("sendTelegramMessage(shelfStallTelegram") < route.indexOf('from("finance_alerts").upsert'));
  assert.ok(route.indexOf("sendTelegramMessage(shelfRecoveredTelegram") < route.indexOf('update({ status: "resolved"'));
  assert.ok(route.indexOf("if (dryRun) return") < route.indexOf("sendTelegramMessage("), "dryRun ничего не отправляет");
  assert.doesNotMatch(route, /process\.env\./, "новых секретов нет: канал — существующий FINANCE_TELEGRAM_* внутри sendTelegramMessage");
});

test("свежесть видна на «Полках», в «Синхронизации» и в «Здоровье»", () => {
  const table = read("../app/api/shelf/table/route.ts");
  assert.match(table, /loadShelfFreshnessFacts\(db, cabinetId\)\s*\.then\(\(facts\) => shelfFreshness\(facts\)\)\s*\.catch\(\(\) => null\)/, "свежесть не роняет экран");
  assert.match(table, /\{ items, days, freshness \}/);

  const page = read("../components/wb/WbShelfPage.tsx");
  assert.match(page, /freshness\?\.state === "stalled" \? \(\s*<div role="alert"/);
  assert.match(page, /shelfStallSummary\(freshness\)/);
  assert.doesNotMatch(page, /\[10, 18, 22\]/, "слоты — из lib/shelf/freshness.ts, а не своей копией");

  const syncHealth = read("../app/api/wb/sync-health/route.ts");
  assert.match(syncHealth, /loadShelfFreshnessFacts\(db, cabinet\.id\)/);
  assert.match(syncHealth, /\.\.\.\(shelf \? \[shelf\] : \[\]\)/);
  const syncPage = read("../components/sync/SyncPage.tsx");
  // Сборщик на mini из панели не перезапустить — кнопки нет совсем, а не серая.
  assert.match(syncPage, /source\.external \? <span[^>]*>сборщик на Mac mini<\/span> : <button onClick=\{\(\) => runJob\(source\.job, cabinet\.id\)\}/);
  assert.match(syncPage, /source\.coveragePct == null \? "—"/);

  const health = read("../app/api/operational-health/route.ts");
  assert.match(health, /loadShelfFreshnessFacts\(db, cabinetId\)\.catch\(\(\) => null\)/);
  assert.match(health, /state: shelf\.state === "stalled" \? "error"/, "застой — ошибка, она же уходит в «Требует внимания»");
});
