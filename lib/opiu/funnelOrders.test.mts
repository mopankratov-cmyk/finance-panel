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

test("funnel overlay aggregates duplicate target-cabinet facts for canonical SKU/day", () => {
  const result = overlayFunnelOrders(
    [order("2026-07-06T10:00:00+03:00", 101, 999)],
    [
      funnel("2026-07-06T00:00:00Z", 101, 2, 300, "cabinet-a"),
      funnel("2026-07-06", 101, 3, 450, "cabinet-a"),
    ],
    targetCabinetId,
  );

  assert.deepEqual(result, [{
    date: "2026-07-06",
    nmId: 101,
    ordersCount: 5,
    totalPriceDiscount: 750,
  }]);
});

test("funnel overlay ignores foreign cabinet facts for the same SKU/day", () => {
  const result = overlayFunnelOrders(
    [order("2026-07-06T10:00:00Z", 101, 999)],
    [
      funnel("2026-07-06", 101, 2, 300, "cabinet-a"),
      funnel("2026-07-06", 101, 50, 7_500, "cabinet-b"),
    ],
    targetCabinetId,
  );

  assert.deepEqual(result, [{
    date: "2026-07-06",
    nmId: 101,
    ordersCount: 2,
    totalPriceDiscount: 300,
  }]);
});

test("invalid funnel facts do not erase wb_orders fallback", () => {
  const invalidPairs: Array<[unknown, unknown]> = [
    [null, 100],
    ["", 100],
    [true, 100],
    [1.5, 100],
    [-1, 100],
    [Number.NaN, 100],
    [1, null],
    [1, " "],
    [1, false],
    [1, -1],
    [1, Number.NaN],
    [1, Number.POSITIVE_INFINITY],
  ];

  for (const [orders, ordersSum] of invalidPairs) {
    const fallback = [order("2026-07-06", 101, 321)];
    assert.deepEqual(
      overlayFunnelOrders(
        fallback,
        [funnel("2026-07-06", 101, orders, ordersSum)],
        targetCabinetId,
      ),
      fallback,
      `orders=${String(orders)}, ordersSum=${String(ordersSum)}`,
    );
  }
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

test("loadMonth wires exact cabinet filters before date filters for both order tables", async () => {
  const source = await readFile(new URL("./loadMonth.ts", import.meta.url), "utf8");

  assert.match(source, /\.from\("wb_orders"\)[\s\S]*?\.select\([^;]*?\.eq\("cabinet_id", OPIU_WB_CABINET_ID\)[\s\S]*?\.gte\("date", dateFrom\)/);
  assert.match(source, /\.from\("wb_funnel_daily"\)[\s\S]*?\.select\("[^"]*cabinet_id[^"]*nm_id[^"]*date[^"]*orders[^"]*orders_sum[^"]*"\)[\s\S]*?\.eq\("cabinet_id", OPIU_WB_CABINET_ID\)[\s\S]*?\.gte\("date", dateFrom\)[\s\S]*?\.lte\("date", dateTo\)/);
  assert.match(source, /\.order\("date", \{ ascending: true \}\)[\s\S]*\.order\("nm_id", \{ ascending: true \}\)[\s\S]*\.order\("cabinet_id", \{ ascending: true \}\)[\s\S]*\.range\(from, to\)/);
  assert.match(source, /overlayFunnelOrders\(cachedOrders, funnelFacts, OPIU_WB_CABINET_ID\)/);
  assert.doesNotMatch(source, /fetch\(|api\.wildberries|statistics-api|allowLiveFallback:\s*true/);
});
