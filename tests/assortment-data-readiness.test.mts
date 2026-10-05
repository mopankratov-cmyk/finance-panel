import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PhotoTraitsError } from "../components/assortment/PhotoTraits.tsx";
import { ReadinessStrip } from "../components/assortment/DataReadiness.tsx";
import { PROMPT_VERSION } from "../lib/assortment/catalogAi.ts";
import { buildReadiness, type ReadinessInput, type TraitsFacts } from "../lib/assortment/dataReadiness.ts";
import { loadReadiness } from "../lib/assortment/dataReadinessStore.ts";

/** «На чём стоят цифры»: что копится, с какого дня и когда функция станет честной (05.10). Даты — расчёт, не обещание. */

const root = fileURLToPath(new URL("..", import.meta.url));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const traits = (over: Partial<TraitsFacts> = {}): TraitsFacts => ({
  enabled: true, keyConfigured: true, analyzed: 62, legacy: 0, failed: 0, eligible: 1172, callsToday: 27, dailyLimit: 1500, weekUsd: 0.03, weeklyBudgetUsd: 20, lastErrors: [], ...over,
});
const input = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({ today: "2026-10-06", traits: traits(), demand: null, history: null, ...over });
const lines = (report: ReturnType<typeof buildReadiness>, key: string) => report.groups.find((g) => g.key === key)!.lines.map((l) => l.text).join(" | ");

test("Признаки по фото: разобрано N из M, вызовы и расход, срок очереди — расчёт по потолку и размеру прогона", () => {
  const r = buildReadiness(input());
  const t = lines(r, "traits");
  assert.match(t, /Разобрано по фото 62 из 1\s172 моделей \(5,3%\)/);
  assert.match(t, /Сегодня вызовов 27 из 1\s500; за 7 дней потрачено \$0,03 из \$20,00/);
  assert.match(t, /Осталось разобрать 1\s110; при 1\s440 в сутки это около суток/, "потолок 1500 упирается в 12 прогонов × 120 моделей");
  assert.equal(r.problem, false);
  const slow = buildReadiness(input({ traits: traits({ dailyLimit: 300 }) }));
  assert.match(lines(slow, "traits"), /при 300 в сутки это около 4 суток/);
  assert.equal(buildReadiness(input({ traits: traits({ analyzed: 1172 }) })).groups[0].lines.some((l) => /Очередь разобрана/.test(l.text)), true);
  const kinds = r.groups[0].lines.map((l) => l.kind);
  assert.ok(kinds.includes("факт") && kinds.includes("расчёт"), "каждая строка помечена: факт или расчёт");
});

test("Признаки по фото: выключен, нет ключа, бюджет недели исчерпан, много неразобранных — проблема (полоска раскрыта); потолок суток — нет", () => {
  assert.equal(buildReadiness(input({ traits: traits({ enabled: false }) })).problem, true);
  const noKey = buildReadiness(input({ traits: traits({ keyConfigured: false }) }));
  assert.equal(noKey.problem, true);
  assert.match(lines(noKey, "traits"), /нет ключа ИИ/);
  const budget = buildReadiness(input({ traits: traits({ weekUsd: 20.5 }) }));
  assert.equal(budget.problem, true);
  assert.match(lines(budget, "traits"), /Бюджет недели исчерпан/);
  const failing = buildReadiness(input({ traits: traits({ analyzed: 60, failed: 40, lastErrors: [{ message: "HTTP 403: модерация", count: 30 }, { message: "фото не скачалось", count: 10 }] }) }));
  assert.equal(failing.problem, true, "40 из 100 попыток — это не «бывает»");
  assert.match(lines(failing, "traits"), /Не разобралось 40 моделей: HTTP 403: модерация \(30\); фото не скачалось \(10\)/);
  const few = buildReadiness(input({ traits: traits({ analyzed: 500, failed: 3 }) }));
  assert.equal(few.problem, false, "3 из 503 — не проблема, но названо");
  assert.match(lines(few, "traits"), /Не разобралось 3 модели/);
  assert.equal(buildReadiness(input({ traits: traits({ callsToday: 1500 }) })).problem, false, "потолок суток достигнут — это норма");
});

test("Спрос WB: срез и охват; свежесть; «роста пока нет» с датой оценкой; без срезов блока нет", () => {
  const demand = (over = {}) => ({ subjectsTotal: 9, subjectsWithSnapshot: 9, withPrevious: 0, latestTo: "2026-10-04", firstTo: "2026-10-04", ...over });
  const fresh = buildReadiness(input({ traits: null, demand: demand() }));
  assert.match(lines(fresh, "demand"), /Срез спроса на 04\.10: предметов 9 из 9; «прошлый» срез для роста есть у 0/);
  assert.match(lines(fresh, "demand"), /Рост поисков появится не раньше 24\.10/, "первый срез + 20 дней");
  assert.equal(fresh.groups[0].lines.find((l) => /не раньше/.test(l.text))?.kind, "оценка");
  assert.equal(fresh.problem, false);
  const withPrev = buildReadiness(input({ traits: null, demand: demand({ withPrevious: 9 }) }));
  assert.doesNotMatch(lines(withPrev, "demand"), /Рост поисков появится/);
  const stale = buildReadiness(input({ traits: null, today: "2026-10-20", demand: demand() }));
  assert.equal(stale.problem, true);
  assert.match(lines(stale, "demand"), /Срез старше недели/);
  assert.equal(buildReadiness(input({ traits: null, demand: demand({ latestTo: null, subjectsWithSnapshot: 0 }) })).groups.length, 0, "срезов нет — блока нет (прячем, не серим)");
});

test("История каталогов: группы по статусам, даты «появилось/пропало» (+7) и динамики (+28) — оценкой от первого дня; верх выдачи назван", () => {
  const r = buildReadiness(input({
    traits: null,
    history: { sources: [
      { name: "Polène", status: "building", firstDay: "2026-10-05" },
      { name: "Rains", status: "building", firstDay: "2026-10-07" },
      { name: "Zara", status: "appearance", firstDay: "2026-09-20" },
      { name: "ASOS", status: "window_only", firstDay: "2026-10-05" },
    ] },
  }));
  const h = lines(r, "history");
  assert.match(h, /«Появилось» и «пропало» — наблюдение: Zara\./);
  assert.match(h, /История копится: Polène, Rains\./);
  assert.match(h, /не раньше 12\.10 \(два полных прогона с разрывом 7 дней\), динамика — не раньше 02\.11 \(28 дней наблюдений\)/);
  assert.match(h, /Только верх выдачи, «пропало» не определить: ASOS\./);
  assert.doesNotMatch(h, /растёт|падает/);
  assert.equal(buildReadiness(input({ traits: null, history: { sources: [] } })).groups.length, 0);
});

test("Полоска: свёрнута, когда всё в порядке; раскрыта сама при проблеме; строки помечены; кнопка не меньше 44 px", () => {
  const ok = renderToStaticMarkup(createElement(ReadinessStrip, { report: buildReadiness(input()) }));
  assert.match(ok, /aria-expanded="false"/);
  assert.match(text(ok), /На чём стоят цифры Признаки по фото: разобрано 62 из 1\s172/, "названия блоков — как есть: «Спрос на WB», а не «на wb»");
  assert.doesNotMatch(text(ok), /Осталось разобрать/, "детали свёрнуты");
  assert.match(ok, /min-h-\[44px\]/);
  const bad = renderToStaticMarkup(createElement(ReadinessStrip, { report: buildReadiness(input({ traits: traits({ keyConfigured: false }) })) }));
  assert.match(bad, /aria-expanded="true"/);
  assert.match(text(bad), /нужно внимание/);
  assert.match(text(bad), /факт У разбора нет ключа ИИ/);
  assert.match(text(bad), /расчёт Осталось разобрать/);
  assert.match(text(bad), /Даты — расчёт по текущим порогам, а не обещание/);
  assert.equal(renderToStaticMarkup(createElement(ReadinessStrip, { report: { groups: [], problem: false } })), "", "нет данных — полоски нет");
});

test("Признаки по фото: ошибка чтения названа, а не проглочена", () => {
  assert.match(text(renderToStaticMarkup(createElement(PhotoTraitsError, { message: "Нет связи с сервером" }))), /Признаки по фото не загрузились: Нет связи с сервером\./);
  const view = readFileSync(join(root, "components/assortment/PhotoTraits.tsx"), "utf8");
  assert.doesNotMatch(view, /\.catch\(\(\) => undefined\)\s*;\s*\n\s*return \(\) => \{\s*\n\s*cancelled/, "загрузчик не молчит при сбое");
});

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, opts: { missing?: string[] } = {}) {
  const calls: string[] = [];
  const db = {
    from: (table: string) => {
      calls.push(table);
      const eqs: Array<[string, unknown]> = [];
      const neqs: Array<[string, unknown]> = [];
      let wantCount = false;
      const rows = () => (tables[table] ?? []).filter((r) => eqs.every(([c, v]) => r[c] === v) && neqs.every(([c, v]) => r[c] !== v));
      const missing = opts.missing?.includes(table);
      const result = () => missing ? { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` }, count: null } : { data: rows(), error: null, count: wantCount ? rows().length : null };
      const q: Record<string, unknown> = {
        select: (_c: string, o?: { count?: string }) => { wantCount = Boolean(o?.count); return q; },
        eq: (c: string, v: unknown) => { eqs.push([c, v]); return q; },
        neq: (c: string, v: unknown) => { neqs.push([c, v]); return q; },
        gte: () => q, order: () => q, limit: () => q,
        range: (a: number, b: number) => Promise.resolve({ ...result(), data: result().data ? (result().data as Row[]).slice(a, b + 1) : null }),
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return q;
    },
  };
  return { db: db as never, calls };
}

test("Чтение базы: числа по текущей и прежней версии, неразобранные с причинами, потолок и бюджет из настройки, «Рынок РФ» не в знаменателе, MPSTATS и ИИ не вызываются", async () => {
  const attr = (v: string, status: string, over: Row = {}): Row => ({ direction: "bags", status, prompt_version: v, last_error: null, taken_at: "2026-10-05T10:00:00Z", model_key: Math.random().toString(36), ...over });
  const { db, calls } = fakeDb({
    assortment_model_attributes: [
      ...Array.from({ length: 4 }, () => attr(PROMPT_VERSION, "ok")),
      ...Array.from({ length: 3 }, () => attr("catalog-v1", "ok")),
      ...Array.from({ length: 2 }, () => attr(PROMPT_VERSION, "failed", { last_error: "HTTP 403" })),
      attr(PROMPT_VERSION, "failed", { last_error: "фото не скачалось" }),
      attr(PROMPT_VERSION, "ok", { direction: "jackets" }),
    ],
    assortment_catalog_stats: [
      { source_id: "S001", direction: "bags", with_photo: 700 }, { source_id: "S027", direction: "bags", with_photo: 300 },
      { source_id: "S128", direction: "bags", with_photo: 500 }, // «Рынок РФ» — не разбирается
    ],
    assortment_ai_usage: [{ day: "2026-10-06", kind: "catalog_attributes", calls: 40, cost_usd: 0.07 }],
    assortment_wb_query_snapshot: [
      { subject_id: 50, window_to: "2026-10-04", direction: "bags" }, { subject_id: 138, window_to: "2026-10-04", direction: "bags" },
      { subject_id: 50, window_to: "2026-09-02", direction: "bags" },
    ],
    assortment_run: [{ source_id: "S001", direction: "bags", observed_on: "2026-10-05", coverage: "full", seen: 100, added: 0, error: null, started_at: "2026-10-05T08:00:00Z" }],
    assortment_sources: [{ source_id: "S001", name: "Zara" }],
  });
  const report = await loadReadiness(db, "bags", new Date("2026-10-06T10:00:00Z"));
  const traitsLines = lines(report, "traits");
  assert.match(traitsLines, /Разобрано по фото 4 из 1\s000 моделей/, "по текущей версии; знаменатель — с фото и без «Рынка РФ»");
  assert.match(traitsLines, /ещё 3 разобраны по прежнему вопросу/);
  assert.match(traitsLines, /Не разобралось 3 модели: HTTP 403 \(2\); фото не скачалось \(1\)/);
  assert.match(lines(report, "demand"), /Срез спроса на 04\.10: предметов 2 из 2; «прошлый» срез для роста есть у 1/);
  assert.match(lines(report, "history"), /История копится: Zara/);
  assert.ok(!calls.includes("sync_log"), "ничего лишнего");
});

test("Чтение базы: нет таблиц — блоки не показываются, а не падают; сбой одной части не роняет остальные", async () => {
  const { db } = fakeDb({ assortment_run: [{ source_id: "S001", direction: "bags", observed_on: "2026-10-05", coverage: "full", seen: 1, added: 0, error: null, started_at: "2026-10-05T08:00:00Z" }], assortment_sources: [{ source_id: "S001", name: "Zara" }] }, { missing: ["assortment_model_attributes", "assortment_wb_query_snapshot"] });
  const report = await loadReadiness(db, "bags", new Date("2026-10-06T10:00:00Z"));
  assert.deepEqual(report.groups.map((g) => g.key), ["history"], "остался только блок, у которого есть данные");
});

test("Роут «На чём стоят цифры»: под сессией модуля, только чтение, MPSTATS и ИИ не вызываются; полоска стоит над «Формами»", () => {
  const route = readFileSync(join(root, "app/api/assortment-development/data-readiness/route.ts"), "utf8");
  assert.match(route, /requireApiSession\(ASSORTMENT_ROLES\)/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.doesNotMatch(route, /^import .*(mpstats|anthropic|polza|runCatalogAi)/im, "роут не тянет клиенты MPSTATS и ИИ");
  const store = readFileSync(join(root, "lib/assortment/dataReadinessStore.ts"), "utf8");
  assert.doesNotMatch(store.replace(/\/\*[\s\S]*?\*\//g, ""), /lib\/mpstats|mpstatsWbQuota|runCatalogAi|askFor\(/, "и хранилище: ни квоты MPSTATS, ни запуска разбора");
  const forms = readFileSync(join(root, "components/assortment/FormsView.tsx"), "utf8");
  assert.ok(forms.indexOf("<DataReadiness") > 0 && forms.indexOf("<DataReadiness") < forms.indexOf("<FormsReportView report={state.report}"));
});
