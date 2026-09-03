import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicRoute = readFileSync(new URL("../../app/api/finance/payroll/route.ts", import.meta.url), "utf8");
const privateRoute = readFileSync(new URL("../../app/api/payroll/private/route.ts", import.meta.url), "utf8");

test("общий зарплатный API не читает и не пишет закрытые реквизиты", () => {
  assert.doesNotMatch(publicRoute, /settlement_account_details|card_transfer_details|payment_details/);
  assert.doesNotMatch(publicRoute, /from\("payments"\)\.(?:insert|upsert|update|delete)/);
});

test("закрытые реквизиты доступны только директорскому API", () => {
  assert.match(privateRoute, /requireApiSession\(\["director"\]\)/);
  assert.match(privateRoute, /payroll_employee_private/);
});
