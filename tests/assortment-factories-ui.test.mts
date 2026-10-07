import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssortmentSection } from "../components/assortment/AssortmentSection.tsx";
import {
  ChecklistView, CompanyCandidates, FACTORY_PAGE, FactoriesBody, FactoriesIntro, FactoriesUnavailable, FactoryCardView, FactoryQuestions, FactoryReadingGuide, FactoryResults,
  FactorySearchForm, FlagChips, NoteView, RegistryView, SearchWait, ShortlistItemView, ShortlistSection, StatusEditor,
} from "../components/assortment/FactoriesView.tsx";
import { isFeedView, sectionViewFrom } from "../lib/assortment/catalog.ts";
import { CHINA_STOP_WORDS } from "../lib/assortment/china1688.ts";
import { cha88Payload, FACTORY_WORDS, parseCompanyRisk, parseCompanySearch, parseFactoryProducts, parseSourceSuppliers, readSupplierStream } from "../lib/assortment/factories1688.ts";
import { buildFactoryResult, FACTORY_SORTS, registryFacts, registryIndicators, sortFactoryCards, type FactoryCard, type FactoryIndicator } from "../lib/assortment/factoryCards.ts";
import { FACTORY_DISCLAIMER, FACTORY_PRICE_CAPTION, FACTORY_READING_GUIDE, FACTORY_SOURCE_LABEL, FACTORY_WAIT_TEXT, factoryQuestionsText, riskTypeLabel } from "../lib/assortment/factoryGuide.ts";
import { FACTORY_DAILY_CALLS, FACTORY_UNVERIFIED_NOTE, type CompanySearchResponse, type FactorySearchResponse } from "../lib/assortment/factorySearch.ts";
import { FACTORY_MIGRATION_WORDS, snapshotOf, type ShortlistItem, type ShortlistView, type StoredRegistry } from "../lib/assortment/factoryShortlist.ts";
import {
  CHECKLIST_VALUES, dateRu, dateTimeRu, FACTORIES_TAB_LABEL, FACTORY_CHECKLIST, FACTORY_READ_ONLY_WORDS, FACTORY_STATUS_LABEL, FACTORY_STATUSES, MAIN_INDICATORS, OWN_PLACE_INDICATORS,
  priceTiersText, SOURCE_LEGEND, sourceStateLine, splitIndicators, statusEditState,
} from "../lib/assortment/factoryUi.ts";

/**
 * «Фабрики (1688)» — экран: вкладка только в «Сумках», поиск, карточки фабрик (показатели по одному со своей меткой, цены и минимальная
 * партия, флаги чипами без счётчика, без общего балла), «Проверить компанию», шорт-лист (статусы, история, чек-лист без суммы),
 * «Вопросы фабрике», «Как читать показатели»; пустые и ошибочные состояния (навык недоступен ключу, нет ключа, нет миграции); права
 * (wb_manager — только просмотр). Разметка — статическим рендером; данные — образцы tests/fixtures/assortment-factories (source_suppliers
 * и 88查 — синтетика по исходникам официальных навыков, find.product — живой образец 07.10 с подставленными ценами и продавцами).
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const FIX = "tests/fixtures/assortment-factories";
const text = (name: string) => read(`${FIX}/${name}`);
const html = (el: ReactElement) => renderToStaticMarkup(el);
const flat = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const noop = () => undefined;
const count = (markup: string, re: RegExp) => (markup.match(new RegExp(re.source, `${re.flags.replace("g", "")}g`)) ?? []).length;

/** Вымышленные люди из образцов (legal_name 88查, имя в названии ИП, телефон, почта) — на экран не выходят ни при каком состоянии. */
const PEOPLE = ["张测试", "王测试", "李测试", "陈测试", "李明", "13800000000", "test@example.com"];
/** Признаки «общего балла»: число баллов, «из 10/100», рейтинг, score. */
const SCORE_RE = /\d\s*балл|из\s*10\b|из\s*100\b|\/\s*10\b|\/\s*100\b|рейтинг|score|итого/i;

const SUPPLIERS = parseSourceSuppliers(readSupplierStream(text("source-suppliers-single-json.txt")));
const OFFERS = parseFactoryProducts((JSON.parse(text("find-product-factories-bags.json")) as { data: unknown }).data);
const RESULT = buildFactoryResult(SUPPLIERS, OFFERS);
const COMPANY = RESULT.factories[0];
const IP = RESULT.factories.find((c) => c.entity === "individual") as FactoryCard;
const UNKNOWN = RESULT.factories.find((c) => c.entity === "unknown") as FactoryCard;
/** Фабрика только из поиска поставщиков: карточек товаров нет — у неё много «нет данных». */
const SUPPLIER_ONLY = RESULT.factories.find((c) => c.origin === "suppliers" && c.entity === "company") as FactoryCard;
const TIERED = [...RESULT.factories, ...RESULT.sellers].find((c) => (c.prices?.tiers.length ?? 0) > 0) as FactoryCard;
const SEARCH_ID = "11111111-2222-4333-8444-555555555555";
const CANDIDATES = parseCompanySearch(cha88Payload(text("cha88-company-search.json")));
const RISK = parseCompanyRisk(cha88Payload(text("cha88-company-risk.json")));
const FACTS = registryFacts(CANDIDATES.candidates[0], RISK, "2026-10-07");

const searchResp = (over: Partial<FactorySearchResponse> = {}): FactorySearchResponse => ({
  ok: true, refused: null, reason: null, searchId: SEARCH_ID, fromCache: false, cacheAvailable: true, createdAt: "2026-10-07T11:20:00.000Z", expiresAt: "2026-10-14T11:20:00.000Z",
  calls: 2, callsToday: 6, dailyCap: FACTORY_DAILY_CALLS, queryZh: "女包 真皮 狮岭", queryRu: "женская сумка из натуральной кожи", cluster: "shiling",
  sources: { suppliers: { status: "ok", reason: null, count: SUPPLIERS.length }, products: { status: "ok", reason: null, count: OFFERS.length } },
  factories: RESULT.factories, sellers: RESULT.sellers, notes: [FACTORY_UNVERIFIED_NOTE], ...over,
});

function stored(): StoredRegistry {
  const { indicators: _indicators, ...facts } = FACTS;
  return { ...facts, checkedBy: "buyer@clerin.test", checkedAt: "2026-10-07T10:00:00.000Z" };
}

function shortItem(card: FactoryCard, over: Partial<ShortlistItem> = {}): ShortlistItem {
  const company = card.entity === "company";
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001", factoryKey: card.key as string, entity: card.entity, displayName: company ? (card.name as string) : "Фабрика 1",
    name: company ? card.name : null, pseudonym: company ? null : "Фабрика 1", shopUrl: card.shopUrl, creditCode: null, province: card.province, city: card.city, cluster: card.cluster,
    offerIds: card.offers.map((o) => o.offerId), queryZh: "女包 真皮 狮岭", snapshot: snapshotOf(card), snapshotOn: "2026-10-05", status: "candidate", statusLabel: "Кандидат",
    rejectReason: null, history: [{ status: "candidate", reason: null, by: "buyer@clerin.test", at: "2026-10-05T08:10:00.000Z" }], checklist: {}, note: null, registry: null,
    createdBy: "buyer@clerin.test", createdAt: "2026-10-05T08:10:00.000Z", updatedAt: "2026-10-06T09:00:00.000Z", ...over,
  };
}

const WORKED = shortItem(COMPANY, {
  status: "video_call", statusLabel: "Видеозвонок", creditCode: "91440114MA59ABCD1X",
  history: [
    { status: "candidate", reason: null, by: "buyer@clerin.test", at: "2026-10-05T08:10:00.000Z" },
    { status: "contacted", reason: null, by: "buyer@clerin.test", at: "2026-10-05T12:40:00.000Z" },
    { status: "video_call", reason: null, by: "director@clerin.test", at: "2026-10-06T09:00:00.000Z" },
  ],
  checklist: {
    license_production: { value: "yes", by: "buyer@clerin.test", at: "2026-10-05T13:00:00.000Z" },
    insured_staff: { value: 48, by: "buyer@clerin.test", at: "2026-10-05T13:02:00.000Z" },
    sample_stitching: { value: "bad", by: "director@clerin.test", at: "2026-10-06T09:05:00.000Z" },
  },
  note: "Образец обещали за 7 дней, стоимость вернут при партии от 300 шт.",
  registry: stored(),
});
const REJECTED = shortItem(UNKNOWN, {
  id: "aaaaaaaa-0000-4000-8000-000000000002", status: "rejected", statusLabel: "Отклонена", rejectReason: "перепродавец: те же фото у десятка магазинов",
  history: [
    { status: "candidate", reason: null, by: "buyer@clerin.test", at: "2026-10-05T08:12:00.000Z" },
    { status: "rejected", reason: "перепродавец: те же фото у десятка магазинов", by: "buyer@clerin.test", at: "2026-10-06T10:00:00.000Z" },
  ],
});

const view = (over: Partial<ShortlistView> = {}): ShortlistView => ({
  tab: { visible: true, reason: null }, shortlist: { available: true, reason: null }, canEdit: true, items: [WORKED, REJECTED], ...over,
});

const cardHtml = (card: FactoryCard, over: Partial<Parameters<typeof FactoryCardView>[0]> = {}) => html(createElement(FactoryCardView, {
  card, canEdit: true, searchId: SEARCH_ID, shortlisted: null, adding: false, addError: null, onAdd: noop, onRegistrySaved: noop, ...over,
}));
const resultsHtml = (resp: FactorySearchResponse, over: Partial<Parameters<typeof FactoryResults>[0]> = {}) => html(createElement(FactoryResults, {
  resp, canEdit: true, shortlistAvailable: true, shortlisted: new Map(), onAdd: noop, onRegistrySaved: noop, ...over,
}));

/** Ячейка показателя: подпись и рядом — метка её источника (буква и расшифровка). */
function labelled(markup: string, indicator: Pick<FactoryIndicator, "label" | "source">): boolean {
  return new RegExp(`${esc(indicator.label)}</span><abbr title="${esc(FACTORY_SOURCE_LABEL[indicator.source])}"[^>]*>${indicator.source}</abbr>`).test(markup);
}

// ---------------------------------------------------------------------------
// Карточка фабрики

test("карточка фабрики: каждый показатель — отдельной ячейкой со своей меткой источника; пустые — строкой «Нет данных»; общего балла нет", () => {
  const out = cardHtml(COMPANY);
  const split = splitIndicators(COMPANY.indicators);
  assert.ok(split.main.length === MAIN_INDICATORS.length, "лицевая сторона — все показатели из MAIN_INDICATORS");
  for (const i of [...split.main, ...split.more]) assert.ok(labelled(out, i), `«${i.label}» — с меткой ${i.source}`);
  for (const key of ["prices", "moq"] as const) {
    const i = COMPANY.indicators.find((x) => x.key === key) as FactoryIndicator;
    assert.ok(labelled(out, i), `${key}: в блоке цен, с меткой Ф`);
  }
  const rank = COMPANY.indicators.find((i) => i.key === "rank") as FactoryIndicator;
  assert.match(flat(out), new RegExp(`${esc(rank.label)}: ${esc(rank.text)} Ф — релевантность запросу у 1688, а не качество фабрики`));
  for (const i of split.empty) assert.match(flat(out), new RegExp(`Нет данных: [^.]*${esc(i.label)}`), `${i.label}: «нет данных» названо`);
  const sparse = splitIndicators(SUPPLIER_ONLY.indicators);
  assert.ok(sparse.empty.length >= 3, "образец: у фабрики без карточек товаров есть пустые показатели");
  const sparseText = flat(cardHtml(SUPPLIER_ONLY));
  for (const i of sparse.empty) assert.match(sparseText, new RegExp(`Нет данных: [^.]*${esc(i.label)}`), `${i.label}: «нет данных» названо, а не пропало`);
  // Всего ячеек с меткой: лицевая сторона + «Все показатели» + цены и партия; больше ничего не сведено в одно число.
  assert.equal(count(out, /<dt /), split.main.length + split.more.length + 2);
  assert.doesNotMatch(flat(out), SCORE_RE, "общего балла фабрики нет");
  for (const source of new Set(COMPANY.indicators.map((i) => i.source))) assert.match(out, new RegExp(`<abbr title="${esc(FACTORY_SOURCE_LABEL[source])}"`));
  assert.match(out, /<details[^>]*>(?:(?!<\/details>).)*Все показатели · \d+/s, "остальные показатели — свёрнуто, а не выброшено");
});

test("карточка: цены и минимальная партия — с карточек 1688, со ступенями от партии и подписью «цена карточки, не ваше ТЗ»", () => {
  const out = flat(cardHtml(COMPANY));
  assert.match(out, /Цены карточек \(¥ за шт\.\) Ф ¥25,5–31 по 2 карточкам/);
  assert.match(out, /Минимальная партия Ф от 2 шт\. по 2 карточкам/);
  assert.match(out, new RegExp(esc(`${FACTORY_PRICE_CAPTION[0].toUpperCase()}${FACTORY_PRICE_CAPTION.slice(1)}.`)));
  assert.doesNotMatch(out, /Ступени цены/, "ступеней 1688 не прислал — строки нет");
  const tiered = flat(cardHtml(TIERED));
  assert.match(tiered, /Ступени цены от партии: от 100 шт\. — ¥88; от 500 шт\. — ¥80,5; от 1 000 шт\. — ¥76 Ф/);
  assert.equal(priceTiersText([{ minQty: 500, price: 80.5 }, { minQty: 100, price: 88 }]), "от 100 шт. — ¥88; от 500 шт. — ¥80,5", "ступени — по возрастанию партии");
  assert.equal(priceTiersText([]), null);
  // Карточки продавца: цена и партия у каждой, ссылки на 1688, фото — без отправки адреса панели.
  const markup = cardHtml(COMPANY);
  for (const o of COMPANY.offers) assert.match(markup, new RegExp(`href="${esc(o.detailUrl)}" target="_blank" rel="noopener noreferrer"`));
  assert.equal(count(markup, /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/i), COMPANY.offers.filter((o) => o.imageUrl).length);
  assert.match(flat(markup), /¥25,5–27,8 от 2 шт\./);
});

test("флаги — отдельными чипами со своей меткой, без счётчика; красные и жёлтые различимы", () => {
  const flagged = [...RESULT.factories, ...RESULT.sellers].find((c) => c.flags.length >= 2) as FactoryCard;
  const out = html(createElement(FlagChips, { flags: flagged.flags }));
  assert.equal(count(out, /<li /), flagged.flags.length, "один флаг — один чип");
  for (const f of flagged.flags) assert.match(out, new RegExp(`${esc(f.text)}</span><abbr title="${esc(FACTORY_SOURCE_LABEL[f.source])}"`));
  assert.doesNotMatch(flat(out), /\d+\s*флаг|флагов|флага/i, "счётчика флагов нет");
  assert.equal(html(createElement(FlagChips, { flags: [] })), "", "нет флагов — нет и блока");
  const red = html(createElement(FlagChips, { flags: [{ key: "quality_refunds", level: "red", source: "Ф", text: "r" }, { key: "young_shop", level: "yellow", source: "Ф", text: "y" }] }));
  assert.match(red, /bg-red-50[^>]*><span aria-hidden="true">●<\/span><span[^>]*>r</);
  assert.match(red, /bg-amber-50[^>]*><span aria-hidden="true">▲<\/span><span[^>]*>y</);
});

test("люди: у ИП и неясных — псевдоним и ссылка, их названия нет в разметке; legal_name, телефоны и почта не выходят ни в одном состоянии", () => {
  const ipName = SUPPLIERS.find((s) => s.companyName.includes("商行"))?.companyName as string;
  const ip = cardHtml(IP);
  assert.ok(!ip.includes(ipName), "название магазина ИП не показываем");
  assert.match(flat(ip), new RegExp(`${esc(IP.displayName)} .*ИП \\(个体工商户\\): название магазина не храним и не показываем — псевдоним и ссылка`));
  assert.doesNotMatch(ip, /Проверить компанию/, "ИП в реестре не проверяем");
  const unknown = flat(cardHtml(UNKNOWN));
  assert.match(unknown, /юрлицо или ИП — по названию не ясно/);
  const all = [
    html(createElement(FactoriesBody, { view: view(), onReload: noop, initialSearch: searchResp() })),
    html(createElement(CompanyCandidates, { resp: { ok: true, refused: null, reason: null, candidates: CANDIDATES.candidates, total: CANDIDATES.total, exactIndex: 0, calls: 1, callsToday: 1, dailyCap: 60 }, onPick: noop })),
    html(createElement(RegistryView, { indicators: FACTS.indicators, flags: FACTS.flags, caption: "x" })),
  ].join("");
  for (const p of PEOPLE) assert.ok(!all.includes(p), `на экране нет «${p}»`);
  assert.doesNotMatch(all, /legal_?name|законный представитель|телефон:|wechat:/i);
});

test("кнопки карточки — только у того, кто может: «В шорт-лист» — закупщику и директору при кэше поиска; «Проверить компанию» — только юрлицам; уже в шорт-листе — ссылка на запись", () => {
  const full = cardHtml(COMPANY);
  assert.match(full, />В шорт-лист</);
  assert.match(full, />Проверить компанию \(88查\)</);
  assert.match(full, new RegExp(`href="${esc(COMPANY.shopUrl as string)}"[^>]*>.*Магазин на 1688`));
  const viewer = cardHtml(COMPANY, { canEdit: false });
  assert.doesNotMatch(viewer, /В шорт-лист|Проверить компанию|<button/, "wb_manager: ни кнопок, ни серых кнопок");
  assert.doesNotMatch(cardHtml(COMPANY, { searchId: null }), />В шорт-лист</, "без кэша поиска (нет миграции) — кнопки нет");
  const done = cardHtml(UNKNOWN, { shortlisted: REJECTED });
  assert.doesNotMatch(done, />В шорт-лист</);
  assert.match(done, new RegExp(`href="#cn-factory-${REJECTED.id}"[^>]*>В шорт-листе как «Фабрика 1» · Отклонена<`), "псевдоним шорт-листа назван, если он другой");
  assert.match(cardHtml(COMPANY, { adding: true }), /aria-busy="true"[^>]*>Добавляем…</);
  assert.match(flat(cardHtml(COMPANY, { addError: "результат поиска не найден или старше 7 дней — повторите поиск" })), /Результат поиска не найден или старше 7 дней/);
});

// ---------------------------------------------------------------------------
// Выдача: блоки, сортировка, состояния источников, отказы

test("выдача: «Фабрики (поиск поставщиков)» и «Продавцы из выдачи товаров» раздельно; запрос, запросы к 1688 и оговорка «вживую не проверено» видны", () => {
  const out = resultsHtml(searchResp());
  const text = flat(out);
  assert.match(text, /Запрос: 女包 真皮 狮岭 — «женская сумка из натуральной кожи»/);
  assert.match(text, new RegExp(`Запросов к 1688: 2; сегодня 6 из ${FACTORY_DAILY_CALLS}`));
  assert.match(text, /Поиск поставщиков: 5 фабрик/);
  assert.match(text, /Поиск товаров: 12 карточек/);
  assert.match(text, /Поиск поставщиков и 88查 вживую не проверены/);
  assert.match(text, new RegExp(`Фабрики \\(поиск поставщиков\\) · ${RESULT.factories.length} фабрик`));
  assert.match(text, new RegExp(`Продавцы из выдачи товаров · ${RESULT.sellers.length} продавца`));
  for (const l of SOURCE_LEGEND) assert.match(text, new RegExp(`${l.source} ${esc(l.label)}`), "легенда меток — текстом (на касании title не виден)");
  const cached = flat(resultsHtml(searchResp({ fromCache: true, calls: 0, createdAt: "2026-10-05T08:00:00.000Z" })));
  assert.match(cached, /Из кэша от 05\.10\.2026, 11:00 — повтор за 7 дней без запросов к 1688/);
  assert.match(flat(resultsHtml(searchResp({ factories: [], sellers: [] }))), /1688 ничего не нашёл по этому запросу/);
});

test("сортировка — только по одному показателю: выбор из FACTORY_SORTS, по флагам и «баллу» сортировки нет; порядок карточек — sortFactoryCards", () => {
  const out = resultsHtml(searchResp(), { initialSort: "prices" });
  const options = [...out.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(options, Object.entries(FACTORY_SORTS).map(([k, v]) => [k, v.label]));
  assert.equal(count(out, /<select/), 1, "один выбор — один показатель");
  assert.doesNotMatch(options.map((o) => o[1]).join(" "), /флаг|балл|рейтинг/i);
  const names = [...flat(out).matchAll(/(广州市花都区狮岭镇明辉皮具有限公司|苏州市吴中区雅致箱包有限公司|义乌市晨光包袋有限公司|Фабрика \d)/g)].map((m) => m[1]);
  const expected = sortFactoryCards(RESULT.factories, "prices").map((c) => c.displayName);
  assert.deepEqual(names.slice(0, expected.length), expected, "блок фабрик — по цене, «нет данных» в конце");
});

test("поиск поставщиков недоступен нашему ключу — одна строка, блока фабрик нет, продавцы из выдачи товаров показаны", () => {
  const onlyProducts = buildFactoryResult([], OFFERS);
  const resp = searchResp({
    searchId: null, cacheAvailable: false, factories: [], sellers: onlyProducts.sellers,
    sources: { suppliers: { status: "unavailable", reason: FACTORY_WORDS.unavailable, count: null }, products: { status: "ok", reason: null, count: OFFERS.length } },
  });
  const text = flat(resultsHtml(resp));
  assert.match(text, /Поиск поставщиков: этот навык 1688 нашим ключом недоступен — ниже только продавцы из выдачи товаров/);
  assert.doesNotMatch(text, /Фабрики \(поиск поставщиков\)/, "пустой блок спрятан");
  assert.match(text, new RegExp(`Продавцы из выдачи товаров · ${onlyProducts.sellers.length}`));
  assert.deepEqual(sourceStateLine("products", { status: "rate_limit", reason: FACTORY_WORDS.rate_limit, count: null }), {
    text: `Поиск товаров: ${FACTORY_WORDS.rate_limit} — ниже только фабрики поиска поставщиков`, tone: "warn",
  });
  assert.deepEqual(sourceStateLine("suppliers", { status: "ok", reason: "1688 не нашёл фабрик по этому запросу", count: 0 }), { text: "Поиск поставщиков: 1688 не нашёл фабрик по этому запросу", tone: "warn" });
  assert.deepEqual(sourceStateLine("suppliers", { status: "ok", reason: null, count: 1 }), { text: "Поиск поставщиков: 1 фабрика", tone: "ok" });
});

test("отказы поиска — одна строка причины без карточек: нет ключа, дневной потолок, оба источника не ответили, нет учёта запросов", () => {
  const cases: Array<[FactorySearchResponse["refused"], string]> = [
    ["no_key", CHINA_STOP_WORDS.no_key],
    ["daily_cap", `дневной потолок запросов 1688 к фабрикам выбран: 60 из ${FACTORY_DAILY_CALLS} — повторите завтра`],
    ["failed", FACTORY_WORDS.unavailable],
    ["no_usage", "нет учёта запросов (assortment_ai_usage) — лимит запросов 1688 нечем считать, поиск не запускается"],
  ];
  for (const [refused, reason] of cases) {
    const out = resultsHtml(searchResp({ ok: false, refused, reason, factories: [], sellers: [] }));
    assert.match(out, /^<div role="alert"/, `${refused}: сообщение`);
    assert.equal(flat(out).trim(), `${reason[0].toUpperCase()}${reason.slice(1)}`, `${refused}: только причина`);
  }
});

// ---------------------------------------------------------------------------
// Вкладка целиком: нет ключа, нет миграции, права

test("нет ключа 1688: вкладка недоступна одной строкой; ожидание поиска — «1688 ищет фабрики… до минуты»; подпись «рекомендация ≠ решение»", () => {
  assert.equal(flat(html(createElement(FactoriesUnavailable, { reason: CHINA_STOP_WORDS.no_key }))).trim(), "Фабрики 1688 недоступны: ключ 1688 не задан (ALI_1688_AK).");
  assert.match(html(createElement(SearchWait)), new RegExp(`role="status".*${esc(FACTORY_WAIT_TEXT)}`));
  assert.equal(FACTORY_WAIT_TEXT, "1688 ищет фабрики… до минуты");
  const intro = flat(html(createElement(FactoriesIntro)));
  assert.match(intro, new RegExp(esc(FACTORY_DISCLAIMER)));
  assert.match(intro, /Общего балла фабрики нет/);
  assert.match(intro, /Цены и минимальная партия — с карточек 1688/);
});

test("нет миграции: шорт-лист скрыт с причиной, «В шорт-лист» в выдаче нет, поиск работает", () => {
  const out = html(createElement(FactoriesBody, { view: view({ shortlist: { available: false, reason: FACTORY_MIGRATION_WORDS }, items: [] }), onReload: noop, initialSearch: searchResp() }));
  const text = flat(out);
  assert.match(text, /Шорт-лист фабрик не создан — нужна миграция 202610070010_assortment_cn_factories\.sql\./);
  assert.doesNotMatch(out, />В шорт-лист</, "кнопки нет даже при searchId — шорт-листа нет");
  assert.match(out, /Фабрики \(поиск поставщиков\)/);
  assert.match(out, /aria-label="Поиск фабрик на 1688"/);
  const empty = flat(html(createElement(ShortlistSection, { available: true, reason: null, items: [], canEdit: true, onItem: noop, onReload: noop })));
  assert.match(empty, /Шорт-лист фабрик · 0 Пока пусто\. Нажмите «В шорт-лист» у фабрики из выдачи — запишется снимок её показателей и цен на сегодня\./);
});

test("права: wb_manager видит шорт-лист, но не поиск и не правку — ни формы, ни выбора статуса, ни кнопок чек-листа, ни заметки, ни 88查", () => {
  const viewer = html(createElement(FactoriesBody, { view: view({ canEdit: false }), onReload: noop }));
  const text = flat(viewer);
  assert.match(text, new RegExp(esc(FACTORY_READ_ONLY_WORDS)));
  assert.doesNotMatch(viewer, /aria-label="Поиск фабрик на 1688"|Найти|Перевести/);
  assert.doesNotMatch(viewer, /<select|<textarea|<input|aria-pressed|Проверить компанию|Сохранить/, "только просмотр — без элементов правки");
  assert.match(text, /广州市花都区狮岭镇明辉皮具有限公司 Видеозвонок/);
  assert.match(text, /Видеозвонок — director@clerin\.test, 06\.10\.2026, 12:00/, "история видна");
  assert.match(text, /Лицензия: производство по сумкам[^]*?да buyer@clerin\.test, 05\.10\.2026, 16:00/);
  assert.match(text, /Число застрахованных сотрудников \(参保人数\) 48 buyer@clerin\.test/);
  assert.match(text, /Видеозвонок из цеха не отмечено/);
  assert.match(text, /Заметка: Образец обещали за 7 дней/);

  const editor = html(createElement(FactoriesBody, { view: view(), onReload: noop }));
  assert.match(editor, /aria-label="Поиск фабрик на 1688"/);
  assert.equal(count(editor, /<option value="(candidate|contacted|video_call|sample_ordered|sample_received|approved|rejected)"/), FACTORY_STATUSES.length * 2, "выбор статуса у каждой записи");
  assert.equal(count(editor, /aria-pressed="(true|false)"/), 2 * FACTORY_CHECKLIST.filter((i) => i.kind !== "number").reduce((n, i) => n + CHECKLIST_VALUES[i.kind as "yesno" | "grade"].length, 0) + 3, "кнопки чек-листа у обеих записей (+3 чипа кластеров)");
  assert.equal(count(editor, /<textarea/), 2);
  assert.match(editor, />Проверить компанию заново \(88查\)</, "юрлицо уже проверено — «заново»");
  assert.doesNotMatch(flat(html(createElement(ShortlistItemView, { item: REJECTED, canEdit: true, onItem: noop, onReload: noop }))), /Проверить компанию/, "у неясного — без 88查");
});

// ---------------------------------------------------------------------------
// Шорт-лист

test("шорт-лист: статус, история «кто и когда», снимок на дату добавления с ценами и флагами, реестр с метками Р, ссылки; отклонённые — свёрнуто с причиной", () => {
  const out = html(createElement(ShortlistSection, { available: true, reason: null, items: [WORKED, REJECTED], canEdit: true, onItem: noop, onReload: noop }));
  const text = flat(out);
  assert.match(text, /Шорт-лист фабрик · 2/);
  assert.match(text, /Добавлена 05\.10\.2026, 11:10, buyer@clerin\.test; снимок показателей и цен — на 05\.10\.2026, запрос «女包 真皮 狮岭»/);
  assert.match(text, /Единый кредитный код: 91440114MA59ABCD1X Р/);
  assert.match(text, /История статусов · 3 Видеозвонок — director@clerin\.test, 06\.10\.2026, 12:00 Написали — buyer@clerin\.test, 05\.10\.2026, 15:40 Кандидат/);
  assert.match(text, /Цены карточек \(¥ за шт\.\) Ф ¥25,5–31/);
  assert.match(text, /Показатели на 05\.10\.2026 · \d+/);
  assert.match(text, /Реестр КНР \(88查\) — проверено 07\.10\.2026, buyer@clerin\.test/);
  for (const i of registryIndicators(WORKED.registry as StoredRegistry)) assert.ok(labelled(out, i), `реестр: «${i.label}» с меткой Р`);
  assert.match(text, /недобросовестный должник \(失信被执行人\) Р/);
  assert.match(out, new RegExp(`href="${esc(WORKED.shopUrl as string)}"`));
  assert.match(out, /<details[^>]*><summary[^>]*>Отклонённые · 1<\/summary>/);
  assert.match(text, /Причина отклонения: перепродавец: те же фото у десятка магазинов/);
  assert.match(text, /Отклонена — buyer@clerin\.test, 06\.10\.2026, 13:00 · причина: перепродавец/);
  assert.match(out, new RegExp(`id="cn-factory-${WORKED.id}"`), "якорь для ссылки «В шорт-листе» из выдачи");
  assert.doesNotMatch(text, SCORE_RE);
});

test("сохранённая проверка реестра показывается теми же словами, что свежая: registryIndicators по фактам без показателей = registryFacts", () => {
  assert.deepEqual(registryIndicators(stored()), FACTS.indicators);
  const risks = FACTS.indicators.find((i) => i.key === "regRisks") as FactoryIndicator;
  assert.match(risks.text, /^5: нарушения в деятельности \(经营异常\) — 2 \(последний 2026-03-02\); недобросовестный должник \(失信被执行人\) — 1/);
  assert.equal(riskTypeLabel("行政处罚"), "административное взыскание (行政处罚)");
  assert.equal(riskTypeLabel("新类型"), "新类型", "незнакомый тип — как есть");
});

test("чек-лист: каждый пункт отдельно со своей отметкой «кто и когда», без суммы и итога; число застрахованных — поле, остальное — кнопки", () => {
  const out = html(createElement(ChecklistView, { item: WORKED, canEdit: true, onSave: noop }));
  const text = flat(out);
  for (const point of FACTORY_CHECKLIST) assert.match(text, new RegExp(esc(point.label)), point.key);
  assert.equal(count(out, /role="group"/), FACTORY_CHECKLIST.filter((i) => i.kind !== "number").length);
  assert.match(out, /<input inputMode="numeric"[^>]*value="48"/);
  assert.match(text, /Образец: швы хорошо приемлемо плохо не ясно плохо — director@clerin\.test, 06\.10\.2026, 12:05/);
  assert.match(out, /aria-pressed="true"[^>]*>плохо</);
  assert.match(text, /Чек-лист проверки Ч/);
  assert.doesNotMatch(text, /\d+\s*из\s*\d+|отмечено\s*\d|\d+\s*%|итог:|сумма:/i, "суммы и доли пройденного нет");
  assert.match(out, /^<details/, "чек-лист свёрнут: на телефоне не занимает экран");
});

test("статус ставит человек: «Сохранить статус» — только когда выбран другой; «Отклонена» — только с причиной (иначе подсказка, кнопки нет)", () => {
  const item = WORKED;
  assert.deepEqual(statusEditState(item, "video_call", ""), { changed: false, ready: false, needReason: false });
  assert.deepEqual(statusEditState(item, "sample_ordered", ""), { changed: true, ready: true, needReason: false });
  assert.deepEqual(statusEditState(item, "rejected", "  "), { changed: true, ready: false, needReason: true });
  assert.deepEqual(statusEditState(item, "rejected", "дорого"), { changed: true, ready: true, needReason: false });
  assert.deepEqual(statusEditState(REJECTED, "rejected", REJECTED.rejectReason as string), { changed: false, ready: false, needReason: false });
  assert.deepEqual(statusEditState(REJECTED, "rejected", "другая причина"), { changed: true, ready: true, needReason: false }, "смена причины — тоже правка");
  const same = html(createElement(StatusEditor, { item, onSave: noop }));
  assert.doesNotMatch(same, /Сохранить статус/);
  for (const s of FACTORY_STATUSES) assert.match(same, new RegExp(`<option value="${s}"[^>]*>${FACTORY_STATUS_LABEL[s]}</option>`));
  assert.match(html(createElement(StatusEditor, { item, onSave: noop, initial: { status: "approved" } })), />Сохранить статус</);
  const noReason = html(createElement(StatusEditor, { item, onSave: noop, initial: { status: "rejected" } }));
  assert.match(flat(noReason), /Отклонить можно только с причиной/);
  assert.doesNotMatch(noReason, /<button/, "без причины кнопки нет — подсказка");
});

test("заметка: у закупщика — поле с напоминанием «без контактов», кнопка — только при изменении; у wb_manager — только текст", () => {
  const edit = flat(html(createElement(NoteView, { item: WORKED, canEdit: true, onSave: noop })));
  assert.match(edit, /Заметка \(без телефонов, WeChat и почты — контакты людей не храним\)/);
  assert.doesNotMatch(edit, /Сохранить заметку/);
  assert.equal(html(createElement(NoteView, { item: REJECTED, canEdit: false, onSave: noop })), "", "пустую заметку не показываем");
});

// ---------------------------------------------------------------------------
// 88查, вопросы фабрике, «Как читать»

test("88查 на экране: кандидаты — у ИП ни названия, ни кнопки рисков; точное совпадение отмечено; тёзок сверяет человек; отказ — строкой", () => {
  const resp: CompanySearchResponse = { ok: true, refused: null, reason: null, candidates: CANDIDATES.candidates, total: CANDIDATES.total, exactIndex: 0, calls: 1, callsToday: 7, dailyCap: 60 };
  const out = html(createElement(CompanyCandidates, { resp, onPick: noop }));
  const text = flat(out);
  assert.match(text, /Реестр КНР \(88查\): найдено 3\. Сверьте город и район — у тёзок они разные/);
  assert.match(text, /广州市花都区狮岭镇明辉皮具有限公司 название совпало целиком Р/);
  assert.match(text, /ИП \(个体工商户\) — название и код не храним Р/);
  const companies = CANDIDATES.candidates.filter((c) => c.entity !== "individual" && c.name && c.creditCode).length;
  assert.equal(count(out, />Это она — проверить риски</), companies, "риски — только по юрлицам");
  assert.doesNotMatch(html(createElement(CompanyCandidates, { resp, busy: true, onPick: noop })), /Это она/, "пока идёт проверка — второй не запускается");
  const refused = flat(html(createElement(CompanyCandidates, { resp: { ...resp, ok: false, refused: "not_company", reason: "проверка в реестре — только для юрлиц (…有限公司): у ИП название не храним", candidates: [] }, onPick: noop })));
  assert.equal(refused.trim(), "Проверка в реестре — только для юрлиц (…有限公司): у ИП название не храним");
  const reg = flat(html(createElement(RegistryView, { indicators: FACTS.indicators, flags: FACTS.flags, caption: "проверено 07.10.2026" })));
  assert.match(reg, /недобросовестный должник \(失信被执行人\) Р ● нарушения в деятельности \(经营异常\) за последний год: 2026-03-02 Р/);
  assert.match(reg, /Уставный капитал Р 500万 \(人民币\) легко подогнать — не опора/);
});

test("«Вопросы фабрике»: текст на китайском с русским переводом и кнопка «Скопировать»; отправляет человек сам — экран ничего не шлёт", () => {
  const { zh, ru } = factoryQuestionsText();
  const out = html(createElement(FactoryQuestions));
  assert.ok(out.includes(`<pre lang="zh" class="${(/<pre lang="zh" class="([^"]+)"/.exec(out) as RegExpExecArray)[1]}">${zh}</pre>`), "китайский текст целиком");
  assert.ok(out.includes(ru), "русский перевод целиком");
  assert.match(flat(out), /Скопировать текст по-китайски/);
  assert.match(flat(out), /панель ничего не отправляет/);
  const src = read("components/assortment/FactoriesView.tsx");
  const questions = src.slice(src.indexOf("export function FactoryQuestions("), src.indexOf("export function FactoryReadingGuide("));
  assert.match(questions, /navigator\.clipboard\.writeText\(zh\)/);
  assert.doesNotMatch(questions, /fetch\(|postJson/, "копирование — без запросов");
});

test("«Как читать показатели» — свёрнутый блок: все пояснения порогов и меток, легенда источников", () => {
  const out = html(createElement(FactoryReadingGuide));
  assert.match(out, /^<details class="[^"]*"><summary[^>]*>Как читать показатели<\/summary>/, "свёрнуто (без open)");
  for (const line of FACTORY_READING_GUIDE) assert.ok(flat(out).includes(line), line.slice(0, 40));
  for (const l of SOURCE_LEGEND) assert.match(flat(out), new RegExp(`${l.source} ${esc(l.label)}`));
});

test("форма поиска: «Перевести» — когда есть русский текст, «Найти» — когда есть китайский; кластер дописывается к запросу видимо", () => {
  const emptyForm = html(createElement(FactorySearchForm, { busy: false, onSearch: noop }));
  assert.doesNotMatch(emptyForm, />Перевести<|type="submit"/, "кнопок без условия нет");
  const empty = flat(emptyForm);
  assert.match(empty, /Напишите запрос по-русски и нажмите «Перевести» или сразу по-китайски — появится «Найти»/);
  const ru = html(createElement(FactorySearchForm, { busy: false, onSearch: noop, initial: { queryRu: "сумка-мешок" } }));
  assert.match(ru, />Перевести</);
  assert.doesNotMatch(ru, /type="submit"/);
  const zh = html(createElement(FactorySearchForm, { busy: false, onSearch: noop, initial: { queryZh: "女包 真皮", cluster: "shiling" } }));
  assert.match(zh, /<button type="submit"[^>]*>.*Найти<\/button>/);
  assert.match(flat(zh), /Шилин \(Гуанчжоу, Хуаду\) — средний и высокий сегмент, OEM; к запросу допишется «狮岭»/);
  assert.match(zh, /aria-pressed="true"[^>]*>Шилин <span lang="zh">狮岭<\/span>/);
  assert.match(zh, /<input lang="zh"[^>]*value="女包 真皮"/, "китайский запрос виден и правится");
  assert.doesNotMatch(html(createElement(FactorySearchForm, { busy: true, onSearch: noop, initial: { queryZh: "女包" } })), /type="submit"/, "пока ищем — второй поиск не запускается");
  assert.doesNotMatch(html(createElement(FactorySearchForm, { busy: false, onSearch: noop, initial: { queryZh: "bag" } })), /type="submit"/, "латиница — не запрос для 1688");
});

// ---------------------------------------------------------------------------
// Раздел, роут, граница клиента

test("вкладка «Фабрики (1688)» — только в «Сумках»: в «Куртках» нет ни вкладки, ни запроса; без ключа (count=1) вкладки нет; по адресу — открыта", () => {
  assert.equal(sectionViewFrom({ view: "factories" }, "bags"), "factories");
  assert.equal(sectionViewFrom({ view: "factories" }, "jackets"), "new", "у курток ?view=factories — «Новинки»");
  assert.equal(isFeedView("factories"), false, "это не лента находок");
  assert.match(read("app/assortment-development/bags/page.tsx"), /sectionViewFrom\(params, "bags"\)/);
  assert.match(read("app/assortment-development/jackets/page.tsx"), /sectionViewFrom\(params, "jackets"\)/);
  const src = read("components/assortment/AssortmentSection.tsx");
  assert.match(src, /if \(direction !== "bags"\) return;\n\s+let cancelled = false;\n\s+fetch\(`\/api\/assortment-development\/factories\/shortlist\?direction=bags&count=1`\)/, "в «Куртках» запроса нет");
  assert.match(src, /direction === "bags" && \(factoriesVisible \|\| factoriesCountFailed \|\| view === "factories"\) \? \[\{ id: "factories" as const, label: FACTORIES_TAB_LABEL \}\]/);
  assert.match(src, /\{view === "factories" && direction === "bags" && <FactoriesView \/>\}/);
  const plain = html(createElement(AssortmentSection, { direction: "bags" }));
  assert.doesNotMatch(plain, new RegExp(esc(FACTORIES_TAB_LABEL)), "до ответа count=1 вкладки нет");
  const opened = html(createElement(AssortmentSection, { direction: "bags", initialView: "factories" }));
  assert.match(opened, /aria-selected="true"[^>]*>Фабрики \(1688\)<\/button>/);
  assert.match(flat(opened), /Загружаем фабрики…/);
  assert.doesNotMatch(flat(opened), /Загружаем ленту/);
  const jackets = html(createElement(AssortmentSection, { direction: "jackets", initialView: "factories" }));
  assert.doesNotMatch(jackets, new RegExp(esc(FACTORIES_TAB_LABEL)));
  assert.match(jackets, /aria-selected="true"[^>]*>Новинки<\/button>/);
});

test("роут шорт-листа: ?count=1 — только «есть ли вкладка» без базы (ключ и раздел), остальное — как было", () => {
  const route = read("app/api/assortment-development/factories/shortlist/route.ts");
  const get = route.slice(route.indexOf("export async function GET("), route.indexOf("export async function POST("));
  const countAt = get.indexOf('if (request.nextUrl.searchParams.get("count") === "1") return NextResponse.json({ tab, canEdit }, { headers: NO_STORE });');
  assert.ok(countAt > 0, "ветка count=1 есть");
  assert.ok(get.indexOf("requireApiSession(ASSORTMENT_ROLES)") < countAt, "под ролями модуля");
  assert.ok(countAt < get.indexOf("getSupabaseAdmin()"), "без базы");
  assert.ok(get.indexOf("factoriesTab(") < countAt, "вкладка — по ключу и разделу");
});

test("граница клиента: экран и его справочники не тянут серверные модули (node:crypto, база, клиент 1688) — только типы", () => {
  const files = ["components/assortment/FactoriesView.tsx", "lib/assortment/factoryUi.ts", "lib/assortment/factoryCards.ts", "lib/assortment/factoryGuide.ts"];
  for (const file of files) {
    const src = read(file);
    const imports = [...src.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gms)].map((m) => ({ type: Boolean(m[1]), from: m[2] }));
    for (const imp of imports) {
      assert.ok(!imp.from.startsWith("node:"), `${file}: ${imp.from}`);
      if (/factorySearch|factoryShortlist|factories1688|china1688|chinaSync|supabase|engineBudget/.test(imp.from)) assert.ok(imp.type, `${file}: из ${imp.from} — только import type`);
    }
  }
  const view = read("components/assortment/FactoriesView.tsx");
  assert.match(view, /^"use client";/);
  const urls = [...view.matchAll(/postJson\("([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(urls)], ["check-company", "search", "shortlist"], "экран зовёт только свои роуты");
  assert.doesNotMatch(view, /sourcing[-_]inquiry|procurement|utp[-_]shopping|88syt|distributingoffer|skills-gateway|ALI_1688_AK/);
  assert.doesNotMatch(read("components/assortment/ChinaView.tsx"), /factor|PriceBlock|priceMin/i, "в трендах «Китай (1688)» цен и продавцов по-прежнему нет");
});

test("помощники экрана: лицевая сторона — постоянный порядок; № в выдаче, цены и партия — на своих местах; ничего не теряется; даты — по Москве", () => {
  for (const card of [COMPANY, SUPPLIER_ONLY, IP]) {
    const split = splitIndicators(card.indicators);
    assert.deepEqual(split.main.map((i) => i.key), [...MAIN_INDICATORS]);
    const shown = [...split.main, ...split.more, ...split.empty].map((i) => i.key);
    assert.deepEqual([...shown, ...OWN_PLACE_INDICATORS].sort(), card.indicators.map((i) => i.key).sort(), `${card.displayName}: каждый показатель — ровно в одном месте`);
    assert.ok(split.empty.every((i) => i.empty) && split.more.every((i) => !i.empty));
  }
  // Время записи — по Москве при любом поясе машины (у сервера Vercel — UTC, у ноутбука владельца — МСК).
  const tz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    assert.equal(dateTimeRu("2026-10-06T21:30:00.000Z"), "07.10.2026, 00:30", "время записи — по Москве");
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
  assert.equal(dateTimeRu("не дата"), "—");
  assert.equal(dateRu("2026-10-05"), "05.10.2026");
  assert.equal(FACTORY_PAGE, 6);
  const many = { ...searchResp(), sellers: [], factories: Array.from({ length: FACTORY_PAGE + 2 }, (_, i) => ({ ...COMPANY, key: `url:k${i}`, n: i + 1, displayName: `Фабрика ${i + 1}` })) };
  const out = flat(resultsHtml(many));
  assert.match(out, /Показать ещё 2 из 2/);
  assert.doesNotMatch(out, /Фабрика 7 /, "дальше шестой — по кнопке");
});
