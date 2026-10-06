import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  jobFreshness, jobsAlertPlan, jobsFreshness, jobsRecoveredTelegram, jobsStallMessage, jobsStallTelegram, JOBS_ALERT_PREFIX, WATCHED_JOBS, WATCHED_JOB_NAMES,
  type JobRun,
} from "../lib/assortment/jobsWatch.ts";

/** Сторож служебных задач движка: срезы спроса WB и признаки по фото пишут не в источники, а в свои таблицы. */

const NOW = Date.parse("2026-10-20T12:00:00Z");
const WB = WATCHED_JOBS[0];
const AI = WATCHED_JOBS[1];
const hoursAgo = (h: number) => new Date(NOW - h * 3600 * 1000).toISOString();
const run = (job: string, status: JobRun["status"], h: number, error: string | null = null): JobRun => ({ job, status, error, started_at: hoursAgo(h) });
const series = (job: string, statuses: JobRun["status"][], stepH = 6, error = "boom"): JobRun[] => statuses.map((s, i) => run(job, s, i * stepH, s === "error" ? error : null));

test("Журнала нет — «ждём»: задача ещё не выкладывалась, тревоги нет", () => {
  const f = jobFreshness(WB, [], NOW);
  assert.equal(f.state, "awaiting");
  assert.equal(jobsFreshness([], NOW).state, "ok");
});

test("Ошибки подряд: срезы WB — 8 подряд (двое суток), ИИ — 3; одна успешная между ними обнуляет серию", () => {
  assert.equal(jobFreshness(WB, series(WB.job, Array(7).fill("error")), NOW).state, "ok", "7 ошибок — ещё не 8");
  const stalled = jobFreshness(WB, series(WB.job, Array(8).fill("error")), NOW);
  assert.equal(stalled.state, "stalled");
  assert.match(String(stalled.reason), /8 прогонов подряд/);
  assert.equal(stalled.lastError, "boom");
  assert.equal(jobFreshness(WB, series(WB.job, ["error", "error", "error", "error", "ok", "error", "error", "error", "error"]), NOW).state, "ok", "ok посередине");
  assert.equal(jobFreshness(AI, series(AI.job, ["error", "error"], 2), NOW).state, "ok");
  assert.equal(jobFreshness(AI, series(AI.job, ["error", "error", "error"], 2, "Anthropic: на счёте нет средств"), NOW).state, "stalled");
  assert.equal(jobFreshness(AI, series(AI.job, ["partial", "error", "error", "error"], 2), NOW).state, "ok", "свежий partial — работа идёт");
});

test("Тишина крона: срезы WB — 3 суток без записей в журнале; у ИИ тишина не судится (журнал только когда была работа)", () => {
  assert.equal(jobFreshness(WB, [run(WB.job, "ok", 71)], NOW).state, "ok", "2 суток 23 часа");
  const silent = jobFreshness(WB, [run(WB.job, "ok", 72)], NOW);
  assert.equal(silent.state, "stalled");
  assert.match(String(silent.reason), /нет прогонов 3 сут/);
  assert.equal(jobFreshness(AI, [run(AI.job, "ok", 24 * 20)], NOW).state, "ok", "ИИ разобрал всё и молчит — это не поломка");
});

test("Прогоны чужих задач не смешиваются; порядок записей не важен", () => {
  const runs = [...series(WB.job, Array(8).fill("error")), ...series(AI.job, ["ok", "ok", "ok"], 2)].reverse();
  const f = jobsFreshness(runs, NOW);
  assert.deepEqual(f.stalled.map((j) => j.job), [WB.job]);
  assert.equal(f.jobs.find((j) => j.job === AI.job)?.state, "ok");
});

test("Серия считается от самого свежего прогона, а не от первой строки выборки: старые ошибки и свежий успех — не поломка", () => {
  const oldestFirst = [...series(WB.job, ["ok", ...Array(8).fill("error")])].reverse();
  assert.equal(oldestFirst[0].status, "error", "в выборке первыми идут старые ошибки");
  assert.equal(jobFreshness(WB, oldestFirst, NOW).state, "ok", "свежий прогон ok");
  assert.equal(jobFreshness(WB, [...oldestFirst].reverse(), NOW).state, "ok", "порядок записей не важен");
});

test("Тревога: один набор — одно сообщение; другой набор — новое, прежнее закрывается; все ожили — «восстановлено»", () => {
  const down = jobsFreshness(series(WB.job, Array(8).fill("error")), NOW);
  const first = jobsAlertPlan(down, []);
  assert.equal(first.send, "stalled");
  assert.equal(first.openKey, `${JOBS_ALERT_PREFIX}${WB.job}`);
  assert.equal(jobsAlertPlan(down, [first.openKey!]).send, null, "повтора нет");
  const both = jobsFreshness([...series(WB.job, Array(8).fill("error")), ...series(AI.job, ["error", "error", "error"], 2)], NOW);
  const second = jobsAlertPlan(both, [first.openKey!]);
  assert.equal(second.send, "stalled");
  assert.deepEqual(second.resolveKeys, [first.openKey]);
  assert.equal(second.openKey, `${JOBS_ALERT_PREFIX}${[AI.job, WB.job].sort().join(",")}`);
  const ok = jobsFreshness([], NOW);
  const recovered = jobsAlertPlan(ok, [second.openKey!, "assortment-collectors-stalled:S001"]);
  assert.equal(recovered.send, "recovered");
  assert.deepEqual(recovered.resolveKeys, [second.openKey], "тревоги сторожа источников не трогаем");
  assert.equal(jobsAlertPlan(ok, []).send, null);
});

test("Тексты: названия и ошибка экранированы для Telegram, есть куда смотреть", () => {
  const down = jobsFreshness(series(AI.job, ["error", "error", "error"], 2, "Anthropic: <на счёте> нет средств & лимит"), NOW);
  const text = jobsStallTelegram(down);
  assert.match(text, /^🚨 <b>Движок тенденций: задачи остановились \(1\)<\/b>/);
  assert.match(text, /&lt;на счёте&gt; нет средств &amp; лимит/);
  assert.doesNotMatch(text, /<на счёте>/);
  assert.match(text, /sync_log/);
  assert.match(jobsStallMessage(down), /Признаки каталога по фото/);
  assert.match(jobsRecoveredTelegram(), /снова работают/);
});

test("Сторож подключён: имена задач совпадают с теми, что пишут в sync_log, а сбой сторожа задач не роняет сторож источников", () => {
  const root = join(import.meta.dirname, "..");
  const jobOf = (path: string) => /const JOB = "([^"]+)"/.exec(readFileSync(join(root, path), "utf8"))?.[1];
  // Роут признаков по фото может прийти в main позже сторожа: проверяем те роуты, что уже есть.
  const routes = ["app/api/sync/assortment-wb-queries/route.ts", "app/api/sync/assortment-catalog-ai/route.ts", "app/api/sync/assortment-social/route.ts"].filter((p) => existsSync(join(root, p)));
  assert.ok(routes.length >= 1);
  for (const path of routes) assert.ok(WATCHED_JOB_NAMES.includes(jobOf(path) ?? ""), `${path}: имя задачи в журнале должно быть в списке сторожа`);
  const route = readFileSync(join(root, "app/api/sync/assortment-freshness/route.ts"), "utf8");
  assert.match(route, /async function watchJobs/);
  assert.match(route, /catch \(error\) \{\s*return \{ error:/, "ошибка сторожа задач возвращается значением, а не бросается");
});

test("Ф1: метка причины остановки (`[stop:…]`) из строки журнала в Telegram не попадает — текст ошибки остаётся", () => {
  const runs = Array.from({ length: 3 }, (_, i) => ({ job: "assortment-catalog-ai", status: "error" as const, error: "Polza: на счёте нет средств [stop:billing]", started_at: `2026-10-06T0${i}:40:00Z` }));
  const text = jobsStallTelegram(jobsFreshness(runs, Date.parse("2026-10-06T10:00:00Z")));
  assert.match(text, /ошибка: Polza: на счёте нет средств/);
  assert.doesNotMatch(text, /\[stop:/);
});

test("Ф2: «нет денег» у Bright Data — одна тревога на провайдера: запуск, сбор и рилсы с [stop:billing] дают один ключ и одну строку; новый 402 той же остановки — без повтора", () => {
  const billing = "Bright Data: нет денег или аккаунт не активен (402): Customer is not active [stop:billing]";
  const tuesday = [run("assortment-social", "error", 30, billing)];
  const first = jobsAlertPlan(jobsFreshness(tuesday, NOW), []);
  assert.equal(first.send, "stalled", "рилсы упёрлись в 402 — тревога сразу, не через три дня");
  assert.equal(first.openKey, `${JOBS_ALERT_PREFIX}billing:brightdata`);
  // Среда: запуск и сбор Bright Data — тоже 402. Остановка та же — сообщения нет.
  const wednesday = [...tuesday, run("assortment-brightdata-trigger", "error", 7, billing), run("assortment-brightdata-collect", "error", 5, billing)];
  const down = jobsFreshness(wednesday, NOW);
  assert.deepEqual(down.stalled.map((j) => j.job).sort(), ["assortment-brightdata-collect", "assortment-brightdata-trigger", "assortment-social"]);
  assert.equal(jobsAlertPlan(down, [first.openKey!]).send, null, "та же остановка провайдера — без потока сообщений");
  const text = jobsStallTelegram(down);
  assert.equal((text.match(/^• /gm) ?? []).length, 1, "одна строка на провайдера");
  assert.match(text, /• Bright Data — нет денег у провайдера или аккаунт не активен \(402\) — платные запуски остановлены; задачи: /);
  assert.doesNotMatch(text, /\[stop:/);
  // Пополнили: покупка прошла (запуск купил выборки, рилсы сделали замеры) — «снова работают».
  const paid = (job: string, rows: number) => ({ ...run(job, "ok", 1), rows_affected: rows });
  const recovered = jobsFreshness([...wednesday, paid("assortment-social", 12), paid("assortment-brightdata-trigger", 4), run("assortment-brightdata-collect", "ok", 1)], NOW);
  assert.equal(jobsAlertPlan(recovered, [first.openKey!]).send, "recovered");
});

test("Ф2: прочие сбои запуска и сбора Bright Data сторож задач не судит (за ними следит сторож источников) — только «нет денег»", () => {
  const plain = Array.from({ length: 6 }, (_, i) => run("assortment-brightdata-collect", "error", i * 24, "S001: HTTP 500"));
  assert.equal(jobsFreshness(plain, NOW).state, "ok");
  const rule = WATCHED_JOBS.find((j) => j.job === "assortment-brightdata-trigger")!;
  assert.deepEqual([rule.maxConsecutiveErrors, rule.maxSilenceDays, rule.billing], [null, null, "brightdata"]);
  // Метка не в конце строки (часть текста ошибки) — не «нет денег».
  assert.equal(jobsFreshness([run("assortment-brightdata-trigger", "error", 1, "[stop:billing] где-то в середине")], NOW).state, "ok");
  // Имена задач — те, что пишет роут Bright Data в журнал.
  const route = readFileSync(join(import.meta.dirname, "..", "app/api/sync/assortment-brightdata/route.ts"), "utf8");
  assert.match(route, /const job = `assortment-brightdata-\$\{phase\}`;/);
  for (const phase of ["trigger", "collect"]) assert.ok(WATCHED_JOB_NAMES.includes(`assortment-brightdata-${phase}`));
  assert.match(route, /const \{ status, note \} = brightdataRunLog\(results\);/, "строка журнала — по правилу brightdataRunLog (метка [stop:billing])");
});

test("Ф2 по ревью: тревога «нет денег» держится до удачной платной покупки — прогон без работы (рилсы выключены, покупать было нечего) и сбор, забравший оплаченное, её не снимают", () => {
  const billing = "Bright Data: нет денег или аккаунт не активен (402) — платные покупки остановлены (S001) [stop:billing]";
  const stop: JobRun = { ...run("assortment-brightdata-trigger", "error", 30, billing), rows_affected: 0 };
  const state = (later: JobRun[]) => jobsFreshness([stop, ...later], NOW).state;
  assert.equal(state([{ ...run("assortment-social", "ok", 20, "выключено (ASSORTMENT_SOCIAL=off)"), rows_affected: 0 }]), "stalled", "рилсы выключены — ни одного платного запроса");
  assert.equal(state([{ ...run("assortment-brightdata-trigger", "ok", 20), rows_affected: 0 }]), "stalled", "запуск без покупок (всё уже куплено) — деньги не доказаны");
  assert.equal(state([{ ...run("assortment-brightdata-collect", "ok", 20), rows_affected: 12 }]), "stalled", "сбор скачивает уже оплаченное — это проходит и без баланса");
  assert.equal(state([{ ...run("assortment-social", "partial", 20), rows_affected: 8 }]), "ok", "рилсы сделали платные запросы — деньги есть");
  assert.equal(state([{ ...run("assortment-catalog-ai", "ok", 20), rows_affected: 50 }]), "stalled", "деньги другого провайдера (ИИ) Bright Data не доказывают");
});
