import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpiuRequestCoordinator,
  type WarehouseSavePayload,
} from "./requestCoordinator.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness() {
  const writes: Array<{
    payload: WarehouseSavePayload;
    deferred: ReturnType<typeof deferred<void>>;
  }> = [];
  const reports: Array<{
    month: string;
    refresh: boolean;
    signal: AbortSignal;
    deferred: ReturnType<typeof deferred<string>>;
  }> = [];
  const visibleReports: string[] = [];
  const visibleErrors: string[] = [];
  const saving: Array<[WarehouseSavePayload, number]> = [];

  const coordinator = createOpiuRequestCoordinator<string>({
    writeWarehouse: (payload) => {
      const pending = deferred<void>();
      writes.push({ payload, deferred: pending });
      return pending.promise;
    },
    fetchReport: (month, refresh, signal) => {
      const pending = deferred<string>();
      reports.push({ month, refresh, signal, deferred: pending });
      return pending.promise;
    },
    onReport: (report) => visibleReports.push(report),
    onError: (message) => visibleErrors.push(message),
    onSavingChange: (payload, count) => saving.push([payload, count]),
  });

  coordinator.setMonth("2026-07");
  return { coordinator, writes, reports, visibleReports, visibleErrors, saving };
}

test("save A then B is FIFO and each write keeps its captured payload", async () => {
  const h = harness();
  const a = h.coordinator.saveWarehouse({ month: "2026-07", weekStart: "2026-07-06", amount: 10 });
  const b = h.coordinator.saveWarehouse({ month: "2026-07", weekStart: "2026-07-13", amount: 20 });
  await flush();

  assert.deepEqual(h.writes.map((write) => write.payload), [
    { month: "2026-07", weekStart: "2026-07-06", amount: 10 },
  ]);
  h.writes[0].deferred.resolve();
  await flush();
  assert.deepEqual(h.writes.map((write) => write.payload), [
    { month: "2026-07", weekStart: "2026-07-06", amount: 10 },
    { month: "2026-07", weekStart: "2026-07-13", amount: 20 },
  ]);
  h.writes[1].deferred.resolve();
  await Promise.all([a, b]);
});

test("refresh during a save aborts only the previous GET and never the PUT", async () => {
  const h = harness();
  h.coordinator.loadReport("2026-07", false);
  const save = h.coordinator.saveWarehouse({ month: "2026-07", weekStart: "2026-07-06", amount: 10 });
  await flush();
  h.coordinator.loadReport("2026-07", true);

  assert.equal(h.reports[0].signal.aborted, true);
  assert.equal(h.writes.length, 1);
  h.writes[0].deferred.resolve();
  h.reports[1].deferred.resolve("refresh");
  await save;
  assert.deepEqual(h.saving.at(-1), [
    { month: "2026-07", weekStart: "2026-07-06", amount: 10 },
    0,
  ]);
});

test("month switch preserves an initiated save but hides its completion and refresh", async () => {
  const h = harness();
  const save = h.coordinator.saveWarehouse({ month: "2026-07", weekStart: "2026-07-06", amount: 10 });
  await flush();
  h.coordinator.setMonth("2026-08");
  h.writes[0].deferred.resolve();
  await save;

  assert.equal(h.reports.length, 0);
  assert.deepEqual(h.visibleReports, []);
  assert.deepEqual(h.visibleErrors, []);
});

test("same-week writes remain ordered and the latest user action wins", async () => {
  const h = harness();
  const first = h.coordinator.saveWarehouse({ month: "2026-07", weekStart: "2026-07-06", amount: 10 });
  const second = h.coordinator.saveWarehouse({ month: "2026-07", weekStart: "2026-07-06", amount: 99 });
  await flush();
  h.writes[0].deferred.resolve();
  await flush();
  assert.equal(h.writes[1].payload.amount, 99);
  h.writes[1].deferred.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(h.saving.at(-1), [
    { month: "2026-07", weekStart: "2026-07-06", amount: 99 },
    0,
  ]);
});

test("failed current save is visible while stale-month failure is hidden", async () => {
  const current = harness();
  const failed = current.coordinator.saveWarehouse({ month: "2026-07", weekStart: "2026-07-06", amount: 10 });
  await flush();
  current.writes[0].deferred.reject(new Error("write failed"));
  await failed;
  assert.deepEqual(current.visibleErrors, ["write failed"]);

  const stale = harness();
  const staleFailure = stale.coordinator.saveWarehouse({ month: "2026-07", weekStart: "2026-07-06", amount: 10 });
  await flush();
  stale.coordinator.setMonth("2026-08");
  stale.writes[0].deferred.reject(new Error("old failure"));
  await staleFailure;
  assert.deepEqual(stale.visibleErrors, []);
});

test("GET A/B is abortable and only the latest generation wins", async () => {
  const h = harness();
  const a = h.coordinator.loadReport("2026-07", false);
  const b = h.coordinator.loadReport("2026-07", true);
  assert.equal(h.reports[0].signal.aborted, true);

  h.reports[1].deferred.resolve("B");
  h.reports[0].deferred.resolve("A");
  await Promise.all([a, b]);
  assert.deepEqual(h.visibleReports, ["B"]);
});

test("save-triggered load immediately replaces refresh activity and both flags settle", async () => {
  let loading = false;
  let refreshing = false;
  const reports: Array<{
    refresh: boolean;
    signal: AbortSignal;
    deferred: ReturnType<typeof deferred<string>>;
  }> = [];
  const write = deferred<void>();
  const coordinator = createOpiuRequestCoordinator<string>({
    writeWarehouse: () => write.promise,
    fetchReport: (_month, refresh, signal) => {
      const pending = deferred<string>();
      reports.push({ refresh, signal, deferred: pending });
      return pending.promise;
    },
    onReport: () => {},
    onError: () => {},
    onSavingChange: () => {},
    onReportStart: ({ refresh }) => {
      loading = !refresh;
      refreshing = refresh;
    },
    onReportSettled: ({ refresh }) => {
      if (refresh) refreshing = false;
      else loading = false;
    },
  });
  coordinator.setMonth("2026-07");

  const refresh = coordinator.loadReport("2026-07", true);
  assert.deepEqual({ loading, refreshing }, { loading: false, refreshing: true });

  const save = coordinator.saveWarehouse({
    month: "2026-07",
    weekStart: "2026-07-06",
    amount: 10,
  });
  await flush();
  write.resolve();
  await flush();

  assert.equal(reports[0].signal.aborted, true);
  assert.equal(reports[1].refresh, false);
  assert.deepEqual({ loading, refreshing }, { loading: true, refreshing: false });

  reports[0].deferred.resolve("stale refresh");
  reports[1].deferred.resolve("saved");
  await Promise.all([refresh, save]);
  assert.deepEqual({ loading, refreshing }, { loading: false, refreshing: false });
});

test("warehouse FIFO is shared across disposed and remounted coordinators", async () => {
  const calls: string[] = [];
  const completedAmounts: number[] = [];
  const firstWrite = deferred<void>();
  const secondWrite = deferred<void>();
  const oldErrors: string[] = [];
  const oldSaving: number[] = [];
  const newErrors: string[] = [];

  const oldCoordinator = createOpiuRequestCoordinator<string>({
    writeWarehouse: async (payload) => {
      calls.push("A");
      await firstWrite.promise;
      completedAmounts.push(payload.amount);
    },
    fetchReport: async () => "old",
    onReport: () => {},
    onError: (message) => oldErrors.push(message),
    onSavingChange: (_payload, count) => oldSaving.push(count),
  });
  oldCoordinator.setMonth("2026-07");
  const a = oldCoordinator.saveWarehouse({
    month: "2026-07",
    weekStart: "2026-07-06",
    amount: 10,
  });
  await flush();
  oldCoordinator.dispose();

  const newCoordinator = createOpiuRequestCoordinator<string>({
    writeWarehouse: async (payload) => {
      calls.push("B");
      await secondWrite.promise;
      completedAmounts.push(payload.amount);
    },
    fetchReport: async () => "new",
    onReport: () => {},
    onError: (message) => newErrors.push(message),
    onSavingChange: () => {},
  });
  newCoordinator.setMonth("2026-07");
  const b = newCoordinator.saveWarehouse({
    month: "2026-07",
    weekStart: "2026-07-06",
    amount: 99,
  });
  await flush();

  assert.deepEqual(calls, ["A"]);
  firstWrite.resolve();
  await flush();
  assert.deepEqual(calls, ["A", "B"]);
  assert.deepEqual(oldErrors, []);
  assert.deepEqual(oldSaving, [1]);

  secondWrite.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(calls, ["A", "B"]);
  assert.deepEqual(completedAmounts, [10, 99]);
  assert.deepEqual(newErrors, []);
});

test("dispose prevents state callbacks without cancelling queued money writes", async () => {
  const h = harness();
  const save = h.coordinator.saveWarehouse({ month: "2026-07", weekStart: "2026-07-06", amount: 10 });
  await flush();
  h.coordinator.dispose();
  h.writes[0].deferred.reject(new Error("after unmount"));
  await save;
  assert.deepEqual(h.visibleErrors, []);
  assert.notEqual(h.saving.at(-1)?.[1], 0);
});

test("StrictMode dispose then setMonth reactivates GET callbacks", async () => {
  const h = harness();
  h.coordinator.dispose();
  h.coordinator.setMonth("2026-07");
  const load = h.coordinator.loadReport("2026-07", false);

  h.reports.at(-1)?.deferred.resolve("reactivated");
  await load;

  assert.deepEqual(h.visibleReports, ["reactivated"]);
});

test("explicit activate re-enables callbacks after a dispose", async () => {
  const h = harness();
  h.coordinator.dispose();
  h.coordinator.activate();
  const load = h.coordinator.loadReport("2026-07", false);

  h.reports.at(-1)?.deferred.resolve("active again");
  await load;

  assert.deepEqual(h.visibleReports, ["active again"]);
});

test("same boundary week in adjacent months has independent saving identity", async () => {
  const h = harness();
  const july = h.coordinator.saveWarehouse({
    month: "2026-07",
    weekStart: "2026-07-27",
    amount: 10,
  });
  const august = h.coordinator.saveWarehouse({
    month: "2026-08",
    weekStart: "2026-07-27",
    amount: 20,
  });
  await flush();

  assert.deepEqual(h.saving.slice(0, 2), [
    [{ month: "2026-07", weekStart: "2026-07-27", amount: 10 }, 1],
    [{ month: "2026-08", weekStart: "2026-07-27", amount: 20 }, 1],
  ]);
  assert.equal(Object.isFrozen(h.saving[0][0]), true);
  assert.equal(Object.isFrozen(h.saving[1][0]), true);

  h.writes[0].deferred.resolve();
  await flush();
  assert.deepEqual(h.saving.at(-1), [
    { month: "2026-07", weekStart: "2026-07-27", amount: 10 },
    0,
  ]);

  h.writes[1].deferred.resolve();
  await Promise.all([july, august]);
});
