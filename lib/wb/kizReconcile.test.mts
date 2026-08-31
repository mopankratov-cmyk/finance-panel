import test from "node:test";
import assert from "node:assert/strict";
import {
  addWorkingDays,
  extractClaimRows,
  isKizOverdue,
  reconcileKizFromWb,
  type FbsAssemblyTask,
  type KizCodesLookupState,
  type KizReconcileInput,
  type WbReturnFact,
} from "./kizReconcile";

const GS = String.fromCharCode(29);
/** GTIN 04680000000100, серийник ABCdef1234567. */
const KM = `010468000000010021ABCdef1234567${GS}91EE06${GS}92abcdefghijklmnopqrstuvwxyz==`;
const KM2 = `01046800000001002167890abcdef12${GS}91EE06`;
const KM_OTHER = `0105901234123450211234567890abc${GS}91EE06`;

const task = (id: number, over: Partial<FbsAssemblyTask> = {}): FbsAssemblyTask => ({
  id,
  srid: `srid-${id}`,
  nmId: 111,
  article: "NV-836",
  barcode: "4680000000100",
  createdAt: "2026-08-10",
  ...over,
});

const lookup = (over: Partial<KizCodesLookupState> = {}): KizCodesLookupState => ({
  lookupStopped: false,
  stopReason: null,
  stopMessage: null,
  failed: 0,
  skipped: 0,
  ...over,
});

function input(over: Partial<KizReconcileInput> = {}): KizReconcileInput {
  const tasks = over.tasks ?? [task(1)];
  return {
    todayIso: "2026-08-19T09:00:00.000Z",
    days: 30,
    tasks,
    soldIds: new Set(tasks.map((row) => row.id)),
    codesByTask: new Map(),
    statusesAvailable: true,
    returns: [],
    reasonBySrid: new Map(),
    brandByNm: new Map([[111, "NORVIA"]]),
    brandByArticle: new Map([["nv-836", "NORVIA"]]),
    ...over,
  };
}

/* ───────────────────────────── рабочие дни ───────────────────────────── */

test("срок ввода в оборот считается рабочими днями и перепрыгивает выходные", () => {
  // 14.08.2026 — пятница: +3 рабочих дня = среда 19.08.
  assert.equal(addWorkingDays("2026-08-14", 3), "2026-08-19");
  assert.equal(addWorkingDays("2026-08-15", 3), "2026-08-19");
  assert.equal(addWorkingDays("2026-08-10T12:34:56Z", 3), "2026-08-13");
  assert.equal(addWorkingDays("2026-08-10", 0), "2026-08-10");
});

test("нераспознанная дата не превращается в выдуманный срок", () => {
  assert.equal(addWorkingDays("не дата", 3), "не дата");
});

test("просрочка — только когда срок известен и он в прошлом", () => {
  assert.equal(isKizOverdue(null, "2026-08-19"), false);
  assert.equal(isKizOverdue("2026-08-18", "2026-08-19T10:00:00Z"), true);
  assert.equal(isKizOverdue("2026-08-19", "2026-08-19T10:00:00Z"), false);
  assert.equal(isKizOverdue("2026-08-20", "2026-08-19"), false);
});

/* ───────────────────────────── разбор ответа заявок ───────────────────────────── */

test("заявки читаются из голого массива и из вложенных конвертов", () => {
  assert.equal(extractClaimRows([{ srid: "a" }]).length, 1);
  assert.equal(extractClaimRows({ claims: [{ srid: "a" }] }).length, 1);
  assert.equal(extractClaimRows({ data: { claims: [{ srid: "a" }, { srid: "b" }] } }).length, 2);
  assert.equal(extractClaimRows({ items: [{ srid: "a" }] }).length, 1);
  assert.equal(extractClaimRows({ data: { items: [{ srid: "a" }] } }).length, 1);
  assert.equal(extractClaimRows(null).length, 0);
  assert.equal(extractClaimRows({ claims: "не массив" }).length, 0);
});

/* ───────────────────────────── раскладка по корзинам ───────────────────────────── */

test("привязанный непротиворечивый код строки не создаёт", () => {
  const result = reconcileKizFromWb(input({ codesByTask: new Map([[1, [KM]]]) }));
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.counts, { noCode: 0, check: 0, notChecked: 0, introduce: 0 });
  assert.deepEqual(result.coverage, { checked: 1, soldTotal: 1, days: 30 });
});

test("продано без привязанного кода — корзина «Нет кода», а не «не проверено»", () => {
  // «Вывести из оборота» панель не показывает: код, привязанный к заданию,
  // выводит сам WB, а проверить это без True API Честного Знака нельзя.
  // Отсутствие кода — отдельный факт, и путать его с «WB не ответил» нельзя.
  const result = reconcileKizFromWb(input({ codesByTask: new Map([[1, []]]) }));
  assert.equal(result.counts.noCode, 1);
  assert.equal(result.counts.notChecked, 0);
  assert.equal(result.rows[0].bucket, "no_code");
  assert.equal(result.rows[0].brand, "NORVIA");
  assert.match(result.rows[0].reason, /код не привязан/);
});

test("непроверенное задание уходит в «Не проверено» и не считается нарушением", () => {
  const result = reconcileKizFromWb(input({ tasks: [task(1), task(2)], codesByTask: new Map([[1, [KM]]]) }));
  assert.equal(result.counts.notChecked, 1);
  assert.equal(result.counts.noCode, 0);
  assert.equal(result.counts.check, 0);
  const row = result.rows.find((item) => item.taskId === "2");
  assert.ok(row, "непроверенное задание должно попасть в строки");
  assert.equal(row.bucket, "not_checked");
  assert.equal(result.coverage.checked, 1);
  assert.equal(result.coverage.soldTotal, 2);
  assert.ok(result.warnings.some((text) => /непроверенным кодом: 1/.test(text)));
});

test("оборванный опрос называет причину и не молчит про незнание", () => {
  const result = reconcileKizFromWb(input({
    tasks: [task(1), task(2)],
    codesByTask: new Map(),
    codesLookup: lookup({ lookupStopped: true, stopReason: "forbidden", stopMessage: "нет доступа к кодам маркировки", skipped: 2 }),
  }));
  assert.equal(result.counts.notChecked, 2);
  assert.equal(result.counts.noCode, 0);
  assert.ok(result.warnings.some((text) => /нет доступа к кодам маркировки/.test(text)));
  assert.ok(result.rows.every((row) => /нет доступа к кодам маркировки/.test(row.reason)));
  // Незнание не должно попадать в группировку кодов — там нечего группировать.
  assert.equal(result.codeGroups.length, 0);
});

test("один код на два задания — обе строки в «Проверить»", () => {
  const result = reconcileKizFromWb(input({
    tasks: [task(1), task(2)],
    codesByTask: new Map([[1, [KM]], [2, [KM]]]),
  }));
  assert.equal(result.counts.check, 2);
  assert.ok(result.rows.every((row) => /один код на два задания/.test(row.reason)));
});

test("GTIN кода против штрихкода задания — «Проверить», неизвестный штрихкод молчит", () => {
  const mismatch = reconcileKizFromWb(input({
    tasks: [task(1, { barcode: "4680000009999" })],
    codesByTask: new Map([[1, [KM]]]),
  }));
  assert.equal(mismatch.counts.check, 1);
  assert.match(mismatch.rows[0].reason, /GTIN/);

  const silent = reconcileKizFromWb(input({
    tasks: [task(1, { barcode: "" })],
    codesByTask: new Map([[1, [KM]]]),
  }));
  assert.equal(silent.rows.length, 0);
});

test("нераспознанная марка задания — «Проверить», а не «нет кода»", () => {
  const result = reconcileKizFromWb(input({ codesByTask: new Map([[1, ["01046800000001"]]]) }));
  assert.equal(result.counts.check, 1);
  assert.equal(result.counts.noCode, 0);
  assert.equal(result.rows[0].code, null);
  assert.match(result.rows[0].reason, /не распознан/);
});

test("без статусов заданий корзины по продажам пусты и об этом сказано вслух", () => {
  const result = reconcileKizFromWb(input({ statusesAvailable: false, codesByTask: new Map([[1, []]]) }));
  assert.equal(result.rows.length, 0);
  assert.equal(result.coverage.soldTotal, 0);
  assert.ok(result.warnings.some((text) => /статусы сборочных заданий/i.test(text)));
});

/* ───────────────────────────── возвраты ───────────────────────────── */

const returnFact = (over: Partial<WbReturnFact> = {}): WbReturnFact => ({
  saleId: "R123",
  srid: "srid-1",
  nmId: 111,
  article: "NV-836",
  barcode: "4680000000100",
  brand: "из отчёта",
  returnedAt: "2026-08-10",
  ...over,
});

test("возврат получает срок в 3 рабочих дня, причину и признак просрочки", () => {
  const result = reconcileKizFromWb(input({
    codesByTask: new Map([[1, [KM]]]),
    returns: [returnFact()],
    reasonBySrid: new Map([["srid-1", "не подошёл размер"]]),
  }));
  assert.equal(result.counts.introduce, 1);
  const row = result.returns[0];
  assert.equal(row.deadline, "2026-08-13");
  assert.equal(row.overdue, true);
  assert.equal(row.reason, "не подошёл размер");
  // Код подтянулся от проданного задания по srid.
  assert.equal(row.code, "010468000000010021ABCdef1234567");
  assert.equal(row.gtinPrefix, "468000000");
});

test("возврат без даты не получает выдуманный срок, но и не теряется", () => {
  const result = reconcileKizFromWb(input({
    codesByTask: new Map([[1, []]]),
    returns: [returnFact({ returnedAt: null, srid: "srid-9" })],
  }));
  assert.equal(result.returns[0].deadline, null);
  assert.equal(result.returns[0].overdue, false);
  assert.equal(result.returns[0].reason, "причина возврата не раскрыта WB");
  assert.ok(result.warnings.some((text) => /без распознанной даты/i.test(text)));
});

test("продан и одновременно вернулся — «Проверить»", () => {
  const result = reconcileKizFromWb(input({
    codesByTask: new Map([[1, [KM]]]),
    returns: [returnFact()],
  }));
  assert.equal(result.counts.check, 1);
  assert.match(result.rows[0].reason, /вернулся/);
});

test("группы кодов считаются по началу GTIN и сортируются по объёму", () => {
  const result = reconcileKizFromWb(input({
    // task 1 — продан и вернулся (группа 468…), task 2 — чист, task 3 — чужой GTIN (группа 590…).
    tasks: [task(1, { barcode: "" }), task(2, { barcode: "" }), task(3, { barcode: "4680000009999" })],
    codesByTask: new Map([[1, [KM]], [2, [KM2]], [3, [KM_OTHER]]]),
    returns: [returnFact({ srid: "srid-1" })],
  }));
  const prefixes = result.codeGroups.map((group) => group.gtinPrefix);
  assert.deepEqual(prefixes, ["468000000", "590123412"]);
  assert.equal(result.codeGroups[0].codes, 2);
  assert.equal(result.codeGroups[0].attention, 1);
  assert.equal(result.codeGroups[0].introduce, 1);
  assert.equal(result.codeGroups[1].codes, 1);
  assert.equal(result.codeGroups[1].introduce, 0);
});
