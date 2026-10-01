import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { digestMessage, telegramEscape, topFindings, type DigestDirection, type DigestFacts } from "../lib/assortment/digest.ts";

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
