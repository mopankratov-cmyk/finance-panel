import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

// РНП Retail Family отдавал 504: холодный обход карточек Content API занимает
// на этом кабинете ~66 секунд (у Оптимы ~20), а лимит пользовательской функции —
// 60. Экран падал целиком, хотя карточки нужны только для названия и бренда.

test("РНП сначала берёт снимок карточек, а обход держит под секундомером", async () => {
  const build = await read("../lib/rnp/buildTable.ts");
  // Снимок пробуется первым — обход нужен только когда его нет.
  assert.match(build, /loadCabinetPimRowsHourly\(cabinetId, \{ cacheOnly: true \}\)/);
  // Ожидание обхода ограничено: экран не должен отваливаться по таймауту
  // функции, как это было на Retail Family (~66 секунд холодного обхода).
  assert.match(build, /RNP_PIM_TIMEOUT_MS = 8_000/);
  assert.match(build, /Promise\.race\(\[live, timeout\]\)/);
  // Без ожидания вовсе фильтры «Бренд» и «Категория» пустовали месяцами:
  // снимок не прогревался, а другого источника у экрана не было.
  assert.match(build, /return rows \?\? "cold"/);
});

test("холодный снимок карточек не подменяется пустотой в кэше", async () => {
  const cards = await read("../lib/wb/cards.ts");
  assert.match(cards, /class PimSnapshotColdError/);
  // Пустой список попал бы в часовой кэш и обесточил названия там, где они есть.
  assert.match(cards, /if \(cacheOnly\) throw new PimSnapshotColdError\(\)/);
});

// unstable_cache подмешивает в ключ саму функцию-колбэк, поэтому отдельная
// ветка «только из кэша» со своим колбэком читала снимок под другим ключом и
// всегда получала холод: в РНП «Бренд» и «Категория» стояли пустыми, сколько
// бы раз PIM ни грелся.
test("режим «только из кэша» ходит в тот же ключ, что и прогрев", async () => {
  const cards = await read("../lib/wb/cards.ts");
  const calls = cards.match(/loadHourlyDashboard\(\s*"wb-pim-cards"/g) ?? [];
  assert.equal(calls.length, 1, "у снимка карточек снова две точки входа — ключи разойдутся");
  // Флаг живёт внутри общего колбэка, а не разводит вызовы.
  assert.match(cards, /const \{ cacheOnly, \.\.\.cacheOptions \} = options/);
});

// Сброс ключа на каждом чтении устраивал вечную петлю: пока PIM холодный,
// каждое открытие РНП пересобирало снимок с нуля (~8 секунд). Правильный ход —
// отдать готовый снимок и чинить в фоне: stale-while-revalidate, не чаще
// раза в 15 минут.
test("холодный снимок отдаётся сразу, починка идёт в фоне", async () => {
  const cache = await read("../lib/rnp/tableCache.ts");
  assert.match(cache, /if \(snapshot\.pim_cold\)/);
  // Синхронного сброса ключа на чтении больше нет — он и был петлёй.
  assert.doesNotMatch(cache, /if \(snapshot\.pim_cold\) \{\s*\n\s*revalidateTag\(tag, \{ expire: 0 \}\)/);
  assert.match(cache, /ageMs > 15 \* 60 \* 1000/);
  assert.match(cache, /revalidateTag\(tag, "max"\)/);
});

test("cron греет карточки до снимков РНП", async () => {
  const cron = await read("../app/api/sync/dashboard-cache/route.ts");
  const pimIndex = cron.indexOf("loadCabinetPimRowsHourly(scope.cabinetId)");
  const rnpIndex = cron.indexOf("loadCachedWbRnp(task, WB_RNP_BACKGROUND_REFRESH)");
  assert.ok(pimIndex > 0, "cron не греет карточки");
  assert.ok(pimIndex < rnpIndex, "карточки греются после РНП — снимок соберётся без названий");
});

test("флаг холодного PIM объявлен в форме снимка", async () => {
  const build = await read("../lib/rnp/buildTable.ts");
  assert.match(build, /pim_cold\?: boolean/);
  assert.match(build, /\.\.\.\(pimCold \? \{ pim_cold: true \} : \{\}\)/);
});

// Кэш Next между роутами не разделяется: ключ unstable_cache зависит от
// текста функции после сборки, а он у разных бандлов разный. На проде это
// выглядело так: /api/pim отдаёт 64 карточки за секунду (свой снимок тёплый),
// а РНП в том же кабинете возвращает pim_cold и пустые «Бренд»/«Категория».
// Обойти обходом нельзя — на Retail Family он идёт больше 45 секунд.
test("справочник карточек лежит в базе, а не только в кэше", async () => {
  const cards = await read("../lib/wb/cards.ts");
  // Обход пишет в базу и не падает, если записать не вышло.
  assert.match(cards, /void persistCards\(rows\)/);
  assert.match(cards, /from\("wb_cards"\)\s*\n?\s*\.upsert/);
  assert.match(cards, /export async function loadCardsFromDb/);

  const build = await read("../lib/rnp/buildTable.ts");
  // База — первый источник, снимок и обход остаются запасными.
  const dbIndex = build.indexOf("loadCardsFromDb(cabinetId)");
  const snapshotIndex = build.indexOf("loadCabinetPimRowsHourly(cabinetId, { cacheOnly: true })");
  assert.ok(dbIndex > 0, "РНП не читает карточки из базы");
  assert.ok(dbIndex < snapshotIndex, "снимок опрашивается раньше базы — вернётся холод");
});

// Пустой фильтр «Категория» месяцами читался как «категорий нет», хотя это
// справочник карточек не прогрелся. Недочитанный источник обязан называть
// себя, а не притворяться отсутствием фактов.
test("недочитанные источники попадают в снимок и на экран", async () => {
  const build = await read("../lib/rnp/buildTable.ts");
  // Тихие catch заменены на именованные заметки.
  assert.doesNotMatch(build, /\.catch\(\(\) => \[\] as FeedbackNmRow\[\]\)/);
  assert.match(build, /noteOn\("отзывы"/);
  assert.match(build, /noteOn\("статистика кампаний"/);
  assert.match(build, /noteOn\("типы кампаний"/);
  // Холодный справочник карточек объясняется словами, а не только флагом.
  assert.match(build, /справочник карточек WB не прогрет/);

  const page = await read("../components/wb/WbRnpPage.tsx");
  assert.match(page, /activeData\?\.notes\?\.length/);
  assert.match(page, /Часть данных не прочиталась/);
});
