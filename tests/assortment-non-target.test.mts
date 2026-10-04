import assert from "node:assert/strict";
import test from "node:test";
import { classifyItem, nonTargetHead, type CatalogItem } from "../lib/assortment/crawl.ts";

const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({ sourceItemId: "1", handle: "h", title: "x", productType: "", tags: [], publishedAt: null, ...over });

// Названия — реальные, из каталога на проде (04.10.2026): всё это попало в «куртки» и «сумки».
const GARBAGE = [
  // Rains: штаны со словом «puffer», посуда, чехлы для техники, головной убор, плед
  "Sarna Puffer Pants", "Lohja Insulated Pants", "Puffer Blanket", "Texel Laptop Case 15″/16″", "Trail Laptop Case 13″/14″",
  "Stainless Steel Tumbler Vacuum Flask 2000ml", "Stainless Steel 2-Pack Cups 300ml", "Sapa Knit Beanie",
  // Zara: ремни, юбка, брюки, рубашка
  "EMBOSSED LEATHER BELT", "LEATHER DRESS BELT", "CORDUROY BOTTOM SKIRT", "PANTS WITH A HIGH WAIST", "SHORT SLEEVE SAFARI SHIRT",
  // JW PEI: платья со словом «shoulder» (сорок три в «сумках»), чехол для очков, платье-костюм
  "Aurelius Wrap-Around Shoulder 3D Floral Mini Dress - Pink", "Knit Off-Shoulder Maxi Dress - Cream",
  "Ruched One-Shoulder Maxi Dress with Trailing Sash - Green", "Celeste Woven Textured Glasses Case – Black",
  "Ophelia One-shoulder Embroidered Iace Dress Suit - White",
  // сайты РФ: головное слово не куртка
  "Брюки прямые", "Платье миди", "Юбка плиссе", "Джинсы клеш", "Футболка оверсайз",
  // Хвост после существительного (цвет, размер, «Set», разделитель) не прячет мусор: решает САМОЕ ПРАВОЕ известное слово.
  "Puffer Pants Black", "Puffer Pants XS", "Puffer Pants Set", "Puffer Pants / Black", "Puffer Pants: Black", "(NEW) Puffer Pants", "Puffer Pants - Чёрный",
  // Модификатор «shoulder»/«shell»/«puffer»/«bomber»/«bucket» — не форма: топ, украшение, головной убор, обувь, аксессуары к сумке.
  "Off-Shoulder Top", "Bershka cold shoulder top", "Shell Necklace", "Bomber Cap", "Puffer Joggers", "Bucket Loafers", "Backpack Rain Cover",
  "Tote Bag Organizer", "Laptop Sleeve", "Shoulder Pads", "Bag Hook", "Bag Strap",
];

// Эти названия содержат «стоп-слова», но главное слово — куртка или сумка. Ложное исключение прячет настоящую модель.
const KEEP = [
  "SHORT COAT WITH SCARF DETAIL", "LIGHTWEIGHT QUILTED SHORT COAT", "TRENCH JACKET WITH BELT DETAIL", "FAUX SUEDE JACKET WITH BELT",
  "SHIRT TRENCH COAT", "CROP KNIT COAT WITH ASYMMETRICAL SCARF", "Scarf-Detail Jacket",
  "Cosima Vanity Case - Chocolate Brown", "Lucia Classic Top Handle Woven Bag - White", "Suva Hardshell Long Jacket", "Sibu Wash Bag",
  "Mango faux croc leather jacket in black", "Hana Large Tote Bag - Dark Brown", "Jenny Human-shaped Handle Handbag - Black",
  "Джинсовая куртка", "Джинсовая куртка из хлопка и лиоцелла", "Куртка-толстовка плюшевая с воротником-стойкой",
  "Толстовка-бомбер из ткани интерлок", "Шерстяное полупальто с шарфом и рукавами-кейп", "Куртка стеганая утепленная с проволокой и шарфик",
  "Сумка с ремнём", "Шуба из искусственного меха", "Сумка для обуви", "Жакет", "Пиджак двубортный",
  // Слова «belt», «strap», «hat», «scarf», «wallet» в названии СУМКИ — деталь, а не предмет (раньше такие сумки терялись целиком).
  "Belt Bag", "ASOS DESIGN bum bag with belt detail in black", "Bag with chain strap", "Mini Shoulder Bag with Detachable Strap",
  "Hat Box Bag", "Shoulder Bag with Scarf", "Tote Bag with Hat", "Wallet on Chain Bag", "Fanny Pack", "Bag for Shoes", "Garment Bag for Dresses",
  // Нераспознанные разделители («w/», «+», «&») не должны делать главным словом хвост.
  "Jacket w/ Belt", "Trench Coat + Belt", "Coat & Scarf",
  // Куртка с «shoulder»/«duffel»/«bag» в названии — куртка, а не сумка.
  "Duffel Coat", "Blazer with Shoulder Pads", "Sleeping bag puffer coat", "Drop Shoulder Wool Coat", "Puffer Overshirt",
];

test("Мусор в «куртках» и «сумках» (штаны, платья, посуда, ремни, чехлы) определяется по главному слову", () => {
  for (const title of GARBAGE) assert.equal(nonTargetHead(title), true, title);
});

test("Куртка и сумка со «стоп-словом» в названии остаются: решает главное слово, а не любое", () => {
  for (const title of KEEP) assert.equal(nonTargetHead(title), false, title);
});

test("Пустое название — не мусор: решает остальное (тип, теги)", () => {
  assert.equal(nonTargetHead(""), false);
  assert.equal(nonTargetHead(null), false);
  assert.equal(nonTargetHead(undefined), false);
});

test("classifyItem: слово «puffer» или «shoulder» больше не затягивает штаны и платья в раздел", () => {
  assert.equal(classifyItem(item({ title: "Sarna Puffer Pants", productType: "Pants" }), ["jackets", "bags"]), null);
  assert.equal(classifyItem(item({ title: "Knit Off-Shoulder Maxi Dress - Cream", productType: "Dress" }), ["bags"]), null);
  assert.equal(classifyItem(item({ title: "Texel Laptop Case 15″/16″", tags: ["bags"] }), ["bags"]), null, "тег «bags» не спасает чехол для ноутбука");
  // А настоящие модели классифицируются, как раньше.
  assert.equal(classifyItem(item({ title: "Puffer Jacket" }), ["jackets", "bags"]), "jackets");
  assert.equal(classifyItem(item({ title: "Lucia Classic Top Handle Woven Bag - White" }), ["bags"]), "bags");
  assert.equal(classifyItem(item({ title: "Cosima Vanity Case - Chocolate Brown", productType: "Handbags" }), ["bags"]), "bags");
  assert.equal(classifyItem(item({ title: "Джинсовая куртка" }), ["jackets"]), "jackets");
  assert.equal(classifyItem(item({ title: "Shell Bag Large" }), ["jackets", "bags"]), "bags", "прежнее правило: «Shell Bag» — сумка");
});

test("Главное слово решает раздел: куртка со «shoulder» или «duffel» — не сумка, сумка с «belt» — не мусор", () => {
  const both: Array<"jackets" | "bags"> = ["jackets", "bags"];
  assert.equal(classifyItem(item({ title: "Duffel Coat" }), both), "jackets", "duffel coat — пальто, а не дафл-сумка");
  assert.equal(classifyItem(item({ title: "Blazer with Shoulder Pads" }), both), "jackets");
  assert.equal(classifyItem(item({ title: "ASOS DESIGN padded shoulder blazer in black" }), ["bags"]), null, "пиджак при поиске сумок — не наш раздел, а не сумка");
  assert.equal(classifyItem(item({ title: "Belt Bag" }), ["bags"]), "bags", "поясная сумка — сумка, а не ремень");
  assert.equal(classifyItem(item({ title: "Bag with chain strap" }), ["bags"]), "bags");
  assert.equal(classifyItem(item({ title: "Zara SHOULDER BAG WITH CHAIN STRAP", productType: "BOLSO" }), ["bags"]), "bags");
  assert.equal(classifyItem(item({ title: "Jacket w/ Belt" }), both), "jackets");
  assert.equal(classifyItem(item({ title: "Puffer Pants Black" }), both), null);
  assert.equal(classifyItem(item({ title: "Fanny Pack" }), ["bags"]), "bags");
  assert.equal(classifyItem(item({ title: "Жакет" }), ["jackets"]), "jackets");
  assert.equal(classifyItem(item({ title: "Card Holder", productType: "Small leather goods" }), ["bags"]), null, "тип и теги по-прежнему решают, когда слово не распознано");
});
