import assert from "node:assert/strict";
import test from "node:test";
import { selectOpiuReportQueueCabinet } from "../lib/opiu/reportSyncQueue";

const period = { dateFrom: "2026-08-01", dateTo: "2026-09-22" };
const NOW = Date.parse("2026-09-22T04:00:00Z");

test("report queue finishes an existing Optima backfill before opening a new cabinet", () => {
  const selected = selectOpiuReportQueueCabinet(
    ["pankratov", "optima", "filippov"],
    [{
      cabinetId: "optima",
      status: "error",
      updatedAt: "2026-09-21T18:58:37.648Z",
      state: { periodDateFrom: "2026-08-01", cursor: 3132161367019, synced: 214029 },
    }],
    period,
    NOW,
  );

  assert.equal(selected, "optima");
});

test("report queue selects the cabinet with the oldest completed report date", () => {
  const selected = selectOpiuReportQueueCabinet(
    ["one", "two", "three"],
    [
      { cabinetId: "one", status: "complete", updatedAt: "2026-09-22T01:00:00Z", state: { periodDateFrom: "2026-08-01", completedPeriodDateTo: "2026-09-21" } },
      { cabinetId: "two", status: "complete", updatedAt: "2026-09-22T02:00:00Z", state: { periodDateFrom: "2026-08-01", completedPeriodDateTo: "2026-09-20" } },
      { cabinetId: "three", status: "complete", updatedAt: "2026-09-22T03:00:00Z", state: { periodDateFrom: "2026-08-01", completedPeriodDateTo: "2026-09-22" } },
    ],
    period,
    NOW,
  );

  assert.equal(selected, "two");
});

test("report queue treats progress from an old refresh window as stale", () => {
  const selected = selectOpiuReportQueueCabinet(
    ["old", "current"],
    [
      { cabinetId: "old", status: "error", updatedAt: "2026-09-01T00:00:00Z", state: { periodDateFrom: "2026-07-01", cursor: 999 } },
      { cabinetId: "current", status: "running", updatedAt: "2026-09-22T00:00:00Z", state: { periodDateFrom: "2026-08-01", cursor: 1 } },
    ],
    period,
    NOW,
  );

  assert.equal(selected, "current");
});

test("report queue returns null without configured cabinets", () => {
  assert.equal(selectOpiuReportQueueCabinet([], [], period, NOW), null);
});

/**
 * Найдено комплексным аудитом панели: крупный агентский кабинет (Оптима,
 * ~116k строк отчёта/день) может проходить период НЕДЕЛЯМИ — все это время
 * его completedPeriodDateTo остаётся самым старым среди кабинетов, а крон
 * берёт РОВНО один кабинет за тик. Без голодания обычная сортировка отдавала
 * бы ему слот каждый час подряд бесконечно — остальные кабинеты не получали
 * бы ни одного тика, пока Оптима сама не продвинется дальше их (а этого
 * может не произойти неделями). "Логистика на единицу" и остальные метрики
 * финотчёта у мелких кабинетов из-за этого молчали неделями без единой
 * ошибки в логах.
 */
test("голодающий кабинет обгоняет очередь, даже если формально меньше отстаёт по датам", () => {
  const selected = selectOpiuReportQueueCabinet(
    ["optima", "retail-family"],
    [
      // Оптима отстаёт СИЛЬНЕЕ по датам (completedPeriodDateTo раньше) и
      // без голодания выигрывала бы всегда.
      { cabinetId: "optima", status: "running", updatedAt: new Date(NOW - 30 * 60 * 1000).toISOString(), state: { periodDateFrom: "2026-08-01", completedPeriodDateTo: "2026-09-01", cursor: 999 } },
      // Retail Family формально свежее по датам, но крон её не трогал
      // дольше STARVED_MS (3 часа) — обязана обогнать очередь.
      { cabinetId: "retail-family", status: "error", updatedAt: new Date(NOW - 4 * 60 * 60 * 1000).toISOString(), state: { periodDateFrom: "2026-08-01", completedPeriodDateTo: "2026-09-10", cursor: 5 } },
    ],
    period,
    NOW,
  );

  assert.equal(selected, "retail-family", "3+ часа без синка должны перебивать обычный рейтинг по датам");
});

test("голодание не применяется к УЖЕ завершённому сегодня кабинету — ему нечего досинкать до завтра", () => {
  const selected = selectOpiuReportQueueCabinet(
    ["optima", "done-yesterday"],
    [
      { cabinetId: "optima", status: "running", updatedAt: new Date(NOW - 30 * 60 * 1000).toISOString(), state: { periodDateFrom: "2026-08-01", completedPeriodDateTo: "2026-09-01", cursor: 999 } },
      // completedPeriodDateTo уже догнал dateTo — кабинет полностью закрыт
      // на сегодня, хотя его не трогали давно. Голодание не должно вернуть
      // его в очередь: досинкивать нечего до сдвига dateTo завтра.
      { cabinetId: "done-yesterday", status: "complete", updatedAt: new Date(NOW - 10 * 60 * 60 * 1000).toISOString(), state: { periodDateFrom: "2026-08-01", completedPeriodDateTo: "2026-09-22" } },
    ],
    period,
    NOW,
  );

  assert.equal(selected, "optima");
});

test("голодание срабатывает и на кабинете без единой строки состояния — он никогда не синкался", () => {
  const selected = selectOpiuReportQueueCabinet(
    ["optima", "brand-new"],
    [
      { cabinetId: "optima", status: "running", updatedAt: new Date(NOW - 30 * 60 * 1000).toISOString(), state: { periodDateFrom: "2026-08-01", completedPeriodDateTo: "2026-09-10", cursor: 999 } },
    ],
    period,
    NOW,
  );
  // У brand-new нет строки в wb_sync_state вовсе — updatedAt=0, это
  // бесконечно давно, он и без голодания должен выиграть по обычному
  // рейтингу (completedThrough=""). Голодание тут не задействовано, но
  // результат должен остаться прежним после правки — не должен обнулиться.
  assert.equal(selected, "brand-new");
});
