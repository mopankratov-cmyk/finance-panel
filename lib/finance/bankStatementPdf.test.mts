import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStatement, recognizeSberStatementText } from "./bankStatementPdf.ts";
import { extractPdfText } from "../loans/pdfText.ts";

const raw = {
  bank: "ВБ Банк", owner: "ИП Филиппов", ownerInn: "330573647518",
  accountNumber: "40802810900000016002", openingBalance: 0, closingBalance: 100,
  declaredDebit: 50, declaredCredit: 150,
  rows: [
    { date: "22.09.2026", amount: -50, counterparty: "А", documentNumber: "1" },
    { date: "23.09.2026", amount: 150, counterparty: "Б", documentNumber: "2" },
  ],
};

test("PDF сохраняет корректные направления по контрольным итогам", () => {
  const result = normalizeStatement(raw, "hash");
  assert.deepEqual(result.rows.map((row) => row.amount), [-50, 150]);
  assert.equal(result.warnings.length, 0);
});

test("PDF исправляет глобально перепутанные дебет и кредит", () => {
  const result = normalizeStatement({ ...raw, rows: raw.rows.map((row) => ({ ...row, amount: -row.amount })) }, "hash");
  assert.deepEqual(result.rows.map((row) => row.amount), [-50, 150]);
  assert.ok(result.warnings.some((warning) => /направления операций исправлены/i.test(warning)));
});

test("PDF показывает контрольное расхождение, а не скрывает его", () => {
  const result = normalizeStatement({ ...raw, rows: [{ date: "22.09.2026", amount: -40, documentNumber: "1" }] }, "hash");
  assert.equal(result.declaredDebit, 40);
  assert.ok(result.warnings.some((warning) => /не совпали с контрольными итогами/i.test(warning)));
});

test("Сбер: текстовая выписка по дебетовой карте разбирается локально без ИИ",()=>{
  const text=`СберБанк Онлайн Выписка по платёжному счёту За период 01.09.2026 — 30.09.2026 Владелец счёта Панкратов Максим Олегович Номер счёта 40817 810 3 3811 2465142 Карты, привязанные к счёту МИР Сберкарта ИТОГО ПО ОПЕРАЦИЯМ ЗА ПЕРИОД: Остаток на 01.09.2026 0,00 Пополнение 360 000,00 Списание 360 000,00 Остаток на 30.09.2026 0,00 Расшифровка операций ДАТА ОПЕРАЦИИ (МСК) 23.09.2026 14:41 Перевод с карты 360 000,00 0,00 23.09.2026 896307 Перевод для П. Максим Олегович. Операция по счету ****5142 23.09.2026 14:39 Перевод СБП +360 000,00 360 000,00 23.09.2026 647305 Перевод из T-B)5k. Операция по карте ****7368 Дата формирования документа 02.10.2026`;
  const statement=recognizeSberStatementText(text,"hash");
  assert.ok(statement);
  assert.equal(statement.owner,"Панкратов Максим Олегович");
  assert.equal(statement.accountNumber,"40817810338112465142");
  assert.deepEqual(statement.rows.map(row=>row.amount),[-360000,360000]);
  assert.match(statement.rows[1].purpose,/T-Bank/);
  assert.deepEqual(statement.warnings,[]);
});

test("PDF literal strings use the embedded ToUnicode table",()=>{
  const pseudoPdf=Buffer.from("<< >> stream\nbegincmap\n1 beginbfrange\n<0149><0149><0410>\nendbfrange\nendcmap\nendstream\n<< >> stream\n(\\001I)Tj\nendstream","latin1");
  assert.equal(extractPdfText(pseudoPdf),"А");
});
