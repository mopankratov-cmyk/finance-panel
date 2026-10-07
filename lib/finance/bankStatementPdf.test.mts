import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStatement, CONTROL_SUM_MISMATCH } from "./bankStatementPdf.ts";

// Отбор лучшей из моделей «Пользы» (recognizeBankStatementPdf) считает именно это
// предупреждение точным сравнением строк. Раньше там стояла regex /контрольн.*сумм/i,
// которая не матчила реальный текст, и отбор по сверке был мёртв. Тест держит текст
// предупреждения и признак отбора вместе — если один поменяют без другого, он упадёт.

test("несведение контрольных итогов даёт предупреждение, по которому идёт отбор моделей", () => {
  const mismatched = normalizeStatement(
    { bank: "Тест", declaredDebit: 100, declaredCredit: 0, rows: [{ date: "2026-01-01", amount: -50 }] },
    "hash-mismatch",
  );
  assert.ok(
    mismatched.warnings.includes(CONTROL_SUM_MISMATCH),
    "при несведении сумм должно быть ровно то предупреждение, по которому отбираются модели",
  );
});

test("сошедшиеся итоги не дают предупреждения о контрольной сумме", () => {
  const reconciled = normalizeStatement(
    { bank: "Тест", declaredDebit: 50, declaredCredit: 0, rows: [{ date: "2026-01-01", amount: -50 }] },
    "hash-ok",
  );
  assert.ok(
    !reconciled.warnings.includes(CONTROL_SUM_MISMATCH),
    "при сошедшихся итогах предупреждения о контрольной сумме быть не должно",
  );
});
