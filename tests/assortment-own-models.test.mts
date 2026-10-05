import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileCard } from "../components/assortment/BrandProfiles.tsx";
import { BRAND_DEFAULTS } from "../lib/assortment/brandProfiles.ts";
import { ownModelsFor, type OwnCard } from "../lib/assortment/ownModels.ts";

/** «У нас N»: собственные модели бренда на WB по формам (05.10). Бренд — из поля бренда WB; нет карточек — «не проверено». */

const root = fileURLToPath(new URL("..", import.meta.url));
const flat = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const card = (nm: number, name: string, brand: string | null, over: Partial<OwnCard> = {}): OwnCard => ({ cabinet_id: "c1", nm_id: nm, imt_id: nm, name, brand, ...over });
const norvia = BRAND_DEFAULTS.find((p) => p.brandKey === "norvia")!;
const heaton = BRAND_DEFAULTS.find((p) => p.brandKey === "heaton")!;
const clerin = BRAND_DEFAULTS.find((p) => p.brandKey === "clerin")!;

test("Подсчёт: цвета и размеры одной модели (общий imt_id) — одна модель; форма — по названию; не называет форму — отдельно; регистр бренда не важен; чужой бренд не считается", () => {
  const cards: OwnCard[] = [
    card(1, "Куртка-бомбер женская демисезонная", "NORVIA", { imt_id: 100 }),
    card(2, "Куртка-бомбер женская демисезонная", "Norvia", { imt_id: 100 }), // другой цвет той же модели
    card(3, "Пуховик женский зимний удлинённый", " norvia ", { imt_id: 200 }),
    card(4, "Брюки женские", "NORVIA", { imt_id: 300 }),
    card(5, "Куртка женская", "NORVIA", { imt_id: null }),
    card(6, "Бомбер мужской", "SomeoneElse", { imt_id: 400 }),
    card(7, "Куртка-бомбер женская", "HEATON", { imt_id: 500 }),
  ];
  const r = ownModelsFor(norvia, cards);
  assert.equal(r.found, true);
  assert.equal(r.cards, 5, "пять карточек NORVIA");
  assert.equal(r.models, 4, "четыре модели: бомбер (2 цвета — одна), пуховик, брюки, «куртка»");
  assert.equal(r.byForm.bomber, 1);
  assert.equal(r.byForm.puffer, 1);
  assert.equal(r.byForm.jacket, 1, "«куртка» без уточнения — общая форма");
  assert.equal(r.unrecognized, 1, "брюки: название не называет форму куртки");
  assert.equal(ownModelsFor(heaton, cards).byForm.bomber, 1, "HEATON — отдельный профиль со своими карточками");
  assert.equal(ownModelsFor(heaton, cards).models, 1);
});

test("Нет карточек бренда — found=false («не проверено»), а не нули по формам; бренд определяется полем бренда WB, а не префиксом артикула", () => {
  const none = ownModelsFor(heaton, [card(1, "Куртка-бомбер женская", "NORVIA"), card(2, "Ветровка женская HT-42", null)]);
  assert.equal(none.found, false);
  assert.equal(none.models, 0);
  assert.equal(none.cards, 0);
  const clerinCards = [card(10, "Сумка-тоут женская", "CLÉRIN"), card(11, "Сумка кросс-боди", "Clerin"), card(12, "Рюкзак женский", "CLERIN")];
  const c = ownModelsFor(clerin, clerinCards);
  assert.equal(c.found, true);
  assert.equal(c.byForm.tote, 1);
  assert.equal(c.byForm.crossbody, 1);
  assert.equal(c.byForm.backpack, 1);
  assert.equal(ownModelsFor(clerin, []).found, false);
});

test("Форма модели — по первой карточке по номеру: порядок строк в базе на результат не влияет", () => {
  const a = card(5, "Куртка-бомбер женская", "NORVIA", { imt_id: 9 });
  const b = card(6, "Пуховик женский", "NORVIA", { imt_id: 9 });
  assert.deepEqual(ownModelsFor(norvia, [a, b]).byForm, ownModelsFor(norvia, [b, a]).byForm);
  assert.equal(ownModelsFor(norvia, [b, a]).byForm.bomber, 1);
});

test("Карточка профиля: «у нас N моделей» рядом с формами, итог бренда и «не проверено», если карточек нет; без данных — как раньше", () => {
  const own = ownModelsFor(norvia, [card(1, "Куртка-бомбер женская", "NORVIA", { imt_id: 1 }), card(2, "Куртка-бомбер женская", "NORVIA", { imt_id: 1 }), card(3, "Брюки женские", "NORVIA", { imt_id: 3 })]);
  const html = renderToStaticMarkup(createElement(ProfileCard, { profile: norvia, editable: true, own }));
  const t = flat(html);
  assert.match(t, /У нас на WB: 2 модели \(3 карточки\); форма — по названию карточки, не по фото\. У 1 название формы не называет\./);
  assert.match(t, /Бомбер у нас 1 модель/);
  assert.match(t, /Пуховик у нас 0 моделей/, "бренд найден — ноль по форме честный");
  const missing = flat(renderToStaticMarkup(createElement(ProfileCard, { profile: heaton, editable: true, own: ownModelsFor(heaton, []) })));
  assert.match(missing, /Карточек с брендом «HEATON» в базе WB не нашлось — «у нас» не проверено \(не «0»\)/);
  assert.doesNotMatch(missing, /у нас 0/, "по формам — ни одного «0»");
  const noOwn = flat(renderToStaticMarkup(createElement(ProfileCard, { profile: norvia, editable: true })));
  assert.doesNotMatch(noOwn, /У нас на WB|у нас \d|не проверено/);
});

test("Роут «у нас»: под сессией модуля, кабинеты сессии учитываются, наружу только числа (ни артикулов, ни номеров WB), бренды — из кода профилей", () => {
  const route = readFileSync(join(root, "app/api/assortment-development/own-models/route.ts"), "utf8");
  assert.match(route, /requireApiSession\(ASSORTMENT_ROLES\)/);
  assert.match(route, /sessionHasCabinetAccess\(session, row\.cabinet_id\)/);
  assert.match(route, /ownModelsFor\(p, allowed\)/);
  assert.doesNotMatch(route.replace(/\/\*[\s\S]*?\*\//g, ""), /article|supplier_article/, "артикулы не читаются");
  assert.match(route, /\.select\("cabinet_id,nm_id,imt_id,name,brand"\)/);
  const lib = readFileSync(join(root, "lib/assortment/ownModels.ts"), "utf8");
  assert.doesNotMatch(lib.replace(/\/\*[\s\S]*?\*\//g, ""), /nmIds:|nm_ids|article/, "отчёт не содержит номеров WB");
  const view = readFileSync(join(root, "components/assortment/BrandProfiles.tsx"), "utf8");
  assert.match(view, /\/api\/assortment-development\/own-models\?direction=/);
});
