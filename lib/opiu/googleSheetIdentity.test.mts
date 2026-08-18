import assert from "node:assert/strict";
import test from "node:test";
import { resolveLoanBlock, resolveRegisterRow } from "./googleSheetIdentity.ts";

test("stable payment id keeps identity when every visible field changes", () => {
  const row = resolveRegisterRow("payment-1", "new|changed|values", new Map([["payment-1", 14]]), new Map());
  assert.equal(row, 14);
});

test("ambiguous legacy payment is never overwritten", () => {
  const row = resolveRegisterRow("", "same-legacy-key", new Map(), new Map([["same-legacy-key", [10, 11]]]));
  assert.equal(row, null);
});

test("RIO loan is not confused with another company loan from the same bank", () => {
  const values: unknown[][] = Array.from({ length: 30 }, () => []);
  values[8] = ["", "Сбербанк"];
  values[9] = ["18.08.2026"];
  values[10] = ["ИП Панкратов"];
  values[11] = [""];
  const row = resolveLoanBlock(values, 52, {
    loanId: "",
    company: "ООО РИО",
    creditor: "Сбербанк",
    contract: "",
    firstScheduleDate: "18.08.2026",
  });
  assert.equal(row, -1);
});

test("stable loan id finds the same block after company, dates and amounts change", () => {
  const values: unknown[][] = Array.from({ length: 20 }, () => []);
  values[8] = ["", "Старое имя"];
  values[8][52] = "loan-rio-1";
  const row = resolveLoanBlock(values, 52, {
    loanId: "loan-rio-1",
    company: "ООО РИО",
    creditor: "Новый кредитор",
    contract: "новый договор",
    firstScheduleDate: "20.09.2026",
  });
  assert.equal(row, 8);
});

test("ambiguous legacy loans are never treated as the same loan", () => {
  const values: unknown[][] = Array.from({ length: 30 }, () => []);
  for (const row of [5, 15]) {
    values[row] = ["", "Банк"];
    values[row + 1] = ["18.08.2026"];
    values[row + 2] = ["ООО РИО"];
    values[row + 3] = [""];
  }
  const row = resolveLoanBlock(values, 52, {
    loanId: "",
    company: "ООО РИО",
    creditor: "Банк",
    contract: "",
    firstScheduleDate: "18.08.2026",
  });
  assert.equal(row, -1);
});
