import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKizBrandLists,
  gtinFromBarcode,
  kizMatchesBarcode,
  parseExportDate,
  parseKizCode,
  parseKizReturnsRows,
  parseKizSalesRows,
  KIZ_BRAND_UNKNOWN,
} from "./kizCodes";

const GS = String.fromCharCode(29);
const KM = `010468000000010021ABCdef1234567${GS}91EE06${GS}92abcdefghijklmnopqrstuvwxyz==`;

test("код идентификации отрезается от криптохвоста и остаётся ровно 31 символ", () => {
  const parsed = parseKizCode(KM);
  assert.equal(parsed.code, "010468000000010021ABCdef1234567");
  assert.equal(parsed.code?.length, 31);
  assert.equal(parsed.gtin, "04680000000100");
  assert.equal(parsed.serial, "ABCdef1234567");
  assert.equal(parsed.gtinPrefix, "468000000");
});

test("нераспознанная марка честно даёт null, а не обрезок строки", () => {
  for (const raw of ["", "просто текст", "0104680000000100", "2100000000000000000000000000000"]) {
    assert.equal(parseKizCode(raw).code, null, `ожидался null для «${raw}»`);
  }
});

test("EAN приводится к GTIN-14, мусор — к null", () => {
  assert.equal(gtinFromBarcode("4680000001007"), "04680000001007");
  assert.equal(gtinFromBarcode(" 4680000001007 "), "04680000001007");
  assert.equal(gtinFromBarcode("12345"), null);
  assert.equal(gtinFromBarcode("abcdefghijklm"), null);
});

test("несовпадение GTIN ловится, а неизвестный GTIN не обвиняется", () => {
  const code = parseKizCode(KM);
  assert.equal(kizMatchesBarcode(code, "4680000000100"), true);
  assert.equal(kizMatchesBarcode(code, "4680000009999"), false);
  assert.equal(kizMatchesBarcode(code, ""), true);
  assert.equal(kizMatchesBarcode(parseKizCode("мусор"), "4680000000100"), true);
});

test("дата читается из ISO, ДД.ММ.ГГГГ и серийного номера Excel", () => {
  assert.equal(parseExportDate("2026-08-18T10:00:00Z"), "2026-08-18");
  assert.equal(parseExportDate("18.08.2026 10:00"), "2026-08-18");
  assert.equal(parseExportDate("46252"), "2026-08-18");
  assert.equal(parseExportDate("не дата"), null);
});

test("выгрузка продаж без колонки кода отвергается, а не считается «кодов нет»", () => {
  const rows = [["Номер задания", "Артикул WB", "Штрихкод"], ["12345", "111", "4680000001007"]];
  assert.throws(() => parseKizSalesRows(rows, "FBS"), /код/i);
});

test("строки продаж разбираются со сдвинутой шапкой и пустыми строками", () => {
  const rows = [
    ["Отчёт по продажам FBS", "", "", "", ""],
    [],
    ["Номер задания", "Артикул WB", "Артикул продавца", "Штрихкод", "Код маркировки", "Дата продажи"],
    [" wb-1 ", "111", "NV-836", "4680000001007", KM, "18.08.2026"],
    ["", "", "", "", "", ""],
    ["wb-2", "222", "HT-42", "4680000002004", "", "18.08.2026"],
  ];
  const parsed = parseKizSalesRows(rows, "FBS");
  assert.equal(parsed.headerRow, 3);
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].taskId, "WB-1");
  assert.equal(parsed.lines[0].scheme, "FBS");
  assert.equal(parsed.lines[0].soldAt, "2026-08-18");
  assert.equal(parsed.lines[0].code?.code, "010468000000010021ABCdef1234567");
  assert.equal(parsed.lines[1].code, null);
  assert.ok(parsed.warnings.some((text) => /без кода/i.test(text)));
});

test("из возвратов берутся только строки «Возврат брака»", () => {
  const rows = [
    ["Артикул WB", "Штрихкод", "Причина", "Код маркировки", "Дата возврата"],
    ["111", "4680000001007", "Возврат брака", KM, "2026-08-10"],
    ["222", "4680000002004", "Возврат по истечении срока хранения", KM, "2026-08-10"],
  ];
  const parsed = parseKizReturnsRows(rows);
  assert.equal(parsed.lines.length, 1);
  assert.equal(parsed.lines[0].nmId, 111);
  assert.ok(parsed.warnings.some((text) => /пропущено: 1/.test(text)));
});

test("возвраты без колонки причины отвергаются", () => {
  assert.throws(() => parseKizReturnsRows([["Артикул WB", "Код маркировки"], ["111", KM]]), /причин/i);
});

test("бренд берётся из каталога, дубли снимаются, группа кодов — по началу GTIN", () => {
  const second = `01046800000001002167890abcdef12${GS}91EE06`;
  const other = `0105901234123450211234567890abc${GS}91EE06`;
  const sales = parseKizSalesRows(
    [
      ["Номер задания", "Артикул WB", "Артикул продавца", "Штрихкод", "Код маркировки"],
      ["wb-1", "111", "NV-836", "4680000001007", KM],
      ["wb-2", "111", "NV-836", "4680000001007", KM],
      ["wb-3", "", "NV-836", "4680000001007", second],
      ["wb-4", "999", "XX-1", "4680000009999", other],
    ],
    "FBS",
  ).lines;
  const built = buildKizBrandLists({
    sales,
    returns: [],
    brandByNm: new Map([[111, "NORVIA"]]),
    brandByArticle: new Map([["nv-836", "NORVIA"]]),
  });

  assert.equal(built.totalCodes, 3);
  const norvia = built.brands.find((brand) => brand.brand === "NORVIA");
  assert.ok(norvia, "бренд каталога должен появиться");
  assert.equal(norvia.codes.length, 2);
  assert.equal(norvia.duplicatesRemoved, 1);
  assert.equal(norvia.sources.fbs, 2);
  assert.equal(norvia.codeGroup.gtinPrefix, "468000000");
  assert.equal(norvia.codeGroup.inn, null);

  const unknown = built.brands.find((brand) => brand.brand === KIZ_BRAND_UNKNOWN);
  assert.ok(unknown, "строка без бренда каталога уходит в отдельную группу");
  assert.equal(unknown.codeGroup.gtinPrefix, "590123412");
});

test("один и тот же код в продажах и возвратах считается один раз", () => {
  const built = buildKizBrandLists({
    sales: parseKizSalesRows([["Номер задания", "Артикул WB", "Код маркировки"], ["wb-1", "111", KM]], "FBS").lines,
    returns: parseKizReturnsRows([["Артикул WB", "Причина", "Код маркировки"], ["111", "Возврат брака", KM]]).lines,
    brandByNm: new Map([[111, "NORVIA"]]),
    brandByArticle: new Map(),
  });
  assert.equal(built.totalCodes, 1);
  assert.equal(built.brands[0].duplicatesRemoved, 1);
});
