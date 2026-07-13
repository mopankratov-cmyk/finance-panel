import assert from "node:assert/strict";
import test from "node:test";
import { selectOzonCabinets, type OzonCabinetAccess } from "../lib/ozon/cabinet";

const cabinet = (id: string, name: string): OzonCabinetAccess => ({
  id,
  name,
  clientId: `client-${id}`,
  creds: { clientId: `client-${id}`, apiKey: `key-${id}` },
  perf: null,
});

const cabinets = [cabinet("a", "Первый"), cabinet("b", "Второй"), cabinet("c", "Третий")];

test("Ozon scope defaults to the first accessible cabinet", () => {
  const scope = selectOzonCabinets(cabinets, null);
  assert.equal(scope?.mode, "single");
  assert.deepEqual(scope?.cabinets.map((item) => item.id), ["a"]);
});

test("Ozon all scope contains every accessible cabinet", () => {
  const scope = selectOzonCabinets(cabinets, "all");
  assert.equal(scope?.mode, "all");
  assert.deepEqual(scope?.cabinets.map((item) => item.id), ["a", "b", "c"]);
});

test("Ozon groups are intersected with accessible cabinets", () => {
  const scope = selectOzonCabinets(cabinets.slice(0, 2), "group:7", ["b", "c"]);
  assert.equal(scope?.mode, "group");
  assert.deepEqual(scope?.cabinets.map((item) => item.id), ["b"]);
});

test("unknown cabinet or empty group fails closed", () => {
  assert.equal(selectOzonCabinets(cabinets, "missing"), null);
  assert.equal(selectOzonCabinets(cabinets, "group:8", ["missing"]), null);
  assert.equal(selectOzonCabinets([], "all"), null);
});
