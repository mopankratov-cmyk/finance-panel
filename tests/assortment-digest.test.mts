import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { digestMessage, telegramEscape, topFindings, type DigestDirection, type DigestFacts } from "../lib/assortment/digest.ts";
import { loadDigestFacts } from "../lib/assortment/digestFacts.ts";

/** Воскресная сводка модуля в Telegram (решение владельца 01.10.2026). */

const root = fileURLToPath(new URL("..", import.meta.url));
const empty = (): DigestDirection => ({ newCount: 0, retailCount: 0, top: [], selected: 0, sampleNeeded: 0, rejected: 0, topReason: null });
const facts = (patch: Partial<DigestFacts> = {}): DigestFacts => ({
  from: "2026-09-27T07:00:00Z", to: "2026-10-04T07:00:00Z", directions: { bags: empty(), jackets: empty() }, collections: [], crawl: null, baseUrl: "https://panel.example/", ...patch,
});

test("Крон заведён на воскресенье 10:00 МСК, роут отвечает на GET (Vercel зовёт кроны GET)", () => {
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons.filter((c) => c.path === "/api/sync/assortment-digest"), [{ path: "/api/sync/assortment-digest", schedule: "0 7 * * 0" }]);
  const route = readFileSync(join(root, "app/api/sync/assortment-digest/route.ts"), "utf8");
  assert.match(route, /export async function GET/);
  assert.match(route, /checkCronAuth\(request\)/);
});

test("Неделя с находками: счёт, сильнейшие сверху, ссылки в модуль, решения и подборки", () => {
  const bags: DigestDirection = {
    newCount: 4, retailCount: 1, selected: 1, sampleNeeded: 0, rejected: 2, topReason: "форма",
    top: topFindings([
      { id: "a", title: "Tote", brand: "Songmont", label: "Добавлено вручную", tone: "manual" },
      { id: "b", title: "Boky - Textured Camel", brand: "Polène", label: "Отмечено ритейлером: NEW", tone: "retail" },
    ]),
  };
  const text = digestMessage(facts({
    directions: { bags, jackets: empty() },
    collections: [{ id: "c1", title: "Сумки · ноябрь 2026", progress: "3 из 5", status: "сохранена", version: 2 }],
  }));
  assert.match(text, /^🧵 <b>Разработка ассортимента — неделя 27\.09–04\.10<\/b>/);
  assert.match(text, /4 новые находки, из них отмечено ритейлером: 1\./);
  assert.ok(text.indexOf("Polène · Boky") < text.indexOf("Songmont · Tote"), "отметка ритейлера выше ручной находки");
  assert.match(text, /<a href="https:\/\/panel\.example\/assortment-development\/bags\/b">Polène · Boky - Textured Camel<\/a> — Отмечено ритейлером: NEW/);
  assert.match(text, /Решения: отобрано 1, отклонено 2 \(чаще всего: форма\)\./);
  assert.match(text, /Сумки · ноябрь 2026<\/a> — 3 из 5, сохранена v2/);
  assert.match(text, /<b>Куртки<\/b>\nНовых находок нет\./);
  assert.doesNotMatch(text, /₽|€|\$|цена|выручк/i);
});

test("Пустая неделя называется пустой, а не пропускается", () => {
  const text = digestMessage(facts());
  assert.match(text, /За неделю в модуле ничего не происходило/);
  assert.match(text, /<a href="https:\/\/panel\.example\/assortment-development">Открыть модуль<\/a>$/);
});

test("Названия моделей экранируются под HTML Telegram", () => {
  assert.equal(telegramEscape("Bag <Mini> & Co"), "Bag &lt;Mini&gt; &amp; Co");
  const bags = { ...empty(), newCount: 1, top: [{ id: "x", title: "<b>Mini</b>", brand: "A&B", label: "Новинка", tone: "novelty" as const }] };
  const text = digestMessage(facts({ directions: { bags, jackets: empty() } }));
  assert.match(text, />A&amp;B · &lt;b&gt;Mini&lt;\/b&gt;<\/a>/);
  assert.match(text, /1 новая находка\./);
});

test("Пульс автообхода: работающие и отказавшие источники; тихая неделя при живом обходе", () => {
  const text = digestMessage(facts({ crawl: { ok: ["Polène", "Rains"], failing: [{ name: "JW PEI", error: "HTTP 429" }] } }));
  assert.match(text, /<b>Автообход каталогов<\/b>\nРаботает: Polène, Rains\.\n⚠️ JW PEI: HTTP 429/);
  assert.match(text, /новых моделей не появилось ни в каталогах, ни среди ручных находок/);
  assert.doesNotMatch(text, /пока не подключён/);
});

// --- «Рынок РФ» не находка недели; история наблюдений названа (05.10) ---

type Row = Record<string, unknown>;
/** Подставная база: цепочки select/eq/gte/lt/in/not/order/limit/range с ожиданием, как у PostgREST. */
const inSizes: number[] = [];
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const q: Record<string, unknown> = {
        select: () => q, order: () => q, limit: () => q,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        gte: (c: string, v: unknown) => { filters.push((r) => String(r[c] ?? "") >= String(v)); return q; },
        lt: (c: string, v: unknown) => { filters.push((r) => String(r[c] ?? "") < String(v)); return q; },
        in: (c: string, v: unknown[]) => { inSizes.push(v.length); filters.push((r) => v.includes(r[c])); return q; },
        not: (c: string, _op: string, v: unknown) => { filters.push((r) => (r[c] ?? null) !== v); return q; },
        or: (expr: string) => {
          const list = /not\.in\.\(([^)]*)\)/.exec(expr)?.[1].split(",") ?? [];
          filters.push((r) => r.source_id == null || !list.includes(String(r.source_id)));
          return q;
        },
        range: (from: number, to: number) => Promise.resolve({ data: rows().slice(from, to + 1), error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
      };
      return q;
    },
  };
}

test("Сводка: «Рынок РФ» (топ WB, Lime на WB) в новые находки не попадает, ручные и из каталогов — попадают", async () => {
  const ref = (id: string, direction: string, source: string | null, title: string): Row => ({ id, direction, title, brand: null, source_id: source, attributes: {}, first_seen_at: "2026-10-08T10:00:00Z" });
  const db = fakeDb({
    assortment_references: [
      ref("a", "bags", "S001", "Tote Polène"),
      ...Array.from({ length: 5 }, (_, i) => ref(`wb${i}`, "bags", "S128", `WB bag ${i}`)),
      ref("lime", "jackets", "S129", "Lime on WB"),
      ref("hand", "jackets", null, "Ручная находка"),
    ],
    assortment_observations: [], assortment_decisions: [], assortment_collections: [], assortment_sources: [], assortment_run: [],
  });
  const facts = await loadDigestFacts(db as never, new Date("2026-10-04T07:00:00Z"), new Date("2026-10-11T07:00:00Z"), "https://panel.example");
  assert.equal(facts.directions.bags.newCount, 1, "из шести сумок пять — «Рынок РФ»");
  assert.deepEqual(facts.directions.bags.top.map((f) => f.title), ["Tote Polène"]);
  assert.equal(facts.directions.jackets.newCount, 1, "Lime на WB не считается, ручная находка — да");
  assert.deepEqual(facts.directions.jackets.top.map((f) => f.title), ["Ручная находка"]);
});

test("Сводка: история наблюдений — у каких источников «появилось/пропало» уже наблюдение, у каких копится; «Рынок РФ» и слова про динамику не попадают", async () => {
  const run = (source: string, day: string, coverage: string): Row => ({ source_id: source, direction: "bags", observed_on: day, coverage, seen: 100, added: 0, error: null, started_at: `${day}T08:00:00Z` });
  const db = fakeDb({
    assortment_references: [], assortment_observations: [], assortment_decisions: [], assortment_collections: [],
    assortment_sources: [{ source_id: "S001", name: "Polène" }, { source_id: "S002", name: "Rains" }, { source_id: "S003", name: "ASOS" }, { source_id: "S128", name: "Рынок РФ: WB" }],
    assortment_run: [
      run("S001", "2026-10-01", "full"), run("S001", "2026-10-09", "full"),
      run("S002", "2026-10-09", "full"),
      run("S003", "2026-10-09", "window"),
      run("S128", "2026-10-09", "window"),
    ],
  });
  const facts = await loadDigestFacts(db as never, new Date("2026-10-04T07:00:00Z"), new Date("2026-10-11T07:00:00Z"), "https://panel.example");
  assert.deepEqual(facts.history, [
    { name: "Polène", status: "appearance" }, { name: "Rains", status: "building" }, { name: "ASOS", status: "window_only" },
  ]);
  const text = digestMessage(facts);
  assert.match(text, /<b>История каталогов<\/b>\n«Появилось» и «пропало» — наблюдение: Polène\.\nИстория копится \(нужны два полных прогона с разрывом от 7 дней\): Rains\.\nТолько верх выдачи \(пропажу не определить\): ASOS\./);
  assert.doesNotMatch(text, /Рынок РФ/);
  assert.doesNotMatch(text, /растёт|падает|усилилось|ослабло|тенденци/i);
});

test("Сводка: автообход каталогов — без «Рынка РФ»: Lime на WB каждую неделю пишет «нет продаж» и не должен давать вечную ⚠️, а «Wildberries — рынок» не «автообход»", async () => {
  const db = fakeDb({
    assortment_references: [], assortment_observations: [], assortment_decisions: [], assortment_collections: [], assortment_run: [],
    assortment_sources: [
      { source_id: "S001", name: "Polène", last_attempt_at: "2026-10-09T05:00:00Z", last_error: null },
      { source_id: "S002", name: "Rains", last_attempt_at: "2026-10-09T05:00:00Z", last_error: "HTTP 429" },
      { source_id: "S128", name: "Wildberries — рынок", last_attempt_at: "2026-10-06T05:00:00Z", last_error: null },
      { source_id: "S129", name: "Lime на Wildberries", last_attempt_at: "2026-10-06T05:00:00Z", last_error: "MPSTATS: у Lime на WB нет продаж — официального магазина нет" },
    ],
  });
  const facts = await loadDigestFacts(db as never, new Date("2026-10-04T07:00:00Z"), new Date("2026-10-11T07:00:00Z"), "https://panel.example");
  assert.deepEqual(facts.crawl, { ok: ["Polène"], failing: [{ name: "Rains", error: "HTTP 429" }] });
  const text = digestMessage(facts);
  assert.doesNotMatch(text, /Lime|Wildberries/);
  const onlyRu = fakeDb({
    assortment_references: [], assortment_observations: [], assortment_decisions: [], assortment_collections: [], assortment_run: [],
    assortment_sources: [{ source_id: "S129", name: "Lime на Wildberries", last_attempt_at: "2026-10-06T05:00:00Z", last_error: "нет продаж" }],
  });
  assert.equal((await loadDigestFacts(onlyRu as never, new Date("2026-10-04T07:00:00Z"), new Date("2026-10-11T07:00:00Z"), "https://panel.example")).crawl, null, "остались одни RU-источники — блока автообхода нет");
});

test("Сводка: нет журнала прогонов — блока истории нет; длинный список имён обрезается", () => {
  assert.doesNotMatch(digestMessage(facts({ history: null })), /История каталогов/);
  assert.doesNotMatch(digestMessage(facts({ history: [] })), /История каталогов/);
  const many = Array.from({ length: 11 }, (_, i) => ({ name: `Источник ${i + 1}`, status: "building" as const }));
  const text = digestMessage(facts({ history: many }));
  assert.match(text, /Источник 8 и ещё 3\./);
  assert.doesNotMatch(text, /Источник 9/);
});

test("Сводка: «Рынок РФ» отсекается в запросе (а не после первой тысячи ответа), наблюдения и разделы решений читаются пачками по 100 id", async () => {
  const refs: Row[] = [
    ...Array.from({ length: 250 }, (_, i) => ({ id: `n${i}`, direction: "bags", title: `Bag ${i}`, brand: null, source_id: "S001", attributes: {}, first_seen_at: "2026-10-08T10:00:00Z" })),
    ...Array.from({ length: 300 }, (_, i) => ({ id: `wb${i}`, direction: "bags", title: `WB ${i}`, brand: null, source_id: "S128", attributes: {}, first_seen_at: "2026-10-08T10:00:00Z" })),
  ];
  inSizes.length = 0;
  const db = fakeDb({ assortment_references: refs, assortment_observations: [], assortment_decisions: [], assortment_collections: [], assortment_sources: [], assortment_run: [] });
  const facts = await loadDigestFacts(db as never, new Date("2026-10-04T07:00:00Z"), new Date("2026-10-11T07:00:00Z"), "https://panel.example");
  assert.equal(facts.directions.bags.newCount, 250);
  assert.ok(inSizes.length >= 3 && Math.max(...inSizes) <= 100, `по наблюдениям — несколько запросов по ≤100 id (было ${inSizes.join(",")})`);
  assert.equal(inSizes.reduce((a, b) => a + b, 0), 250, "в запросы наблюдений ушли только 250 настоящих находок: RU-позиции отсечены в запросе находок, а не после него");
});
