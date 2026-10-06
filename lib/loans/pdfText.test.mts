import assert from "node:assert/strict";
import test from "node:test";

import { recognizeLoanPdfSchedule } from "../../components/loans/loanRecognition.ts";
import { extractPdfText } from "./pdfText.ts";

function streamObject(id: number, data: string) {
  return `${id} 0 obj\n<</Length ${Buffer.byteLength(data, "latin1")}>> stream\n${data}\nendstream\nendobj\n`;
}

test("PDF text uses the active font CMap instead of merging colliding glyph codes", () => {
  const fontOne = `/CIDInit /ProcSet findresource begin\nbegincmap\n2 beginbfchar\n<0001> <0031>\n<0006> <0036>\nendbfchar\nendcmap\nend`;
  const fontTwo = `/CIDInit /ProcSet findresource begin\nbegincmap\n1 beginbfchar\n<0001> <0032>\nendbfchar\nendcmap\nend`;
  const content = `BT\n/F4 12 Tf\n<0001> Tj\n<0006> Tj\n/F5 12 Tf\n<0001> Tj\nET`;
  const pdf = Buffer.from([
    "%PDF-1.7\n",
    "1 0 obj\n<</Type /Page /Resources <</Font <</F4 4 0 R /F5 5 0 R>>>> /Contents 9 0 R>>\nendobj\n",
    "4 0 obj\n<</Type /Font /ToUnicode 10 0 R>>\nendobj\n",
    "5 0 obj\n<</Type /Font /ToUnicode 11 0 R>>\nendobj\n",
    streamObject(9, content),
    streamObject(10, fontOne),
    streamObject(11, fontTwo),
    "%%EOF",
  ].join(""), "latin1");

  assert.equal(extractPdfText(pdf), "162");
});

test("unnumbered eight-column PDF rows preserve payment totals and ending balance", () => {
  const text = [
    "08.12.2024 429 859,51 191 895,61 207 211,90 0,00 0,00 399 107,51 30 751,00 9 807 004,39",
    "08.01.2025 430 266,36 188 888,37 210 219,14 0,00 0,00 399 107,51 31 158,85 9 618 116,02",
    "08.02.2025 429 670,97 192 895,50 206 212,01 0,00 0,00 399 107,51 30 563,46 9 425 220,52",
  ].join(" ");

  const rows = recognizeLoanPdfSchedule(text);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    date: "2024-12-08",
    principal: 191_895.61,
    interest: 237_963.90,
    penalty: 0,
    fine: 0,
    status: "planned",
    balanceBefore: 9_998_900,
    balanceAfter: 9_807_004.39,
  });
});

test("numbered five-column rows win when they form the more complete valid schedule", () => {
  const text = [
    // Частичное совпадение альтернативной восьмиколоночной формы не должно
    // останавливать остальные стратегии распознавания.
    "01.01.2026 100,00 10,00 20,00 0,00 0,00 20,00 1,00 990,00",
    "02.01.2026 100,00 10,00 20,00 0,00 0,00 20,00 1,00 980,00",
    "03.01.2026 100,00 10,00 20,00 0,00 0,00 20,00 1,00 970,00",
    "21 06.07.2026 17 057.11 10 557.99 6 499.12 0 796 305.23",
    "22 13.07.2026 17 057.11 10 643.03 6 414.08 0 785 662.20",
    "23 20.07.2026 17 057.11 10 728.76 6 328.35 0 774 933.44",
    "24 27.07.2026 17 057.11 10 815.18 6 241.93 0 764 118.26",
  ].join(" ");

  const rows = recognizeLoanPdfSchedule(text);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], {
    date: "2026-07-06",
    principal: 10_557.99,
    interest: 6_499.12,
    penalty: 0,
    fine: 0,
    status: "planned",
    balanceBefore: 806_863.22,
    balanceAfter: 796_305.23,
  });
});

test("numbered schedule keeps money columns printed without kopecks", () => {
  const text = [
    "25 03.08.2026 17 057.11 10 902.29 6 154.82 0 753 215.97",
    "26 10.08.2026 17 057.11 10 990.11 6 067 0 742 225.86",
    "58 22.03.2027 17 057.11 14 883 2 174.11 0 318 933.89",
    "74 12.07.2027 17 057.11 16 512.01 545.10 0 67 184",
  ].join(" ");

  const rows = recognizeLoanPdfSchedule(text);
  assert.deepEqual(rows.map((row) => ({
    date: row.date,
    principal: row.principal,
    interest: row.interest,
    balanceAfter: row.balanceAfter,
  })), [
    { date: "2026-08-03", principal: 10902.29, interest: 6154.82, balanceAfter: 753215.97 },
    { date: "2026-08-10", principal: 10990.11, interest: 6067, balanceAfter: 742225.86 },
    { date: "2027-03-22", principal: 14883, interest: 2174.11, balanceAfter: 318933.89 },
    { date: "2027-07-12", principal: 16512.01, interest: 545.1, balanceAfter: 67184 },
  ]);
});
