import assert from "node:assert/strict";
import test from "node:test";
import {
  CASH_FLOW_MAX_PAGES,
  CASH_FLOW_MAX_ROWS,
  CASH_FLOW_PAGE_SIZE,
  PAYMENT_MAX_PAGES,
  PAYMENT_PAGE_SIZE,
  allocateForecastRemainder,
  assessCappedProviderRows,
  assessForecastCoverage,
  assessTariffCoverage,
  classifyActualPeriod,
  createRequestDeadline,
  deriveMoscowBusinessDate,
  deriveDefinitivePayout,
  deriveReconciliationDataStatus,
  isForecastDateEligible,
  loadBoundedPaymentRows,
  loadOzonCashFlowReports,
  mergePayoutSchedule,
  isSupportedForecastYear,
  reportBelongsToMonth,
  parsePayoutMode,
  parsePayoutRuleParams,
  publicOzonForecastError,
  runWithDeadline,
  validateOzonForecastQuery,
} from "./ozonForecastPolicy";

const cashFlowInput = {
  creds: { clientId: "client", apiKey: "secret" },
  from: new Date("2026-07-01T12:00:00Z"),
  to: new Date("2026-08-31T12:00:00Z"),
  rules: {
    mode: "standard" as const,
    weeklyDay: 2,
    standardDelayDays: 24,
  },
  identity: { cabinetId: "cabinet-a", companyId: "company-a" },
};

const detail = (
  id: string | undefined,
  amount = 100,
  begin = "2026-07-28T00:00:00Z",
  end = "2026-08-03T00:00:00Z",
) => ({
  payments: { payment: amount },
  period: { id, begin, end },
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

test("cash-flow pagination keeps the latest correction for one external report id", async () => {
  const calls: number[] = [];
  const result = await loadOzonCashFlowReports({
    ...cashFlowInput,
    fetchImpl: async (_input, init) => {
      const page = JSON.parse(String(init?.body)).page as number;
      calls.push(page);
      return jsonResponse({
        result: {
          page_count: 2,
          details: page === 1
            ? [
              detail("report-1", 100),
              ...Array.from(
                { length: CASH_FLOW_PAGE_SIZE - 1 },
                () => detail("report-1", 100),
              ),
            ]
            : [detail("report-1", 125)],
        },
      });
    },
  });

  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0]?.reportId, "report-1");
  assert.equal(result.reports[0]?.amount, 125);
});

test("different external report ids on the same date remain separate", async () => {
  const result = await loadOzonCashFlowReports({
    ...cashFlowInput,
    fetchImpl: async () => jsonResponse({
      result: { page_count: 1, details: [detail("report-1"), detail("report-2")] },
    }),
  });

  assert.deepEqual(result.reports.map((row) => row.reportId), ["report-1", "report-2"]);
});

test("missing and blank external ids are excluded and counted as degradation", async () => {
  const result = await loadOzonCashFlowReports({
    ...cashFlowInput,
    fetchImpl: async () => jsonResponse({
      result: {
        page_count: 1,
        details: [detail(undefined), detail("   "), detail("report-1")],
      },
    }),
  });

  assert.equal(result.reports.length, 1);
  assert.equal(result.rejectedRows, 2);
  assert.equal(result.degraded, true);
});

test("cash-flow parser accepts singleton and array details", async () => {
  const singleton = await loadOzonCashFlowReports({
    ...cashFlowInput,
    fetchImpl: async () => jsonResponse({
      result: { page_count: 1, details: detail("singleton") },
    }),
  });
  const array = await loadOzonCashFlowReports({
    ...cashFlowInput,
    fetchImpl: async () => jsonResponse({
      result: { page_count: 1, details: [detail("array")] },
    }),
  });

  assert.deepEqual(singleton.reports.map((row) => row.reportId), ["singleton"]);
  assert.deepEqual(array.reports.map((row) => row.reportId), ["array"]);
});

test("cash-flow page count over the hard budget fails without unbounded calls", async () => {
  let calls = 0;

  await assert.rejects(
    loadOzonCashFlowReports({
      ...cashFlowInput,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({
          result: { page_count: CASH_FLOW_MAX_PAGES + 1, details: [] },
        });
      },
    }),
    /лимит/i,
  );
  assert.ok(calls <= CASH_FLOW_MAX_PAGES);
});

test("cash-flow cumulative row count over the hard budget fails visibly", async () => {
  let call = 0;

  await assert.rejects(
    loadOzonCashFlowReports({
      ...cashFlowInput,
      fetchImpl: async () => {
        call += 1;
        return jsonResponse({
          result: {
            page_count: 2,
            details: Array.from(
              {
                length: call === 1
                  ? CASH_FLOW_PAGE_SIZE
                  : CASH_FLOW_MAX_ROWS - CASH_FLOW_PAGE_SIZE + 1,
              },
              (_, index) => detail(`report-${call}-${index}`),
            ),
          },
        });
      },
    }),
    /размер страницы|лимит строк/i,
  );
  assert.equal(call, 2);
});

test("cash-flow provider error returns no partial reports and does not expose credentials", async () => {
  let call = 0;
  await assert.rejects(
    loadOzonCashFlowReports({
      ...cashFlowInput,
      fetchImpl: async () => {
        call += 1;
        return call === 1
          ? jsonResponse({ result: { page_count: 2, details: [detail("partial")] } })
          : jsonResponse({}, false, 500);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /secret|client/);
      return true;
    },
  );
});

test("cash-flow rejects a page count changing from 3 to 1 without partial success", async () => {
  let calls = 0;

  await assert.rejects(
    loadOzonCashFlowReports({
      ...cashFlowInput,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({
          result: {
            page_count: calls === 1 ? 3 : 1,
            details: calls === 1
              ? Array.from(
                { length: CASH_FLOW_PAGE_SIZE },
                (_, index) => detail(`partial-${index}`),
              )
              : [detail("changed")],
          },
        });
      },
    }),
    /неполные|страниц/i,
  );
  assert.equal(calls, 2);
});

test("cash-flow rejects missing or invalid later page counts after a full page", async () => {
  for (const invalidPageCount of [undefined, 1.5, Number.POSITIVE_INFINITY, 0, -1]) {
    let calls = 0;
    await assert.rejects(
      loadOzonCashFlowReports({
        ...cashFlowInput,
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({
            result: {
              ...(calls === 1 ? { page_count: 2 } : { page_count: invalidPageCount }),
              details: calls === 1
                ? Array.from({ length: CASH_FLOW_PAGE_SIZE }, (_, index) => detail(`first-${index}`))
                : [],
            },
          });
        },
      }),
      /неполные|страниц/i,
    );
    assert.equal(calls, 2);
  }
});

test("cash-flow rejects malformed, impossible and reversed report dates as degradation", async () => {
  const result = await loadOzonCashFlowReports({
    ...cashFlowInput,
    fetchImpl: async () => jsonResponse({
      result: {
        page_count: 1,
        details: [
          detail("malformed", 100, "not-a-date", "2026-08-03"),
          detail("impossible", 100, "2026-02-01", "2026-02-30"),
          detail("reversed", 100, "2026-08-04", "2026-08-03"),
          detail("valid", 100, "2026-08-01", "2026-08-03"),
        ],
      },
    }),
  });

  assert.deepEqual(result.reports.map((item) => item.reportId), ["valid"]);
  assert.equal(result.rejectedRows, 3);
  assert.equal(result.degraded, true);
  assert.doesNotMatch(JSON.stringify(result), /NaN/);
});

test("cash-flow accepts only exact ISO dates or complete RFC3339 timestamps", async () => {
  const result = await loadOzonCashFlowReports({
    ...cashFlowInput,
    fetchImpl: async () => jsonResponse({
      result: {
        page_count: 1,
        details: [
          detail("date-only", 100, "2026-08-01", "2026-08-03"),
          detail(
            "rfc3339",
            100,
            "2026-08-01T01:02:03.456+03:00",
            "2026-08-03T23:59:59Z",
          ),
          detail("junk", 100, "2026-08-01", "2026-08-03-invalid"),
        ],
      },
    }),
  });

  assert.deepEqual(
    result.reports.map((item) => item.reportId),
    ["date-only", "rfc3339"],
  );
  assert.equal(result.rejectedRows, 1);
  assert.equal(result.degraded, true);
});

test("cash-flow rejects a short non-final page without requesting later pages", async () => {
  for (const secondPageRows of [[], [detail("short")]]) {
    let calls = 0;
    await assert.rejects(
      loadOzonCashFlowReports({
        ...cashFlowInput,
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({
            result: {
              page_count: 3,
              details: calls === 1
                ? Array.from(
                  { length: CASH_FLOW_PAGE_SIZE },
                  (_, index) => detail(`full-${index}`),
                )
                : secondPageRows,
            },
          });
        },
      }),
      /неполные|страниц/i,
    );
    assert.equal(calls, 2);
  }
});

test("cash-flow rejects an oversized single or final page without partial success", async () => {
  for (const pageCount of [1, 2]) {
    let calls = 0;
    await assert.rejects(
      loadOzonCashFlowReports({
        ...cashFlowInput,
        fetchImpl: async () => {
          calls += 1;
          return {
            ok: true,
            json: async () => ({
              result: {
                page_count: pageCount,
                details: Array.from(
                  { length: CASH_FLOW_PAGE_SIZE + 1 },
                  (_, index) => detail(`${calls}-${index}`),
                ),
              },
            }),
          } as Response;
        },
      }),
      /страниц|лимит|непол/i,
    );
    assert.equal(calls, 1);
  }
});

test("cash-flow response body decode is bounded by the shared deadline", async () => {
  let timeoutDelay = -1;
  let aborted = false;
  const deadline = createRequestDeadline(1_000, 50);

  await assert.rejects(
    loadOzonCashFlowReports({
      ...cashFlowInput,
      deadline,
      deadlineOptions: {
        now: () => 1_000,
        scheduleTimeout: (callback, delay) => {
          timeoutDelay = delay;
          callback();
          return 1;
        },
        cancelTimeout: () => {},
      },
      fetchImpl: async (_input, init) => {
        aborted = Boolean(init?.signal?.aborted);
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        return {
          ok: true,
          status: 200,
          json: () => new Promise<never>(() => {}),
        } as unknown as Response;
      },
    }),
    /срок|deadline|врем/i,
  );

  assert.equal(timeoutDelay, 50);
  assert.equal(aborted, true);
});

test("cross-month report belongs only to the month containing periodTo", () => {
  const report = { periodTo: "2026-08-03" };

  assert.equal(reportBelongsToMonth(report, 2026, 7), false);
  assert.equal(reportBelongsToMonth(report, 2026, 8), true);
});

test("future analytics period is not started and has no provider range", () => {
  assert.deepEqual(
    classifyActualPeriod(2026, 9, "2026-08-15"),
    { status: "not_started", range: null },
  );
});

test("Moscow business date changes at 21:00 UTC including month and year rollover", () => {
  assert.equal(
    deriveMoscowBusinessDate(new Date("2026-07-31T20:59:59Z")),
    "2026-07-31",
  );
  assert.equal(
    deriveMoscowBusinessDate(new Date("2026-07-31T21:00:00Z")),
    "2026-08-01",
  );
  assert.equal(
    deriveMoscowBusinessDate(new Date("2026-12-31T21:00:00Z")),
    "2027-01-01",
  );
});

test("Moscow month rollover makes July past and August current", () => {
  const businessDate = deriveMoscowBusinessDate(
    new Date("2026-07-31T21:00:00Z"),
  );
  const july = classifyActualPeriod(2026, 7, businessDate);
  const august = classifyActualPeriod(2026, 8, businessDate);

  assert.deepEqual(july, {
    status: "available",
    range: { from: "2026-07-01", to: "2026-07-31" },
  });
  assert.deepEqual(august, {
    status: "available",
    range: { from: "2026-08-01", to: "2026-08-01" },
  });
  assert.ok(july.range && july.range.from <= july.range.to);
  assert.ok(august.range && august.range.from <= august.range.to);
});

test("past schedule buckets cannot receive forecast remainder", () => {
  const businessDate = deriveMoscowBusinessDate(
    new Date("2026-07-31T21:00:00Z"),
  );
  const eligible = [
    { id: "past", date: "2026-07-31", weight: 1 },
    { id: "current", date: "2026-08-01", weight: 1 },
  ].filter((row) => isForecastDateEligible(row.date, businessDate));

  assert.deepEqual(eligible.map((row) => row.id), ["current"]);
  assert.deepEqual(allocateForecastRemainder(100, eligible), {
    schedule: [
      { id: "current", date: "2026-08-01", amount: 100, source: "forecast" },
    ],
    unallocatedForecastPayout: 0,
  });
});

test("current and past analytics ranges are bounded and never inverted", () => {
  const current = classifyActualPeriod(2026, 8, "2026-08-15");
  const past = classifyActualPeriod(2026, 7, "2026-08-15");

  assert.deepEqual(current, {
    status: "available",
    range: { from: "2026-08-01", to: "2026-08-15" },
  });
  assert.deepEqual(past, {
    status: "available",
    range: { from: "2026-07-01", to: "2026-07-31" },
  });
  assert.ok(current.range && current.range.from <= current.range.to);
  assert.ok(past.range && past.range.from <= past.range.to);
});

test("bounded payment reader applies scope, fact, date, ordering and pagination filters", async () => {
  const observed: Array<[string, ...unknown[]]> = [];
  const controller = new AbortController();
  const rows = Array.from({ length: PAYMENT_PAGE_SIZE + 1 }, (_, index) => ({
    id: `payment-${index}`,
  }));
  const db = {
    from(table: string) {
      observed.push(["from", table]);
      const query = {
        select(value: string) { observed.push(["select", value]); return query; },
        eq(column: string, value: unknown) { observed.push(["eq", column, value]); return query; },
        gt(column: string, value: unknown) { observed.push(["gt", column, value]); return query; },
        gte(column: string, value: unknown) { observed.push(["gte", column, value]); return query; },
        lte(column: string, value: unknown) { observed.push(["lte", column, value]); return query; },
        order(column: string, options?: unknown) {
          observed.push(["order", column, options]);
          return query;
        },
        abortSignal(signal: AbortSignal) {
          observed.push(["abortSignal", signal]);
          return query;
        },
        range(from: number, to: number) {
          observed.push(["range", from, to]);
          return Promise.resolve({
            data: rows.slice(from, to + 1),
            error: null,
          });
        },
      };
      return query;
    },
  };

  const result = await loadBoundedPaymentRows(
    db,
    "account-a",
    new Date("2026-08-01T12:00:00"),
    new Date("2026-08-31T12:00:00"),
    24,
    { signal: controller.signal },
  );

  assert.equal(result.length, PAYMENT_PAGE_SIZE + 1);
  assert.ok(observed.some((item) => item[0] === "eq" && item[1] === "account_id" && item[2] === "account-a"));
  assert.ok(observed.some((item) =>
    item[0] === "select"
    && String(item[1]).includes("account_id")
    && String(item[1]).includes("company_id")));
  assert.ok(observed.some((item) => item[0] === "eq" && item[1] === "status" && item[2] === "done"));
  assert.ok(observed.some((item) => item[0] === "gt" && item[1] === "amount" && item[2] === 0));
  assert.ok(observed.some((item) => item[0] === "gte" && item[1] === "date" && item[2] === "2026-07-01"));
  assert.ok(observed.some((item) => item[0] === "lte" && item[1] === "date" && item[2] === "2026-10-25"));
  assert.deepEqual(
    observed.filter((item) => item[0] === "order").map((item) => item[1]),
    ["date", "id", "date", "id"],
  );
  assert.deepEqual(
    observed.filter((item) => item[0] === "range"),
    [["range", 0, PAYMENT_PAGE_SIZE - 1], ["range", PAYMENT_PAGE_SIZE, PAYMENT_PAGE_SIZE * 2 - 1]],
  );
  assert.deepEqual(
    observed.filter((item) => item[0] === "abortSignal"),
    [["abortSignal", controller.signal], ["abortSignal", controller.signal]],
  );
});

test("bounded payment reader fails visibly when the final allowed page is full", async () => {
  let calls = 0;
  const db = {
    from() {
      const query = {
        select() { return query; },
        eq() { return query; },
        gt() { return query; },
        gte() { return query; },
        lte() { return query; },
        order() { return query; },
        range() {
          calls += 1;
          return Promise.resolve({
            data: Array.from({ length: PAYMENT_PAGE_SIZE }, (_, index) => ({ id: index })),
            error: null,
          });
        },
      };
      return query;
    },
  };

  await assert.rejects(
    loadBoundedPaymentRows(
      db,
      "company-a",
      new Date("2026-08-01T12:00:00"),
      new Date("2026-08-31T12:00:00"),
      24,
    ),
    /неполные|лимит/i,
  );
  assert.equal(calls, PAYMENT_MAX_PAGES);
});

test("confirmed report and forecast bucket on the same date remain separate rows", () => {
  const rows = mergePayoutSchedule(
    [{ id: "report:r1", date: "2026-08-07", amount: 100, source: "financial_report" }],
    [{ id: "forecast:f1", date: "2026-08-07", amount: 50, source: "forecast" }],
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.id), ["report:r1", "forecast:f1"]);
});

test("positive remainder with no future buckets is returned as unallocated", () => {
  assert.deepEqual(allocateForecastRemainder(123.45, []), {
    schedule: [],
    unallocatedForecastPayout: 123.45,
  });
});

test("positive remainder with only zero-weight buckets stays finite and unallocated", () => {
  const result = allocateForecastRemainder(100, [
    { id: "one", date: "2026-08-07", weight: 0 },
    { id: "two", date: "2026-08-14", weight: 0 },
  ]);

  assert.deepEqual(result, {
    schedule: [],
    unallocatedForecastPayout: 100,
  });
  assert.ok(Number.isFinite(result.unallocatedForecastPayout));
});

test("weighted allocation preserves the exact rounded monetary total", () => {
  const result = allocateForecastRemainder(100.01, [
    { id: "one", date: "2026-08-07", weight: 1 },
    { id: "two", date: "2026-08-14", weight: 1 },
    { id: "three", date: "2026-08-21", weight: 1 },
  ]);

  assert.equal(result.schedule.reduce((sum, row) => sum + row.amount, 0), 100.01);
  assert.equal(result.unallocatedForecastPayout, 0);
});

test("missing tariff coverage makes the forecast subtotal unavailable", () => {
  assert.deepEqual(
    assessForecastCoverage(true, [
      { revenue: 100, covered: true },
      { revenue: 50, covered: false },
    ]),
    {
      forecastDataStatus: "degraded",
      plannedPositiveRevenueRows: 2,
      plannedPositiveRevenue: 150,
      coveredPositiveRevenueRows: 1,
      coveredPositiveRevenue: 100,
    },
  );
  assert.equal(assessForecastCoverage(false, []).forecastDataStatus, "degraded");
  assert.equal(assessForecastCoverage(true, []).forecastDataStatus, "available");
});

test("tariff coverage fails closed for invalid money-driving fields and provider cap", () => {
  const valid = { commissionPct: 15, logistics: 40, acquiring: 2 };
  for (const invalid of [
    { ...valid, commissionPct: 0 },
    { ...valid, commissionPct: Number.NaN },
    { ...valid, logistics: 0 },
    { ...valid, logistics: Number.NaN },
    { ...valid, acquiring: 0 },
    { ...valid, acquiring: Number.NaN },
  ]) {
    const result = assessTariffCoverage(true, 1, [
      { revenue: 100, tariff: invalid },
    ]);
    assert.equal(result.forecastDataStatus, "degraded");
    assert.equal(result.coveredPositiveRevenueRows, 0);
    assert.doesNotMatch(JSON.stringify(result), /NaN|Infinity/);
  }

  assert.equal(
    assessTariffCoverage(true, 19_999, [{ revenue: 100, tariff: valid }])
      .forecastDataStatus,
    "available",
  );
  assert.equal(
    assessTariffCoverage(true, 20_000, [{ revenue: 100, tariff: valid }])
      .forecastDataStatus,
    "degraded",
  );
});

test("analytics provider cap distinguishes complete and potentially truncated results", () => {
  assert.equal(assessCappedProviderRows(true, 19_999).status, "available");
  assert.equal(assessCappedProviderRows(true, 20_000).status, "degraded");
  assert.equal(assessCappedProviderRows(false, 0).status, "degraded");
});

test("payout rule parsing preserves valid zero values", () => {
  assert.deepEqual(
    parsePayoutRuleParams("0", "0"),
    { ok: true, weeklyDay: 0, standardDelayDays: 0 },
  );
  assert.deepEqual(
    parsePayoutRuleParams(null, null),
    { ok: true, weeklyDay: 2, standardDelayDays: 24 },
  );
  assert.deepEqual(
    parsePayoutRuleParams("   ", "\t"),
    { ok: true, weeklyDay: 2, standardDelayDays: 24 },
  );
  assert.deepEqual(
    parsePayoutRuleParams("6", "60"),
    { ok: true, weeklyDay: 6, standardDelayDays: 60 },
  );
});

test("payout rule parsing rejects non-canonical and out-of-range values", () => {
  for (const [weeklyDay, standardDelayDays] of [
    ["1.5", null],
    ["1e0", null],
    ["-1", null],
    ["7", null],
    [null, "1.5"],
    [null, "1e1"],
    [null, "-1"],
    [null, "61"],
  ] as const) {
    const result = parsePayoutRuleParams(weeklyDay, standardDelayDays);
    assert.equal(result.ok, false);
    assert.match(result.error, /параметр/i);
  }
});

test("payout mode defaults only when missing and accepts exact documented values", () => {
  assert.deepEqual(parsePayoutMode(null), { ok: true, mode: "standard" });
  assert.deepEqual(parsePayoutMode("standard"), { ok: true, mode: "standard" });
  assert.deepEqual(parsePayoutMode("weekly"), { ok: true, mode: "weekly" });
});

test("payout mode rejects every supplied non-canonical value", () => {
  for (const value of ["", "typo", "1", " standard", "weekly ", "Weekly"]) {
    assert.deepEqual(parsePayoutMode(value), {
      ok: false,
      error: "Некорректный режим выплаты",
    });
  }
});

test("forecast query rejects unknown and duplicate singleton parameters", () => {
  assert.equal(validateOzonForecastQuery(
    new URLSearchParams("year=2026&month=7&cabinet=one"),
  ).ok, true);
  assert.equal(validateOzonForecastQuery(
    new URLSearchParams("year=2026&year=2027&month=7"),
  ).ok, false);
  assert.equal(validateOzonForecastQuery(
    new URLSearchParams("year=2026&month=7&company=arbitrary"),
  ).ok, false);
});

test("public Ozon forecast errors never expose arbitrary backend details", () => {
  const sensitive = [
    new Error("relation private_table does not exist token=secret"),
    {
      message: "column api_key missing",
      details: "postgres://private-host/database",
      hint: "SELECT * FROM auth.users",
    },
    "provider body client_id=credential",
  ];

  for (const error of sensitive) {
    const result = publicOzonForecastError(error);
    assert.equal(result, "Не удалось рассчитать прогноз Ozon");
    assert.doesNotMatch(
      result,
      /private_table|token|secret|column|api_key|postgres|select|auth|provider|client_id|credential/i,
    );
  }
});

test("definitive payout totals are gated by tariff and report completeness", () => {
  const reports = [
    { key: "valid", amount: 100 },
  ];
  const receivedByReport = new Map([["valid", 25]]);

  assert.deepEqual(
    deriveDefinitivePayout({
      forecastDataStatus: "available",
      reportDataStatus: "degraded",
      expectedPayout: 150,
      reports,
      receivedByReport,
    }),
    {
      expectedPayout: 150,
      actualPayout: null,
      forecastExpectedPayout: null,
      confirmedOutstanding: null,
      forecastRemainder: null,
    },
  );
  assert.deepEqual(
    deriveDefinitivePayout({
      forecastDataStatus: "degraded",
      reportDataStatus: "available",
      expectedPayout: 150,
      reports,
      receivedByReport,
    }),
    {
      expectedPayout: null,
      actualPayout: 25,
      forecastExpectedPayout: null,
      confirmedOutstanding: 75,
      forecastRemainder: null,
    },
  );
  assert.equal(
    deriveDefinitivePayout({
      forecastDataStatus: "available",
      reportDataStatus: "not_selected",
      expectedPayout: 150,
      reports: [],
      receivedByReport: new Map(),
    }).actualPayout,
    null,
  );
});

test("every unresolved receipt reason gates definitive payout money", () => {
  for (const reason of ["unlinked", "ambiguous", "partial", "over_allocation"] as const) {
    const reconciliationDataStatus = deriveReconciliationDataStatus(
      "available",
      [{ reason }],
    );
    assert.equal(reconciliationDataStatus, "degraded");
    const totals = deriveDefinitivePayout({
      forecastDataStatus: "available",
      reportDataStatus: "available",
      reconciliationDataStatus,
      expectedPayout: 150,
      reports: [{ key: "valid", amount: 100 }],
      receivedByReport: new Map([["valid", 25]]),
    });
    assert.deepEqual(totals, {
      expectedPayout: 150,
      actualPayout: null,
      forecastExpectedPayout: null,
      confirmedOutstanding: null,
      forecastRemainder: null,
    });
  }
});

test("mixed linked and unresolved receipts cannot expose linked subtotal as bank fact", () => {
  const reconciliationDataStatus = deriveReconciliationDataStatus(
    "available",
    [{ reason: "unlinked" }],
  );
  const totals = deriveDefinitivePayout({
    forecastDataStatus: "available",
    reportDataStatus: "available",
    reconciliationDataStatus,
    expectedPayout: 200,
    reports: [{ key: "linked", amount: 100 }],
    receivedByReport: new Map([["linked", 100]]),
  });
  assert.equal(totals.actualPayout, null);
  assert.equal(totals.forecastRemainder, null);
  assert.ok(Object.values(totals).every((value) => value === null || Number.isFinite(value)));
});

test("supported forecast year range is strict", () => {
  assert.equal(isSupportedForecastYear(2020), true);
  assert.equal(isSupportedForecastYear(2100), true);
  for (const year of [2019, 2101, NaN, 2026.5]) {
    assert.equal(isSupportedForecastYear(year), false);
  }
});

test("definitive payout arithmetic is cent-exact", () => {
  const totals = deriveDefinitivePayout({
    forecastDataStatus: "available",
    reportDataStatus: "available",
    expectedPayout: 0.3,
    reports: [
      { key: "one", amount: 0.1 },
      { key: "two", amount: 0.2 },
    ],
    receivedByReport: new Map([["one", 0.1]]),
  });

  assert.deepEqual(totals, {
    expectedPayout: 0.3,
    actualPayout: 0.1,
    forecastExpectedPayout: 0.2,
    confirmedOutstanding: 0.2,
    forecastRemainder: 0,
  });
  for (const value of Object.values(totals)) {
    assert.ok(value === null || Number.isFinite(value));
  }
});

test("shared deadline rejects expired stages without starting work", async () => {
  let started = false;
  const deadline = createRequestDeadline(1_000, 50);

  await assert.rejects(
    runWithDeadline(
      deadline,
      "prices",
      async () => {
        started = true;
        return "late";
      },
      { now: () => 1_050 },
    ),
    /срок|deadline|врем/i,
  );
  assert.equal(started, false);
});

test("shared deadline aborts a never-resolving stage without real sleep", async () => {
  const deadline = createRequestDeadline(1_000, 50);
  let scheduledDelay = -1;

  await assert.rejects(
    runWithDeadline(
      deadline,
      "cash-flow",
      () => new Promise<never>(() => {}),
      {
        now: () => 1_000,
        scheduleTimeout: (callback, delay) => {
          scheduledDelay = delay;
          callback();
          return 1;
        },
        cancelTimeout: () => {},
      },
    ),
    /срок|deadline|врем/i,
  );
  assert.equal(scheduledDelay, 50);
});

test("caller abort reaches an active deadline stage", async () => {
  const caller = new AbortController();
  let observed: AbortSignal | null = null;
  const running = runWithDeadline(
    createRequestDeadline(Date.now(), 10_000),
    "provider body",
    (signal) => {
      observed = signal;
      return new Promise<never>(() => {});
    },
    { signal: caller.signal },
  );
  caller.abort();
  await assert.rejects(running, /abort/i);
  assert.ok(observed);
  assert.equal((observed as AbortSignal).aborted, true);
});
