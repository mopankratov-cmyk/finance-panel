import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describeOzonPostingStatus, isOzonPostingDelayed } from "../lib/ozon/postingStatus.ts";

test("ожидающие отгрузки не считаются доставленными", () => {
  for (const status of ["awaiting_deliver", "awaiting_packaging", "awaiting_approve"]) {
    const state = describeOzonPostingStatus(status);
    assert.equal(state.delivered, false, `${status} не доставлен`);
    assert.equal(state.cancelled, false);
    assert.equal(state.stage, "shipping");
  }
  assert.equal(describeOzonPostingStatus("awaiting_deliver").awaitingShipment, true);
});

test("в пути — это не доставлено", () => {
  const state = describeOzonPostingStatus("delivering");
  assert.equal(state.delivered, false);
  assert.equal(state.stage, "transit");
  assert.equal(state.label, "В пути");
});

test("доставлено и отменено распознаются точно", () => {
  assert.equal(describeOzonPostingStatus("delivered").delivered, true);
  assert.equal(describeOzonPostingStatus("cancelled").cancelled, true);
  assert.equal(describeOzonPostingStatus("not_accepted").cancelled, true);
  assert.equal(describeOzonPostingStatus("DELIVERED").delivered, true);
});

test("незнакомый статус остаётся активным и показывается как есть", () => {
  const state = describeOzonPostingStatus("some_new_ozon_status");
  assert.equal(state.delivered, false);
  assert.equal(state.cancelled, false);
  assert.equal(state.stage, "unknown");
  assert.equal(state.label, "some_new_ozon_status");
});

test("просрочка считается только для того, что ещё зависит от продавца", () => {
  const past = "2020-01-01T00:00:00.000Z";
  assert.equal(isOzonPostingDelayed(describeOzonPostingStatus("awaiting_deliver"), past), true);
  assert.equal(isOzonPostingDelayed(describeOzonPostingStatus("delivering"), past), false);
  assert.equal(isOzonPostingDelayed(describeOzonPostingStatus("delivered"), past), false);
  assert.equal(isOzonPostingDelayed(describeOzonPostingStatus("cancelled"), past), false);
  assert.equal(isOzonPostingDelayed(describeOzonPostingStatus("awaiting_deliver"), null), false);
  assert.equal(
    isOzonPostingDelayed(describeOzonPostingStatus("awaiting_deliver"), "2099-01-01T00:00:00.000Z"),
    false,
  );
});
