import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../../app/api/finance/taxes/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../components/taxes/TaxesPage.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/202609280002_tax_vat_payment_kind.sql", import.meta.url), "utf8");

test("tax register supports an explicit VAT payment kind", () => {
  assert.match(route, /"vat_tax_payment"/);
  assert.match(migration, /'vat_tax_payment'/);
  assert.match(page, /value: "vat_tax_payment", label: "Уплата НДС"/);
});

test("live VAT balance subtracts only saved VAT payments", () => {
  assert.match(page, /payment\.saved && payment\.taxPaymentKind === "vat_tax_payment"/);
  assert.match(page, /Math\.max\(0, calculation\.vatPayable - vatPaid\)/);
  assert.match(page, /Осталось уплатить НДС/);
});

test("supplier payments mentioning VAT are not automatically classified as VAT tax payments", () => {
  assert.match(route, /const vatTaxPattern =/);
  assert.doesNotMatch("Оплата услуг, в т.ч. НДС 22%", /(?:уплата|перечисление|налоговый\s+плат[её]ж)\s+(?:налога\s+)?(?:на\s+добавленную\s+стоимость|ндс)|(?:^|[^а-яё])ндс\s+(?:за|налог)/i);
});
