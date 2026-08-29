import { strict as assert } from "node:assert";
import test from "node:test";
import { buildCsv, csvFileName } from "../lib/ozon/csvExport";

test("CSV открывается в русском Excel: BOM, точка с запятой, запятая в дробях", () => {
  const csv = buildCsv(
    [
      { header: "Товар", value: (row: { name: string; drr: number }) => row.name },
      { header: "ДРР, %", value: (row: { name: string; drr: number }) => row.drr },
    ],
    [{ name: "Пенал школьный", drr: 8.3 }],
  );
  assert.ok(csv.startsWith("﻿"), "без BOM Excel ломает кириллицу");
  assert.match(csv, /Товар;ДРР, %/);
  assert.match(csv, /Пенал школьный;8,3/);
  assert.ok(csv.endsWith("\r\n"));
});

test("разделители и кавычки внутри значения не рвут строку", () => {
  const csv = buildCsv(
    [{ header: "Склады", value: (row: { text: string }) => row.text }],
    [{ text: 'Хоругвино: 10; Тверь: 5, склад "А"' }],
  );
  assert.match(csv, /"Хоругвино: 10; Тверь: 5, склад ""А"""/);
});

test("пустые значения остаются пустыми, а не «null»", () => {
  const csv = buildCsv(
    [{ header: "Маржа", value: (row: { margin: number | null }) => row.margin }],
    [{ margin: null }, { margin: Number.NaN }],
  );
  assert.equal(csv.split("\r\n")[1], "");
  assert.equal(csv.split("\r\n")[2], "");
});

test("имя файла собирается из кабинета и периода без запрещённых символов", () => {
  assert.equal(
    csvFileName(["ozon-эконом", "Ozon COSMOS", "2026-08-17", "2026-08-30"]),
    "ozon-эконом_Ozon-COSMOS_2026-08-17_2026-08-30.csv",
  );
  assert.equal(csvFileName(["a/b:c*d"]), "a-b-c-d.csv");
  assert.equal(csvFileName([null, undefined, "  "]), "ozon.csv");
});
