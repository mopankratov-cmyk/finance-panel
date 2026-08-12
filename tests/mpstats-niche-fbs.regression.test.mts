import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../lib/mpstats/client.ts", import.meta.url), "utf8");

// MPSTATS по умолчанию отдаёт ряды ниши только по FBW. Наши продажи считаются из
// wb_orders, где обе схемы вместе, поэтому без флага доля в нише делила полный
// числитель на урезанный знаменатель и завышалась втрое.
test("ряды ниши по дням запрашиваются вместе с FBS", () => {
  const byDateCalls = client
    .split("\n")
    .filter((line) => line.includes("by_date") && line.includes("post<"));
  assert.equal(byDateCalls.length, 2, "ожидались вызовы category/by_date и subject/by_date");
  for (const call of byDateCalls) {
    assert.match(call, /WITH_FBS/, `вызов без флага FBS: ${call.trim()}`);
  }
});

test("флаг FBS задан одной константой, а не строкой вразнобой", () => {
  assert.match(client, /const WITH_FBS = "fbs=1";/);
});
