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

/** В колонке «Документ» стоял технический код (`purchase_receipt`): человек
 *  ищет документ по номеру, а тип ему ничего не говорит. */
test("документ в журнале движений подписан номером, а не кодом", () => {
  assert.match(read("../app/api/warehouse/moves/route.ts"), /docNumber: row\.doc_id \? docNumbers\.get/);
  const source = read("../components/warehouse/MovesTab.tsx");
  assert.match(source, /row\.docNumber \?\? DOC_TYPE_LABEL\[row\.docType\] \?\? row\.docType/);
  assert.match(source, /purchase_receipt: "приёмка"/);
  assert.doesNotMatch(source, /\{row\.docType \|\| "документ"\}/, "сырой код в колонке остался");
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
  // Не «/» жёстко: витрина модулей закрыта внешнему селлеру, и адрес выхода
  // берётся тот же, что в сайдбаре.
  assert.match(mobile, /href=\{exitHref\}/, "ссылка на другие модули");
});

/** resolveEntity зовут ВСЕ роуты склада до собственной работы: каждый лишний
 *  последовательный круг здесь (≈0,5 с из fra1) платят все экраны. */
test("юрлица, связи и имена кабинетов читаются одним кругом", () => {
  const source = read("../lib/warehouse/entityAccess.ts");
  assert.match(source, /const \[entitiesResult, linksResult, cabinetsResult\] = await Promise\.all\(\[/);
  assert.doesNotMatch(source, /await db\.from\("wb_cabinets"\)/, "имена кабинетов не должны стоить второго круга");
});

/** Между «запросы» и «сборка» пряталось пять последовательных запросов —
 *  1,0–2,3 с по замеру ?timings=1, больше всего остального экрана вместе. */
test("вторая волна запросов остатка идёт одним кругом", () => {
  const source = read("../app/api/warehouse/stock/route.ts");
  assert.match(source, /const \[allowedWarehouses, draftLines, batches, defaults\] = await Promise\.all\(\[/);
  assert.match(source, /mark\("wave2"\)/);
  assert.doesNotMatch(source, /const draftLines = await chunked/, "остался последовательный запрос");
  assert.doesNotMatch(source, /const batches = await chunked/, "остался последовательный запрос");
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

/**
 * Каждое переключение вкладки поднимало экран с нуля: 3–7 секунд «Загружаю…»
 * и вместе с компонентом умирало состояние — раскрытые модели, фильтры,
 * незаконченный ввод. Вкладку, где человек уже был, теперь прячем, а не
 * размонтируем.
 */
test("посещённые вкладки склада не размонтируются", () => {
  const source = read("../components/warehouse/WarehousePage.tsx");
  assert.match(source, /useKeepAliveTabs<Tab>\(tab, entityId\)/, "юрлицо — то, при смене чего данные чужие");
  assert.doesNotMatch(source, /\) : tab === "receipts" \? \(/, "остался условный рендер вкладок");
  for (const key of ["balances", "receipts", "shipment", "movement", "defects", "events", "products", "kiz", "docs", "moves", "warehouses"]) {
    assert.ok(source.includes(`panel("${key}")`), key);
  }
});

/** Распараллеливание сняло лишь треть ожидания — остаток надо мерить, а не
 *  угадывать. */
test("остаток отвечает по этапам на ?timings=1", () => {
  const source = read("../app/api/warehouse/stock/route.ts");
  assert.match(source, /url\.searchParams\.get\("timings"\) === "1"/);
  for (const stage of ["gate", "resolveEntity", "queries", "assemble", "total"]) {
    assert.ok(source.includes(`mark("${stage}")`), stage);
  }
});

/**
 * Размеры и товары читались двумя кругами подряд: второй ждал первого только
 * потому, что список product_id рождался в нём. По замеру пара стоила ~0,7 с
 * из 2,4 с всего ответа.
 */
test("товар приезжает вместе с размером, а не вторым кругом", () => {
  const source = read("../app/api/warehouse/stock/route.ts");
  assert.match(source, /products\(\$\{product\}\)/, "товар вложен в выборку размеров");
  assert.doesNotMatch(source, /let productsResult = await chunked/, "остался отдельный круг за товарами");
  // PostgREST отдаёт вложение объектом или массивом — принимаем оба вида.
  assert.match(source, /Array\.isArray\(row\.products\) \? row\.products\[0\] : row\.products/);
});
