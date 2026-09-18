import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PaymentsPage.tsx", import.meta.url), "utf8");
const companiesModal = source.slice(source.indexOf("function CompaniesModal"));

test("настройки компаний не требуют горизонтальной прокрутки", () => {
  assert.match(companiesModal, /grid gap-3 xl:grid-cols-2/);
  assert.match(companiesModal, /return <article className="rounded-xl border/);
  assert.doesNotMatch(companiesModal, /min-w-\[1080px\]/);
});

test("НДС идёт до ставок и доступен в каждой карточке", () => {
  const row = companiesModal.slice(companiesModal.indexOf("function CompanySettingsRow"));
  const vatLabel = row.indexOf(">НДС");
  const ratesLabel = row.indexOf(">Основная, %");

  assert.ok(vatLabel >= 0, "в карточке должна быть видимая подпись НДС");
  assert.ok(ratesLabel >= 0, "в карточке должны остаться налоговые ставки");
  assert.ok(vatLabel < ratesLabel, "НДС должен быть доступен до расширенного блока ставок");
  assert.match(row, /grid-cols-1 gap-2 sm:grid-cols-2/);
});
