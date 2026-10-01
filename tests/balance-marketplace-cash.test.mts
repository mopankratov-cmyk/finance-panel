import assert from "node:assert/strict";
import test from "node:test";

import { isLateDirectWbSnapshot, marketplaceCashAmount } from "../lib/finance/balanceMarketplaceCash";

test("прямой баланс WB складывает текущий и доступный остаток", () => {
  assert.equal(marketplaceCashAmount({
    marketplace: "wb",
    amount: 429_069.11,
    availableAmount: 149_528.1,
    calculationMethod: "provider_balance",
  }), 578_597.21);
});

test("расчёт общего WB seller не прибавляет доступную часть второй раз", () => {
  assert.equal(marketplaceCashAmount({
    marketplace: "wb",
    amount: 603_536.11,
    availableAmount: 408_565.64,
    calculationMethod: "brand_report_allocation",
  }), 603_536.11);
});

test("Ozon не меняет opening balance", () => {
  assert.equal(marketplaceCashAmount({
    marketplace: "ozon",
    amount: -13_430.83,
    availableAmount: null,
    calculationMethod: "provider_balance",
  }), -13_430.83);
});

test("поздний прямой WB-снимок помечается предварительным", () => {
  assert.equal(isLateDirectWbSnapshot({
    marketplace: "wb",
    calculationMethod: "provider_balance",
    snapshotMonth: "2026-10-01",
    capturedAt: "2026-09-30T21:01:47.000Z",
  }), false);
  assert.equal(isLateDirectWbSnapshot({
    marketplace: "wb",
    calculationMethod: "provider_balance",
    snapshotMonth: "2026-10-01",
    capturedAt: "2026-10-01T13:43:32.000Z",
  }), true);
  assert.equal(isLateDirectWbSnapshot({
    marketplace: "ozon",
    calculationMethod: "provider_balance",
    snapshotMonth: "2026-10-01",
    capturedAt: "2026-10-01T13:43:32.000Z",
  }), false);
});
