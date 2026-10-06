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

test("JetLend PDF rows without row numbers preserve payment totals and ending balance", () => {
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
