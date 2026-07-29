import assert from "node:assert/strict";
import test from "node:test";
import { loadUnitCommissionCache } from "../lib/unit/commissionCache";

function queryWith(results: Record<string, { data: unknown[] | null; error: Error | null }>) {
  return async (table: "wb_nm_commissions" | "wb_cabinet_commission_overhead") => results[table];
}

test("commission pagination includes a tail SKU and tail revenue in weighted fallback", async () => {
  const rows = Array.from({ length: 1_001 }, (_, index) => ({
    nm_id: index + 1,
    pct: index === 1_000 ? 30 : 10,
    acq_pct: index === 1_000 ? 3 : 1,
    extra_pct: 0,
    rev: index === 1_000 ? 1_000 : 1,
  }));
  const pages: Array<[number, number]> = [];
  const rates = await loadUnitCommissionCache(async (table, _columns, _cabinet, from, to) => {
    if (table === "wb_nm_commissions") {
      pages.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    }
    return { data: [{ overhead_pct: 0 }], error: null };
  }, "cab-a");

  assert.deepEqual(pages, [[0, 999], [1000, 1999]]);
  assert.deepEqual(rates.resolve(1_001), { factual: true, marketplacePct: 30, acquiringPct: 3 });
  assert.deepEqual(rates.resolve(9_999), { factual: true, marketplacePct: 20, acquiringPct: 2 });
});

test("unit commission loader is cache-only and exposes query errors", async () => {
  const errorQuery = queryWith({
    wb_nm_commissions: { data: null, error: new Error("rates query failed") },
    wb_cabinet_commission_overhead: { data: [], error: null },
  });
  await assert.rejects(loadUnitCommissionCache(errorQuery, "cab-a"), /rates query failed/);
});

test("empty commission cache returns unavailable rates, never zeros", async () => {
  const query = queryWith({
    wb_nm_commissions: { data: [], error: null },
    wb_cabinet_commission_overhead: { data: [], error: null },
  });
  const rates = await loadUnitCommissionCache(query, "cab-a");
  assert.deepEqual(rates.resolve(123), { factual: false, marketplacePct: null, acquiringPct: null });
});

test("commission cache stays cabinet-scoped and combines factual overhead", async () => {
  const query = queryWith({
    wb_nm_commissions: { data: [{ nm_id: 123, pct: 12, acq_pct: 1.5, extra_pct: 2, rev: 1_000 }], error: null },
    wb_cabinet_commission_overhead: { data: [{ overhead_pct: 3 }], error: null },
  });
  const rates = await loadUnitCommissionCache(query, "cab-a");
  assert.deepEqual(rates.resolve(123), { factual: true, marketplacePct: 17, acquiringPct: 1.5 });
});

test("commission loader queries revenue and rejects zero pct/acquiring without a valid fallback", async () => {
  let selectedColumns = "";
  const query = async (
    table: "wb_nm_commissions" | "wb_cabinet_commission_overhead",
    columns: string,
  ) => {
    if (table === "wb_nm_commissions") {
      selectedColumns = columns;
      return {
        data: [
          { nm_id: 1, pct: 0, acq_pct: 1, extra_pct: 0, rev: 100 },
          { nm_id: 2, pct: 10, acq_pct: 0, extra_pct: 0, rev: 100 },
        ],
        error: null,
      };
    }
    return { data: [{ overhead_pct: 0 }], error: null };
  };

  const rates = await loadUnitCommissionCache(query, "cab-a");
  assert.match(selectedColumns, /(?:^|, )rev(?:,|$)/);
  assert.deepEqual(rates.resolve(1), { factual: false, marketplacePct: null, acquiringPct: null });
  assert.deepEqual(rates.resolve(2), { factual: false, marketplacePct: null, acquiringPct: null });
});

test("rev <= 0 and non-finite or negative rates never become factual", async () => {
  const invalidRows = [
    { nm_id: 1, pct: 10, acq_pct: 1, extra_pct: 0, rev: 0 },
    { nm_id: 2, pct: 10, acq_pct: 1, extra_pct: 0, rev: -10 },
    { nm_id: 3, pct: Number.NaN, acq_pct: 1, extra_pct: 0, rev: 100 },
    { nm_id: 4, pct: 10, acq_pct: -1, extra_pct: 0, rev: 100 },
    { nm_id: 5, pct: 10, acq_pct: 1, extra_pct: Number.NaN, rev: 100 },
  ];

  for (const row of invalidRows) {
    const rates = await loadUnitCommissionCache(queryWith({
      wb_nm_commissions: { data: [row], error: null },
      wb_cabinet_commission_overhead: { data: [{ overhead_pct: 0 }], error: null },
    }), "cab-a");
    assert.deepEqual(rates.resolve(row.nm_id), {
      factual: false,
      marketplacePct: null,
      acquiringPct: null,
    });
  }
});

test("zero extra and overhead are valid factual values", async () => {
  const query = queryWith({
    wb_nm_commissions: {
      data: [{ nm_id: 123, pct: 12, acq_pct: 1.5, extra_pct: 0, rev: 500 }],
      error: null,
    },
    wb_cabinet_commission_overhead: { data: [{ overhead_pct: 0 }], error: null },
  });
  const rates = await loadUnitCommissionCache(query, "cab-a");
  assert.deepEqual(rates.resolve(123), { factual: true, marketplacePct: 12, acquiringPct: 1.5 });
});

test("strict commission primitives reject coercive and non-numeric values", async () => {
  const invalidValues = [
    null,
    undefined,
    "",
    " \t",
    true,
    false,
    Number.NaN,
    "not-a-number",
    "01",
    "1e2",
    {},
    [],
  ];
  const fields = ["pct", "acq_pct", "extra_pct", "rev"] as const;

  for (const field of fields) {
    for (const invalidValue of invalidValues) {
      const row = {
        nm_id: 123,
        pct: 12,
        acq_pct: 1.5,
        extra_pct: 2,
        rev: 500,
        [field]: invalidValue,
      };
      const rates = await loadUnitCommissionCache(queryWith({
        wb_nm_commissions: { data: [row], error: null },
        wb_cabinet_commission_overhead: { data: [{ overhead_pct: 0 }], error: null },
      }), "cab-a");

      assert.deepEqual(
        rates.resolve(123),
        { factual: false, marketplacePct: null, acquiringPct: null },
        `${field} must reject ${String(invalidValue)}`,
      );
    }
  }
});

test("strict overhead primitive rejects coercive and non-numeric values", async () => {
  const invalidValues = [
    null,
    undefined,
    "",
    " \t",
    true,
    false,
    Number.NaN,
    "not-a-number",
    "01",
    "1e2",
    {},
    [],
  ];

  for (const overheadPct of invalidValues) {
    const rates = await loadUnitCommissionCache(queryWith({
      wb_nm_commissions: {
        data: [{ nm_id: 123, pct: 12, acq_pct: 1.5, extra_pct: 2, rev: 500 }],
        error: null,
      },
      wb_cabinet_commission_overhead: { data: [{ overhead_pct: overheadPct }], error: null },
    }), "cab-a");

    assert.deepEqual(
      rates.resolve(123),
      { factual: false, marketplacePct: null, acquiringPct: null },
      `overhead_pct must reject ${String(overheadPct)}`,
    );
  }
});

test("canonical numeric strings remain valid commission primitives", async () => {
  const rates = await loadUnitCommissionCache(queryWith({
    wb_nm_commissions: {
      data: [{ nm_id: 123, pct: "12", acq_pct: "1.5", extra_pct: "2", rev: "500" }],
      error: null,
    },
    wb_cabinet_commission_overhead: { data: [{ overhead_pct: "3" }], error: null },
  }), "cab-a");

  assert.deepEqual(rates.resolve(123), { factual: true, marketplacePct: 17, acquiringPct: 1.5 });
});

test("invalid SKU extra uses only a valid cabinet fallback and never factual zero", async () => {
  const invalidExtraValues = [null, undefined, "", " \t", true, false, Number.NaN, "not-a-number", {}, []];

  for (const extraPct of invalidExtraValues) {
    const unavailableRates = await loadUnitCommissionCache(queryWith({
      wb_nm_commissions: {
        data: [{ nm_id: 1, pct: 12, acq_pct: 1.5, extra_pct: extraPct, rev: 100 }],
        error: null,
      },
      wb_cabinet_commission_overhead: { data: [{ overhead_pct: 0 }], error: null },
    }), "cab-a");
    assert.deepEqual(
      unavailableRates.resolve(1),
      { factual: false, marketplacePct: null, acquiringPct: null },
      `invalid extra_pct ${String(extraPct)} must not become zero`,
    );

    const fallbackRates = await loadUnitCommissionCache(queryWith({
      wb_nm_commissions: {
        data: [
          { nm_id: 1, pct: 12, acq_pct: 1.5, extra_pct: extraPct, rev: 100 },
          { nm_id: 2, pct: 20, acq_pct: 2, extra_pct: 4, rev: 300 },
        ],
        error: null,
      },
      wb_cabinet_commission_overhead: { data: [{ overhead_pct: 1 }], error: null },
    }), "cab-a");
    assert.deepEqual(
      fallbackRates.resolve(1),
      { factual: true, marketplacePct: 25, acquiringPct: 2 },
      `invalid extra_pct ${String(extraPct)} may use the valid cabinet fallback`,
    );
  }
});

test("missing SKU uses revenue-weighted cabinet averages from valid cache rows", async () => {
  const query = queryWith({
    wb_nm_commissions: {
      data: [
        { nm_id: 1, pct: 10, acq_pct: 1, extra_pct: 0, rev: 100 },
        { nm_id: 2, pct: 20, acq_pct: 2, extra_pct: 3, rev: 300 },
        { nm_id: 3, pct: 0, acq_pct: 0, extra_pct: 0, rev: 10_000 },
      ],
      error: null,
    },
    wb_cabinet_commission_overhead: { data: [{ overhead_pct: 2 }], error: null },
  });
  const rates = await loadUnitCommissionCache(query, "cab-a");

  assert.deepEqual(rates.resolve(999), {
    factual: true,
    marketplacePct: 21.75,
    acquiringPct: 1.75,
  });
  assert.deepEqual(rates.resolve(3), {
    factual: true,
    marketplacePct: 19.5,
    acquiringPct: 1.75,
  });
});
