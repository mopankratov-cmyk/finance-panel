import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatWaiting, TASK_STALE_MS } from "../lib/warehouse/duration";
import { operationalWarehouses } from "../lib/warehouse/warehouseKind";
import { sortTaskRows } from "../app/api/warehouse/tasks/taskRows";
import type { ShipmentTaskRow } from "../lib/warehouse/tasks";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const task = (id: string, createdAt: string, status: ShipmentTaskRow["status"] = "draft") => ({
  id, number: `ОТГ-${id}`, status, createdAt, occurredAt: createdAt,
  createdBy: null, warehouseName: null, cabinetId: null, cabinetName: null,
  qty: 1, note: null, lines: [],
}) as unknown as ShipmentTaskRow;

/**
 * Очередь заданий была перевёрнута: свежие сверху, а TaskList раскрывает
 * первый черновик. Кладовщик начинал смену с задания пятиминутной давности,
 * а трёхдневное лежало под ним.
 */
test("черновики заданий идут от старых к новым", () => {
  const sorted = sortTaskRows([
    task("c", "2026-09-04T10:00:00Z"),
    task("a", "2026-09-01T10:00:00Z"),
    task("b", "2026-09-02T10:00:00Z"),
  ]);
  assert.deepEqual(sorted.map((row) => row.id), ["a", "b", "c"]);
});

test("выполненные остаются свежими сверху — это история, а не очередь", () => {
  const sorted = sortTaskRows([
    task("old", "2026-09-01T10:00:00Z", "shipped"),
    task("new", "2026-09-04T10:00:00Z", "shipped"),
    task("draft", "2026-09-02T10:00:00Z"),
  ]);
  assert.equal(sorted[0].id, "draft", "черновик всегда выше выполненных");
  assert.deepEqual(sorted.slice(1).map((row) => row.id), ["new", "old"]);
});

test("возраст задания читается как открытый счётчик, а не как срок", () => {
  const start = Date.parse("2026-09-04T10:00:00Z");
  assert.equal(formatWaiting("2026-09-04T10:00:00Z", start + 40 * 60_000), "ждёт 40 мин");
  assert.equal(formatWaiting("2026-09-04T10:00:00Z", start + 5 * 3_600_000), "ждёт 5 ч");
  assert.equal(formatWaiting("2026-09-04T10:00:00Z", start + 3 * 86_400_000), "ждёт 3 дн");
  assert.equal(formatWaiting("2026-09-04T10:00:00Z", start), "ждёт 1 мин", "только что поставленное — не ноль");
  assert.equal(formatWaiting(null, start), null);
  assert.equal(formatWaiting("2026-09-04T10:00:00Z", start - 1000), null, "будущее не считаем");
  assert.equal(TASK_STALE_MS, 86_400_000);
});

/**
 * Кнопка «В архив» меняла только подпись: склад оставался во всех рабочих
 * списках — приёмка, отгрузка, перемещение брали warehouses.map без разбора.
 */
test("архивные склады не предлагаются в работе", () => {
  const list = [
    { id: "a", isActive: true },
    { id: "b", isActive: false },
    { id: "c" },
  ];
  assert.deepEqual(operationalWarehouses(list).map((w) => w.id), ["a", "c"], "склад без флага считается рабочим");
  assert.deepEqual(operationalWarehouses(list, "b").map((w) => w.id), ["a", "b", "c"],
    "уже выбранный архивный склад остаётся — иначе документ молча переедет на чужой");
});

test("пикеры складов ходят через общий фильтр", () => {
  for (const name of ["ShipmentTab", "ReceiptsTab", "MovementTab"]) {
    const source = read(`../components/warehouse/${name}.tsx`);
    assert.match(source, /operationalWarehouses\(warehouses/, name);
    assert.doesNotMatch(source, /\{warehouses\.map\(\(warehouse\)/, `${name}: остался список без фильтра`);
  }
});

/**
 * post_fbs_sales пишет вид 'sale', а KIND_LABEL знал шесть видов из семи —
 * списания продаж приезжали в журнал пустой клеткой.
 */
test("журнал движений знает продажу FBS и не молчит о неизвестном", () => {
  const source = read("../components/warehouse/MovesTab.tsx");
  assert.match(source, /sale: "продажа FBS"/);
  assert.match(source, /KIND_LABEL\[kind as StockMoveRow\["kind"\]\] \?\? kind/, "неизвестный вид показываем кодом");
  assert.match(read("../app/api/warehouse/moves/route.ts"), /\| "sale";/);
});

test("журнал движений даёт документ, автора и фильтры", () => {
  const source = read("../components/warehouse/MovesTab.tsx");
  for (const needle of [">Документ<", ">Кто<", "row.createdBy", "warehouse/print/", "setQuery", "setKind"]) {
    assert.ok(source.includes(needle), needle);
  }
});

/** Приёмка получает номер из общей нумерации и объявляется документом в
 *  «Событиях», но журнал документов её не показывал. */
test("приёмки попадают в журнал документов и печатаются своей формой", () => {
  assert.match(read("../app/api/warehouse/docs/route.ts"), /stock_receipt_batches/);
  assert.match(read("../components/warehouse/DocsTab.tsx"), /warehouse\/print\/receipt\/\$\{row\.batchId\}/);
});

/** Заглушка фото печатает nm_id, а у товара без карточки WB он равен нулю —
 *  в журнале стоял серый квадрат с «0» вместо артикула. */
test("заглушка фото на складе подписана артикулом", () => {
  for (const name of [
    "MovesTab", "DefectsTab", "ProductsTab", "ReceiptsTab",
    "MovementTab", "ReceiveModal", "CorrectReceiptModal",
  ]) {
    assert.match(read(`../components/warehouse/${name}.tsx`), /label=\{/, name);
  }
});

/** Сайдбар скрыт на узком экране вместе с выходом из модуля и кнопкой «Выйти» —
 *  а по складу ходят с телефоном. */
test("на телефоне из модуля можно выйти и вернуться к другим модулям", () => {
  const source = read("../components/warehouse/WarehouseShell.tsx");
  const mobile = source.slice(source.indexOf("lg:hidden"));
  assert.match(mobile, /logout\(\)/, "кнопка выхода");
  assert.match(mobile, /href="\/"/, "ссылка на все модули");
});

/** resolveEntity зовут ВСЕ роуты склада до собственной работы: лишний
 *  последовательный круг здесь платят все экраны. */
test("справочник юрлиц и связи читаются одним кругом", () => {
  const source = read("../lib/warehouse/entityAccess.ts");
  assert.match(source, /const \[entitiesResult, linksResult\] = await Promise\.all\(\[/);
});

/** Пересчёт вторым человеком уходил в тишину: сервер отвечал saved:0 без
 *  ошибки, окно считало это успехом и закрывалось. */
test("разошедшийся пересчёт отвечает отказом, а не тишиной", () => {
  const route = read("../app/api/warehouse/receipts/route.ts");
  assert.match(route, /alreadyCounted\.length > 0 && updates\.length === 0/);
  assert.match(route, /409/);
  assert.match(route, /skipped: alreadyCounted\.length/);
  const modal = read("../components/warehouse/ReceiveModal.tsx");
  assert.match(modal, /json\.data\?\.skipped/, "частичный пропуск тоже нельзя закрывать молча");
  assert.match(modal, /window\.confirm/, "сброс сканером обязан спрашивать");
});

/** Сборка задания жила только в памяти вкладки: телефон засыпал — и поля
 *  снова показывали полное задание, что опаснее пустых. */
test("сборка задания переживает выгрузку вкладки", () => {
  const source = read("../components/warehouse/TaskCard.tsx");
  assert.match(source, /useDraft\(\s*`warehouse:task:\$\{task\.id\}`/);
  assert.match(source, /forget\(\);\s*\n\s*onShipped/, "черновик стираем до размонтирования карточки");
});

/** Заглушка подменяла таблицу на каждое обновление — дерево размонтировалось
 *  и теряло раскрытые модели. */
test("обновление остатков не схлопывает дерево", () => {
  const source = read("../components/warehouse/BalancesTab.tsx");
  assert.match(source, /if \(loading && !data\)/);
  assert.match(source, /lastFbsSaleAt/, "видно, насколько остаток отстал от факта");
  assert.match(source, /computedAt/);
});
