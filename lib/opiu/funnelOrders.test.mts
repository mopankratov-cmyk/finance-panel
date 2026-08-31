import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregateWeek,
  overlayFunnelOrders,
  type FunnelOrderFact,
  type OpiuOrder,
} from "./metrics";

const week = {
  weekStart: "2026-07-06",
  rangeFrom: "2026-07-06",
  rangeTo: "2026-07-12",
  label: "6–12 июл.",
};
const emptyCosts = {
  byArticle: new Map<string, number>(),
  byBarcode: new Map<string, number>(),
  packagingByArticle: new Map<string, number>(),
  packagingByBarcode: new Map<string, number>(),
  costByGiBarcode: new Map<string, number>(),
  packagingByGiBarcode: new Map<string, number>(),
};
const targetCabinetId = "cabinet-a";

function order(
  date: string,
  nmId: number,
  priceWithDisc: number,
): OpiuOrder {
  return { date, nmId, priceWithDisc };
}

function funnel(
  date: string,
  nmId: number,
  orders: unknown,
  ordersSum: unknown,
  cabinetId = "cabinet-a",
): FunnelOrderFact {
  return {
    cabinetId,
    date,
    nmId,
    orders,
    ordersSum,
  };
}

test("funnel overlay replaces covered SKU/day and preserves uncovered wb_orders", () => {
  const result = overlayFunnelOrders(
    [
      order("2026-07-06T10:00:00Z", 101, 100),
      order("2026-07-06T11:00:00Z", 101, 200),
      order("2026-07-06T12:00:00Z", 202, 300),
      order("2026-07-07T10:00:00Z", 101, 400),
    ],
    [funnel("2026-07-06", 101, 7, 1_050)],
    targetCabinetId,
  );

  assert.deepEqual(result, [
    order("2026-07-06T12:00:00Z", 202, 300),
    order("2026-07-07T10:00:00Z", 101, 400),
    {
      date: "2026-07-06",
      nmId: 101,
      ordersCount: 7,
      totalPriceDiscount: 1_050,
    },
  ]);
});

test("duplicate canonical SKU/day rejects the whole overlay batch", () => {
  const fallback = [order("2026-07-06T10:00:00+03:00", 101, 999)];
  const result = overlayFunnelOrders(
    fallback,
    [
      funnel("2026-07-06T00:00:00Z", 101, 2, 300, "cabinet-a"),
      funnel("2026-07-06", 101, 3, 450, "cabinet-a"),
    ],
    targetCabinetId,
  );

  assert.deepEqual(result, fallback);
});

test("one foreign cabinet fact rejects the whole overlay batch", () => {
  const fallback = [
    order("2026-07-06T10:00:00Z", 101, 999),
    order("2026-07-07T10:00:00Z", 202, 888),
  ];
  const result = overlayFunnelOrders(
    fallback,
    [
      funnel("2026-07-06", 101, 2, 300, "cabinet-a"),
      funnel("2026-07-07", 202, 50, 7_500, "cabinet-b"),
    ],
    targetCabinetId,
  );

  assert.deepEqual(result, fallback);
});

test("one malformed fact rejects the whole overlay batch without partial keys", () => {
  const invalidFacts: FunnelOrderFact[] = [
    funnel("not-a-date", 202, 1, 100),
    funnel("2026-02-30", 202, 1, 100),
    funnel("2026-07-07", 0, 1, 100),
    funnel("2026-07-07", 1.5, 1, 100),
    funnel("2026-07-07", Number.NaN, 1, 100),
    funnel("2026-07-07", Number.MAX_SAFE_INTEGER + 1, 1, 100),
    funnel("2026-07-07", 202, null, 100),
    funnel("2026-07-07", 202, 1.5, 100),
    funnel("2026-07-07", 202, Number.MAX_SAFE_INTEGER + 1, 100),
    funnel("2026-07-07", 202, 1, null),
    funnel("2026-07-07", 202, 1, -1),
    funnel("2026-07-07", 202, 1, Number.POSITIVE_INFINITY),
    funnel("2026-07-07", 202, 1, Number.MAX_SAFE_INTEGER + 1),
  ];

  for (const invalidFact of invalidFacts) {
    const fallback = [
      order("2026-07-06", 101, 321),
      order("2026-07-07", 202, 654),
    ];
    assert.deepEqual(
      overlayFunnelOrders(
        fallback,
        [funnel("2026-07-06", 101, 2, 300), invalidFact],
        targetCabinetId,
      ),
      fallback,
      JSON.stringify(invalidFact),
    );
  }
});

test("distinct funnel facts reject cumulative count or ruble overflow", () => {
  const fallback = [order("2026-07-06", 999, 321)];
  const cases: FunnelOrderFact[][] = [
    [
      funnel("2026-07-06", 101, Number.MAX_SAFE_INTEGER, 0),
      funnel("2026-07-07", 202, 1, 0),
    ],
    [
      funnel("2026-07-06", 101, 0, Number.MAX_SAFE_INTEGER),
      funnel("2026-07-07", 202, 0, 0.5),
    ],
  ];

  for (const facts of cases) {
    assert.deepEqual(
      overlayFunnelOrders(fallback, facts, targetCabinetId),
      fallback,
    );
  }
});

test("funnel plus uncovered fallback rejects cumulative overflow", () => {
  const fallback = [
    order("2026-07-06", 101, 1),
    order("2026-07-07", 202, Number.MAX_SAFE_INTEGER),
  ];

  assert.deepEqual(
    overlayFunnelOrders(
      fallback,
      [funnel("2026-07-06", 101, Number.MAX_SAFE_INTEGER, 1)],
      targetCabinetId,
    ),
    fallback,
  );
});

test("factual funnel zero replaces wb_orders instead of being treated as missing", () => {
  assert.deepEqual(
    overlayFunnelOrders(
      [order("2026-07-06", 101, 321)],
      [funnel("2026-07-06", 101, 0, 0)],
      targetCabinetId,
    ),
    [{
      date: "2026-07-06",
      nmId: 101,
      ordersCount: 0,
      totalPriceDiscount: 0,
    }],
  );
});

test("aggregateWeek sums explicit order counts and keeps order rubles as stored sums", () => {
  const metrics = aggregateWeek(
    week,
    [],
    [
      { date: "2026-07-06", nmId: 101, ordersCount: 4, totalPriceDiscount: 800 },
      { date: "2026-07-07", nmId: 202, priceWithDisc: 250 },
      { date: "2026-07-08", nmId: 303, ordersCount: 0, totalPriceDiscount: 0 },
      { date: "2026-07-09", nmId: 404, priceWithDisc: 999, isCancel: true },
    ],
    [],
    emptyCosts,
    0,
  );

  assert.equal(metrics.orders, 5);
  assert.equal(metrics.ordersRub, 1_050);
});

test("WB Analytics orderCount/orderSum stay gross and never subtract cancellations", () => {
  // Deployed RNP SQL uses the same placed-order denominator. wb_funnel_daily has
  // no cancel fields, so neither orderCount nor orderSum may be netted here.
  const overlaid = overlayFunnelOrders(
    [{ date: "2026-07-06", nmId: 101, priceWithDisc: 999, isCancel: true }],
    [funnel("2026-07-06", 101, 7, 1_050)],
    targetCabinetId,
  );
  const metrics = aggregateWeek(week, [], overlaid, [], emptyCosts, 0);

  assert.equal(metrics.orders, 7);
  assert.equal(metrics.ordersRub, 1_050);
});

test("canonical PostgREST numeric strings are accepted without loose coercion", () => {
  assert.deepEqual(
    overlayFunnelOrders(
      [order("2026-07-06", 101, 321)],
      [funnel("2026-07-06", 101, "2", "300.50")],
      targetCabinetId,
    ),
    [{
      date: "2026-07-06",
      nmId: 101,
      ordersCount: 2,
      totalPriceDiscount: 300.5,
    }],
  );

  for (const [orders, ordersSum] of [
    [" 2", "300"],
    ["02", "300"],
    ["2.0", "300"],
    ["2", ""],
    ["2", " 300"],
    ["2", "+300"],
    ["2", "3e2"],
  ] satisfies Array<[unknown, unknown]>) {
    const fallback = [order("2026-07-06", 101, 321)];
    assert.deepEqual(
      overlayFunnelOrders(
        fallback,
        [funnel("2026-07-06", 101, orders, ordersSum)],
        targetCabinetId,
      ),
      fallback,
    );
  }
});

test("loadMonth delegates readiness-gated funnel reads and keeps wb_orders cabinet pagination", async () => {
  const source = await readFile(new URL("./loadMonth.ts", import.meta.url), "utf8");

  assert.match(source, /\.from\("wb_orders"\)[\s\S]*?\.select\([^;]*?\.eq\("cabinet_id", brand\.cabinetId\)[\s\S]*?\.gte\("date", dateFrom\)/);
  assert.match(source, /loadReadyFunnelFacts\([\s\S]*?brand\.cabinetId,[\s\S]*?dateFrom,[\s\S]*?dateTo/);
  assert.match(source, /overlayFunnelOrders\(cachedOrders, funnelFacts, brand\.cabinetId\)/);
  assert.doesNotMatch(source, /fetch\(|api\.wildberries|statistics-api|allowLiveFallback:\s*true/);
});
