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

  // Состав удержаний тоже переживает сериализацию состояния синка между страницами:
  // логистика пришла на первой, хранение — на второй.
  assert.deepEqual(result.byNm.get(101), {
    pct: 16.7,
    acqPct: 1.3,
    extraPct: 5,
    rev: 1_500,
    parts: { delivery: 3.3, storage: 1.7, penalty: 0, acceptance: 0, deduction: 0 },
  });
  assert.equal(result.byNm.has(999), false);
  assert.equal(result.avgPct, 16.7);
  assert.equal(result.avgAcqPct, 1.3);
  assert.equal(result.avgExtraPct, 5);
});

test("состав удержаний копится по статьям и сходится с общей суммой", () => {
  const scope = { brandFilters: ["norvia"], allowedNmIds: [101] };
  const rows: ReportRow[] = [{
    nm_id: 101,
    brand_name: "Norvia",
    supplier_oper_name: "Продажа",
    retail_price_withdisc_rub: 1_000,
    commission_percent: 20,
    acquiring_fee: 20,
    delivery_rub: 50,
    storage_fee: 30,
    penalty: 10,
    acceptance: 5,
    deduction: 15,
  }];
  const commission = commissionFromAccumulator(
    accumulateCommissionRows(emptyCommissionAccumulator(), rows, scope),
  );
  const rates = commission.byNm.get(101)!;
  assert.ok(rates.parts);
  assert.equal(rates.parts!.delivery, 5);      // 50 / 1000
  assert.equal(rates.parts!.storage, 3);       // 30 / 1000
  assert.equal(rates.parts!.penalty, 1);       // 10 / 1000
  assert.equal(rates.parts!.acceptance, 0.5);  // 5 / 1000
  assert.equal(rates.parts!.deduction, 1.5);   // 15 / 1000
  // Состав не может разъехаться с суммой: extraPct собран из тех же слагаемых.
  const partsSum = Object.values(rates.parts!).reduce((sum, value) => sum + value, 0);
  assert.equal(Math.round(partsSum * 10) / 10, rates.extraPct);
});

test("рекламное удержание не попадает ни в сумму, ни в состав", () => {
  const scope = { brandFilters: ["norvia"], allowedNmIds: [101] };
  const rows: ReportRow[] = [{
    nm_id: 101,
    brand_name: "Norvia",
    supplier_oper_name: "Продажа",
    retail_price_withdisc_rub: 1_000,
    commission_percent: 20,
    acquiring_fee: 20,
    bonus_type_name: "Оплата за продвижение",
    deduction: 400,
  }];
  const commission = commissionFromAccumulator(
    accumulateCommissionRows(emptyCommissionAccumulator(), rows, scope),
  );
  const rates = commission.byNm.get(101)!;
  assert.equal(rates.extraPct, 0);
  assert.equal(rates.parts!.deduction, 0);
});
