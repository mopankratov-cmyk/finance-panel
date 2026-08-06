import assert from "node:assert/strict";
import test from "node:test";
import { resolveForecastCabinet } from "@/lib/opiu/forecastCabinet";

const CABINETS = [
  { id: "cosmos", name: "COSMOS SHOP" },
  { id: "retail", name: "Retail Family" },
  { id: "clerin", name: "CLERIN" },
];

test("§3: без запроса выбирается дефолтный кабинет, если он доступен", () => {
  const result = resolveForecastCabinet(CABINETS, null, "retail");
  assert.deepEqual(result, { ok: true, cabinetId: "retail", cabinetName: "Retail Family" });
});

test("§3: без запроса и без дефолта в списке — первый доступный", () => {
  const result = resolveForecastCabinet(CABINETS, null, "unknown");
  assert.deepEqual(result, { ok: true, cabinetId: "cosmos", cabinetName: "COSMOS SHOP" });
});

test("§3: запрошенный кабинет валиден и возвращается как есть", () => {
  const result = resolveForecastCabinet(CABINETS, "clerin", "cosmos");
  assert.deepEqual(result, { ok: true, cabinetId: "clerin", cabinetName: "CLERIN" });
});

test("§3: запрошенный недоступный кабинет → 404", () => {
  const result = resolveForecastCabinet(CABINETS, "ghost", "cosmos");
  assert.deepEqual(result, { ok: false, status: 404, error: "Выбранный кабинет WB не найден или недоступен" });
});

test("§3/§19: агрегаты all и group запрещены → 422", () => {
  assert.equal(resolveForecastCabinet(CABINETS, "all", "cosmos").ok, false);
  assert.equal(resolveForecastCabinet(CABINETS, "group:x", "cosmos").ok, false);
});

test("§3: пустой список доступных кабинетов → 422", () => {
  const result = resolveForecastCabinet([], null, "cosmos");
  assert.deepEqual(result, { ok: false, status: 422, error: "Нет доступных кабинетов WB для прогноза" });
});

test("§3: пробелы в id/имени нормализуются", () => {
  const result = resolveForecastCabinet([{ id: " retail ", name: " Retail Family " }], "retail", "retail");
  assert.deepEqual(result, { ok: true, cabinetId: "retail", cabinetName: "Retail Family" });
});
