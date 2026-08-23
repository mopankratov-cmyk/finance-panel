import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { claimDocKey } from "../lib/warehouse/idempotency.ts";

type Rpc = { fn: string; args: Record<string, unknown> };
const fakeDb = (reply: { data?: unknown; error?: unknown }, calls: Rpc[] = []) => ({
  rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return reply; },
}) as never;

test("первый запрос занимает ключ", async () => {
  const claim = await claimDocKey(fakeDb({ data: { claimed: true, result: null } }), "k1", "shipment", "e1", "a@b");
  assert.deepEqual(claim, { state: "claimed" });
});

test("повтор уже проведённого отдаёт тот же ответ, а не новую проводку", async () => {
  const claim = await claimDocKey(fakeDb({ data: { claimed: false, result: { qty: 10 } } }), "k1", "shipment", "e1", null);
  assert.deepEqual(claim, { state: "done", result: { qty: 10 } });
});

test("второй клик, пока первый ещё проводится, получает «занято»", async () => {
  const claim = await claimDocKey(fakeDb({ data: { claimed: false, result: null } }), "k1", "shipment", "e1", null);
  assert.deepEqual(claim, { state: "busy" });
});

test("без ключа защита просто выключена — старые клиенты работают как раньше", async () => {
  const calls: Rpc[] = [];
  const claim = await claimDocKey(fakeDb({ data: null }, calls), null, "shipment", "e1", null);
  assert.deepEqual(claim, { state: "off" });
  assert.equal(calls.length, 0, "без ключа в базу ходить незачем");
});

test("непринятая миграция не ломает проведение", async () => {
  const claim = await claimDocKey(fakeDb({ error: { code: "42883" } }), "k1", "shipment", "e1", null);
  assert.deepEqual(claim, { state: "off" });
});

test("все четыре проводки занимают, закрывают и освобождают ключ", () => {
  for (const route of ["shipments", "writeoffs", "transfers", "returns"]) {
    const src = readFileSync(new URL(`../app/api/warehouse/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(src, /claimDocKey\(/, `${route}: не занимает ключ`);
    assert.match(src, /settleDocKey\(/, `${route}: не закрывает ключ ответом`);
    assert.match(src, /releaseDocKey\(/, `${route}: не освобождает ключ при ошибке`);
  }
});
