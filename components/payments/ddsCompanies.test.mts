import assert from "node:assert/strict";
import test from "node:test";
import { companyLabel } from "./ddsCompanies.ts";

test("старая общая группа показывается как основная", () => {
  assert.equal(companyLabel("Общая группа РИО"), "Основная группа");
  assert.equal(companyLabel("ИП Митриченко"), "ИП Митриченко");
});
