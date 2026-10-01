import test from "node:test";
import assert from "node:assert/strict";
import { uniqueCounterpartyOptions } from "./counterpartyOptions.ts";

test("один ИНН оставляет один вариант названия контрагента", () => {
  const result = uniqueCounterpartyOptions([
    "Интернет Решения, ООО ИНН:7704217370",
    "Интернет Решения, ОООИНН:7704217370",
    "ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"ИНТЕРНЕТ РЕШЕНИЯ\" ИНН:7704217370",
  ]);
  assert.deepEqual(result, ["Интернет Решения, ООО ИНН:7704217370"]);
});

test("текущее банковское написание сохраняется без скрытой перезаписи", () => {
  const result = uniqueCounterpartyOptions(
    ["ИП Филиппов Артем Сергеевич ИНН:330573647518", "Другой контрагент"],
    "Индивидуальный предприниматель Филиппов Артем Сергеевич ИНН:330573647518",
  );
  assert.equal(result.includes("Индивидуальный предприниматель Филиппов Артем Сергеевич ИНН:330573647518"), true);
  assert.equal(result.includes("ИП Филиппов Артем Сергеевич ИНН:330573647518"), false);
  assert.equal(result.includes("Другой контрагент"), true);
});

test("разные ИНН никогда не объединяются по похожему названию", () => {
  assert.equal(uniqueCounterpartyOptions([
    "ООО Ромашка ИНН:7701000001",
    "ООО Ромашка ИНН:7701000002",
  ]).length, 2);
});
