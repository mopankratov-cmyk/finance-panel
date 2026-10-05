import assert from "node:assert/strict";
import test from "node:test";
import { BAG_FORMS, buildFormsReport, CONCENTRATION_MIN_MODELS, formOf, JACKET_FORMS, MIN_SOURCE_MODELS, normalizeTitle, traitsOf, type FormModel } from "../lib/assortment/forms.ts";

const jacket = (title: string) => formOf("jackets", title)?.key ?? null;
const bag = (title: string) => formOf("bags", title)?.key ?? null;

// Названия — реальные, из каталога на проде (04.10.2026).
test("Куртки: форма по названию на английском, русском и немецком", () => {
  assert.equal(jacket("FAUX LEATHER CROP BIKER JACKET"), "biker", "специальная форма важнее общей «jacket»");
  assert.equal(jacket("Oversized Drawstring-Waist Jacket"), "jacket");
  assert.equal(jacket("Вязаный бомбер на молнии"), "bomber");
  assert.equal(jacket("Бомбер D-силуэта как из бумаги"), "bomber");
  assert.equal(jacket("Oversized Twill Trench"), "trench");
  assert.equal(jacket("FUNNEL-NECK TRENCH JACKET"), "trench", "trench jacket — тренч");
  assert.equal(jacket("Плащ из хлопка"), "trench", "плащ — тренч/плащ");
  assert.equal(jacket("Ultra Light Down Jacket"), "puffer");
  assert.equal(jacket("Daunenjacke"), "puffer", "немецкая витрина Zalando");
  assert.equal(jacket("Kunstlederjacke"), "jacket", "материал — не форма: просто куртка");
  assert.equal(jacket("Winterjacke"), "jacket");
  assert.equal(jacket("Lederjacke"), "jacket");
  assert.equal(jacket("Weste"), "vest");
  assert.equal(jacket("BLOCKTECH Parka"), "parka");
  assert.equal(jacket("Hybrid Down Coat"), "puffer", "пуховое пальто — пуховик");
  assert.equal(jacket("Wool-Blend Tie-Belt Coat"), "coat");
  assert.equal(jacket("Шерстяное полупальто с шарфом и рукавами-кейп"), "coat");
  assert.equal(jacket("Джинсовая куртка из хлопка и лиоцелла"), "denim");
  assert.equal(jacket("OVERSIZED DENIM JACKET"), "denim");
  assert.equal(jacket("Стеганая куртка-подложка"), "quilted");
  assert.equal(jacket("Long Storm Breaker"), "windbreaker", "Rains: storm breaker — ветровка");
  assert.equal(jacket("Анорак из твила"), "windbreaker");
  assert.equal(jacket("Blazer"), "blazer");
  assert.equal(jacket("Куртка-рубашка из хлопка"), "overshirt");
  assert.equal(jacket("Плащ-кейп как из бумаги"), "trench", "плащ в начале названия решает");
});

test("Буква «й»: normalizeTitle превращает её в «и», поэтому «блейзер», «кейп», «дутый» и «оверсайз» должны находиться — и находятся; ни одно правило не содержит «й» (иначе оно не совпало бы никогда)", () => {
  assert.equal(normalizeTitle("Блейзер Кейп Дутый Оверсайз"), "блеизер кеип дутыи оверсаиз", "й → и: правила пишутся по нормализованному тексту");
  assert.equal(jacket("Блейзер из шерсти"), "blazer", "раньше уходил в «название не называет форму»");
  assert.equal(jacket("Двубортный блейзер"), "blazer");
  assert.equal(jacket("Кейп из шерсти"), "cape");
  assert.equal(jacket("Кейп-жилет"), "vest", "жилет в названии решает раньше кейпа — порядок правил не менялся");
  assert.equal(jacket("Дутый жилет"), "vest");
  assert.equal(jacket("Куртка дутый крой"), "puffer", "«дутый» — пуховик, а не просто куртка");
  assert.equal(traitsOf("jackets", "Куртка оверсайз").fit, "oversized", "оверсайз по-русски попадает в «Уточнения из названий»");
  assert.equal(traitsOf("jackets", "Oversize jacket").fit, "oversized");
  for (const rule of [...JACKET_FORMS, ...BAG_FORMS]) assert.doesNotMatch(rule.re.source, /[йЙ]/, `правило «${rule.key}» содержит «й» — по нормализованному тексту оно не совпадёт никогда`);
});

test("Куртки: порядок правил — жилет и косуха важнее материала и общей формы", () => {
  assert.equal(jacket("Puffer Vest"), "vest", "puffer vest — жилет, а не пуховик");
  assert.equal(jacket("Padded Gilet"), "vest");
  assert.equal(jacket("Quilted Bomber Jacket"), "bomber");
  assert.equal(jacket("Faux Fur Coat"), "fur", "эко-мех важнее общего «пальто»");
  assert.equal(jacket("Teddy Coat"), "fleece");
  assert.equal(jacket("Куртка"), "jacket");
  assert.equal(normalizeTitle("  Numéro   Dix – Ёлка "), "numero dix – елка");
});

test("Сумки: форма по названию, включая немецкий, русский и сокращения Zara", () => {
  assert.equal(bag("XXL LEATHER TOTE BAG"), "tote");
  assert.equal(bag("Umhängetasche"), "crossbody");
  assert.equal(bag("LTHR BCKT BG 11"), "bucket", "сокращение Zara: bucket bag");
  assert.equal(bag("LTHR CRSSBDY BG 11"), "crossbody", "сокращение Zara");
  assert.equal(bag("Medium Luna Hobo Bag"), "hobo");
  assert.equal(bag("PEARL MINAUDIERE"), "clutch");
  assert.equal(bag("Jenny Human-shaped Handle Handbag - Black"), "bag", "название не называет форму");
  assert.equal(bag("Carmen Top Handle Bag - Brown"), "top_handle");
  assert.equal(bag("Women's Mini Bucket Bag"), "bucket");
  assert.equal(bag("Сумка-шоппер с принтом"), "tote");
  assert.equal(bag("Сумка-шопер"), "tote", "одна и две «п»");
  assert.equal(bag("Lucia Classic Top Handle Woven Bag - White"), "top_handle", "плетёная — материал, форма названа ручками");
  assert.equal(bag("Сумка кавер миди"), "bag");
  assert.equal(bag("Cosima Vanity Case - Chocolate Brown"), null, "«Case» без слова сумка — форма не называется");
  assert.equal(bag("Mini Drippy Roof Bag"), "bag");
  assert.equal(bag("Canvas Convertible Pouch"), "pouch");
  assert.equal(bag("Backpack"), "backpack");
  assert.equal(bag("Sibu Wash Bag"), "pouch", "wash bag — косметичка, а не просто сумка");
});

test("Имена моделей без слова о форме — «не определена», а не догадка (Polène)", () => {
  for (const title of ["Numéro Un - Textured Black", "Numéro Dix - Onda Cognac", "Cyme Mini - Textured Camel", "Boky - Textured Black Cherry", "Béri - Onda Black"]) {
    assert.equal(bag(title), null, title);
  }
  assert.equal(formOf("bags", ""), null);
  assert.equal(formOf("bags", null), null);
});

test("Признаки-уточнения: длина, посадка, капюшон, материал, размер сумки", () => {
  assert.deepEqual(traitsOf("jackets", "FAUX LEATHER CROP BIKER JACKET"), { length: "cropped", fit: null, hooded: false, material: "leather", size: null });
  assert.deepEqual(traitsOf("jackets", "Oversized hooded long coat"), { length: "long", fit: "oversized", hooded: true, material: null, size: null });
  assert.equal(traitsOf("jackets", "SHORT SLEEVE SAFARI SHIRT").length, null, "short sleeve — не «укороченная куртка»");
  assert.equal(traitsOf("jackets", "LIGHTWEIGHT QUILTED SHORT COAT").length, "cropped");
  assert.equal(traitsOf("jackets", "Куртка с капюшоном").hooded, true);
  assert.equal(traitsOf("jackets", "Замшевая куртка").material, "suede");
  assert.equal(traitsOf("bags", "Mini Song Bag").size, "small");
  assert.equal(traitsOf("bags", "XXL LEATHER TOTE BAG").size, "large");
  assert.equal(traitsOf("bags", "Medium Luna Hobo Bag").size, null, "medium — не маленькая и не большая");
  assert.equal(traitsOf("bags", "Cyme - Raffia Laurel").material, "woven");
});

const mk = (sourceId: string, titles: string[]): FormModel[] => titles.map((title) => ({ sourceId, sourceName: sourceId, title }));

test("Нормировка: большой каталог не делает форму сильнее — средняя доля по источникам", () => {
  // Большой источник Z (40 моделей) почти весь — бомберы; три маленьких (по 10) — бомберы лишь у одного из десяти.
  const models = [
    ...mk("Z", [...Array(36).fill("Бомбер"), ...Array(4).fill("Пальто")]),
    ...mk("A", [...Array(1).fill("Бомбер"), ...Array(9).fill("Пальто")]),
    ...mk("B", [...Array(1).fill("Бомбер"), ...Array(9).fill("Пальто")]),
    ...mk("C", [...Array(1).fill("Бомбер"), ...Array(9).fill("Пальто")]),
  ];
  const report = buildFormsReport("jackets", models);
  const bomber = report.rows.find((r) => r.key === "bomber")!;
  assert.equal(bomber.models, 39);
  assert.equal(bomber.share, 55.7, "доля каталога: 39 из 70 — раздута большим источником");
  // Среднее по источникам: (36/40 + 1/10 + 1/10 + 1/10) / 4 = 0,3 → 30%.
  assert.equal(bomber.avgSourceShare, 30, "средняя доля по источникам: источники весят поровну");
  assert.equal(bomber.sources, 4);
  assert.equal(bomber.topSourceShare, 92.3, "36 из 39 — у одного источника");
  assert.equal(bomber.concentrated, true, "почти всё у одного — это ассортимент бренда, а не распространение формы");
});

test("Маленькие источники в среднюю долю не входят: одна модель из трёх — не «33% формы»", () => {
  const models = [...mk("BIG", [...Array(MIN_SOURCE_MODELS).fill("Бомбер")]), ...mk("TINY", ["Пальто", "Пальто", "Бомбер"])];
  const report = buildFormsReport("jackets", models);
  assert.equal(report.sourcesInAverage, 1, "TINY (3 модели) не входит");
  const bomber = report.rows.find((r) => r.key === "bomber")!;
  assert.equal(bomber.avgSourceShare, 100, "считаем только по BIG");
  assert.equal(buildFormsReport("jackets", mk("S", ["Бомбер"])).rows[0].avgSourceShare, null, "нет источников с достаточным каталогом — среднего нет, а не 100%");
});

test("Концентрация: форма у многих источников — не сосредоточена; мало моделей — судить рано", () => {
  const spread = buildFormsReport("jackets", [...mk("A", Array(3).fill("Тренч")), ...mk("B", Array(3).fill("Тренч")), ...mk("C", Array(3).fill("Тренч"))]);
  assert.equal(spread.rows[0].concentrated, false);
  assert.equal(spread.rows[0].sources, 3);
  const few = buildFormsReport("jackets", mk("A", Array(CONCENTRATION_MIN_MODELS - 1).fill("Тренч")));
  assert.equal(few.rows[0].concentrated, false, "меньше шести моделей — не называем форму сосредоточенной");
  assert.equal(buildFormsReport("jackets", mk("A", Array(CONCENTRATION_MIN_MODELS).fill("Тренч"))).rows[0].concentrated, true);
});

test("Охват: общие «куртка»/«сумка» и неопределённые считаются отдельно, знаменатель — все модели", () => {
  const report = buildFormsReport("bags", [
    ...mk("P", ["Numéro Un - Black", "Cyme - Raffia", "Boky"]),
    ...mk("Z", ["TOTE BAG", "BAG", "Umhängetasche"]),
  ]);
  assert.equal(report.models, 6);
  assert.equal(report.recognized, 3, "TOTE, BAG и Umhängetasche; «Cyme - Raffia» — рафия это материал, форма не названа");
  assert.equal(report.specific, 2, "TOTE и Umhängetasche — конкретные; «BAG» — общая");
  assert.equal(report.coverage, 50);
  assert.equal(report.specificCoverage, 33.3);
  assert.equal(report.unrecognized.count, 3);
  assert.ok(report.unrecognized.samples.includes("Numéro Un - Black"), "показываем, что не определилось — для проверки глазами");
  const tote = report.rows.find((r) => r.key === "tote")!;
  assert.equal(tote.share, 16.7, "доля — от всех 6 моделей, а не от опознанных");
  // Конкретные формы выше общих.
  assert.equal(report.rows[report.rows.length - 1].generic, true);
  // Рафия — признак материала, а не форма.
  assert.equal(report.traits.find((t) => t.key === "woven")?.models, 1);
});

test("Пустой каталог: отчёт без делений на ноль", () => {
  const report = buildFormsReport("jackets", []);
  assert.equal(report.models, 0);
  assert.equal(report.coverage, 0);
  assert.deepEqual(report.rows, []);
  assert.equal(report.sourcesInAverage, 0);
});
