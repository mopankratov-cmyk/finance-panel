import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildXlsx } from "../lib/xlsx/write";

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

test("выгрузка КИЗ проверяет готовый файл, а не намерение", () => {
  const route = readFileSync(new URL("../app/api/warehouse/kiz/export/route.ts", import.meta.url), "utf8");
  assert.match(route, /function assertSheetIsUsable/);
  assert.match(route, /assertSheetIsUsable\(file, rows\.length\);/);
  assert.match(route, /файл собрался неверно/);
  assert.match(route, /Excel откроет его пустым/);
});
