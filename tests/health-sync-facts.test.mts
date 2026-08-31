import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { syncFactVerdict } from "../lib/health/syncFacts";

/**
 * 31.08.2026: «Здоровье» писало «Продажи WB — данные синхронизированы» в день,
 * когда продаж не было десять суток подряд. Синк исправно ходил к WB, получал
 * пустой ответ и честно отчитывался об успехе; разрыв между «сходил» и
 * «принёс» не смотрел никто, и разбор занял полдня.
 */

test("данные приходят — придраться не к чему", () => {
  assert.equal(syncFactVerdict({ own: "2026-08-30", peer: "2026-08-31", peerName: "Заказы WB", today: "2026-08-31" }), null);
});

test("источник молчит, а сосед приносит — это дыра, а не затишье", () => {
  const verdict = syncFactVerdict({ own: "2026-08-20", peer: "2026-08-31", peerName: "Заказы WB", today: "2026-08-31" });
  assert.equal(verdict?.state, "error");
  assert.match(verdict!.detail, /данных нет/);
  assert.match(verdict!.detail, /тишина 11 дн\./);
  assert.match(verdict!.detail, /«Заказы WB» за это время данные приносит/);
});

test("молчат оба — предупреждение: у кабинета может не быть продаж", () => {
  const verdict = syncFactVerdict({ own: "2026-08-20", peer: "2026-08-19", peerName: "Заказы WB", today: "2026-08-31" });
  assert.equal(verdict?.state, "warning");
  assert.equal(/приносит/.test(verdict!.detail), false);
});

test("строк нет вовсе — тоже не «синхронизировано»", () => {
  const verdict = syncFactVerdict({ own: null, peer: "2026-08-31", peerName: "Заказы WB", today: "2026-08-31" });
  assert.equal(verdict?.state, "warning");
  assert.match(verdict!.detail, /строк в базе нет вовсе/);
});

test("двухдневная пауза — ещё не авария", () => {
  assert.equal(syncFactVerdict({ own: "2026-08-29", peer: "2026-08-31", peerName: "Заказы WB", today: "2026-08-31" }), null);
});

test("здоровье сверяет заявленное с фактическим", () => {
  const route = readFileSync(new URL("../app/api/operational-health/route.ts", import.meta.url), "utf8");
  assert.match(route, /latestScoped\(db, "wb_orders", "date", cabinetId, allowedNmIds\)/);
  assert.match(route, /latestScoped\(db, "wb_sales", "date", cabinetId, allowedNmIds\)/);
  assert.match(route, /syncFactVerdict\(\{ \.\.\.facts, today:/);
  // Прежняя проверка смотрела только на отметку о запуске.
  assert.match(route, /own: salesFactFreshness\.value/);
  assert.match(route, /peer: ordersFactFreshness\.value/);
});
