import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ASSORTMENT_ALERT_PREFIX,
  assortmentAlertPlan,
  assortmentFreshness,
  assortmentRecoveredTelegram,
  assortmentStallMessage,
  assortmentStallTelegram,
  escapeTelegramHtml,
  isWatched,
  sourceFreshness,
  type SourceFact,
} from "../lib/assortment/freshness.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const DAY = 24 * 3600 * 1000;
const HOURS = 3600 * 1000;
const now = Date.parse("2026-10-09T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

const fact = (sourceId: string, over: Partial<SourceFact> = {}): SourceFact => ({
  sourceId, name: over.name ?? sourceId, lastAttemptAt: ago(DAY), lastSuccessAt: ago(DAY), lastError: null, ...over,
});

test("Крон заведён раз в сутки после сборов (12:30 МСК), роут отвечает на GET под cron-авторизацией", () => {
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons.filter((c) => c.path === "/api/sync/assortment-freshness"), [{ path: "/api/sync/assortment-freshness", schedule: "30 9 * * *" }]);
  const route = readFileSync(join(root, "app/api/sync/assortment-freshness/route.ts"), "utf8");
  assert.match(route, /export async function GET/, "Vercel зовёт кроны GET");
  assert.match(route, /checkCronAuth\(request\)/);
  assert.match(route, /dryRun/, "есть пробный прогон без отправки");
});

test("Источник собирает: свежий успех — ok; молчит дольше порога по расписанию — stalled", () => {
  // Ежедневный Shopify (порог 2,5 сут): 1 сутки — норма, 4 — молчит.
  assert.equal(sourceFreshness(fact("S014", { lastSuccessAt: ago(DAY) }), now).state, "ok");
  assert.equal(sourceFreshness(fact("S014", { lastSuccessAt: ago(4 * DAY) }), now).state, "stalled");
  // Zara раз в неделю (порог 8,5 сут): 6 суток — норма, 10 — молчит.
  assert.equal(sourceFreshness(fact("S001", { lastSuccessAt: ago(6 * DAY) }), now).state, "ok");
  const silent = sourceFreshness(fact("S001", { lastSuccessAt: ago(10 * DAY) }), now);
  assert.equal(silent.state, "stalled");
  assert.equal(silent.silentDays, 10);
});

test("Тихая поломка: сборщик пытается и «успешен», но ничего не приносит — это молчание", () => {
  // last_success_at ставится, только если что-то собрано: сайт сменил разметку и отдаёт ноль карточек.
  const broken = sourceFreshness(fact("S131", { lastAttemptAt: ago(HOURS), lastSuccessAt: ago(9 * DAY), lastError: null }), now);
  assert.equal(broken.state, "stalled", "попытки свежие, а собрано давно");
});
test("Не было успешных сборов: с ошибкой — не работает, без попыток — судить рано", () => {
  assert.equal(sourceFreshness(fact("S138", { lastAttemptAt: ago(HOURS), lastSuccessAt: null, lastError: "HTTP 403" }), now).state, "stalled");
  assert.equal(sourceFreshness(fact("S138", { lastAttemptAt: null, lastSuccessAt: null, lastError: null }), now).state, "awaiting");
  assert.equal(sourceFreshness(fact("S138", { lastAttemptAt: ago(HOURS), lastSuccessAt: null, lastError: null }), now).state, "awaiting", "попытка без ошибки и без сбора — ещё не повод");
});

test("Сторожим только источники с настоящим сборщиком; «Lime на Wildberries» (собирать нечего) — исключён", () => {
  assert.equal(isWatched("S001"), true);
  assert.equal(isWatched("S028"), false, "Charles & Keith: обходчика нет — молчать нечему");
  assert.equal(isWatched("S055"), false, "непроверенный источник");
  assert.equal(isWatched("S129"), false, "у LIME на WB нет продаж — по построению ничего не собирает");
  const f = assortmentFreshness([
    fact("S129", { lastSuccessAt: ago(30 * DAY) }),
    fact("S028", { lastSuccessAt: null, lastAttemptAt: null }),
    fact("S014", { lastSuccessAt: ago(DAY) }),
    fact("S001", { lastSuccessAt: ago(20 * DAY), name: "Zara" }),
  ], now);
  assert.deepEqual(f.sources.map((s) => s.sourceId), ["S001", "S014"], "отсортированы, лишних нет");
  assert.equal(f.state, "stalled");
  assert.deepEqual(f.stalled.map((s) => s.sourceId), ["S001"]);
});

test("Всё собирает — состояние ok и тревоги нет", () => {
  const f = assortmentFreshness([fact("S014"), fact("S001", { lastSuccessAt: ago(4 * DAY) }), fact("S046", { lastSuccessAt: ago(2 * DAY) })], now);
  assert.equal(f.state, "ok");
  assert.equal(f.stalled.length, 0);
});

const stalledFor = (...ids: string[]) => assortmentFreshness(ids.map((id) => fact(id, { lastSuccessAt: ago(30 * DAY) })), now);
const okState = () => assortmentFreshness([fact("S014")], now);

test("Один простой — одно сообщение: пока набор молчащих тот же, повтора нет", () => {
  const first = assortmentAlertPlan(stalledFor("S001", "S046"), []);
  assert.equal(first.send, "stalled");
  assert.equal(first.openKey, `${ASSORTMENT_ALERT_PREFIX}S001,S046`);
  const again = assortmentAlertPlan(stalledFor("S046", "S001"), [first.openKey!]);
  assert.equal(again.send, null, "тот же набор в другом порядке — не новое сообщение");
  assert.deepEqual(again.resolveKeys, []);
});

test("Замолчал ещё один источник — новое сообщение, прежняя тревога закрывается молча", () => {
  const prior = `${ASSORTMENT_ALERT_PREFIX}S001`;
  const next = assortmentAlertPlan(stalledFor("S001", "S046"), [prior]);
  assert.equal(next.send, "stalled");
  assert.equal(next.openKey, `${ASSORTMENT_ALERT_PREFIX}S001,S046`);
  assert.deepEqual(next.resolveKeys, [prior]);
});

test("Все заговорили — одно сообщение «снова идёт» и тревога закрыта; чужие тревоги не трогаем", () => {
  const prior = `${ASSORTMENT_ALERT_PREFIX}S001`;
  const done = assortmentAlertPlan(okState(), [prior, "shelf-collector-stalled:2026-09-21T00:00:00Z"]);
  assert.equal(done.send, "recovered");
  assert.equal(done.openKey, null);
  assert.deepEqual(done.resolveKeys, [prior], "тревога «Полок» не наша — не закрываем");
  assert.equal(assortmentAlertPlan(okState(), []).send, null, "тревог не было — и сообщения нет");
});

test("Сообщение: названия с & экранируются, список режется, есть что делать", () => {
  assert.equal(escapeTelegramHtml("H&M <b>"), "H&amp;M &lt;b&gt;");
  const f = assortmentFreshness([
    fact("S007", { name: "H&M", lastSuccessAt: ago(12 * DAY) }),
    fact("S138", { name: "Pull&Bear (Zalando)", lastSuccessAt: null, lastAttemptAt: ago(HOURS), lastError: "HTTP 403 <captcha>" }),
  ], now);
  const text = assortmentStallTelegram(f);
  assert.match(text, /^🚨 <b>Сбор ассортимента: молчат источники \(2\)<\/b>/);
  assert.ok(text.includes("H&amp;M — последний успешный сбор"), "& экранирован");
  assert.ok(text.includes("12 сут назад"));
  // Zalando приносит Mac mini, но молчит один он — это его поломка, а не простой mini: своей строкой; ошибка и название экранированы.
  assert.ok(text.includes("• Pull&amp;Bear (Zalando) — успешных сборов не было; ошибка: HTTP 403 &lt;captcha&gt;"), "ошибка экранирована");
  assert.doesNotMatch(text, /Mac mini — молчат/, "один сайт через mini — не «Mac mini молчит»");
  assert.match(text, /Откройте «Разработка ассортимента → Источники»/);
  assert.ok(!/<(?!\/?b>)/.test(text), "в тексте нет посторонней разметки");

  // Источники mini (S131–S134, S136–S140) — одной строкой: 11 обычных + строка mini = 12 строк.
  const many = assortmentFreshness(["S014", "S024", "S026", "S027", "S001", "S003", "S046", "S007", "S130", "S135", "S128", "S131", "S132"].map((id) => fact(id, { lastSuccessAt: ago(30 * DAY) })), now);
  const long = assortmentStallTelegram(many);
  assert.match(long, /…и ещё 2/, "показаны 10 строк, остальные — числом");
  assert.equal((long.match(/^• /gm) ?? []).length, 10);
  assert.equal(assortmentStallMessage(f), "Молчат сборщики ассортимента (2): H&M, Pull&Bear (Zalando)");
  assert.match(assortmentRecoveredTelegram(), /снова идёт/);
});

test("Shopify-источник, подключённый позже таблицы расписаний (products.json в паспорте), тоже под сторожем — ежедневно", () => {
  const hint = { accessStatus: "auto_verified", accessNote: "Shopify products.json; коллекции new" };
  assert.equal(isWatched("S150"), false, "без подсказки неизвестный источник не сторожим");
  assert.equal(isWatched("S150", hint), true);
  const late = { ...fact("S150", { lastSuccessAt: ago(4 * DAY) }), ...hint };
  assert.equal(sourceFreshness(late, now).state, "stalled", "ежедневный: 4 суток без успеха — молчит");
  assert.equal(sourceFreshness({ ...late, lastSuccessAt: ago(DAY) }, now).state, "ok");
  const f = assortmentFreshness([late, fact("S028", { lastSuccessAt: null, lastAttemptAt: null })], now);
  assert.deepEqual(f.sources.map((s) => s.sourceId), ["S150"], "Charles & Keith (нет обходчика) по-прежнему не сторожится");
});
