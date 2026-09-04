import { strict as assert } from "node:assert";
import test from "node:test";
import { assertSheetIsUsable, buildXlsx } from "../lib/xlsx/write";

const GS = String.fromCharCode(29);

/**
 * Файл на вывод из оборота собрался на девятнадцать кодов, весил девять
 * килобайт — и открывался в Excel ПУСТЫМ. Коды маркировки содержат разделитель
 * GS (0x1D), запрещённый в XML 1.0; Excel «чинит» такую книгу, выбрасывая лист.
 * Ошибки при этом не было ни в панели, ни в Excel.
 */

test("управляющие символы не попадают в книгу как есть", () => {
  const file = buildXlsx("t", [["КИЗ"], [`0104679783193566215Nun${GS}91EE11${GS}92abc=`]]);
  const xml = file.toString("utf8");
  assert.equal([...xml].some((ch) => ch.charCodeAt(0) === 29), false, "GS ломает XML и обнуляет лист");
  assert.ok(xml.includes("_x001D_"), "символ сохранён в виде, который Excel читает обратно");
});

test("литеральная последовательность _xHHHH_ не превращается в символ", () => {
  const xml = buildXlsx("t", [["текст _x0041_ в тексте"]]).toString("utf8");
  assert.ok(xml.includes("_x005F_x0041_"));
});

test("обычный текст и цифры не портятся", () => {
  const xml = buildXlsx("t", [["Артикул", 123], ["NV-01-35 & <тест>", 45.6]]).toString("utf8");
  assert.ok(xml.includes("NV-01-35 &amp; &lt;тест&gt;"));
  assert.ok(xml.includes("<v>45.6</v>"));
});

/**
 * Проверка «файл пригоден» сама роняла КАЖДУЮ выгрузку.
 *
 * Она искала управляющие символы во всём файле, а XLSX — это ZIP: его
 * заголовки начинаются с «PK\x03\x04». Совпадение находилось всегда, отказ
 * летел мимо JSON, и экран показывал безликое «Не удалось собрать файл» на
 * любом юрлице. Настоящая поломка книги при этом осталась бы незамеченной.
 */
test("готовый файл с кодами маркировки проходит проверку", () => {
  // Считается столько же, сколько считает выгрузка: шапка сверх строк с кодами.
  const codes = [
    [`0104630691647749215Y*ovJpRu94OC${GS}91EE12${GS}92A1ITIfjCqugXeOUhNjVpOEC=`, 5588],
    [`0104630691647794215LmENvwd)RJXf${GS}91EE12${GS}92E05G14Zm50dj/O4HEBo5m54=`, 4990],
  ];
  const file = buildXlsx("КИЗ на вывод", [["КИЗ", "Цена реализации, ₽"], ...codes]);
  assertSheetIsUsable(file, codes.length);
});

test("проверка ловит потерянные строки", () => {
  const file = buildXlsx("КИЗ на вывод", [["КИЗ"], ["0104679783193535215s7BYhd_%mddt"]]);
  assert.throws(() => assertSheetIsUsable(file, 5), /1 строк вместо 5/);
});

test("проверка ловит управляющий символ, доехавший до листа", () => {
  // Лист собран в обход экранирования — ровно та книга, которую Excel
  // открывает пустой.
  const broken = Buffer.from(
    '<sheetData><row r="1"><c><is><t>КИЗ</t></is></c></row>'
    + `<row r="2"><c><is><t>код${GS}хвост</t></is></c></row></sheetData>`,
    "utf8",
  );
  assert.throws(() => assertSheetIsUsable(broken, 1), /управляющие символы/);
});

test("проверка ловит книгу без листа", () => {
  assert.throws(() => assertSheetIsUsable(Buffer.from("PK\u0003\u0004", "utf8"), 1), /нет листа/);
});
