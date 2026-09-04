import { strict as assert } from "node:assert";
import test from "node:test";
import {
  ALL_EVENT_KINDS,
  CHANGE_KINDS,
  EVENT_LABEL,
  EVENT_TONE,
  describeChange,
  describeEvent,
  isEventKind,
  toEventRow,
  type WarehouseEventKind,
} from "../lib/warehouse/events.ts";

const AT = "2026-09-04T10:00:00Z";
const describe = (kind: WarehouseEventKind, payload: Record<string, unknown>, occurredAt = AT) =>
  describeEvent({ kind, payload, occurredAt, changes: [] });

test("создание приёмки: поставщик, мешки со склонением, штуки, новинки", () => {
  assert.equal(
    describe("receipt_created", { supplier: "Фабрика", bagsCount: 5, qty: 100, lines: 3, novelty: ["NV-836-02", "NV-836-04"] }),
    "Фабрика · 5 мешков · 100 шт · новинка NV-836-02, NV-836-04",
  );
  assert.equal(describe("receipt_created", { bagsCount: 1, qty: 10 }), "1 мешок · 10 шт");
  assert.equal(describe("receipt_created", { bagsCount: 3, qty: 10 }), "3 мешка · 10 шт");
  assert.equal(describe("receipt_created", { bagsCount: 11, qty: 10 }), "11 мешков · 10 шт");
  assert.equal(describe("receipt_created", { bagsCount: 21, qty: 10 }), "21 мешок · 10 шт");
  // Ноль мешков и пустой список новинок в подпись не лезут.
  assert.equal(describe("receipt_created", { bagsCount: 0, qty: 10, novelty: [] }), "10 шт");
});

test("пересчёт приёмки: принято, брак, склад при проводке и «через N» от создания", () => {
  const createdAt = "2026-09-04T08:00:00Z";
  assert.equal(
    describe("receipt_counted", { expected: 10, received: 9, defect: 1, warehouseName: "ФФ", posted: true, createdAt }),
    "9 шт · брак 1 · на остаток ФФ · через 2 ч после создания",
  );
  // Без проводки склад не упоминается, нулевой брак — тоже.
  assert.equal(
    describe("receipt_counted", { received: 9, defect: 0, warehouseName: "ФФ", posted: false, createdAt: "2026-09-04T09:35:00Z" }),
    "9 шт · через 25 мин после создания",
  );
  assert.equal(describe("receipt_counted", { received: 9 }), "9 шт");
});

test("постановка на остаток: штуки, сумма, расчётная себестоимость, склад", () => {
  assert.equal(
    describe("receipt_posted", { qty: 9, total: 900.4, costBasis: "estimated", warehouseName: "ФФ" }),
    "9 шт · 900 ₽ · себестоимость расчётная · ФФ",
  );
  assert.equal(describe("receipt_posted", { qty: 9, total: 0, costBasis: "exact" }), "9 шт");
});

test("расхождение: ждали/принято, недовоз и излишек", () => {
  assert.equal(describe("receipt_discrepancy", { expected: 10, received: 9, short: 1, over: 0 }), "ждали 10, принято 9 · недовоз 1");
  assert.equal(describe("receipt_discrepancy", { expected: 10, received: 12, short: 0, over: 2 }), "ждали 10, принято 12 · излишек 2");
});

test("коррекция прихода: знак у дельт и причина", () => {
  assert.equal(
    describe("receipt_corrected", { reason: "досчитали", deltaQty: 2, deltaDefect: -1 }),
    "принято +2 · брак -1 · причина: досчитали",
  );
  // Нулевые дельты не показываются.
  assert.equal(describe("receipt_corrected", { reason: "ошиблись", deltaQty: 0, deltaDefect: 3 }), "брак +3 · причина: ошиблись");
});

test("задание: кабинет, позиции со склонением, штуки", () => {
  assert.equal(describe("task_created", { cabinetName: "Оптима", warehouseName: "ФФ", lines: 2, qty: 5 }), "Оптима · 2 позиции · 5 шт");
  assert.equal(describe("task_created", { cabinetName: "Оптима", lines: 1, qty: 1 }), "Оптима · 1 позиция · 1 шт");
  assert.equal(describe("task_created", { cabinetName: "Оптима", lines: 5, qty: 9 }), "Оптима · 5 позиций · 9 шт");
  assert.equal(describe("task_corrected", { reason: "пересобрали" }), "пересобрали");
  assert.equal(describe("task_corrected", {}), "");
});

test("отгрузка по заданию: неполная отгрузка — «X из Y в задании», время от постановки", () => {
  const createdAt = "2026-09-01T10:00:00Z";
  assert.equal(
    describe("task_shipped", { cabinetName: "Оптима", lines: 1, qty: 3, plannedQty: 5, amount: 300, createdAt }),
    "Оптима · 1 позиция · 3 шт из 5 в задании · через 3 дн после постановки",
  );
  // Отгрузили ровно план — «из» не нужно.
  assert.equal(
    describe("task_shipped", { cabinetName: "Оптима", lines: 1, qty: 5, plannedQty: 5, createdAt: "2026-09-04T09:00:00Z" }),
    "Оптима · 1 позиция · 5 шт · через 1 ч после постановки",
  );
  // Без отметки постановки длительности нет.
  assert.equal(describe("task_shipped", { cabinetName: "Оптима", lines: 1, qty: 5 }), "Оптима · 1 позиция · 5 шт");
});

test("отмена задания: кабинет, штуки и причина в кавычках", () => {
  assert.equal(describe("task_cancelled", { cabinetName: "Оптима", qty: 5, reason: "передумали" }), "Оптима · 5 шт · «передумали»");
  assert.equal(describe("task_cancelled", { cabinetName: "Оптима", qty: 5 }), "Оптима · 5 шт");
});

test("отгрузка сразу, перемещение, возврат", () => {
  assert.equal(describe("shipment_posted", { qty: 7, amount: 700, lines: 2, cabinets: ["Оптима", "РИО"] }), "Оптима, РИО · 2 позиции · 7 шт");
  assert.equal(describe("shipment_posted", { qty: 7, lines: 2, cabinets: [] }), "2 позиции · 7 шт");
  assert.equal(describe("transfer_posted", { qty: 3, from: "ФФ", to: "В пути" }), "ФФ → В пути · 3 шт");
  assert.equal(describe("transfer_posted", { qty: 3, from: "ФФ" }), "3 шт");
  assert.equal(describe("return_posted", { qty: 2, defects: 1, cabinetName: "Оптима", warehouseName: "ФФ" }), "из Оптима · 2 шт · брак 1");
  assert.equal(describe("return_posted", { qty: 2, defects: 0, cabinetName: "Оптима" }), "из Оптима · 2 шт");
});

test("брак: склад, штуки, причина и дата задним числом", () => {
  assert.equal(
    describe("writeoff_created", { warehouseName: "ФФ", reason: "порвано", qty: 2, amount: 200, date: "2026-04-24" }),
    "ФФ · 2 шт · порвано · дата 2026-04-24",
  );
  assert.equal(describe("writeoff_created", { warehouseName: "ФФ", reason: "порвано", qty: 2 }), "ФФ · 2 шт · порвано");
});

test("сторно: какой документ отменён и сколько вернулось", () => {
  assert.equal(
    describe("doc_reversed", { kind: "shipment", reversedNumber: "ОТГ-2026-0001", qty: 4, amount: 400 }),
    "отменяет ОТГ-2026-0001 · 4 шт вернулись в остаток",
  );
});

test("пустой payload не роняет подпись ни у одного вида", () => {
  for (const kind of ALL_EVENT_KINDS) {
    assert.equal(describe(kind, {}), "", `${kind}: пустой payload должен давать пустую подпись`);
    assert.equal(describeEvent({ kind, payload: null as never, occurredAt: AT, changes: [] }), "");
  }
});

test("правка словами: «42: принято 33 → 35»", () => {
  assert.equal(describeChange({ line: "42", field: "received", before: 33, after: 35 }), "42: принято 33 → 35");
  assert.equal(describeChange({ line: "NV-836-04 · 42", field: "defect", before: 1, after: 3 }), "NV-836-04 · 42: брак 1 → 3");
  assert.equal(describeChange({ line: "42", field: "qty", before: null, after: 5 }), "42: кол-во — → 5");
  assert.equal(describeChange({ line: "42", field: "note", before: "было", after: "" }), "42: комментарий было → —");
  // Неизвестное поле показывается как есть, а не пропадает.
  assert.equal(describeChange({ line: "42", field: "weird", before: 1, after: 2 }), "42: weird 1 → 2");
});

test("строка из базы превращается в строку ленты: склад по карте, правки без поля отбрасываются", () => {
  const names = new Map([["wh-ff", "ФФ"]]);
  const row = toEventRow(
    {
      id: "17",
      kind: "task_shipped",
      ref_type: "stock_doc",
      ref_id: "doc-1",
      number: "ОТГ-2026-0001",
      warehouse_id: "wh-ff",
      actor: "gia@ff.ru",
      actor_role: "warehouse",
      occurred_at: AT,
      payload: { qty: 3 },
      changes: [
        { line: "42", field: "qty", before: 5, after: 3 },
        { line: "без поля" },
        null,
        "мусор",
      ],
    },
    names,
  );
  assert.equal(row.id, 17);
  assert.equal(row.kind, "task_shipped");
  assert.equal(row.label, EVENT_LABEL.task_shipped);
  assert.equal(row.warehouseName, "ФФ");
  assert.equal(row.actor, "gia@ff.ru");
  assert.equal(row.actorRole, "warehouse");
  assert.equal(row.number, "ОТГ-2026-0001");
  assert.deepEqual(row.payload, { qty: 3 });
  assert.deepEqual(row.changes, [{ line: "42", field: "qty", before: 5, after: 3 }]);
});

test("неизвестный вид события не роняет ленту: подпись — сырой код, склад без карты — пусто", () => {
  const row = toEventRow(
    { id: 1, kind: "something_new", warehouse_id: "unknown", occurred_at: AT, payload: "не объект", changes: "не массив" },
    new Map(),
  );
  assert.ok(isEventKind(row.kind), "kind обязан остаться допустимым значением");
  assert.equal(row.label, "something_new");
  assert.equal(row.warehouseName, null);
  assert.equal(row.actor, null);
  assert.equal(row.refType, null);
  assert.deepEqual(row.payload, {});
  assert.deepEqual(row.changes, []);
});

test("журнал правок — ровно правки: коррекция, изменение и отмена задания, сторно", () => {
  assert.deepEqual(
    [...CHANGE_KINDS].sort(),
    ["doc_reversed", "receipt_corrected", "task_cancelled", "task_corrected"],
  );
  for (const kind of CHANGE_KINDS) assert.ok(isEventKind(kind), `${kind} не является видом события`);
});

test("у каждого вида события есть подпись и цвет", () => {
  assert.ok(ALL_EVENT_KINDS.length >= 14);
  for (const kind of ALL_EVENT_KINDS) {
    assert.ok(EVENT_LABEL[kind]?.trim(), `${kind}: нет подписи`);
    assert.ok(["danger", "warn", "info", "ok"].includes(EVENT_TONE[kind]), `${kind}: нет цвета`);
  }
  assert.deepEqual(Object.keys(EVENT_TONE).sort(), [...ALL_EVENT_KINDS].sort());
  assert.equal(isEventKind("не событие"), false);
});
