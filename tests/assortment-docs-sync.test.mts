import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AVERAGE_MIN_COVERAGE, MIN_SOURCE_VISIBLE } from "../lib/assortment/catalogAi.ts";
import { ACCURACY_EARLY_MIN, ACCURACY_LOWER_MIN, ACCURACY_MIN_JUDGED, ACCURACY_UNCLEAR_MAX } from "../lib/assortment/attributeVerdicts.ts";
import { FAILED_MIN_ATTEMPTS, FAILED_SHARE_PROBLEM } from "../lib/assortment/dataReadiness.ts";

/**
 * Раздел 14 docs/assortment-development-integration.md описывает поведение, которое меняется константами и условиями в коде.
 * Расхождение молчит и вводит в заблуждение (владелец решает по доку, сработает ли Telegram), поэтому ключевые утверждения привязаны к коду.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const docsRaw = read("docs/assortment-development-integration.md");
// Переносы строк в доке — вёрстка, не смысл: сравниваем текст с одинарными пробелами.
const docs = docsRaw.replace(/\s+/g, " ");
/** Абзацы и пункты списка по отдельности: пометка PR должна стоять в том же пункте, что и утверждение, а не где-то рядом. */
const blocks = docsRaw.split(/\n\n|\n(?=- )/).map((block) => block.replace(/\s+/g, " "));
const pct = (value: number) => `${Math.round(value * 100)}%`;

test("Docs §14, пороги: переключающие и прячущие данные пороги названы и совпадают с константами кода", () => {
  const start = docs.indexOf("**Основные пороги");
  assert.ok(start >= 0, "абзац назван «основные»: полным списком константы модуля не считаются");
  const paragraph = docs.slice(start, docs.indexOf("**Грабли", start));
  const mentioned: Array<[string, RegExp]> = [
    ["AVERAGE_MIN_COVERAGE", new RegExp(`не меньше ${pct(AVERAGE_MIN_COVERAGE)} разобранного \\(\`AVERAGE_MIN_COVERAGE\`\\), иначе весь отчёт считается по всем разобранным моделям \\(\`basis="raw"\``)],
    ["ACCURACY_EARLY_MIN", new RegExp(`от ${ACCURACY_EARLY_MIN} отметок \\(\`ACCURACY_EARLY_MIN\`\\), если уже верхняя граница <${pct(ACCURACY_LOWER_MIN)}`)],
    ["ACCURACY_UNCLEAR_MAX", new RegExp(`от ${ACCURACY_MIN_JUDGED} отметок всего, если доля «не понять» >${pct(ACCURACY_UNCLEAR_MAX)} \\(\`ACCURACY_UNCLEAR_MAX\``)],
    ["MIN_SOURCE_VISIBLE", new RegExp(`ещё ≥${MIN_SOURCE_VISIBLE} видимых \\(\`MIN_SOURCE_VISIBLE\``)],
    ["FAILED_SHARE_PROBLEM", new RegExp(`≥${pct(FAILED_SHARE_PROBLEM)} неудач за 7 суток \\(от ${FAILED_MIN_ATTEMPTS} попыток`)],
  ];
  for (const [name, pattern] of mentioned) assert.match(paragraph, pattern, `${name}: значение в доке расходится с кодом`);
});

test("Docs §14, «Сторож в Telegram»: статусы крона разбора по фото описаны так, как их ставит роут; порог 20% — только у полоски", () => {
  const route = read("app/api/sync/assortment-catalog-ai/route.ts");
  // Что делает роут (иначе правка роута молча разведёт его с докой).
  assert.match(route, /const hardStop = summary\.stoppedBy === "auth" \|\| summary\.stoppedBy === "billing" \|\| summary\.stoppedBy === "config" \|\| summary\.stoppedBy === "errors" \|\| \(rateLimited && summary\.done === 0\);/);
  assert.match(route, /\(summary\.done === 0 && summary\.failed \+ summary\.transient > 0\) \? "error" : summary\.failed > 0 \|\| summary\.stoppedBy === "time" \|\| rateLimited \|\| summary\.deadSources\.length > 0 \? "partial" : "ok"/);
  assert.match(route, /summary\.candidates === 0\) \{\n\s+return NextResponse\.json/, "пустая очередь и нулевой остаток — ответ без строки в sync_log");
  assert.doesNotMatch(route, /FAILED_SHARE_PROBLEM/, "доли 20% в роуте нет");
  const watch = read("lib/assortment/jobsWatch.ts");
  assert.match(watch, /job: "assortment-catalog-ai".*maxSilenceDays: null, maxConsecutiveErrors: 3/, "три прогона подряд, тишину не судим");

  const start = docs.indexOf("**Сторож в Telegram**");
  const section = docs.slice(start, docs.indexOf("**Основные пороги", start));
  assert.match(section, /3 последних прогона подряд со статусом `error`/);
  assert.match(section, /остановка по лимиту запросов \(`rate_limit`\) — только если за прогон не разобрано ни одной модели/);
  assert.match(section, /`partial` — что-то разобрано, но была неудача \(`failed>0`: хоть одна из 120\)/);
  assert.match(section, /`ok` — остальное, в том числе остановка по бюджету недели или потолку суток/);
  assert.match(section, /строки в `sync_log` не пишет вовсе/);
  assert.match(section, /Порог «неудач ≥20%» на статус крона не влияет: он относится только к красной строке полоски «На чём стоят цифры» \(`FAILED_SHARE_PROBLEM` в\s*`dataReadiness\.ts`\)/);
  assert.equal(FAILED_SHARE_PROBLEM, 0.2);
  assert.doesNotMatch(section, /дают его сразу/, "прежнее утверждение «остановки по лимиту дают error сразу» неверно при разобранных моделях");
});

test("Docs §14: утверждения о поведении из соседних PR несут пометку PR, пока этого кода в ветке нет (порядок слияния не важен)", () => {
  const has = (path: string, probe: RegExp) => existsSync(join(root, path)) && probe.test(read(path));
  const claims: Array<{ fragment: string; pr: string; present: boolean }> = [
    { fragment: "платный запуск не заказывает пробу", pr: "#1530", present: has("lib/assortment/brightdataCrawl.ts", /p\.targetKey === signature/) },
    { fragment: "разбор HTML линейный (`scanDocument`)", pr: "#1528", present: has("lib/assortment/extract.ts", /scanDocument/) },
    { fragment: "ячейки CSV с `= + - @` получают апостроф", pr: "#1528", present: has("lib/assortment/collections.ts", /\[=\+\\-@/) },
    { fragment: "ключи проверяются `hasOwnKey`", pr: "#1528", present: has("lib/assortment/own.ts", /hasOwnKey/) },
    { fragment: "комментарий решения, поля профиля бренда", pr: "#1528", present: has("lib/assortment/brandProfiles.ts", /containsMoney/) && has("lib/assortment/decisions.ts", /containsMoney/) },
  ];
  for (const { fragment, pr, present } of claims) {
    const block = blocks.find((b) => b.includes(fragment));
    assert.ok(block, `в доке нет утверждения «${fragment}»`);
    if (present) continue;
    assert.ok(block.includes(`PR ${pr}`), `«${fragment}»: кода в ветке нет, а пометки «PR ${pr}» в том же пункте нет — док врёт при слиянии в другом порядке`);
  }
});
