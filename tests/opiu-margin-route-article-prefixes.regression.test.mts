import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// GET /api/opiu/margin читал финотчёт без articlePrefixes — на обычных
// кабинетах разницы не видно, но на агентских (Оптима, ~116k строк отчёта/
// день, 92% чужие товары) запрос без фильтра ilike прямо в SQL тянет весь
// месяц целиком без дневного chunking'а и стабильно падает по statement
// timeout (тот же класс, который lib/opiu/loadMonth.ts уже обходит этим же
// аргументом). Клиентская фильтрация scopedRows ниже по файлу срабатывает
// СЛИШКОМ ПОЗДНО — после того, как запрос к Postgres уже упал.

test("«Маржа по артикулам» передаёт articlePrefixes в fetchReportRows — иначе агентский кабинет падает по таймауту", async () => {
  const source = await readFile(new URL("../app/api/opiu/margin/route.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /fetchReportRows\(dateFrom,\s*dateTo,\s*"sale",\s*brand\.cabinetId,\s*brand\.articlePrefixes\)/,
    "fetchReportRows должен получать articlePrefixes пятым аргументом — как в lib/opiu/loadMonth.ts",
  );
});
