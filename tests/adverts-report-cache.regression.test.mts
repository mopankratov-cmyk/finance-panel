import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { advertReportScopeKey } from "../lib/adverts/reportCache";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

// Экран «Реклама» держал 11–16 секунд один источник — RPC месячных агрегатов
// по товарам (report). Данные под ним обновляются часовыми синками, поэтому
// он читается из снимка с фоновым освежением. Живые части экрана (ставки,
// статусы, последние правки репрайсера, баланс) кэшироваться НЕ должны.

test("справочник товаров читается из снимка, живые части — нет", async () => {
  const route = await read("../app/api/adverts/list/route.ts");
  assert.match(route, /loadCachedAdvertReportRows<RpcRow>\(cabinetId, reportScopeKey/);
  // Реестр кампаний (ставки/статусы) и правки репрайсера остаются живыми:
  // репрайсер пишет в wb_adverts сразу, часовой снимок показал бы старую ставку.
  assert.doesNotMatch(route, /loadCachedAdvertReportRows[\s\S]{0,200}wb_adverts/);
  assert.match(route, /from\("advert_bid_changes"\)/);
});

test("устаревший снимок помечается на фоновую пересборку, а не блокирует чтение", async () => {
  const cache = await read("../lib/adverts/reportCache.ts");
  // Синхронный сброс ключа на чтении = вечная петля РНП (PR#444) — сторожим.
  assert.doesNotMatch(cache, /revalidateTag\(tag, \{ expire: 0 \}\)/);
  assert.match(cache, /after\(\(\) => \{\s*\n\s*revalidateTag\(tag, "max"\)/);
  assert.match(cache, /WB_ADVERT_REPORT_STALE_MS/);
});

test("ключ снимка различает продуктовые контуры", () => {
  assert.equal(advertReportScopeKey(null), "full");
  const narrow = advertReportScopeKey(new Set([3, 1, 2]));
  // Порядок множества не должен менять ключ.
  assert.equal(narrow, advertReportScopeKey(new Set([1, 2, 3])));
  assert.notEqual(narrow, advertReportScopeKey(new Set([1, 2])));
  assert.notEqual(narrow, "full");
});

test("scoped-запрос и общий кабинет не делят один снимок", async () => {
  const route = await read("../app/api/adverts/list/route.ts");
  // Для cabinet=all снимок общий (фильтр по контуру режет строки после чтения),
  // а scoped-загрузчик конкретного кабинета строит другие строки — ключ обязан
  // включать контур запроса.
  assert.match(route, /advertReportScopeKey\(cabinetId \? allowedNmIds : null\)/);
});
