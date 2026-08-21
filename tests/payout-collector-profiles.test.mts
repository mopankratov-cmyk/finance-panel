import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { groupTargetsByProfile, profileNameOf, sanitizeProfileName } from "../lib/opiu/browser-collector/profiles.mjs";

const collector = readFileSync(new URL("../lib/opiu/browser-collector/collector.mjs", import.meta.url), "utf8");

test("каждый кабинет по умолчанию получает свой профиль браузера", () => {
  // WB держит одну сессию продавца на профиль: общий профиль означал бы, что
  // сборщик снимает последний вход вместо пяти разных кабинетов.
  const groups = groupTargetsByProfile([
    { marketplace: "wb", cabinetId: "cab-1" },
    { marketplace: "wb", cabinetId: "cab-2" },
    { marketplace: "ozon", cabinetId: "cab-1" },
  ]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => group.profile), ["wb-cab-1", "wb-cab-2", "ozon-cab-1"]);
});

test("кабинеты одного аккаунта можно свести в один профиль явным полем", () => {
  const groups = groupTargetsByProfile([
    { marketplace: "wb", cabinetId: "cab-1", profile: "wb-optima" },
    { marketplace: "wb", cabinetId: "cab-2", profile: "wb-optima" },
    { marketplace: "wb", cabinetId: "cab-3" },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], { profile: "wb-optima", targets: [
    { marketplace: "wb", cabinetId: "cab-1", profile: "wb-optima" },
    { marketplace: "wb", cabinetId: "cab-2", profile: "wb-optima" },
  ] });
  assert.equal(groups[1].profile, "wb-cab-3");
});

test("справочные блоки targets.json целями не считаются", () => {
  // В черновике рядом с целями лежит шпаргалка со списком компаний и счетов.
  const groups = groupTargetsByProfile([
    { _справочник: "не цель", _компании: {} },
    { marketplace: "wb", cabinetId: "cab-1" },
  ]);
  assert.deepEqual(groups.map((group) => group.profile), ["wb-cab-1"]);
});

test("имя профиля не уводит запись за пределы папки профилей", () => {
  assert.equal(sanitizeProfileName("../../etc"), "etc");
  assert.equal(sanitizeProfileName("wb/../shelf-collector"), "wb-..-shelf-collector");
  assert.equal(profileNameOf({ marketplace: "wb", cabinetId: "../secret" }), "wb-..-secret");
  assert.equal(sanitizeProfileName("   "), "default");
});

test("сборщик открывает отдельный контекст на профиль и не падает целиком из-за одной блокировки", () => {
  assert.match(collector, /groupTargetsByProfile/);
  assert.match(collector, /path\.join\(profilesRoot, profile\)/);
  assert.match(collector, /profile_skipped_after_block/);
  // Прежний код висел вечно в режиме --login и требовал Ctrl+C, теряя очередь
  // профилей. Теперь переход к следующему профилю — по Enter.
  assert.match(collector, /waitForEnter/);
  assert.doesNotMatch(collector, /await new Promise\(\(\) => \{\}\)/);
});
