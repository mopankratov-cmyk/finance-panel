import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isEmailStatementImportRequest } from "../lib/opiu/emailStatementImportAuth";
import { isPublicApi } from "../proxy";

const originalSecret = process.env.DDS_EMAIL_IMPORT_SECRET;

test.afterEach(() => {
  if (originalSecret === undefined) delete process.env.DDS_EMAIL_IMPORT_SECRET;
  else process.env.DDS_EMAIL_IMPORT_SECRET = originalSecret;
});

test("почтовый импорт принимает только точный отдельный Bearer-секрет", () => {
  process.env.DDS_EMAIL_IMPORT_SECRET = "a".repeat(40);
  assert.equal(isEmailStatementImportRequest(new Request("https://panel.test", {
    headers: { authorization: `Bearer ${"a".repeat(40)}` },
  })), true);
  assert.equal(isEmailStatementImportRequest(new Request("https://panel.test", {
    headers: { authorization: `Bearer ${"a".repeat(39)}b` },
  })), false);
  assert.equal(isEmailStatementImportRequest(new Request("https://panel.test")), false);
});

test("короткий или отсутствующий секрет не открывает машинный импорт", () => {
  process.env.DDS_EMAIL_IMPORT_SECRET = "short";
  assert.equal(isEmailStatementImportRequest(new Request("https://panel.test", {
    headers: { authorization: "Bearer short" },
  })), false);
  delete process.env.DDS_EMAIL_IMPORT_SECRET;
  assert.equal(isEmailStatementImportRequest(new Request("https://panel.test")), false);
});

test("прокси пропускает без cookie только два POST этапа почтового импорта", () => {
  assert.equal(isPublicApi("/api/opiu/bank-statement", "POST"), true);
  assert.equal(isPublicApi("/api/opiu/bank-review", "POST"), true);
  assert.equal(isPublicApi("/api/opiu/bank-review", "DELETE"), false);
  assert.equal(isPublicApi("/api/opiu/bank-review", "PATCH"), false);
});

test("машинный ключ банковской очереди ограничен действием batch", () => {
  const route = readFileSync(new URL("../app/api/opiu/bank-review/route.ts", import.meta.url), "utf8");
  assert.match(route, /emailImport\s*&&\s*body\.action\s*!==\s*["']batch["']/);
  assert.match(route, /Почтовому импорту разрешено только добавление выписки в очередь/);
});
