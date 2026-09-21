import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StockCatalogRow } from "../app/api/supplies/route";
import { StockCatalogTab } from "../components/supplies/StockCatalogTab";
import { StockChart, StockHistoryPanel, StockHistoryView } from "../components/supplies/StockHistoryPanel";
import { WarehouseFilter } from "../components/supplies/WarehouseFilter";
import { apiPermissionFor } from "../lib/auth/apiPermissions";
import {
  applyWarehouseFilter, isTransitWarehouse, normalizeSelection, selectionLabel, toggleWarehouse, warehouseOptions, withoutTransit,
} from "../lib/supplies/stockFilter";
import { dailyPoints, historyLines, mskDate, pointTotal, unreliableNote, type HistoryRow } from "../lib/supplies/stockHistory";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Остатки WB: фильтр по складам и история.
 *
 * Общий остаток включает то, что продать нельзя (товар в пути между складами WB,
 * склады после пожара): по Retail Family отчёт показал 14 944 шт при 2 370
 * доступных на витрине. Поэтому остаток считается по выбранным складам, а рядом
 * лежит история — снимки раз в четыре часа, о которых экран раньше не знал.
 */

// ── Фильтр по складам ────────────────────────────────────────────────────────

const row = (over: Partial<StockCatalogRow> = {}): StockCatalogRow => ({
  nmId: 1, article: "HT-83-26", name: "Куртка", quantity: 130, inWayToClient: 12, inWayFromClient: 3, daysLeft: 13, avgDaily: 10,
  warehouseCount: 3,
  topWarehouses: [{ warehouse: "Коледино", quantity: 80 }, { warehouse: "Склад WB РФ", quantity: 40 }, { warehouse: "Казань", quantity: 10 }],
  warehouses: [{ warehouse: "Коледино", quantity: 80 }, { warehouse: "Склад WB РФ", quantity: 40 }, { warehouse: "Казань", quantity: 10 }],
  ...over,
});

test("транзитный склад — «Склад WB РФ» и прежний агрегат «Склад WB»", () => {
  assert.equal(isTransitWarehouse("Склад WB РФ"), true);
  assert.equal(isTransitWarehouse("Склад WB"), true);
  assert.equal(isTransitWarehouse("  склад wb рф "), true);
  assert.equal(isTransitWarehouse("Коледино"), false);
  assert.equal(isTransitWarehouse("Электросталь"), false);
});

test("склады для выбора: только с товаром, с суммой и числом артикулов, крупные первыми", () => {
  const options = warehouseOptions([
    row(),
    row({ nmId: 2, warehouses: [{ warehouse: "Коледино", quantity: 20 }, { warehouse: "Пустой", quantity: 0 }, { warehouse: "Отриц", quantity: -5 }] }),
  ]);
  assert.deepEqual(options.map((option) => option.warehouse), ["Коледино", "Склад WB РФ", "Казань"]);
  assert.deepEqual(options[0], { warehouse: "Коледино", quantity: 100, skus: 2, transit: false });
  assert.equal(options[1].transit, true);
  assert.equal(options.some((option) => option.warehouse === "Пустой"), false, "склад без товара в списке не нужен");
});

test("без фильтра строка остаётся ровно той, что посчитал сервер", () => {
  const source = row();
  assert.equal(applyWarehouseFilter(source, null), source, "тот же объект: подменять серверную цифру пересчётом незачем");
});

test("остаток, «хватит дней» и склады пересчитываются по выбранным складам", () => {
  const filtered = applyWarehouseFilter(row(), new Set(["Коледино", "Казань"]));
  assert.equal(filtered.quantity, 90, "130 − 40 товара в пути между складами");
  assert.equal(filtered.daysLeft, 9, "90 шт при 10 заказах в день");
  assert.equal(filtered.warehouseCount, 2);
  assert.deepEqual(filtered.topWarehouses.map((entry) => entry.warehouse), ["Коледино", "Казань"]);
  assert.equal(filtered.inWayToClient, 12, "«в пути» WB не делит по складам — не трогаем");
  assert.equal(filtered.inWayFromClient, 3);
});

test("без заказов «хватит дней» — бесконечность, а не ноль; нет остатка на выбранных складах — честный ноль", () => {
  assert.equal(applyWarehouseFilter(row({ avgDaily: 0 }), new Set(["Коледино"])).daysLeft, null);
  const none = applyWarehouseFilter(row(), new Set(["Другой склад"]));
  assert.equal(none.quantity, 0);
  assert.equal(none.daysLeft, 0);
  assert.equal(none.warehouseCount, 0);
});

test("выбрали все склады — это «без фильтра»; переключение и пресет «без транзита»", () => {
  const options = warehouseOptions([row()]);
  assert.equal(normalizeSelection(new Set(options.map((option) => option.warehouse)), options), null);
  assert.deepEqual([...normalizeSelection(new Set(["Коледино"]), options)!], ["Коледино"]);

  const off = toggleWarehouse(null, "Казань", options);
  assert.deepEqual([...off!].sort(), ["Коледино", "Склад WB РФ"], "из «все» снимаем один склад");
  assert.equal(toggleWarehouse(off, "Казань", options), null, "вернули склад — снова «все»");

  const noTransit = withoutTransit(options);
  assert.deepEqual([...noTransit!].sort(), ["Казань", "Коледино"]);
  assert.equal(withoutTransit([{ warehouse: "Коледино", quantity: 1, skus: 1, transit: false }]), null, "транзита нет — фильтр не нужен");
  assert.equal(selectionLabel(null, options), "все (3)");
  assert.equal(selectionLabel(noTransit, options), "2 из 3");
});

// ── История: снимки по дням ──────────────────────────────────────────────────

const snap = (at: string, warehouse: string, quantity: number, inWay = 0): HistoryRow => ({ snapshot_at: at, warehouse, quantity, in_way_to_client: inWay, in_way_from_client: 0 });

test("день по Москве: вечер по UTC уже следующие сутки", () => {
  assert.equal(mskDate("2026-09-20T20:59:00Z"), "2026-09-20");
  assert.equal(mskDate("2026-09-20T21:00:00Z"), "2026-09-21", "в 00:00 по Москве начались новые сутки");
});

test("за сутки берётся последний снимок, а не первый и не сумма", () => {
  const points = dailyPoints([
    snap("2026-09-20T05:00:00Z", "Коледино", 100),
    snap("2026-09-20T13:00:00Z", "Коледино", 80),
    snap("2026-09-20T17:00:00Z", "Коледино", 60), snap("2026-09-20T17:00:00Z", "Казань", 15),
  ], []);
  assert.equal(points.length, 1);
  assert.deepEqual(points[0].byWarehouse, { Коледино: 60, Казань: 15 });
  assert.equal(points[0].confirmed, false, "журнала нет — снимок взят по строкам артикула");
});

test("нулевой остаток — это день, когда снимок был, а строк у артикула нет", () => {
  const runs = ["2026-09-19T17:00:00Z", "2026-09-20T17:00:00Z"];
  const points = dailyPoints([snap("2026-09-19T17:00:00Z", "Коледино", 40)], runs);
  assert.deepEqual(points.map((point) => point.date), ["2026-09-19", "2026-09-20"]);
  assert.deepEqual(points[1].byWarehouse, {}, "20.09 запуск был, а у артикула строк нет — остаток нулевой");
  assert.equal(points[1].confirmed, true);
  assert.equal(pointTotal(points[1], null), 0);
});

test("снимок неудавшегося запуска не считается: часть строк могла не записаться", () => {
  const runs = ["2026-09-20T13:00:00Z"];
  const points = dailyPoints([
    snap("2026-09-20T13:00:00Z", "Коледино", 50),
    snap("2026-09-20T17:00:00Z", "Коледино", 999), // запуск в 17:00 упал — его в журнале «ok» нет
  ], runs);
  assert.deepEqual(points[0].byWarehouse, { Коледино: 50 });
});

test("строки нескольких кабинетов одного снимка складываются, а «в пути» не идёт в остаток", () => {
  const points = dailyPoints([
    snap("2026-09-20T17:00:00Z", "Коледино", 30, 4),
    snap("2026-09-20T17:00:00Z", "Коледино", 20, 1),
    { snapshot_at: "2026-09-20T17:00:00Z", warehouse: "В пути до получателей", quantity: 0, in_way_to_client: 9, in_way_from_client: 2 },
  ], ["2026-09-20T17:00:00Z"]);
  assert.deepEqual(points[0].byWarehouse, { Коледино: 50 });
  assert.equal(points[0].inWayToClient, 14);
  assert.equal(points[0].inWayFromClient, 2);
});

test("история по выбранным складам: остаток, изменение к предыдущему дню, топ складов", () => {
  const points = dailyPoints([
    snap("2026-09-18T17:00:00Z", "Коледино", 100), snap("2026-09-18T17:00:00Z", "Склад WB РФ", 40),
    snap("2026-09-19T17:00:00Z", "Коледино", 70), snap("2026-09-19T17:00:00Z", "Склад WB РФ", 40),
  ], []);
  const all = historyLines(points, null);
  assert.deepEqual(all.map((line) => line.total), [140, 110]);
  assert.deepEqual(all.map((line) => line.delta), [null, -30]);
  const noTransit = historyLines(points, new Set(["Коледино"]));
  assert.deepEqual(noTransit.map((line) => line.total), [100, 70], "тот же фильтр, что у таблицы остатков");
  assert.deepEqual(noTransit[1].top, [{ warehouse: "Коледино", quantity: 70 }]);
});

test("период сбоя источника помечен, границы включительные", () => {
  assert.ok(unreliableNote("2026-08-28"));
  assert.ok(unreliableNote("2026-09-01"));
  assert.equal(unreliableNote("2026-08-27"), null);
  assert.equal(unreliableNote("2026-09-02"), null);
  const lines = historyLines(dailyPoints([snap("2026-08-30T17:00:00Z", "Коледино", 0)], []), null);
  assert.ok(lines[0].unreliable, "провал внутри окна не должен читаться как распродажа");
});

// ── Роут ─────────────────────────────────────────────────────────────────────

test("роут истории закрыт правами чтения аналитики и тем же товарным контуром, что список остатков", () => {
  const access = apiPermissionFor("/api/supplies/stock-history", "GET");
  assert.ok(access && "permission" in access, "путь должен попадать в карту прав, а не оставаться открытым");
  assert.deepEqual(access, apiPermissionFor("/api/supplies", "GET"));

  const route = read("../app/api/supplies/stock-history/route.ts");
  assert.match(route, /hasCabinetAccess/);
  assert.match(route, /requestAllowsNm\(scopes\.get\(cabinet\) \?\? null, nmId\)/, "артикул вне контура кабинета не показываем");
  assert.match(route, /\.order\("snapshot_at", \{ ascending: true \}\)\s*\.order\("id", \{ ascending: true \}\)/, "выборка постраничная и с порядком: иначе страницы перекрываются");
  assert.match(route, /loadAllSupabasePages/, "обрезка на тысяче строк молчит");
  assert.match(route, /\.eq\("job", "stocks-history"\)\.eq\("status", "ok"\)/, "нулевой остаток отличается от пропущенного снимка только по журналу крона");
  assert.match(route, /PERIODS\.includes\(requestedDays\)/, "период — из списка, а не любое число");
});

// ── Экран (серверный рендер) ─────────────────────────────────────────────────

test("фильтр складов: кнопка со счётчиком, пресет «без транзита» и склады с остатком", () => {
  const options = warehouseOptions([row()]);
  const all = renderToStaticMarkup(createElement(WarehouseFilter, { options, selected: null, onChange: () => undefined }));
  assert.match(all, /Склады WB: все \(3\)/);
  assert.match(all, /Без «Склад WB…» — товара в пути между складами/);
  assert.match(all, /в пути между складами/, "транзитный склад подписан");
  assert.match(all, /Коледино/);
  assert.doesNotMatch(all, />все склады</, "кнопки сброса при «все склады» нет");

  const some = renderToStaticMarkup(createElement(WarehouseFilter, { options, selected: new Set(["Коледино"]), onChange: () => undefined }));
  assert.match(some, /Склады WB: 1 из 3/);
  assert.match(some, /все склады/, "выбор частичный — есть сброс");
});

test("вкладка остатков: фильтр по складам, колонка истории и клик по строке", () => {
  const html = renderToStaticMarkup(createElement(StockCatalogTab, { rows: [row(), row({ nmId: 2, article: "HT-83-27" })], cabinet: "cab" }));
  assert.match(html, /Склады WB: все \(3\)/);
  assert.match(html, /История/);
  assert.match(html, /aria-label="История остатка HT-83-26"/);
  assert.match(html, /Всего на складах \(по фильтру\)/);
  assert.match(html, /Скрыть нулевые/);
});

test("панель истории: закрыта без строки, с периодами и подписью «по всем складам» при открытии", () => {
  const closed = renderToStaticMarkup(createElement(StockHistoryPanel, { row: null, selected: null, cabinet: "cab", onClose: () => undefined }));
  assert.doesNotMatch(closed, /7 дн\./);
  const open = renderToStaticMarkup(createElement(StockHistoryPanel, { row: row(), selected: null, cabinet: "cab", onClose: () => undefined }));
  for (const text of ["7 дн.", "30 дн.", "90 дн.", "по всем складам", "История остатка · HT-83-26"]) assert.match(open, new RegExp(text.replace(".", "\\.")), text);
  const some = renderToStaticMarkup(createElement(StockHistoryPanel, { row: row(), selected: new Set(["Коледино"]), cabinet: "cab", onClose: () => undefined }));
  assert.match(some, /по выбранным складам: 1/);
});

test("график остатка: линия, подписи концов и закрашенный период сбоя источника", () => {
  const points = [
    { t: Date.parse("2026-08-25T12:00:00Z"), value: 100, label: "25 авг." },
    { t: Date.parse("2026-08-30T12:00:00Z"), value: 0, label: "30 авг." },
    { t: Date.parse("2026-09-05T12:00:00Z"), value: 90, label: "5 сент." },
  ];
  const svg = renderToStaticMarkup(createElement(StockChart, { points }));
  assert.match(svg, /<path d="M/);
  assert.match(svg, /25 авг\./);
  assert.match(svg, /5 сент\./);
  assert.match(svg, /fill-amber-100/, "окно 28.08–01.09 закрашено: нуль внутри — сбой, а не распродажа");
  const calm = renderToStaticMarkup(createElement(StockChart, { points: [{ t: Date.parse("2026-09-10T12:00:00Z"), value: 5, label: "10 сент." }, { t: Date.parse("2026-09-12T12:00:00Z"), value: 7, label: "12 сент." }] }));
  assert.doesNotMatch(calm, /fill-amber-100/);
  assert.equal(renderToStaticMarkup(createElement(StockChart, { points: [] })), "");
});

test("обе страницы поставок передают вкладке кабинет — история берёт данные по нему", () => {
  assert.match(read("../components/wb/WbSuppliesPage.tsx"), /<StockCatalogTab rows=\{data\.data\.catalog\} cabinet=\{cabinetId \|\| "all"\} \/>/);
  assert.match(read("../components/supplies/SuppliesPage.tsx"), /<StockCatalogTab rows=\{catalog\} cabinet=\{cabId \|\| "all"\} \/>/);
});

// ── Панель истории с данными ────────────────────────────────────────────────

const view = (over: Partial<Parameters<typeof StockHistoryView>[0]> = {}) => renderToStaticMarkup(createElement(StockHistoryView, {
  // Как на экране: в панель приходит строка, уже пропущенная через фильтр складов.
  row: applyWarehouseFilter(row(), new Set(["Коледино", "Казань"])), selected: new Set(["Коледино", "Казань"]), days: 30, onDays: () => undefined, ready: true, error: null,
  data: {
    journal: true, retentionDays: 90,
    points: dailyPoints([
      snap("2026-09-10T17:00:00Z", "Коледино", 100, 5), snap("2026-09-10T17:00:00Z", "Склад WB РФ", 40),
      snap("2026-09-11T17:00:00Z", "Коледино", 70, 8), snap("2026-09-11T17:00:00Z", "Казань", 10), snap("2026-09-11T17:00:00Z", "Склад WB РФ", 40),
    ], ["2026-08-30T17:00:00Z", "2026-09-10T17:00:00Z", "2026-09-11T17:00:00Z"]),
  },
  ...over,
}));

test("история с данными: сейчас, изменение, минимум и максимум и таблица по дням по выбранным складам", () => {
  const html = view();
  assert.match(html, /Сейчас<\/div><div[^>]*>90 шт/);
  // 30 авг — первая точка (нулевой остаток: запуск был, строк нет), изменение к сегодняшним 90.
  assert.match(html, /30 авг\.<\/div><div[^>]*>0 шт/);
  assert.match(html, /Изменение<\/div><div[^>]*>\+90/);
  assert.match(html, /Минимум \/ максимум<\/div><div[^>]*>0 \/ 100/, "склад WB РФ (товар в пути) в остаток не вошёл: 100, а не 140");
  assert.match(html, /\+100/, "10 сен: 0 → 100");
  assert.match(html, /−20/, "11 сен: 100 → 80 (Коледино 70 + Казань 10)");
  assert.match(html, /\+10/, "сегодня 90 против 80 в последнем снимке");
  assert.match(html, /Коледино 70 · Казань 10/, "склады строки — только выбранные");
  assert.doesNotMatch(html, /Склад WB РФ 40/, "невыбранный склад в таблице не показан");
  assert.match(html, /по выбранным складам: 2/);
  assert.match(html, /scroll-x/, "таблица едет вбок внутри блока");
});

test("история: период сбоя источника подписан и в тексте, и в строке таблицы", () => {
  const html = view();
  assert.match(html, /снимки остатков ненадёжны/);
  assert.match(html, /ненадёжно/);
});

test("история: загрузка, ошибка, пустой период и недоступный журнал говорят каждый своё", () => {
  assert.match(view({ ready: false, data: null }), /Загружаем историю/);
  const failed = view({ ready: true, error: "WB не ответил", data: null });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /WB не ответил/);
  const empty = view({ data: { journal: true, retentionDays: 90, points: [] } });
  assert.match(empty, /За 30 дн\. снимков по этому артикулу нет/);
  assert.match(empty, /артикул без остатка в снимок не попадает/, "пустая история не читается как «остаток был нулевой»");
  const noJournal = view({ data: { journal: false, retentionDays: 90, points: dailyPoints([snap("2026-09-10T17:00:00Z", "Коледино", 5)], []) } });
  assert.match(noJournal, /Журнал запусков крона недоступен/);
});
