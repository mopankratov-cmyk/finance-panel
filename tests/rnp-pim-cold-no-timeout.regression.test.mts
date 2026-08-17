import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

// РНП Retail Family отдавал 504: холодный обход карточек Content API занимает
// на этом кабинете ~66 секунд (у Оптимы ~20), а лимит пользовательской функции —
// 60. Экран падал целиком, хотя карточки нужны только для названия и бренда.

test("РНП читает карточки только из прогретого снимка", async () => {
  const build = await read("../lib/rnp/buildTable.ts");
  assert.match(build, /loadCabinetPimRowsHourly\(p_cabinet, \{ cacheOnly: true \}\)/);
  // Без cacheOnly пользовательский запрос снова начнёт обходить Content API.
  assert.doesNotMatch(build, /loadCabinetPimRowsHourly\(p_cabinet\)\.catch/);
});

test("холодный снимок карточек не подменяется пустотой в кэше", async () => {
  const cards = await read("../lib/wb/cards.ts");
  assert.match(cards, /class PimSnapshotColdError/);
  // Пустой список попал бы в часовой кэш и обесточил названия там, где они есть.
  assert.match(cards, /if \(options\.cacheOnly\) \{[\s\S]*throw new PimSnapshotColdError\(\)/);
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
