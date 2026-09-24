import assert from "node:assert/strict";
import test from "node:test";
import { isMissingPaidStorageTask } from "./paidStorageRequest.ts";

test("удалённая задача платного хранения распознаётся по ответу WB 404", () => {
  assert.equal(isMissingPaidStorageTask(404, '{"detail":"not found"}'), true);
  assert.equal(isMissingPaidStorageTask(404, "Task Not-Found"), true);
});

test("другие ошибки WB не сбрасывают taskId как протухший", () => {
  assert.equal(isMissingPaidStorageTask(429, "too many requests"), false);
  assert.equal(isMissingPaidStorageTask(500, "not found"), false);
  assert.equal(isMissingPaidStorageTask(404, "forbidden"), false);
});
