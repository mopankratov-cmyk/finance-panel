import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * «Склейки» грузились по 55 с на КАЖДОЕ открытие (04–05.10.2026, Retail Family,
 * 64 SKU). Замер ?timings=1 на проде: карточки 54,6 с из 54,8 с сборки.
 * Две причины, обе в Next 16:
 *  1) страница слала background=1, а помощник сбрасывал тег снимка ДО чтения —
 *     такой снимок в том же запросе не отдаётся, и каждое открытие пересобирало;
 *  2) карточки читались внутри колбэка снимка, а вложенный unstable_cache кэш
 *     не читает — Content API вживую, по запросу на артикул с паузой 600 мс.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("страница открывает склейки простым чтением, пересборка и карточки у WB — только кнопкой", () => {
  const page = read("../components/wb/WbSklejkiPage.tsx");
  assert.doesNotMatch(page, /"background=1"|&background=1/, "в запросе флага фонового освежения нет");
  assert.match(page, /const mode = forceRefreshRef\.current \? "&refresh=1&cards=live" : "";/);
});

test("карточки и агрегаты товаров читаются из контекста запроса, а не вложенным кэшем", () => {
  const route = read("../app/api/sklejki/route.ts");
  const fn = route.slice(route.indexOf("async function loadSklejkiSnapshot("), route.indexOf("export async function GET("));
  const outside = fn.slice(0, fn.indexOf("return loadHourlyDashboard("));
  const callback = fn.slice(fn.indexOf("return loadHourlyDashboard("));
  assert.match(route, /import \{ AsyncLocalStorage \} from "node:async_hooks";/);
  assert.match(outside, /const inRequest = AsyncLocalStorage\.snapshot\(\);/);
  assert.doesNotMatch(outside, /loadCabinetPimRowsHourly\(|loadCachedAdvertReportRows/, "до сборки склеек источники не читаются — тёплый снимок их не трогает");
  assert.match(callback, /inRequest\(\(\) => loadCabinetPimRowsHourly\(cabinetId\)\)/);
  assert.match(callback, /inRequest\(\(\) => loadCachedAdvertReportRows<RpcTotal>\(cabinetId, "full"/);
  // Этапы замера — внутри сборки: ключи cards/report появляются только когда снимок собирался.
  assert.match(callback, /timed\("cards", liveCards/);
  assert.match(callback, /timed\("report", inRequest/);
});

test("«Обновить» перечитывает карточки у WB только для одного кабинета", () => {
  const route = read("../app/api/sklejki/route.ts");
  assert.match(route, /const liveCards = cacheOptions\.forceRefresh === true && params\.get\("cards"\) === "live";/);
  assert.match(route, /liveCards \? fetchCabinetPimRows\(cabinetId\)/);
  // Ветка «Все кабинеты» флаг не передаёт: параллельные обходы Content API — это 429.
  const all = route.slice(route.indexOf("const cabinets = await getActiveWbCabinets();"));
  assert.match(all, /loadSklejkiSnapshot\(cabinet\.id, cacheOptions, period\)/);
});

test("прогрев карточек в кроне не просит принудительного освежения вложенным вызовом", () => {
  const warmup = read("../lib/wb/dashboardWarmup.ts");
  const cards = read("../lib/wb/cards.ts");
  assert.doesNotMatch(warmup, /loadCabinetPimRowsHourly\(scope\.cabinetId, \{ forceRefresh: true \}\)/);
  assert.match(cards, /rows\.push\(\.\.\.await loadCabinetPimRowsHourly\(cabinet\.id\)\);/);
});
