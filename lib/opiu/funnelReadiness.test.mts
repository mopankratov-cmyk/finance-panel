import assert from "node:assert/strict";
import test from "node:test";
import {
  isFunnelSyncReady,
  type FunnelSyncStateRow,
} from "./funnelReadiness";
import { loadReadyFunnelFacts } from "./loadFunnelOrders";
import { overlayFunnelOrders } from "./metrics";

const NOW = new Date("2026-07-29T12:00:00.000Z");
const CABINET = "cabinet-a";

function readyState(
  overrides: Partial<FunnelSyncStateRow> = {},
): FunnelSyncStateRow {
  return {
    cabinet_id: CABINET,
    job: "funnel",
    status: "caught_up",
    attempts: 0,
    last_error: null,
    state: {
      coveragePct: 100,
      nextBatch: 0,
      lastSyncedAt: "2026-07-28T12:00:00.000Z",
    },
    updated_at: "2026-07-28T12:00:00.000Z",
    ...overrides,
  };
}

test("pure funnel readiness accepts only exact complete fresh state", () => {
  assert.equal(isFunnelSyncReady(readyState(), CABINET, NOW), true);

  const notReady: Array<[string, FunnelSyncStateRow | null]> = [
    ["missing", null],
    ["foreign cabinet", readyState({ cabinet_id: "cabinet-b" })],
    ["foreign job", readyState({ job: "orders" })],
    ["partial status", readyState({ status: "pending" })],
    ["attempts", readyState({ attempts: 1 })],
    ["last error", readyState({ last_error: "rate limited" })],
    ["partial coverage", readyState({
      state: { coveragePct: 99.9, nextBatch: 0, lastSyncedAt: "2026-07-28T12:00:00.000Z" },
    })],
    ["next batch", readyState({
      state: { coveragePct: 100, nextBatch: 1, lastSyncedAt: "2026-07-28T12:00:00.000Z" },
    })],
    ["stale updated_at", readyState({ updated_at: "2026-07-27T11:59:59.999Z" })],
    ["stale lastSyncedAt", readyState({
      state: { coveragePct: 100, nextBatch: 0, lastSyncedAt: "2026-07-27T11:59:59.999Z" },
    })],
    ["invalid updated_at", readyState({ updated_at: "not-a-date" })],
    ["invalid lastSyncedAt", readyState({
      state: { coveragePct: 100, nextBatch: 0, lastSyncedAt: "not-a-date" },
    })],
    ["future updated_at", readyState({ updated_at: "2026-07-29T12:00:00.001Z" })],
    ["invalid now", readyState()],
  ];

  for (const [name, row] of notReady) {
    const now = name === "invalid now" ? new Date(Number.NaN) : NOW;
    assert.equal(isFunnelSyncReady(row, CABINET, now), false, name);
  }
});

interface MockOptions {
  state?: FunnelSyncStateRow | null;
  stateError?: string;
  stateSequence?: Array<{
    data: FunnelSyncStateRow | null;
    error?: string;
  }>;
  funnelError?: string;
  funnelRows?: Array<{
    cabinet_id: string;
    nm_id: number;
    date: string;
    orders: unknown;
    orders_sum: unknown;
  }>;
}

function mockClient(options: MockOptions) {
  const calls: string[] = [];
  const filters: Array<[string, string, string]> = [];
  let rangeCalls = 0;
  let stateCalls = 0;

  return {
    calls,
    filters,
    get rangeCalls() {
      return rangeCalls;
    },
    from(relation: string) {
      calls.push(relation);
      if (relation === "wb_sync_state") {
        const query = {
          select() {
            return query;
          },
          eq(column: string, value: string) {
            filters.push([relation, column, value]);
            return query;
          },
          maybeSingle() {
            const sequenced = options.stateSequence?.[stateCalls++];
            return Promise.resolve({
              data: sequenced ? sequenced.data : options.state ?? null,
              error: sequenced?.error
                ? { message: sequenced.error }
                : options.stateError
                  ? { message: options.stateError }
                  : null,
            });
          },
        };
        return query;
      }

      assert.equal(relation, "wb_funnel_daily");
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: string) {
          filters.push([relation, column, value]);
          return query;
        },
        gte(column: string, value: string) {
          filters.push([relation, column, value]);
          return query;
        },
        lte(column: string, value: string) {
          filters.push([relation, column, value]);
          return query;
        },
        order() {
          return query;
        },
        range(from: number, to: number) {
          rangeCalls++;
          const rows = options.funnelRows ?? [];
          return Promise.resolve({
            data: rows.slice(from, to + 1),
            error: options.funnelError ? { message: options.funnelError } : null,
          });
        },
      };
      return query;
    },
  };
}

test("query gate reads exact cabinet/job state before paginated cabinet funnel facts", async () => {
  const rows = Array.from({ length: 1_001 }, (_, index) => ({
    cabinet_id: CABINET,
    nm_id: index + 1,
    date: "2026-07-28",
    orders: 1,
    orders_sum: 100,
  }));
  const client = mockClient({ state: readyState(), funnelRows: rows });

  const facts = await loadReadyFunnelFacts(
    client,
    CABINET,
    "2026-07-01",
    "2026-07-31",
    NOW,
  );

  assert.equal(facts.length, 1_001);
  assert.equal(client.rangeCalls, 2);
  assert.deepEqual(client.calls, [
    "wb_sync_state",
    "wb_funnel_daily",
    "wb_funnel_daily",
    "wb_sync_state",
  ]);
  assert.deepEqual(client.filters.slice(0, 2), [
    ["wb_sync_state", "cabinet_id", CABINET],
    ["wb_sync_state", "job", "funnel"],
  ]);
  assert.ok(client.filters.some((filter) =>
    filter[0] === "wb_funnel_daily"
    && filter[1] === "cabinet_id"
    && filter[2] === CABINET));
});

test("TOCTOU state gate requires the same exact ready fingerprint after pagination", async () => {
  const row = {
    cabinet_id: CABINET,
    nm_id: 101,
    date: "2026-07-28",
    orders: 1,
    orders_sum: 100,
  };
  const changedTimestamp = readyState({
    updated_at: "2026-07-28T12:00:01.000Z",
  });
  const cases: Array<[string, FunnelSyncStateRow | null, string | undefined, number]> = [
    ["ready to running", readyState({ status: "running" }), undefined, 0],
    ["ready to new ready timestamp", changedTimestamp, undefined, 0],
    ["ready to missing", null, undefined, 0],
    ["ready to query error", readyState(), "database unavailable", 0],
    ["ready unchanged", readyState(), undefined, 1],
  ];

  for (const [name, secondState, secondError, expectedFacts] of cases) {
    const client = mockClient({
      stateSequence: [
        { data: readyState() },
        { data: secondState, error: secondError },
      ],
      funnelRows: [row],
    });
    const facts = await loadReadyFunnelFacts(
      client,
      CABINET,
      "2026-07-01",
      "2026-07-31",
      NOW,
    );

    assert.equal(facts.length, expectedFacts, name);
    assert.equal(
      client.calls.filter((relation) => relation === "wb_sync_state").length,
      2,
      name,
    );
  }
});

test("TOCTOU state gate fails closed when readiness expires during pagination", async () => {
  const state = readyState();
  const client = mockClient({
    stateSequence: [
      { data: state },
      { data: state },
    ],
    funnelRows: [{
      cabinet_id: CABINET,
      nm_id: 101,
      date: "2026-07-28",
      orders: 1,
      orders_sum: 100,
    }],
  });
  const clockValues = [
    NOW,
    new Date("2026-07-30T12:00:00.001Z"),
  ];
  let clockCalls = 0;

  const facts = await loadReadyFunnelFacts(
    client,
    CABINET,
    "2026-07-01",
    "2026-07-31",
    () => clockValues[clockCalls++] ?? clockValues.at(-1)!,
  );

  assert.deepEqual(facts, []);
  assert.equal(client.rangeCalls, 1);
  assert.equal(clockCalls, 2);
});

test("partial, stale, error, missing, and foreign state fail closed before funnel query", async () => {
  const cases: Array<[string, MockOptions]> = [
    ["partial", { state: readyState({ status: "pending" }) }],
    ["stale", { state: readyState({ updated_at: "2026-07-27T11:59:59.999Z" }) }],
    ["query error", { state: readyState(), stateError: "database unavailable" }],
    ["missing", { state: null }],
    ["foreign", { state: readyState({ cabinet_id: "cabinet-b" }) }],
  ];

  for (const [name, options] of cases) {
    const client = mockClient(options);
    assert.deepEqual(
      await loadReadyFunnelFacts(client, CABINET, "2026-07-01", "2026-07-31", NOW),
      [],
      name,
    );
    assert.deepEqual(client.calls, ["wb_sync_state"], name);
  }
});

test("funnel query error also fails closed to wb_orders fallback", async () => {
  const client = mockClient({ state: readyState(), funnelError: "timeout" });
  const fallback = [{ date: "2026-07-28", nmId: 101, priceWithDisc: 321 }];
  const facts = await loadReadyFunnelFacts(
    client,
    CABINET,
    "2026-07-01",
    "2026-07-31",
    NOW,
  );

  assert.deepEqual(overlayFunnelOrders(fallback, facts, CABINET), fallback);
});

test("factual zero replaces wb_orders only after ready state proves the overlay", async () => {
  const zeroRow = {
    cabinet_id: CABINET,
    nm_id: 101,
    date: "2026-07-28",
    orders: 0,
    orders_sum: 0,
  };
  const fallback = [{ date: "2026-07-28", nmId: 101, priceWithDisc: 321 }];

  const readyFacts = await loadReadyFunnelFacts(
    mockClient({ state: readyState(), funnelRows: [zeroRow] }),
    CABINET,
    "2026-07-01",
    "2026-07-31",
    NOW,
  );
  assert.deepEqual(overlayFunnelOrders(fallback, readyFacts, CABINET), [{
    date: "2026-07-28",
    nmId: 101,
    ordersCount: 0,
    totalPriceDiscount: 0,
  }]);

  const partialFacts = await loadReadyFunnelFacts(
    mockClient({ state: readyState({ status: "pending" }), funnelRows: [zeroRow] }),
    CABINET,
    "2026-07-01",
    "2026-07-31",
    NOW,
  );
  assert.deepEqual(overlayFunnelOrders(fallback, partialFacts, CABINET), fallback);
});
