import { strict as assert } from "node:assert";
import test from "node:test";
import {
  hasWildberriesSource,
  noWildberriesSourceReason,
  wildberriesOwnCabinets,
} from "../lib/warehouse/cabinetChannels.ts";
import type { EntityCabinetLink } from "../lib/warehouse/entityAccess.ts";

const link = (over: Partial<EntityCabinetLink>): EntityCabinetLink => ({
  cabinetId: "c1", cabinetName: "Кабинет", relation: "own", marketplace: "wb", ...over,
});

test("источником карточек служит только свой кабинет Wildberries", () => {
  const links = [
    link({ cabinetId: "wb-own", marketplace: "wb", relation: "own" }),
    link({ cabinetId: "wb-agent", marketplace: "wb", relation: "agent" }),
    link({ cabinetId: "ozon-own", marketplace: "ozon", relation: "own" }),
  ];
  assert.deepEqual(wildberriesOwnCabinets(links).map((l) => l.cabinetId), ["wb-own"]);
  assert.equal(hasWildberriesSource(links), true);
});

test("юрлицо с одними Ozon-кабинетами источником не считается", () => {
  const links = [link({ marketplace: "ozon", cabinetName: "Ozon COSMOS" })];
  assert.equal(hasWildberriesSource(links), false);
});

test("причина отказа различает «кабинетов нет» и «кабинеты чужого маркетплейса»", () => {
  const empty = noWildberriesSourceReason("ИП Тест", []);
  assert.match(empty, /нет собственных кабинетов/);
  assert.doesNotMatch(empty, /Wildberries/);

  const ozonOnly = noWildberriesSourceReason("ИП Тест", [link({ marketplace: "ozon" })]);
  assert.match(ozonOnly, /нет кабинетов Wildberries/);
  assert.match(ozonOnly, /Ozon/);
});

test("агентский WB-кабинет не делает юрлицо источником: карточки там чужие", () => {
  assert.equal(hasWildberriesSource([link({ relation: "agent" })]), false);
});
