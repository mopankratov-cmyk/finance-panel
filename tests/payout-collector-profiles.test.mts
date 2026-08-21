import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { groupTargetsByProfile, profileNameOf, sanitizeProfileName } from "../lib/opiu/browser-collector/profiles.mjs";
import { activeSupplierId, supplierCookiesFor, verifySupplierSwitch } from "../lib/opiu/browser-collector/supplierCookies.mjs";

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

test("кабинет WB переключается ПОСЛЕ главной и проверяется на самой странице выплат", () => {
  // Живой сбор 21.08: кука, поставленная до главной, затиралась — WB отдаёт
  // Set-Cookie со своим активным кабинетом, и первый кабинет уезжал на чужой.
  const collectorSource = readFileSync(new URL("../lib/opiu/browser-collector/collector.mjs", import.meta.url), "utf8");
  const homeIndex = collectorSource.indexOf("target.homeUrl");
  const cookieIndex = collectorSource.indexOf("addCookies(supplierCookies)");
  const payoutIndex = collectorSource.indexOf("target.payoutUrl");
  assert.ok(homeIndex > 0 && cookieIndex > 0 && payoutIndex > 0);
  assert.ok(cookieIndex > homeIndex, "куку ставим после перехода на главную");
  assert.ok(payoutIndex > cookieIndex, "на страницу выплат идём уже с кукой кабинета");
  assert.match(collectorSource, /supplier_switch_retry/);
});

test("кабинет Ozon сверяется по куке sc_company_id", () => {
  // Живой сбор 21.08: профиль был авторизован под CLERIN, а снимки ушли ещё и
  // под именем COSMOS — 9 чужих строк. Сверки для Ozon тогда не было.
  const cosmos = { marketplace: "ozon", cabinetId: "cab-cosmos", sellerId: "62515" };
  const asClerin = [{ name: "sc_company_id", value: "1933484" }];
  const asCosmos = [{ name: "sc_company_id", value: "62515" }];
  assert.equal(activeSupplierId(asClerin, "ozon"), "1933484");
  assert.equal(verifySupplierSwitch(cosmos, asCosmos).ok, true);
  const mismatch = verifySupplierSwitch(cosmos, asClerin);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason ?? "", /Ozon оставил активным кабинет 1933484/);
  // Профиль без куки — не авторизован, снимать нельзя.
  assert.equal(verifySupplierSwitch(cosmos, []).ok, false);
});

test("цель без идентификатора кабинета сверять нечем — и это не выдаётся за успех", () => {
  const noId = { marketplace: "ozon", cabinetId: "cab-1" };
  assert.equal(verifySupplierSwitch(noId, []).ok, true);
  assert.deepEqual(supplierCookiesFor(noId), []);
  assert.deepEqual(supplierCookiesFor({ marketplace: "wb", cabinetId: "c", supplierId: "abc" }).map((c: { name: string }) => c.name),
    ["x-supplier-id", "x-supplier-id-external"]);
  assert.deepEqual(supplierCookiesFor({ marketplace: "ozon", cabinetId: "c", sellerId: "62515" }).map((c: { name: string; domain: string }) => [c.name, c.domain]),
    [["sc_company_id", ".ozon.ru"]]);
});

test("кабинет сверяется и по куке, и по подписи магазина на странице", () => {
  // Куку сборщик ставит сам и сам же её читает: если маркетплейс её не
  // применил (магазина нет в этом логине), проверка прошла бы вхолостую, а на
  // странице остались бы выплаты чужого кабинета. Поэтому есть вторая опора —
  // подпись магазина в шапке, та самая, что видит человек.
  const source = readFileSync(new URL("../lib/opiu/browser-collector/collector.mjs", import.meta.url), "utf8");
  assert.match(source, /activeCabinetLabel/);
  assert.match(source, /cabinet_label_mismatch/);
  assert.match(source, /switched\.ok && labelOk/);
  // Переключение через селектор: список длиннее экрана, пункт нужно проматывать.
  assert.match(source, /scrollIntoView\(\{ block: "center" \}\)/);
  assert.match(source, /keyboard\.press\("Enter"\)/);
  // Отвергнутый снимок должен попадать в лог целиком, иначе непонятно, что чинить.
  assert.match(source, /snapshot_rejected/);
});

test("отказ по одной строке не отменяет весь кабинет", () => {
  const source = readFileSync(new URL("../lib/opiu/browser-collector/collector.mjs", import.meta.url), "utf8");
  assert.match(source, /snapshots_partially_rejected/);
  assert.match(source, /rejected\.length === unique\.size/);
  // В счётчик успеха идут только принятые строки, иначе лог врал бы числом.
  assert.match(source, /rows: unique\.size - rejected\.length/);
});
