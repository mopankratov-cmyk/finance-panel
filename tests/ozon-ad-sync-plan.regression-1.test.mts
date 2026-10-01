import assert from "node:assert/strict";
import test from "node:test";

import { buildOzonAdSyncWarningNotes, selectOzonAdSyncCabinets } from "../lib/ozon/adSyncPlan";

// Regression: ISSUE-001 — Ozon Performance ran every cabinet at once and kept returning partial reports.
// Found by /qa on 2026-07-17
// Report: .gstack/qa-reports/qa-report-finance-panel-two-vercel-app-2026-07-17.md
test("Ozon ad sync processes the stalest cache first and limits cabinet fan-out", () => {
  const cabinets = [
    { id: "fresh", name: "Ozon Fresh", client_id: "client-fresh" },
    { id: "stale", name: "Ozon Stale", client_id: "client-stale" },
    { id: "missing", name: "Ozon Missing", client_id: "client-missing" },
  ];
  const cache = new Map([
    ["client-fresh", "2026-07-17T16:00:00.000Z"],
    ["client-stale", "2026-07-17T12:00:00.000Z"],
  ]);

  assert.deepEqual(
    selectOzonAdSyncCabinets(cabinets, cache, 1).map((cabinet) => cabinet.id),
    ["missing"],
  );
  assert.deepEqual(
    selectOzonAdSyncCabinets(cabinets, cache, 2).map((cabinet) => cabinet.id),
    ["missing", "stale"],
  );
});

// Regression: комплексный аудит панели — постоянно падающий кабинет (нет
// ключей Ozon Performance API) никогда не пишет ozon_ad_cache.updated_at
// (пишется только при полном успехе), поэтому его ранг всегда 0 — "никогда".
// При runLimit=1 (обычный часовой тик без ?all=1) такой кабинет выигрывал бы
// сортировку каждый час бесконечно, а остальные активные Ozon-кабинеты не
// получали бы ни одного тика, пока он числится активным.
test("постоянно падающий кабинет не монополизирует слот — засчитывается время последней ПОПЫТКИ, не только успеха", () => {
  const cabinets = [
    { id: "broken", name: "Ozon Broken", client_id: "client-broken" },
    { id: "healthy", name: "Ozon Healthy", client_id: "client-healthy" },
  ];
  // healthy успешно синкался недавно — cache есть.
  const cache = new Map([["client-healthy", "2026-09-29T10:00:00.000Z"]]);
  // broken никогда не писал в ozon_ad_cache (нет ключей API), но КАЖДЫЙ час
  // пытался и падал — wb_sync_state.updated_at продвигается на каждой
  // попытке (writeWbSyncState пишет его и в catch тоже).
  const lastAttempt = new Map([["client-broken", "2026-09-29T10:30:00.000Z"]]);

  assert.deepEqual(
    selectOzonAdSyncCabinets(cabinets, cache, 1, lastAttempt).map((cabinet) => cabinet.id),
    ["healthy"],
    "без учёта попыток здесь всегда побеждал бы broken (ранг 0 навсегда)",
  );
});

test("без данных о попытках поведение не меняется — параметр опционален для обратной совместимости", () => {
  const cabinets = [
    { id: "fresh", name: "Ozon Fresh", client_id: "client-fresh" },
    { id: "missing", name: "Ozon Missing", client_id: "client-missing" },
  ];
  const cache = new Map([["client-fresh", "2026-07-17T16:00:00.000Z"]]);
  assert.deepEqual(
    selectOzonAdSyncCabinets(cabinets, cache, 1).map((cabinet) => cabinet.id),
    ["missing"],
  );
});

test("Ozon ad sync still runs at least one cabinet when an invalid limit is passed", () => {
  const cabinets = [{ id: "one", name: "Ozon One", client_id: "client-one" }];
  assert.deepEqual(selectOzonAdSyncCabinets(cabinets, new Map(), 0).map((cabinet) => cabinet.id), ["one"]);
});

test("Ozon ad sync warning notes include only real API/report issues", () => {
  assert.deepEqual(
    buildOzonAdSyncWarningNotes([
      { cabinet: "Ozon Planned", ok: true, partial: false, deferred: false, error: null },
    ]),
    [],
  );

  assert.deepEqual(buildOzonAdSyncWarningNotes([
    { cabinet: "Ozon Deferred", ok: false, partial: false, deferred: true, error: "report not ready" },
  ]), [
    "Ozon Deferred: Ozon Performance готовит отчёт или ограничил частоту, повторим автоматически (report not ready)",
  ]);

  assert.deepEqual(buildOzonAdSyncWarningNotes([
    { cabinet: "Ozon Partial", ok: true, partial: true, deferred: false, error: null },
  ]), ["Частичный Performance-отчёт: Ozon Partial"]);
});
