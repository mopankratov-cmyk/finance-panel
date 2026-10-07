import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { China1688Error, contentMd5, FIND_PRODUCT_PATH, parseFindProduct } from "../lib/assortment/china1688.ts";
import {
  areaOf, callSkillsGateway, cha88Payload, companyRiskBody, companySearchBody, COMPANY_RISK_PATH, COMPANY_SEARCH_PATH, countOf, factoryErrorState, FACTORY_WORDS,
  factoryProductsBody, isoDayOf, listField, makeFactoryCallers, parseCompanyRisk, parseCompanySearch, parseFactoryProducts, parseSourceSuppliers, priceRangeOf,
  priceTiersOf, readSupplierStream, RISK_PAGE_SIZE, satisfiedOf, shopUrlOf, SOURCE_SUPPLIERS_PATH, splitJsonObjects, supplierRecords, supplierResultOrThrow,
  type FactoryOffer,
} from "../lib/assortment/factories1688.ts";
import {
  brandMentions, buildFactoryResult, categoryGroup, FACTORY_SORTS, factoryKeyOf, fullYears, normalizeCompanyName, parseSortKey, quartileOf, registryFacts,
  RESELLERS_MIN_PUHUO, RESELLERS_MIN_SELLERS, sortFactoryCards, type FactoryCard,
} from "../lib/assortment/factoryCards.ts";
import { factorySellerKey } from "../lib/assortment/factorySearch.ts";
import {
  clusterOf, entityFromName, FACTORY_CLUSTER_CHIPS, FACTORY_DISCLAIMER, FACTORY_QUESTIONS, FACTORY_READING_GUIDE, FACTORY_SOURCE_LABEL, factoryQuestionsText, outsideBagProvinces,
  parseClusterKey, regionLabel, tagLabel,
} from "../lib/assortment/factoryGuide.ts";

/**
 * «Фабрики сумок (1688)» — клиент навыков (подпись, поток, ошибки), разбор ответов (вырезание людей, цены только в режиме фабрик),
 * показатели, флаги, четверти, сведение источников, сортировка, реестр. Образцы source_suppliers и 88查 — синтетика по исходникам
 * официальных навыков (вживую не проверено), find.product — живой образец 07.10 с подставленными ценами и продавцами.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const FIX = "tests/fixtures/assortment-factories";
const text = (name: string) => read(`${FIX}/${name}`);
const json = (name: string) => JSON.parse(text(name)) as Record<string, unknown>;
const PRODUCTS = json("find-product-factories-bags.json").data;
const REAL_BAGS = JSON.parse(read("tests/fixtures/assortment-china/find-product-niche-yexiabao-sold-desc.json")).data;

const FAKE_SECRET = "TestSecretTestSecretTestSecret12";
const FAKE_ID = "testkeyid000000001";
const FAKE_AK = Buffer.from(FAKE_SECRET + FAKE_ID, "utf8").toString("base64url");
const ENV = { ALI_1688_AK: FAKE_AK };

/** Вымышленные имена-маркеры образцов: ни одно не должно дойти до выхода (у ИП — псевдоним, legal_name и тексты дел — вырезаны). */
const PEOPLE = ["张测试", "王测试", "李测试", "陈测试", "李明", "13800000000", "test@example.com"];

/** Ошибка 1688 нужного вида — по имени и виду: тестовый загрузчик может держать две копии модуля china1688 (как в assortment-china). */
const isKind = (kind: string) => (e: unknown) => (e as { name?: string } | null)?.name === "China1688Error" && (e as { kind?: string }).kind === kind;

const suppliers = () => parseSourceSuppliers(readSupplierStream(text("source-suppliers-single-json.txt")));
const offers = () => parseFactoryProducts(PRODUCTS);
const SELLER_KEY = factorySellerKey(ENV);

// ---------------------------------------------------------------------------
// Поток поиска поставщиков

test("поток source_suppliers: три формы официального клиента и куски SSE дают одни и те же фабрики; пустая фаза RETRIEVAL пропускается", () => {
  const names = (raw: string) => parseSourceSuppliers(readSupplierStream(raw)).map((f) => f.companyName);
  const expected = ["广州市花都区狮岭镇明辉皮具有限公司", "白沟新城华美箱包厂", "苏州市吴中区雅致箱包有限公司", "广州市白云区李明皮具商行", "义乌市晨光包袋有限公司"];
  assert.deepEqual(names(text("source-suppliers-single-json.txt")), expected, "форма 1: originResponses сверху; первая RETRIEVAL пустая — берётся следующая");
  assert.deepEqual(names(text("source-suppliers-nested.txt")), expected, "форма 2: data.result.originResponses");
  assert.deepEqual(names(text("source-suppliers-model.txt")), expected, "форма 3: data.result.model");
  assert.deepEqual(names(text("source-suppliers-sse.txt")), expected, "куски «data: {...}» — фазы собираются");
  const chunks = text("source-suppliers-single-json.txt");
  assert.deepEqual(names(`${chunks.slice(0, 40)}${chunks.slice(40)}`), expected, "склейка кусков — один JSON");
  assert.throws(() => readSupplierStream("не json"), isKind("service"));
  assert.deepEqual(supplierRecords({ success: true, originResponses: [{ currentPhase: "RETRIEVAL", responseData: { data: [] } }] }), []);
});

test("разбор объектов подряд: скобки внутри строк не путают границы, битый кусок пропускается", () => {
  const parts = splitJsonObjects('data: {"a":"}{"}\n\ndata: {"b":1}{bad}{"c":{"d":2}}');
  assert.deepEqual(parts, [{ a: "}{" }, { b: 1 }, { c: { d: 2 } }]);
});

test("запись фабрики: № в выдаче вместо score, поля терпимы к форме (строка JSON, массив, перечисление), без названия — не берётся, повтор — один раз", () => {
  const list = suppliers();
  assert.equal(list.length, 5);
  assert.deepEqual(list.map((f) => f.rank), [1, 2, 3, 4, 5]);
  assert.ok(!JSON.stringify(list).includes("score") && !JSON.stringify(list).includes("0.97"), "score 1688 наружу не выходит");
  const [a, b, c, d, e] = list;
  assert.deepEqual(a.oemModes, ["OEM", "ODM"]);
  assert.deepEqual(a.manufactureTypes, ["包工包料"]);
  assert.equal(a.proofing, true);
  assert.equal(a.satisfiedPct, 98);
  assert.equal(a.monthBuyers, 356);
  assert.equal(a.companyUrl, "https://sale.1688.com/factory/card.html?memberId=b2b-0000000001");
  assert.deepEqual(b.oemModes, ["OEM"], "массив вместо строки JSON");
  assert.deepEqual(b.manufactureTypes, ["清加工"], "голая строка");
  assert.equal(b.proofing, null, "«N» — не «нет», а «нет данных»: отсутствие отметки не значит, что образцов не делают");
  assert.equal(b.satisfiedPct, 95, "0.95 → 95%");
  assert.equal(b.companyUrl, "https://shop-test2.1688.com/page/creditdetail.htm", "http → https, хост строчными");
  assert.deepEqual(c.oemModes, [], "нет OEM — запись остаётся («не указано»), а не выбрасывается молча");
  assert.equal(c.monthBuyers, 12_000, "«1.2万+» → 12 000");
  assert.deepEqual(d.oemModes, ["OEM", "ODM"], "перечисление через запятую");
  assert.equal(e.companyUrl, null, "javascript: — не ссылка на 1688");
});

test("ссылки, списки, числа, проценты, даты, район — по белому списку формы", () => {
  assert.equal(shopUrlOf("https://evil.com/1688.com"), null);
  assert.equal(shopUrlOf("https://1688.com.evil.com/"), null);
  assert.equal(shopUrlOf("https://user:pw@shop1.1688.com/"), null);
  assert.equal(shopUrlOf("https://shop1.1688.com/page#x"), "https://shop1.1688.com/page");
  assert.deepEqual(listField('["A","A","null",""]'), ["A"]);
  assert.equal(countOf("2万+"), 20_000);
  assert.equal(countOf("abc"), null);
  assert.deepEqual(satisfiedOf("满意度97.5%"), { text: "满意度97.5%", pct: 97.5 });
  assert.equal(isoDayOf("2015/3/2"), "2015-03-02");
  assert.equal(isoDayOf(1420070400000), "2015-01-01");
  assert.equal(areaOf("广东省广州市花都区狮岭镇芙蓉大道18号3栋201"), "广东省广州市花都区");
  assert.equal(areaOf("浙江省金华市义乌市稠城街道工人北路1号"), "浙江省金华市义乌市");
  assert.equal(areaOf("河北省保定市白沟新城和道国际箱包城"), "河北省保定市");
  assert.ok(!/路|号|栋/.test(areaOf("广东省广州市白云区XX路XX超市1号") ?? ""), "улица и дом не попадают");
});

// ---------------------------------------------------------------------------
// Ошибки

test("ошибки навыка: 401, APIUnsupported и 1688_no_scope_specified — «этот навык нашим ключом недоступен» одной строкой; 429 / Qos — подождать", () => {
  const state = (raw: string) => {
    const result = readSupplierStream(raw);
    try {
      cha88Payload(JSON.stringify(result));
      return null;
    } catch (error) {
      return factoryErrorState(error);
    }
  };
  assert.deepEqual(state(text("source-suppliers-error-401.txt")), { status: "unavailable", reason: FACTORY_WORDS.unavailable });
  assert.deepEqual(state(text("source-suppliers-error-unsupported.txt")), { status: "unavailable", reason: FACTORY_WORDS.unavailable });
  assert.deepEqual(state(text("source-suppliers-error-noscope.txt")), { status: "unavailable", reason: FACTORY_WORDS.unavailable });
  assert.equal(state(text("source-suppliers-error-qos.txt"))?.status, "rate_limit");
  assert.equal(factoryErrorState(new China1688Error("x", "rate_limit", null, 429)).status, "rate_limit");
  assert.equal(factoryErrorState(new China1688Error("1688: временный сбой (HTTP 503)", "transient", null, 503)).status, "error");
  assert.equal(factoryErrorState(new Error("x")).status, "error");
  assert.equal(factoryErrorState(new China1688Error("k", "no_key")).status, "no_key");
});

interface FakeResponse { status: number; body: string }
function fakeFetch(responses: Array<FakeResponse | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("подставка: ответы кончились");
    if (next instanceof Error) throw next;
    return { status: next.status, ok: next.status === 200, text: async () => next.body, json: async () => JSON.parse(next.body) } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("вызов skills-gateway: подпись x-csk-* с версией 1.0.0, точное тело, без заголовков навыка gateway; ключ не уходит; без ключа — запроса нет", async () => {
  const f = fakeFetch([{ status: 200, body: text("source-suppliers-sse.txt") }]);
  const raw = await callSkillsGateway(SOURCE_SUPPLIERS_PATH, { query: "女包 源头工厂" }, { env: ENV, fetchImpl: f.impl });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://skills-gateway.1688.com/api/1688_source_suppliers/1.0.0");
  const headers = f.calls[0].init.headers as Record<string, string>;
  assert.equal(headers["x-csk-version"], "1.0.0");
  assert.equal(headers["x-csk-ak"], FAKE_ID);
  assert.equal(headers["x-csk-content-md5"], contentMd5(JSON.stringify({ query: "女包 源头工厂" })));
  assert.equal(headers["x-skill-code"], undefined);
  assert.equal(f.calls[0].init.body, JSON.stringify({ query: "女包 源头工厂" }));
  assert.ok(!JSON.stringify(f.calls[0]).includes(FAKE_SECRET) && !JSON.stringify(f.calls[0]).includes(FAKE_AK));
  assert.ok(raw.startsWith("data:"));

  const none = fakeFetch([]);
  await assert.rejects(callSkillsGateway(COMPANY_SEARCH_PATH, {}, { env: {}, fetchImpl: none.impl }), isKind("no_key"));
  assert.equal(none.calls.length, 0);

  for (const [status, kind] of [[401, "auth"], [429, "rate_limit"], [503, "transient"], [403, "service"]] as const) {
    const g = fakeFetch([{ status, body: "" }, { status: 200, body: "{}" }]);
    await assert.rejects(callSkillsGateway(COMPANY_RISK_PATH, {}, { env: ENV, fetchImpl: g.impl }), isKind(kind));
    assert.equal(g.calls.length, 1, `HTTP ${status}: без повтора — на поиск не больше двух запросов`);
  }
});

test("вызовы фабрик: поиск товаров без повтора (503 — один запрос), тело как у снимка ниш; 88查 — page/pageSize строками; success:false поиска поставщиков — ошибка", async () => {
  const f = fakeFetch([{ status: 503, body: "" }, { status: 200, body: JSON.stringify({ success: true, data: PRODUCTS }) }]);
  const callers = makeFactoryCallers({ env: ENV, fetchImpl: f.impl });
  await assert.rejects(callers.products("女包 工厂"), isKind("transient"));
  assert.equal(f.calls.length, 1, "повтора нет");
  assert.equal(f.calls[0].url, `https://gateway.1688.com${FIND_PRODUCT_PATH}`);
  assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), factoryProductsBody("女包 工厂"));
  assert.deepEqual(factoryProductsBody("x"), { query: "x", pageSize: 40, purchaseAmount: 1, sortType: "sold_desc", scoreLevel: "high", tags: "4306497" });
  assert.deepEqual(companySearchBody("某公司"), { query: "某公司", pageNo: 1, pageSize: 10 });
  assert.deepEqual(companyRiskBody("91440114MA59ABCD1X"), { companyId: "", pageSize: "50", page: "1", socialCreditCode: "91440114MA59ABCD1X" });
  assert.equal(RISK_PAGE_SIZE, 50, "риски — 50 одной страницей (официальный клиент берёт 10)");

  const s = fakeFetch([{ status: 200, body: text("source-suppliers-error-unsupported.txt") }]);
  await assert.rejects(makeFactoryCallers({ env: ENV, fetchImpl: s.impl }).suppliers("女包"), (e: unknown) => factoryErrorState(e).status === "unavailable");
  const r = fakeFetch([{ status: 200, body: text("cha88-company-risk.json") }]);
  const risk = await makeFactoryCallers({ env: ENV, fetchImpl: r.impl }).companyRisk("91440114MA59ABCD1X");
  assert.equal(parseCompanyRisk(risk).total, 5);
});

test("поиск поставщиков: ответ без success:true — ошибка, как у официального клиента (код шлюза — по нему, без кода — «без признака успеха»), а не пустая выдача", async () => {
  const noScope = fakeFetch([{ status: 200, body: text("source-suppliers-no-success.txt") }]);
  await assert.rejects(makeFactoryCallers({ env: ENV, fetchImpl: noScope.impl }).suppliers("女包"), (e: unknown) => factoryErrorState(e).status === "unavailable");
  const junk = fakeFetch([{ status: 200, body: '{"result":{"items":[]}}' }]);
  await assert.rejects(makeFactoryCallers({ env: ENV, fetchImpl: junk.impl }).suppliers("女包"), (e: unknown) => isKind("service")(e) && /без признака успеха/.test((e as Error).message));
  assert.throws(() => supplierResultOrThrow(readSupplierStream('data: {"note":"busy"}\n\ndata: {"x":1}\n')), /без признака успеха/, "куски без фаз и без success — не успех");
  assert.throws(() => supplierResultOrThrow(readSupplierStream('data: {"code":"QosApiFrequencyLimit","message":"m"}\n')), isKind("rate_limit"));
  assert.equal(supplierResultOrThrow(readSupplierStream(text("source-suppliers-sse.txt"))).success, true, "куски с фазами — успех");
  const empty = { success: true, originResponses: [] };
  assert.deepEqual(parseSourceSuppliers(supplierResultOrThrow(empty)), [], "success:true без фабрик — честное «1688 не нашёл»");
});

// ---------------------------------------------------------------------------
// Режим фабрик: цены и свойства магазина — только здесь

test("сторож: трендовый разбор parseFindProduct не изменился — в нём нет ни цен, ни партии, ни продавцов, ни показателей магазина", () => {
  const trend = JSON.stringify(parseFindProduct(PRODUCTS));
  for (const leak of ["25.5", "27.8", "88", "priceMin", "moq", "quantityBegin", "明辉", "陈测试", "repeatRate", "shop", "merchant", "currentPrice"]) {
    assert.ok(!trend.includes(`"${leak}`) && !trend.includes(leak === "88" ? "\"88\"" : leak), `в трендах нет «${leak}»`);
  }
  const factory = JSON.stringify(parseFactoryProducts(PRODUCTS));
  for (const fact of ["\"priceMin\":25.5", "\"priceMax\":27.8", "\"moq\":2", "\"repeatRate\":0.71", "广州市花都区狮岭镇明辉皮具有限公司"]) assert.ok(factory.includes(fact), fact);
});

test("карточки для фабрик: строки SKU сворачиваются по номеру (цена — от минимума до максимума), ступени цены — только списком, флаги priceTags — не ступени", () => {
  const list = offers();
  assert.equal(list.length, 12, "13 строк — 12 карточек");
  const first = list[0];
  assert.equal(first.offerId, "975160314318");
  assert.equal(first.position, 1);
  assert.deepEqual([first.priceMin, first.priceMax], [25.5, 27.8]);
  assert.equal(first.moq, 2);
  assert.equal(first.detailUrl, "https://detail.1688.com/offer/975160314318.html");
  assert.equal(first.invoice, "special");
  assert.equal(first.officialInspection, true);
  assert.equal(first.payLater, true);
  assert.equal(first.ship48h, true);
  assert.equal(first.qualityRefundPct, 0);
  assert.deepEqual(first.shop, { years: 7, repeatRate: 0.71, customerScale: 9765, officialPartner: false });
  assert.deepEqual(first.priceTiers, [], "is_price_stable_30d и прочие флаги — не ступени");
  const tiered = list.find((o) => o.offerId === "893598870921");
  assert.deepEqual(tiered?.priceTiers, [{ minQty: 100, price: 88 }, { minQty: 500, price: 80.5 }, { minQty: 1000, price: 76 }]);
  assert.equal(list.find((o) => o.offerId === "925926365867")?.invoice, null, "kp_type «null» — нет данных");
  assert.deepEqual(priceRangeOf("PRICE"), null, "обезличенная цена — не цена");
  assert.deepEqual(priceRangeOf("12.8-15"), [12.8, 15]);
  assert.deepEqual(priceTiersOf([{ beginAmount: 2, price: "9.9" }, { beginAmount: "x", price: 1 }]), [{ minQty: 2, price: 9.9 }]);
  const real = parseFactoryProducts(REAL_BAGS);
  assert.equal(real.length, 40, "живой образец разбирается");
  assert.ok(real.every((o) => o.priceMin == null), "в обезличенном живом образце цен нет (PRICE)");
  assert.ok(real.every((o) => o.shop && o.shop.years != null), "свойства магазина читаются из живого ответа");
});

test("передача курьеру за 24 ч: поля нет — null, а не 0; 0 у 1688 не отличить от «нет данных» — на карточке «нет данных», а не 0%", () => {
  const rows = (PRODUCTS as { data: Array<Record<string, unknown>> }).data;
  const strip = (row: Record<string, unknown>, lgt: unknown) => ({ ...row, serviceTags: { ...(row.serviceTags as Record<string, unknown>), lgt_3m_24h_avg: lgt } });
  const parsed = parseFactoryProducts({ data: [strip(rows[0], undefined), strip(rows[2], "0")] });
  assert.deepEqual(parsed.map((o) => o.ship24h), [null, 0], "нет поля — null; «0» — как дал 1688");
  const card = buildFactoryResult([], parsed).sellers[0];
  const ship = card.indicators.find((i) => i.key === "ship24h");
  assert.deepEqual([ship?.empty, ship?.text, ship?.value], [true, "нет данных", null], "0 и null — «нет данных», а не 0%");
  const real = buildFactoryResult([], parseFactoryProducts({ data: [strip(rows[0], "0.5"), strip(rows[2], "0")] })).sellers[0];
  assert.equal(real.indicators.find((i) => i.key === "ship24h")?.text, "50%", "медиана — только по значениям больше нуля");
});

test("много перепродавцов (铺货): четверть — только при 8+ продавцах со значением, флаг — только от 20 размещений; 1 размещение — не «много»", () => {
  const base = offers()[0];
  const mk = (i: number, puhuo: number | null): FactoryOffer => ({ ...base, offerId: String(1000000000 + i), position: i + 1, seller: `某${"甲乙丙丁戊己庚辛壬癸"[i]}皮具有限公司`, puhuo30d: puhuo, titleZh: "托特包" });
  const small = buildFactoryResult([], [0, 0, 0, 1].map((v, i) => mk(i, v))).sellers;
  assert.deepEqual(small.flatMap((c) => c.flags.map((f) => f.key)).filter((k) => k === "resellers_top"), [], "4 продавца, у лидера 1 размещение — флага нет");
  assert.equal(small[3].indicators.find((i) => i.key === "puhuo")?.text, "1", "без четверти на малой выборке");
  assert.equal(quartileOf(1, [0, 0, 0, 1], RESELLERS_MIN_SELLERS), null);
  assert.equal(quartileOf(1, [0, 0, 0, 1]), 4, "у остальных показателей порог прежний — 4 значения");
  const eight = (top: number) => buildFactoryResult([], [0, 1, 2, 3, 4, 5, 6, top].map((v, i) => mk(i, v))).sellers[7];
  assert.equal(RESELLERS_MIN_SELLERS, 8);
  assert.equal(RESELLERS_MIN_PUHUO, 20);
  assert.deepEqual(eight(19).flags.map((f) => f.key), [], "верхняя четверть, но 19 размещений — не «много»");
  assert.match(eight(19).indicators.find((i) => i.key === "puhuo")?.text ?? "", /^19 · верхняя четверть выдачи$/);
  const many = eight(25);
  assert.deepEqual(many.flags.map((f) => [f.key, f.level, f.source]), [["resellers_top", "yellow", "О"]]);
  assert.match(many.flags[0].text, /25 размещений 铺货 за 30 дней — верхняя четверть выдачи/);
  const live = buildFactoryResult([], parseFactoryProducts(JSON.parse(read("tests/fixtures/assortment-china/find-product-niche-nvshi-jiake-sold-desc.json")).data));
  const flagged = [...live.factories, ...live.sellers].filter((c) => c.flags.some((f) => f.key === "resellers_top"));
  assert.ok(flagged.every((c) => (c.indicators.find((i) => i.key === "puhuo")?.value ?? 0) >= RESELLERS_MIN_PUHUO), "живой образец курток: флаг не ставится на 9 размещениях");
});

test("ключ фабрики один для всех поисков: юрлицо — по нормализованному названию, ИП — псевдоним-HMAC с секретом сервера (имени в ключе нет)", () => {
  assert.equal(factoryKeyOf("广州市（花都）皮具 有限公司", "company"), factoryKeyOf("广州市(花都)皮具有限公司", "company"));
  assert.equal(factoryKeyOf("陈测试", "individual", SELLER_KEY), factoryKeyOf(" 陈测试 ", "individual", SELLER_KEY), "тот же продавец — тот же ключ");
  assert.notEqual(factoryKeyOf("陈测试", "individual", SELLER_KEY), factoryKeyOf("王测试", "individual", SELLER_KEY));
  assert.equal(factoryKeyOf("陈测试", "individual", null), null, "без секрета — без ключа");
  assert.equal(factoryKeyOf("陈测试", "individual", () => "陈测试"), null, "функция, вернувшая имя, ключом не станет");
  const other = factorySellerKey({ ALI_1688_AK: Buffer.from(`${"Q".repeat(32)}otherkeyid0000001`, "utf8").toString("base64url") });
  assert.notEqual(other?.("陈测试"), SELLER_KEY?.("陈测试"), "псевдоним — с секретом: по словарю имён его не подобрать");
  assert.equal(factorySellerKey({ ...ENV, ASSORTMENT_FACTORY_SALT: "salt-1" })?.("陈测试"), factorySellerKey({ ASSORTMENT_FACTORY_SALT: "salt-1", ALI_1688_AK: "x" })?.("陈测试"), "своя соль — ключ 1688 можно менять");
  assert.equal(factorySellerKey({}), null);
});

// ---------------------------------------------------------------------------
// 88查: людей не читаем

test("88查, поиск: legal_name, телефон, почта не читаются; у ИП нет ни названия, ни кода; адрес — только до района; <em> снят", () => {
  const raw = json("cha88-company-search.json");
  const { total, candidates } = parseCompanySearch(cha88Payload(JSON.stringify(raw)));
  assert.equal(total, 3);
  const out = JSON.stringify(candidates);
  for (const p of PEOPLE) assert.ok(!out.includes(p), `в разборе нет «${p}»`);
  assert.ok(!/legal|phone|email/i.test(out));
  const [company, namesake, ip] = candidates;
  assert.equal(company.entity, "company");
  assert.equal(company.name, "广州市花都区狮岭镇明辉皮具有限公司");
  assert.equal(company.creditCode, "91440114MA59ABCD1X");
  assert.equal(company.active, true);
  assert.equal(company.area, "广东省广州市花都区");
  assert.equal(company.regCapText, "500万 (人民币)");
  assert.equal(namesake.active, false, "注销 — не действует");
  assert.equal(namesake.establishedOn, "2015-01-01");
  assert.equal(ip.entity, "individual");
  assert.equal(ip.name, null);
  assert.equal(ip.creditCode, null);
  assert.equal(ip.area, "广东省广州市花都区");
});

test("88查, риски: число по типам и дата последнего, «недобросовестный должник» и «нарушения в деятельности»; тексты дел не читаются", () => {
  const risk = parseCompanyRisk(cha88Payload(text("cha88-company-risk.json")));
  assert.equal(risk.total, 5);
  assert.equal(risk.fetched, 5);
  assert.equal(risk.dishonest, 1);
  assert.deepEqual(risk.abnormal, { count: 2, lastOn: "2026-03-02" });
  assert.equal(risk.lastOn, "2026-03-02");
  assert.deepEqual(risk.byType.find((t) => t.subType === "失信被执行人"), { mainType: "司法风险", subType: "失信被执行人", count: 1, lastOn: "2026-01-01" });
  const out = JSON.stringify(risk);
  for (const p of PEOPLE) assert.ok(!out.includes(p), `в разборе нет «${p}»`);
  assert.ok(!/contentChinese|列入原因|处罚内容|rowId/.test(out));
  const clean = parseCompanyRisk(cha88Payload(text("cha88-company-risk-clean.json")));
  assert.deepEqual([clean.total, clean.fetched, clean.byType.length], [0, 0, 0]);
});

test("факты реестра: статус не «действует», 失信 и свежие 经营异常 — красные флаги; компании меньше года — жёлтый; капитал — «легко подогнать»", () => {
  const { candidates } = parseCompanySearch(cha88Payload(text("cha88-company-search.json")));
  const risk = parseCompanyRisk(cha88Payload(text("cha88-company-risk.json")));
  const facts = registryFacts(candidates[0], risk, "2026-10-07");
  assert.deepEqual(facts.flags.map((f) => [f.key, f.level, f.source]), [["registry_dishonest", "red", "Р"], ["registry_abnormal", "red", "Р"]]);
  assert.equal(facts.ageYears, 10);
  assert.match(facts.indicators.find((i) => i.key === "regCapital")?.note ?? "", /легко подогнать/);
  assert.match(facts.indicators.find((i) => i.key === "regRisks")?.text ?? "", /^5: /);
  assert.ok(facts.indicators.every((i) => i.source === "Р"));
  const old = registryFacts(candidates[1], parseCompanyRisk({ total: 1, riskMap: { 经营风险: [{ subType: "经营异常", time: "2024-01-01" }] } }), "2026-10-07");
  assert.deepEqual(old.flags.map((f) => f.key), ["registry_not_active"], "经营异常 старше года — не красный флаг; 注销 — красный");
  const young = registryFacts({ ...candidates[0], establishedOn: "2026-02-01" }, null, "2026-10-07");
  assert.deepEqual(young.flags.map((f) => [f.key, f.level]), [["registry_young", "yellow"]]);
  assert.equal(young.risks, null);
  assert.equal(fullYears("2016-05-20", "2026-05-19"), 9);
  const partial = registryFacts(candidates[0], { ...risk, total: 30 }, "2026-10-07");
  assert.equal(partial.risks?.complete, false);
  assert.match(partial.indicators.find((i) => i.key === "regRisks")?.basis ?? "", /первые 5 из 30/);
});

test("рисков в 88查 больше, чем прочитано: отсутствие 失信 на странице — не «чисто», а жёлтый чип «проверьте вручную»", () => {
  const { candidates } = parseCompanySearch(cha88Payload(text("cha88-company-search.json")));
  const page = Array.from({ length: 20 }, (_, i) => ({ subType: "被执行人", time: `2025-0${1 + (i % 9)}-01`, contentChinese: "{\"name\":\"张测试\"}" }));
  const risk = parseCompanyRisk({ data: { total: 45, riskMap: { 司法风险: page } } });
  assert.deepEqual([risk.total, risk.fetched, risk.dishonest], [45, 20, 0]);
  const facts = registryFacts(candidates[0], risk, "2026-10-07");
  assert.deepEqual(facts.flags.map((f) => [f.key, f.level, f.source]), [["registry_incomplete", "yellow", "Р"]]);
  assert.match(facts.flags[0].text, /рисков в реестре больше, чем прочитано \(20 из 45\).*失信.*проверьте вручную/);
  const withDishonest = registryFacts(candidates[0], parseCompanyRisk({ data: { total: 45, riskMap: { 司法风险: [...page.slice(1), { subType: "失信被执行人", time: "2026-01-01" }] } } }), "2026-10-07");
  assert.deepEqual(withDishonest.flags.map((f) => f.key), ["registry_dishonest", "registry_incomplete"]);
  const complete = registryFacts(candidates[0], parseCompanyRisk({ data: { total: 20, riskMap: { 司法风险: page } } }), "2026-10-07");
  assert.deepEqual(complete.flags.map((f) => f.key), [], "все прочитаны и 失信 нет — флага нет");
});

// ---------------------------------------------------------------------------
// Карточки: сведение, показатели, флаги

const result = () => buildFactoryResult(suppliers(), offers(), { sellerKey: SELLER_KEY });
const byKey = (cards: FactoryCard[], name: string) => cards.find((c) => c.displayName === name);
const indicator = (card: FactoryCard | undefined, key: string) => card?.indicators.find((i) => i.key === key);

test("сведение источников: совпавшие по нормализованному названию — одна карточка (both); остальные продавцы — отдельным блоком; без продавца — никуда", () => {
  const r = result();
  assert.deepEqual(r.factories.map((c) => c.origin), ["both", "both", "suppliers", "suppliers", "both"]);
  assert.deepEqual(r.factories.map((c) => c.supplierRank), [1, 2, 3, 4, 5]);
  assert.equal(r.factories[4].name, "义乌市晨光包袋有限公司", "продавец «…有限公司 » с пробелом сведён");
  assert.deepEqual(r.sellers.map((c) => c.origin), ["products", "products", "products"]);
  assert.deepEqual(r.sellers.map((c) => c.productRank), [6, 8, 11], "по лучшей позиции в выдаче товаров");
  assert.equal(r.factories[0].offers.length, 2);
  assert.equal(normalizeCompanyName("广州市（花都）　皮具 有限公司"), normalizeCompanyName("广州市(花都)皮具有限公司"));
  assert.ok(![...r.factories, ...r.sellers].some((c) => c.offers.some((o) => o.offerId === "843989880358")), "карточка без продавца в фабрики не идёт");
  assert.deepEqual([...r.factories, ...r.sellers].map((c) => c.n), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("люди: у ИП и неясных — псевдоним «Фабрика N», их названий нет нигде в выдаче; у юрлиц — название; ключ ИП — псевдоним-HMAC, а не имя", () => {
  const r = result();
  const out = JSON.stringify(r);
  for (const p of PEOPLE) assert.ok(!out.includes(p), `в выдаче нет «${p}»`);
  for (const hidden of ["白沟新城华美箱包厂", "深圳市福田区优品服饰商行", "广州市白云区李明皮具商行"]) assert.ok(!out.includes(hidden), hidden);
  assert.deepEqual([...r.factories, ...r.sellers].map((c) => [c.entity, c.displayName]), [
    ["company", "广州市花都区狮岭镇明辉皮具有限公司"], ["unknown", "Фабрика 2"], ["company", "苏州市吴中区雅致箱包有限公司"], ["individual", "Фабрика 4"],
    ["company", "义乌市晨光包袋有限公司"], ["unknown", "Фабрика 6"], ["individual", "Фабрика 7"], ["company", "东莞市鑫源皮具有限公司"],
  ]);
  assert.equal(r.factories[0].key, "name:广州市花都区狮岭镇明辉皮具有限公司", "юрлицо — по названию, а не по ссылке (ссылка — отдельно)");
  assert.equal(r.factories[0].shopUrl, "https://sale.1688.com/factory/card.html?memberId=b2b-0000000001");
  assert.equal(r.factories[4].key, "name:义乌市晨光包袋有限公司");
  assert.equal(r.sellers[0].key, SELLER_KEY?.("陈测试"));
  assert.equal(r.sellers[1].key, SELLER_KEY?.(normalizeCompanyName("深圳市福田区优品服饰商行")));
  assert.equal(r.factories[1].key, SELLER_KEY?.("白沟新城华美箱包厂"), "неясный (…厂) — тоже псевдоним, хоть и со ссылкой");
  assert.equal(r.sellers[2].key, "name:东莞市鑫源皮具有限公司");
  for (const c of [...r.factories, ...r.sellers].filter((x) => x.entity !== "company")) assert.match(String(c.key), /^ps:[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify([...r.factories, ...r.sellers].map((c) => c.key)).match(/陈测试|华美|优品|李明/), "в ключах нет названий ИП");
  const bare = buildFactoryResult(suppliers(), offers());
  assert.deepEqual([...bare.factories, ...bare.sellers].filter((c) => c.entity !== "company").map((c) => c.key), [null, null, null, null], "без секрета сервера у ИП ключа нет — «В шорт-лист» не показывается");
  assert.equal(entityFromName("广州市XX皮具有限公司（个体工商户）"), "individual");
  assert.equal(entityFromName("某某箱包厂"), "unknown");
  assert.equal(entityFromName("张三"), "unknown");
  assert.equal(entityFromName("广州市XX皮具有限公司(分公司)"), "company");
});

test("показатели: каждый со своей меткой источника, без общего балла; «нет данных» — словами; № в выдаче — без score", () => {
  const r = result();
  const all = [...r.factories, ...r.sellers];
  const sources = new Set(all.flatMap((c) => c.indicators.map((i) => i.source)));
  assert.deepEqual([...sources].sort(), ["З", "О", "Ф"]);
  for (const c of all) {
    assert.ok(!c.indicators.some((i) => /score|rating|total|балл/i.test(i.key)), "общего балла нет");
    for (const i of c.indicators) if (i.empty) assert.equal(i.text, "нет данных");
  }
  assert.ok(!JSON.stringify(r).includes("\"score\""));
  const mh = r.factories[0];
  assert.equal(indicator(mh, "rank")?.text, "поиск поставщиков: №1; товары: №1");
  assert.match(indicator(mh, "oem")?.text ?? "", /OEM — шьют по вашему ТЗ.*ODM — своя разработка/);
  assert.equal(indicator(mh, "oem")?.source, "З");
  assert.equal(indicator(mh, "proofing")?.text, "да");
  assert.equal(indicator(mh, "region")?.text, "Гуандун, Гуанчжоу");
  assert.match(indicator(mh, "cluster")?.text ?? "", /^Шилин/);
  assert.equal(indicator(mh, "cluster")?.source, "О");
  assert.equal(indicator(mh, "shopYears")?.text, "7 лет");
  assert.equal(indicator(mh, "inspection")?.text, "2 из 2 карточек");
  assert.equal(indicator(mh, "qualityRefunds")?.text, "0%");
  assert.match(indicator(mh, "qualityRefunds")?.basis ?? "", /по 2 карточкам с ≥30/);
  assert.equal(indicator(mh, "orders30d")?.text, "не меньше 221");
  assert.match(indicator(mh, "invoice")?.text ?? "", /^专票/);
  assert.equal(indicator(mh, "prices")?.text, "¥25,5–31");
  assert.match(indicator(mh, "prices")?.note ?? "", /цена карточки 1688.*из переписки/);
  assert.equal(indicator(mh, "moq")?.text, "от 2 шт.");
  assert.equal(indicator(r.factories[2], "oem")?.text, "нет данных", "нет OEM — «нет данных», а не выброс");
  assert.equal(indicator(r.sellers[0], "oem")?.empty, true, "у продавцов из выдачи товаров заявлений поиска поставщиков нет");
  assert.equal(indicator(r.sellers[0], "qualityRefunds")?.text, "0%", "50 заказов за 30 дней — считается");
  assert.equal(indicator(r.sellers[1], "qualityRefunds")?.empty, true, "у всех карточек меньше 30 заказов");
  assert.match(indicator(r.sellers[1], "qualityRefunds")?.note ?? "", /мало заказов/);
  assert.match(indicator(r.sellers[0], "moq")?.note ?? "", /розничный пул/);
  const gz = r.factories[3];
  assert.equal(gz.prices, null);
  assert.equal(indicator(gz, "prices")?.text, "нет данных", "нет карточек — нет цены, а не ноль");
  assert.ok(!JSON.stringify(gz.indicators).includes("\"0 из 0"), "нет «0 из 0» там, где карточек не было");
});

test("флаги: отдельными чипами, без счётчика — молодой магазин, возвраты >3% при ≥30 заказах, чужие бренды, широта, перепродавцы, нет 专票, вне кластеров", () => {
  const r = result();
  const flags = (c: FactoryCard) => c.flags.map((f) => `${f.key}:${f.level}`);
  assert.deepEqual(flags(r.factories[0]), ["foreign_brands:red"], "mlb в названии");
  assert.match(r.factories[0].flags[0].text, /MLB.*риск ИС на WB/);
  assert.deepEqual(flags(r.factories[1]), ["young_shop:yellow", "no_vat_invoice:yellow"], "1 год на 1688; единственная карточка — 普票");
  assert.deepEqual(flags(r.factories[2]), ["outside_clusters:yellow"], "Цзянсу");
  assert.deepEqual(flags(r.factories[4]), ["no_vat_invoice:yellow"]);
  assert.deepEqual(flags(r.sellers[0]), ["no_vat_invoice:yellow"], "122 размещения, но значение есть лишь у 6 продавцов — четверти и чипа нет");
  assert.equal(indicator(r.sellers[0], "puhuo")?.text, "122", "на малой выборке — только число");
  assert.deepEqual(flags(r.sellers[1]), ["no_vat_invoice:yellow", "trader_breadth:yellow"], "только 普票; куртка + обувь + чехол");
  assert.deepEqual(flags(r.sellers[2]), ["quality_refunds:red"], "4,2% при 45 заказах");
  assert.ok(!JSON.stringify(r).match(/flagsCount|flagCount|redCount/), "счётчика флагов нет");
});

test("широта: две группы товаров — ещё не «торговец», три — флаг (оценка снизу по названиям карточек в выдаче)", () => {
  const base = offers()[0];
  const mk = (offerId: string, titleZh: string, position: number) => ({ ...base, offerId, titleZh, position, seller: "某某皮具有限公司" });
  const two = buildFactoryResult([], [mk("1000000001", "托特包", 1), mk("1000000002", "女士夹克", 2)]).sellers[0];
  assert.deepEqual(two.flags.filter((f) => f.key === "trader_breadth"), []);
  assert.match(two.indicators.find((i) => i.key === "breadth")?.text ?? "", /^сумки, одежда; категорий 1688: 1$/);
  const three = buildFactoryResult([], [mk("1000000001", "托特包", 1), mk("1000000002", "女士夹克", 2), mk("1000000003", "运动鞋", 3)]).sellers[0];
  assert.deepEqual(three.flags.filter((f) => f.key === "trader_breadth").map((f) => f.level), ["yellow"]);
});

test("четверти — внутри выдачи: строго меньшие значения, равные — в нижнюю; меньше 4 значений — нет четверти", () => {
  assert.equal(quartileOf(4, [1, 2, 3, 4]), 4);
  assert.equal(quartileOf(3, [1, 2, 3, 4]), 3);
  assert.equal(quartileOf(1, [1, 2, 3, 4]), 1);
  assert.equal(quartileOf(5, [5, 5, 5, 5]), 1, "все равны — никто не «верхняя четверть»");
  assert.equal(quartileOf(3, [1, 2, 3]), null);
  assert.equal(quartileOf(null, [1, 2, 3, 4]), null);
  const r = result();
  const repeat = [...r.factories, ...r.sellers].map((c) => indicator(c, "repeatRate")?.quartile ?? null);
  assert.deepEqual(repeat, [4, 1, null, null, 3, 1, 2, 3], "повторы — четверти среди 6 продавцов с магазином (0,25 … 0,71)");
  assert.match(indicator(r.factories[0], "repeatRate")?.text ?? "", /71% · верхняя четверть выдачи/);
});

test("наши оценки по названиям: бренды по границам слов (mlb, ZA, кириллица — нет), группы товаров без «包邮 / 口袋»", () => {
  assert.deepEqual(brandMentions("法棍包mlb包包"), ["MLB"]);
  assert.deepEqual(brandMentions("ZA家同款 风衣"), ["ZA (Zara)"]);
  assert.deepEqual(brandMentions("ZARA风 托特包"), ["Zara"]);
  assert.deepEqual(brandMentions("Mlbb 托特包 coachella"), [], "часть слова — не бренд");
  assert.deepEqual(brandMentions("香奈儿 菱格链条包"), ["Chanel"]);
  assert.equal(categoryGroup("工装外套多口袋"), "одежда", "карман — не сумка");
  assert.equal(categoryGroup("腋下包 包邮"), "сумки");
  assert.equal(categoryGroup("包邮 毛巾"), "дом");
  assert.equal(categoryGroup("手机壳 卡通"), "чехлы и электроника");
  assert.equal(categoryGroup("abc"), null);
});

test("сортировка — по одному выбранному показателю: «нет данных» в конце, при равенстве — порядок выдачи; по флагам сортировки нет", () => {
  const r = result();
  const all = [...r.factories, ...r.sellers];
  assert.deepEqual(sortFactoryCards(all, "rank").map((c) => c.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(sortFactoryCards(all, "shopYears").map((c) => c.n), [8, 1, 7, 5, 6, 2, 3, 4]);
  assert.deepEqual(sortFactoryCards(all, "prices").map((c) => c.n), [6, 7, 2, 5, 1, 8, 3, 4], "цена — от дешёвых, без цены — в конце");
  assert.equal(parseSortKey("flags"), "rank");
  assert.equal(parseSortKey("moq"), "moq");
  assert.ok(!Object.keys(FACTORY_SORTS).some((k) => /flag|score|total/i.test(k)));
});

// ---------------------------------------------------------------------------
// Справочники

test("кластеры и регион: город → кластер (оценка), чипы — три (Шилин, Байгоу, Гуанчжоу) и дописываются к запросу; провинции вне сумок — флаг", () => {
  assert.deepEqual(FACTORY_CLUSTER_CHIPS.map((c) => [c.key, c.query]), [["shiling", "狮岭"], ["baigou", "白沟"], ["guangzhou", "广州 桂花岗"]]);
  assert.equal(clusterOf({ province: "广东省", city: "广州市", hint: "广州市花都区狮岭镇X有限公司" }), "shiling");
  assert.equal(clusterOf({ province: "广东省", city: "广州市" }), "canton", "один город: Шилин — тоже Гуанчжоу, не различить");
  assert.equal(clusterOf({ province: "广东省", city: "广州市", hint: "广州市白云区X皮具有限公司" }), "guangzhou", "оптовые ряды — только по явному 白云 / 桂花岗");
  assert.equal(clusterOf({ province: "广东省", city: "深圳市", hint: "广州市白云区X有限公司" }), null, "название не перебивает другой город");
  assert.equal(clusterOf({ province: "河北省", city: "保定市" }), "baigou");
  assert.equal(clusterOf({ province: "浙江省", city: "嘉兴市" }), "pinghu");
  assert.equal(clusterOf({ province: "江苏省", city: "苏州市" }), null);
  assert.equal(outsideBagProvinces("江苏省"), true);
  assert.equal(outsideBagProvinces("广东省"), false);
  assert.equal(outsideBagProvinces(null), false, "регион не известен — флага нет");
  assert.equal(regionLabel("河北省", "保定市"), "Хэбэй, Баодин");
  // Название ИП в оценку кластера не идёт: ИП «…白云区…» или «…狮岭…» в Гуанчжоу — «Гуанчжоу: не различить».
  const ipCard = (companyName: string) => buildFactoryResult([{ ...suppliers()[0], companyName, city: "广州市", province: "广东省" }], []).factories[0];
  for (const name of ["广州市白云区李明皮具商行", "狮岭镇某某皮具店"]) {
    const card = ipCard(name);
    assert.equal(card.entity, "individual", name);
    assert.equal(card.cluster, "canton", name);
  }
  assert.equal(ipCard("广州市花都区狮岭镇某某皮具有限公司").cluster, "shiling", "у юрлица название — подсказка");
  const unclear = ipCard("花都区某某皮具厂");
  assert.equal(unclear.cluster, "canton", "неясный (…厂) в Гуанчжоу — не «оптовые ряды»");
  assert.equal(unclear.indicators.find((i) => i.key === "cluster")?.text, "Гуанчжоу — Шилин (Хуаду) или оптовые ряды — по региону регистрации не различить");
  assert.equal(regionLabel(null, null), null);
  assert.equal(parseClusterKey("pinghu"), null, "Пинху — не чип");
  assert.equal(tagLabel("源头工厂"), "源头工厂 — «фабрика-первоисточник» (метка 1688)");
  assert.equal(tagLabel("新标签"), "新标签");
});

test("вопросы фабрике: китайский текст с русским переводом, нумерация совпадает; темы — мощность, швеи, лекала, образец, партия, НДС, видеозвонок, поставщики", () => {
  const { zh, ru } = factoryQuestionsText();
  assert.equal(FACTORY_QUESTIONS.length, 10);
  for (let i = 1; i <= FACTORY_QUESTIONS.length; i += 1) {
    assert.ok(zh.includes(`\n${i}. `) && ru.includes(`\n${i}. `), `пункт ${i}`);
  }
  for (const w of ["每天", "车工", "版房", "打样", "退还", "起订量", "颜色", "生产周期", "专用发票", "视频", "五金"]) assert.ok(zh.includes(w), w);
  for (const w of ["мощность", "швей", "лекал", "образец", "партия", "цвет", "НДС", "видеозвонок", "фурнитур"]) assert.ok(ru.toLowerCase().includes(w.toLowerCase()), w);
  assert.ok(!/微信|wechat|电话|\d{6,}/i.test(zh), "в шаблоне нет контактов");
});

test("подписи: метки источников, «рекомендация ≠ решение о закупке», «Как читать показатели» — пороги, четверти, «нет данных»", () => {
  assert.deepEqual(Object.keys(FACTORY_SOURCE_LABEL), ["Ф", "З", "О", "Р", "Ч"]);
  assert.match(FACTORY_DISCLAIMER, /Рекомендация ≠ решение о закупке; фабрику подтверждают лицензия, видеозвонок и образец/);
  const guide = FACTORY_READING_GUIDE.join(" ");
  for (const w of ["Общего балла фабрики нет", "меньше 2 лет", "30 и больше заказами", "больше 3%", "четверти", "2 из 5", "под ваше ТЗ", "легко подогнать"]) assert.ok(guide.includes(w), w);
});

// ---------------------------------------------------------------------------
// Миграция

const MIGRATION_FILE = "202610070010_assortment_cn_factories.sql";
const sql = read(`supabase/migrations/${MIGRATION_FILE}`);

function migrationColumns(table: string): Set<string> {
  const block = new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? "";
  return new Set(block.split("\n").map((l) => /^\s{2}([a-z_0-9]+)\s+/.exec(l)?.[1]).filter((c): c is string => Boolean(c) && c !== "primary" && c !== "check"));
}

test("миграция: один новый файл со свободным номером (не 202610070001), две таблицы, RLS и revoke у каждой, ничего существующего не меняет", () => {
  const all = readdirSync(join(root, "supabase/migrations"));
  assert.deepEqual(all.filter((f) => /assortment_cn_factor/.test(f)), [MIGRATION_FILE]);
  const number = MIGRATION_FILE.slice(0, 12);
  assert.notEqual(number, "202610070001");
  assert.equal(all.filter((f) => f.startsWith(`${number}_`)).length, 1, "номер не занят другим файлом");
  const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables, ["assortment_cn_factory_search", "assortment_cn_factory"]);
  for (const t of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security;`), t);
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from anon, authenticated;`), t);
  }
  assert.doesNotMatch(sql, /^\s*(alter|drop|update|delete|insert)\s+(?!table public\.assortment_cn_factory(_search)? enable row level security)/im);
  assert.match(sql, /factory_key\s+text not null unique/);
  assert.match(sql, /interval '7 days 1 minute'/);
  assert.match(sql, /status <> 'rejected' or reject_reason is not null/);
});

test("сторож людей: в таблицах фабрик нет колонок legal_name, phone, wechat, director (и контактов, адреса, балла)", () => {
  for (const table of ["assortment_cn_factory_search", "assortment_cn_factory"]) {
    const cols = migrationColumns(table);
    assert.ok(cols.size >= 8, table);
    for (const c of cols) assert.doesNotMatch(c, /legal|phone|wechat|director|contact|person|mobile|email|address|owner|score|rating|login|member/i, `${table}.${c}`);
  }
  assert.ok(migrationColumns("assortment_cn_factory").has("credit_code"));
  assert.match(sql, /credit_code is null or \(entity = 'company'/, "кредитный код — только у юрлица");
  assert.match(sql, /company_name is null or \(entity = 'company'/, "название — только у юрлица");
});
