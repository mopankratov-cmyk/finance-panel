import assert from "node:assert/strict";
import test from "node:test";

import {
  accumulateCommissionRows,
  commissionFromAccumulator,
  emptyCommissionAccumulator,
  type ReportRow,
} from "../lib/wb/commissions";

test("commission pages can be accumulated and restored without changing the totals", () => {
  const scope = { brandFilters: ["norvia"], allowedNmIds: [101] };
  const first: ReportRow[] = [{
    nm_id: 101,
    brand_name: "Norvia",
    supplier_oper_name: "Продажа",
    retail_price_withdisc_rub: 1_000,
    commission_percent: 20,
    acquiring_fee: 15,
    delivery_rub: 50,
  }];
  const second: ReportRow[] = [{
    nm_id: 101,
    brand_name: "Norvia",
    supplier_oper_name: "Продажа",
    retail_price_withdisc_rub: 500,
    commission_percent: 10,
    acquiring_fee: 5,
    storage_fee: 25,
  }, {
    nm_id: 999,
    brand_name: "Another brand",
    supplier_oper_name: "Продажа",
    retail_price_withdisc_rub: 100_000,
    commission_percent: 99,
  }];

  const saved = JSON.parse(JSON.stringify(accumulateCommissionRows(emptyCommissionAccumulator(), first, scope)));
  const result = commissionFromAccumulator(accumulateCommissionRows(saved, second, scope));

  assert.deepEqual(result.byNm.get(101), {
    pct: 16.7,
    acqPct: 1.3,
    extraPct: 5,
    rev: 1_500,
  });
  assert.equal(result.byNm.has(999), false);
  assert.equal(result.avgPct, 16.7);
  assert.equal(result.avgAcqPct, 1.3);
  assert.equal(result.avgExtraPct, 5);
});
