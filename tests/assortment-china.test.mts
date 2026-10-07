import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  call1688, canonicalResource, China1688Error, CHINA_NICHES, CHINA_STOP_WORDS, classifyBizError, containsChinaMoney, contentMd5, countRefCopies, estimateListedOn,
  FIND_PRODUCT_PATH, isNewOffer, isWomenTitle, nicheTop, parseAk, parseFindProduct, parseOfferHot, parseOpportunities, parseRefKey, parseSearchOffer, refQuery,
  signHeaders, soldLowerBound, stripChinaMoney, titleHasAlias, titleHasRef, topicDirection, WORKFLOW_PATH,
  type ChinaCaller, type ChinaOffer,
} from "../lib/assortment/china1688.ts";
import {
  CHINA_SOURCE_ID, CHINA_TRANSLATE_KIND, CHINA_USAGE_KIND, chinaConfig, chinaRunLog, chinaTranslatorFromEnv, chinaWeekOf, MAX_TASK_ATTEMPTS, nicheRows, parseTranslations,
  pickRefTasks, RATE_LIMIT_PAUSE_MS, readChinaState, runChinaSnapshot, TRANSLATE_CALLS_PER_WEEK, TranslateStopError,
  type ChinaConfig, type ChinaRunSummary, type RunChinaOptions, type TranslateSetup,
} from "../lib/assortment/chinaSync.ts";
import { articleCards, compareTop, loadChinaView, ROSE_MIN_POSITIONS } from "../lib/assortment/chinaStore.ts";
import { ENGINE_KIND, engineWeek, isEngineKind, kindTier } from "../lib/assortment/engineBudget.ts";

/**
 * «Китай (1688)»: клиент официальных навыков (подпись, ошибки, повторы), разбор ответов по белому списку (без цен и продавцов),
 * копии по номерам, неделя к неделе, недельный снимок на подставной базе (применяет фильтры, режет страницу на 1 000 строк и сверяет
 * записываемые колонки с миграцией) и чтение для экрана. Образцы — живые ответы 07.10.2026, обезличенные (цены → PRICE, продавцы → shopN).
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const FIXTURES = "tests/fixtures/assortment-china";
const fixture = (name: string) => JSON.parse(read(`${FIXTURES}/${name}`)) as Record<string, unknown> & { data?: unknown; model?: unknown };
const MIGRATION_FILE = "202610070001_assortment_china_1688.sql";
const sql = read(`supabase/migrations/${MIGRATION_FILE}`);

const G_BAGS = fixture("find-product-niche-yexiabao-sold-desc.json");
const G_JACKETS = fixture("find-product-niche-nvshi-jiake-sold-desc.json");
const G_JACKETS_NEW = fixture("find-product-niche-nvshi-jiake-2026-new-sold-desc.json");
const G_ZARA = fixture("find-product-ref-zara-8372288-za-category.json");
const G_UNIQLO = fixture("find-product-ref-uniqlo-487517-ujia-category.json");
const G_ZARA_BARE = fixture("find-product-ref-zara-8372288-bare.json");
const SK_SEARCH = fixture("shopkeeper-searchoffer-yexiabao.json");
const SK_TREND_BAGS = fixture("shopkeeper-trend-yexiabao.json");
const SK_TREND_JACKETS = fixture("shopkeeper-trend-nvshi-jiake.json");
const SK_OPPORTUNITIES = fixture("shopkeeper-opportunities.json");

/** Признаки цены и продавца в выходе: маркер образцов PRICE, валюта, «N元», shopN, служебные поля магазина. */
const LEAK_RE = /PRICE|¥|￥|\d\s*元|RMB|\bshop\d+\b|company|currentPrice|priceTags|promotionTags|merchantReputation|rankedContent|店铺/;

/** Вымышленный ключ: собирается в тесте, а не лежит строкой (сторож длинных base64-строк в коде модуля). */
const FAKE_SECRET = "TestSecretTestSecretTestSecret12";
const FAKE_ID = "testkeyid000000001";
const FAKE_AK = Buffer.from(FAKE_SECRET + FAKE_ID, "utf8").toString("base64url");
const ENV = { ALI_1688_AK: FAKE_AK };

// ---------------------------------------------------------------------------
// Ключ и подпись

test("ключ AK разбирается как у официального клиента: base64url → 32 символа секрета, остальное — id; иначе — режем исходную строку", () => {
  assert.equal(FAKE_AK.length, 67);
  assert.deepEqual(parseAk(FAKE_AK), { id: FAKE_ID, secret: FAKE_SECRET });
  assert.deepEqual(parseAk(`${FAKE_AK}=`), { id: FAKE_ID, secret: FAKE_SECRET }, "лишний «=» в конце не мешает");
  assert.deepEqual(parseAk(`${"x".repeat(32)}!idpart`), { id: "!idpart", secret: "x".repeat(32) }, "не base64url — по исходной строке");
  assert.deepEqual(parseAk("A".repeat(69)), { id: "A".repeat(37), secret: "A".repeat(32) }, "длина 1 по модулю 4 — не base64, как у Python");
  assert.equal(parseAk("short"), null);
  assert.equal(parseAk(""), null);
  assert.equal(parseAk(undefined), null);
});

test("подпись совпадает с эталоном официального алгоритма (_auth.py build_signature, вымышленный ключ, время и nonce зафиксированы)", () => {
  const keys = { id: FAKE_ID, secret: FAKE_SECRET };
  const body = JSON.stringify({ query: "腋下包 女", pageSize: 40, purchaseAmount: 1, sortType: "sold_desc", scoreLevel: "high", tags: "4306497" });
  const gw = signHeaders({ method: "POST", path: FIND_PRODUCT_PATH, body, keys, version: "1.7.0", timestamp: 1791368929, nonce: "a1b2c3d4" });
  assert.equal(gw["x-csk-content-md5"], "eafuR9Evs8GvNkpwDM4OQA==");
  assert.equal(gw["x-csk-sign"], "rZikbiC2DgbuYyIoY7p/QI5lQSyzwEaHiU9TjnDoXVk=");
  assert.deepEqual(Object.keys(gw).sort(), ["Content-Type", "x-csk-ak", "x-csk-content-md5", "x-csk-nonce", "x-csk-sign", "x-csk-time", "x-csk-version"]);
  assert.equal(gw["x-csk-ak"], FAKE_ID);
  assert.ok(!Object.values(gw).some((v) => v.includes(FAKE_SECRET)), "секрета в заголовках нет");
  const ai = signHeaders({ method: "POST", path: WORKFLOW_PATH, body: JSON.stringify({ code: "offer_hot", bizParams: { query: "腋下包" } }), keys, version: "1.0.1", timestamp: 1791368930, nonce: "0f0e0d0c" });
  assert.equal(ai["x-csk-sign"], "KRTzfFacCAFyH+i2BNoVCKehECLIpYtK7/KNf6RVvls=");
  const empty = signHeaders({ method: "post", path: "/x/y?b=2&a=1&a=0", body: "", keys, version: "1.0.1", timestamp: 1, nonce: "00000000" });
  assert.equal(empty["x-csk-content-md5"], "");
  assert.equal(empty["x-csk-sign"], "2L6uvfDMylPu/0GL+hpgMWSgFdgwfZDFp6YmeKG7f7E=");
  assert.equal(contentMd5(""), "");
  assert.equal(canonicalResource("/x/y?b=2&a=1&a=0&c=%E4%B8%AD+x"), "/x/y?a=0&a=1&b=2&c=%E4%B8%AD%20x");
});

// ---------------------------------------------------------------------------
// Вызов: конверты, ошибки, повторы

interface FakeResponse { status: number; body: unknown }
function fakeFetch(responses: Array<FakeResponse | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("подставка: ответы кончились");
    if (next instanceof Error) throw next;
    return { status: next.status, ok: next.status >= 200 && next.status < 300, json: async () => next.body } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const noSleep = async () => {};

test("вызов gateway: POST с подписью, кодом навыка и точным телом; ответ — data конверта; секрет ключа не уходит ни в тело, ни в заголовки", async () => {
  const f = fakeFetch([{ status: 200, body: G_BAGS }]);
  const data = await call1688("gateway", FIND_PRODUCT_PATH, { query: "腋下包 女", pageSize: 40 }, { env: ENV, fetchImpl: f.impl, sleep: noSleep });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://gateway.1688.com/api/alibaba.1688.find.product/1.0.0/github");
  const headers = f.calls[0].init.headers as Record<string, string>;
  assert.equal(f.calls[0].init.method, "POST");
  assert.equal(f.calls[0].init.body, JSON.stringify({ query: "腋下包 女", pageSize: 40 }));
  assert.equal(headers["x-skill-code"], "1688-product-find");
  assert.equal(headers["x-csk-version"], "1.7.0");
  assert.equal(headers["x-csk-content-md5"], contentMd5(String(f.calls[0].init.body)));
  assert.match(headers["x-csk-nonce"], /^[0-9a-f]{8}$/);
  const wire = JSON.stringify(f.calls[0]);
  assert.ok(!wire.includes(FAKE_SECRET) && !wire.includes(FAKE_AK), "ни секрета, ни строки ключа в запросе");
  assert.equal((data as { count: number }).count, 40);

  const g = fakeFetch([{ status: 200, body: SK_TREND_BAGS }]);
  const model = await call1688("ainext", WORKFLOW_PATH, { code: "offer_hot" }, { env: ENV, fetchImpl: g.impl, sleep: noSleep });
  assert.equal(g.calls[0].url, "https://ainext.1688.com/1688claw/skill/workflow");
  assert.equal((g.calls[0].init.headers as Record<string, string>)["x-csk-version"], "1.0.1");
  assert.equal((g.calls[0].init.headers as Record<string, string>)["x-skill-code"], undefined, "у ainext заголовков навыка нет");
  assert.equal(typeof (model as { bizData: unknown }).bizData, "string");
});

test("ошибки: ключ (401, SignatureInvalid) и лимит (429, Qos*) — без повторов; 5xx и сеть — один повтор; без ключа — запроса нет", async () => {
  const kind = async (responses: Array<FakeResponse | Error>, host: "gateway" | "ainext" = "gateway") => {
    const f = fakeFetch(responses);
    try {
      await call1688(host, FIND_PRODUCT_PATH, {}, { env: ENV, fetchImpl: f.impl, sleep: noSleep });
      return { kind: "ok", calls: f.calls.length };
    } catch (error) {
      assert.ok(error instanceof China1688Error);
      assert.ok(!error.message.includes(FAKE_SECRET) && !error.message.includes(FAKE_AK));
      return { kind: error.kind, calls: f.calls.length };
    }
  };
  assert.deepEqual(await kind([{ status: 401, body: {} }, { status: 200, body: G_BAGS }]), { kind: "auth", calls: 1 });
  assert.deepEqual(await kind([{ status: 200, body: fixture("synthetic-gateway-error-signature.json") }, { status: 200, body: G_BAGS }]), { kind: "auth", calls: 1 });
  assert.deepEqual(await kind([{ status: 429, body: {} }, { status: 200, body: G_BAGS }]), { kind: "rate_limit", calls: 1 }, "429 не повторяем");
  assert.deepEqual(await kind([{ status: 200, body: fixture("synthetic-gateway-error-qos.json") }, { status: 200, body: G_BAGS }]), { kind: "rate_limit", calls: 1 });
  assert.deepEqual(await kind([{ status: 200, body: fixture("synthetic-ainext-error-429.json") }, { status: 200, body: SK_TREND_BAGS }], "ainext"), { kind: "rate_limit", calls: 1 });
  assert.deepEqual(await kind([{ status: 503, body: {} }, { status: 200, body: G_BAGS }]), { kind: "ok", calls: 2 }, "5xx — один повтор");
  assert.deepEqual(await kind([{ status: 502, body: {} }, { status: 504, body: {} }, { status: 200, body: G_BAGS }]), { kind: "transient", calls: 2 }, "не больше одного повтора");
  assert.deepEqual(await kind([new TypeError("fetch failed"), { status: 200, body: G_BAGS }]), { kind: "ok", calls: 2 }, "сеть — повтор");
  assert.deepEqual(await kind([{ status: 200, body: { success: false, code: "ISPInvokeTimeout" } }, { status: 200, body: G_BAGS }]), { kind: "ok", calls: 2 });
  assert.deepEqual(await kind([{ status: 400, body: {} }, { status: 200, body: G_BAGS }]), { kind: "param", calls: 1 });
  assert.deepEqual(await kind([{ status: 200, body: { success: false, code: "ISPInvokeError" } }, { status: 200, body: G_BAGS }]), { kind: "service", calls: 1 });
  const f = fakeFetch([{ status: 200, body: G_BAGS }]);
  await assert.rejects(call1688("gateway", FIND_PRODUCT_PATH, {}, { env: {}, fetchImpl: f.impl }), (e: unknown) => e instanceof China1688Error && e.kind === "no_key" && e.message === CHINA_STOP_WORDS.no_key);
  assert.equal(f.calls.length, 0, "без ключа запроса нет");
  assert.equal(classifyBizError({ code: "QosApiFrequencyLimit" }).kind, "rate_limit");
  assert.equal(classifyBizError({ msgCode: "401" }).kind, "auth");
});

// ---------------------------------------------------------------------------
// Разбор по белому списку: ни цен, ни продавцов

const OFFER_KEYS = ["badges", "category", "imageUrl", "isAd", "listedOn", "offerId", "orders30d", "position", "sellerSlot", "soldMin", "soldText", "titleZh", "traits"];

test("find.product → карточки только из белого списка полей: цен, промо, магазина и rankedContent в выходе нет; продавцы — только число", () => {
  const r = parseFindProduct(G_BAGS.data);
  assert.equal(r.count, 40);
  assert.equal(r.offers.length, 40);
  assert.equal(r.sellers, 33, "33 разных продавца (как в пробе) — числом");
  const first = r.offers[0];
  assert.deepEqual(Object.keys(first).sort(), OFFER_KEYS);
  assert.deepEqual({ ...first, sellerSlot: undefined }, {
    offerId: "975160314318", position: 1, titleZh: "2025简约大容量波士顿腋下包包女潮腋肩包小众设计法棍包mlb包包",
    imageUrl: "https://cbu01.alicdn.com/img/ibank/O1CN0131hMt025zwOgg7AXX_!!9000000000001-0-cib.jpg", category: "201972802",
    soldText: "5000+", soldMin: 5000, orders30d: 181, listedOn: null, isAd: false, badges: ["inspected"], traits: ["拼接", "涤纶", "中偏软"], sellerSlot: undefined,
  });
  assert.equal(typeof first.sellerSlot, "number", "номер продавца обезличен — число в пределах ответа");
  for (const name of readdirSync(join(root, FIXTURES)).filter((f) => f.startsWith("find-product-"))) {
    assert.doesNotMatch(JSON.stringify(parseFindProduct(fixture(name).data)), LEAK_RE, name);
  }
  assert.doesNotMatch(JSON.stringify(parseSearchOffer(SK_SEARCH.model)), LEAK_RE);
  assert.match(JSON.stringify(G_BAGS), /PRICE/, "образец действительно содержит цены (маркер) — иначе сторож пустой");
  assert.match(JSON.stringify(G_BAGS), /shop1/, "и продавцов");
});

test("shopkeeper searchoffer: дата размещения — факт, счётчик «100+» — нижняя граница; цены и оценок нет", () => {
  const r = parseSearchOffer(SK_SEARCH.model);
  assert.equal(r.offers.length, 20);
  const o = r.offers.find((x) => x.offerId === "1010963140890")!;
  assert.equal(o.listedOn, "2026-01-06");
  assert.equal(o.soldText, "100+");
  assert.equal(o.soldMin, 100);
  assert.equal(o.category, "箱包皮具 > 女士包袋 > 女士单肩包");
  assert.equal(soldLowerBound("<10"), 0);
  assert.equal(soldLowerBound("1.2万+"), 12_000);
  assert.equal(soldLowerBound("PRICE"), null);
});

test("суммы вырезаются из названий и переводов: «￥13.5-￥24», «35元», «RMB 42–98»", () => {
  assert.equal(stripChinaMoney("立领夹克 ￥13.5-￥24 女"), "立领夹克 女");
  assert.equal(stripChinaMoney("腋下包 35元 包邮"), "腋下包 包邮");
  assert.equal(stripChinaMoney("Куртка RMB 42–98 женская"), "Куртка женская");
  assert.equal(containsChinaMoney("流行元素 腋下包"), false, "«元素» (элемент) — не деньги");
  assert.equal(containsChinaMoney("35元"), true);
  const raw = { data: [{ itemId: 123456789, title: "女士夹克 ￥99 新款", currentPrice: "99", company: "张三服饰", soldOut: 10 }] };
  const parsed = parseFindProduct(raw);
  assert.equal(parsed.offers[0].titleZh, "女士夹克 新款");
  assert.doesNotMatch(JSON.stringify(parsed), /99|张三/);
});

test("топ ниши: без платных размещений и без мужского и детского; порядок — как в выдаче 1688", () => {
  const bags = nicheTop(parseFindProduct(G_BAGS.data), 40);
  assert.equal(bags.offers.length, 39);
  assert.ok(!bags.offers.some((o) => o.offerId === "981988980742"), "платное размещение (isYuanbaoadOffer) — не в топе");
  assert.deepEqual(bags.offers.slice(0, 3).map((o) => o.position), [1, 2, 3]);
  const jackets = nicheTop(parseFindProduct(G_JACKETS.data), 40);
  assert.ok(!jackets.offers.some((o) => o.offerId === "853456997671"));
  assert.equal(nicheTop(parseFindProduct(G_BAGS.data), 10).offers.length, 10);
  assert.equal(isWomenTitle("男士夹克 秋冬"), false);
  assert.equal(isWomenTitle("男装女装 摇粒绒 茄克"), true, "унисекс — да");
  assert.equal(isWomenTitle("女童 外套"), false, "детское — нет, даже с «女»");
  assert.equal(isWomenTitle("托特包 大容量"), true, "сумка без указания пола — да");
  const synthetic = { data: [
    { itemId: 100000001, title: "男士夹克 秋冬", company: "a", soldOut: 1 },
    { itemId: 100000002, title: "儿童外套", company: "b", soldOut: 1 },
    { itemId: 100000003, title: "女士夹克", company: "c", soldOut: 1 },
  ] };
  assert.deepEqual(nicheTop(parseFindProduct(synthetic), 40).offers.map((o) => o.offerId), ["100000003"]);
});

test("новинка — оценка по номеру карточки (номера растут со временем); «新款» в названии — только значок-заявление", () => {
  assert.equal(estimateListedOn("1064913903100"), "2026-07-14");
  assert.equal(estimateListedOn("1007558400078"), "2025-12-24");
  assert.ok(estimateListedOn("1084835650850")! > "2026-09-15" && estimateListedOn("1084835650850")! < "2026-10-01");
  assert.ok(estimateListedOn("1095000000000")! > "2026-10-06", "за последней опорной точкой — по среднему темпу");
  assert.equal(isNewOffer("1084835650850", "2026-10-05"), true);
  assert.equal(isNewOffer("1064452733926", "2026-10-05"), false);
  assert.equal(isNewOffer("975160314318", "2026-10-05"), false);
  const jackets = parseFindProduct(G_JACKETS_NEW.data).offers;
  assert.ok(jackets.filter((o) => o.badges.includes("claims_new")).length >= 15, "«2026秋冬新款» — заявление продавца");
});

// ---------------------------------------------------------------------------
// Номера товаров брендов

test("номер в названии: Zara — ровно 7 цифр (с цветом через пробел — да), Uniqlo — 6 цифр, допустима буква впереди", () => {
  const zara = { brand: "zara" as const, number: "8372288" };
  assert.equal(titleHasRef("立领棉衣夹克外套8372288", zara), true);
  assert.equal(titleHasRef("TAOP&ZA 夹克 8372288 600", zara), true);
  assert.equal(titleHasRef("夹克18372288", zara), false, "часть длинного числа — не номер");
  assert.equal(titleHasRef("夹克83722880", zara), false);
  const uq = { brand: "uniqlo" as const, number: "487517" };
  assert.equal(titleHasRef("加绒保暖上衣外套R487517", uq), true);
  assert.equal(titleHasRef("立领茄克 487517", uq), true);
  assert.equal(titleHasRef("外套AR487517", uq), false, "буква впереди — только одна и не часть слова");
  assert.equal(titleHasRef("外套4875170", uq), false);
  assert.equal(titleHasRef("外套1487517", uq), false);
  assert.equal(titleHasAlias("TAOP&ZA 女装", "zara"), true);
  assert.equal(titleHasAlias("Z家外贸跨境", "zara"), true);
  assert.equal(titleHasAlias("日单出品 外套", "uniqlo"), true);
  assert.equal(titleHasAlias("AMAZON 外套", "zara"), false);
});

test("копии по номеру на образцах: Zara 8372288 — 3 карточки у 3 продавцов; Uniqlo 487517 — 2 (вместе с R487517); голый номер — 0", () => {
  const zara = countRefCopies(parseFindProduct(G_ZARA.data).offers, parseRefKey("zara:8372288")!);
  assert.deepEqual(zara, { offers: 3, sellers: 3, withAlias: 1, sampleOfferIds: ["1080947777395", "1082953013238", "1087509220041"] });
  const uq = countRefCopies(parseFindProduct(G_UNIQLO.data).offers, parseRefKey("uniqlo:487517")!);
  assert.equal(uq.offers, 2);
  assert.deepEqual(uq.sampleOfferIds, ["1083094378976", "1078976931819"]);
  assert.equal(countRefCopies(parseFindProduct(G_ZARA_BARE.data).offers, parseRefKey("zara:8372288")!).offers, 0);
  // Один продавец с двумя карточками — один продавец.
  const offer = (id: string, slot: number): ChinaOffer => ({ offerId: id, position: 1, titleZh: `外套 8372288`, imageUrl: null, category: null, soldText: null, soldMin: null, orders30d: null, listedOn: null, isAd: false, badges: [], traits: [], sellerSlot: slot });
  assert.deepEqual(countRefCopies([offer("1000001", 0), offer("1000002", 0), offer("1000003", 1)], { brand: "zara", number: "8372288" }).sellers, 2);
  assert.doesNotMatch(JSON.stringify(zara), LEAK_RE);
});

test("номер → запрос: псевдоним бренда, номер, категория раздела, «女»; ключи номеров — только zara:7 цифр и uniqlo:6 цифр", () => {
  assert.equal(refQuery(parseRefKey("zara:8372288")!, "jackets"), "ZA 8372288 外套 女");
  assert.equal(refQuery(parseRefKey("uniqlo:487517")!, "bags"), "U家 487517 包 女");
  assert.equal(refQuery(parseRefKey("uniqlo:487517")!, null), "U家 487517 女");
  assert.equal(parseRefKey("zara:837228"), null);
  assert.equal(parseRefKey("uniqlo:4875170"), null);
  assert.equal(parseRefKey("mango:1234567"), null);
});

test("номера из рилсов: только Zara/Uniqlo, не мужское, не детское, не скрытое; сначала «сильный залёт», потом «залетает», потом по лайкам", () => {
  const post = (refs: string[], over: Record<string, unknown> = {}) => ({ refs, brand: "zara", direction: "jackets", verdict: null, likes: 10, match_status: null, match_gender: null, hidden_at: null, ...over });
  const tasks = pickRefTasks([
    post(["zara:1111111"], { likes: 5000 }),
    post(["zara:2222222"], { verdict: "viral", likes: 100 }),
    post(["uniqlo:487517"], { verdict: "strong", likes: 50, direction: "bags" }),
    post(["zara:3333333"], { match_gender: "men", verdict: "strong" }),
    post(["zara:4444444"], { match_status: "kids", verdict: "strong" }),
    post(["zara:5555555"], { hidden_at: "2026-10-01T00:00:00Z", verdict: "strong" }),
    post(["zara:123", "mango:1234567"], { verdict: "strong" }),
  ], 10);
  assert.deepEqual(tasks.map((t) => t.ref.key), ["uniqlo:487517", "zara:2222222", "zara:1111111"]);
  assert.equal(tasks[0].direction, "bags");
  assert.equal(pickRefTasks([post(["zara:1111111"]), post(["zara:2222222"])], 1).length, 1, "не больше потолка недели");
});

// ---------------------------------------------------------------------------
// Тренды и «возможности»

test("тренд ключа: покупатели в день, предложение, год к году и ряд по месяцам; раздел хитов Taobao — только число товаров и доли TOP1/TOP3", () => {
  const t = parseOfferHot((SK_TREND_BAGS.model as { bizData: string }).bizData)!;
  assert.equal(t.keyword, "腋下包");
  assert.equal(t.buyersPerDay, 7729.2);
  assert.equal(t.supplyPerDay, 64379.3);
  assert.equal(t.ratio, 0.12);
  assert.equal(t.yoyPct, -6.2);
  assert.equal(t.series.length, 12);
  assert.deepEqual(t.series.at(-1), { month: "202608", value: 8962.3 });
  assert.deepEqual([t.taobaoItems, t.top1Pct, t.top3Pct], [20, 8, 21]);
  const j = parseOfferHot((SK_TREND_JACKETS.model as { bizData: string }).bizData)!;
  assert.equal(j.yoyPct, -12.2);
  assert.deepEqual(j.series.find((p) => p.month === "202603"), { month: "202603", value: 1376.9 });
  assert.doesNotMatch(JSON.stringify([t, j]), LEAK_RE, "均价 / 中位数价格 / 价格分布 не читаются");
  assert.equal(parseOfferHot("нет данных"), null);
  assert.equal(parseOfferHot(null), null);
});

test("«возможности»: только наши категории и не мужское/детское — летние темы 07.10 и «салфетки большой пачкой» (大包) не проходят", () => {
  assert.deepEqual(parseOpportunities(SK_OPPORTUNITIES.model), []);
  assert.equal(topicDirection("商用大包抽纸"), null, "голое «包» — не сумка");
  assert.equal(topicDirection("面包"), null);
  assert.equal(topicDirection("通勤托特包女"), "bags");
  assert.equal(topicDirection("短款羽绒服女"), "jackets");
  assert.equal(topicDirection("男士夹克"), null);
  assert.equal(topicDirection("童装外套"), null);
  const model = { bizData: { "1688": { hot: {
    detail: [
      { topic: "通勤托特包", rank: 2, content: [{ searchWord: "大容量托特包女", text: "**1688相关搜索增速59.06%** ￥39" }] },
      { topic: "一字拖女夏款", rank: 1, content: [] },
    ],
    graphic: { list: [{ topic: "通勤托特包", count: "+120%", isUp: true, rank: 2 }] },
  } } } };
  const topics = parseOpportunities(model);
  assert.deepEqual(topics, [{ platform: "1688", section: "hot", rank: 2, topic: "通勤托特包", count: "+120%", isUp: true, words: [{ word: "大容量托特包女", growthPct: 59.06 }], direction: "bags" }]);
});

test("ниши из пробы 06.10: 9 курточных и 8 сумочных + 4 формы CLÉRIN, ключи уникальны, ключи тренда — не длиннее 5 иероглифов", () => {
  assert.equal(CHINA_NICHES.length, 21);
  assert.equal(CHINA_NICHES.filter((n) => n.direction === "jackets").length, 9);
  assert.equal(CHINA_NICHES.filter((n) => n.direction === "bags" && !n.clerin).length, 8);
  assert.equal(CHINA_NICHES.filter((n) => n.clerin).length, 4);
  assert.equal(new Set(CHINA_NICHES.map((n) => n.key)).size, 21);
  for (const n of CHINA_NICHES) {
    assert.match(n.zh[0], /\p{Script=Han}/u, n.key);
    assert.ok((n.trendKey.match(/\p{Script=Han}/gu) ?? []).length <= 5, n.key);
    assert.ok(n.ru.length > 0);
    if (n.direction === "jackets") assert.match(n.zh[0], /女/, `${n.key}: куртки — только женское`);
  }
});

// ---------------------------------------------------------------------------
// Миграция

function migrationColumns(table: string): Set<string> {
  const block = new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? "";
  return new Set(block.split("\n").map((l) => /^\s{2}([a-z_0-9]+)\s+/.exec(l)?.[1]).filter((c): c is string => Boolean(c) && c !== "primary"));
}

test("миграция: один новый файл со свободным номером, три таблицы, ключи как в спецификации, RLS и revoke у каждой", () => {
  const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.startsWith("2026100700") || /assortment_china|assortment_cn/.test(f));
  assert.deepEqual(files, [MIGRATION_FILE]);
  const number = MIGRATION_FILE.slice(0, 12);
  assert.ok(!(number >= "202610060006" && number <= "202610060011"), "не номера 202610060006–0011");
  assert.equal(readdirSync(join(root, "supabase/migrations")).filter((f) => f.startsWith(`${number}_`)).length, 1, "номер не занят другим файлом");
  const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables, ["assortment_cn_offer_snapshot", "assortment_cn_article_snapshot", "assortment_cn_trend_snapshot"]);
  for (const t of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security;`), t);
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from anon, authenticated;`), t);
  }
  assert.match(sql, /primary key \(niche_key, observed_on, offer_id\)/);
  assert.match(sql, /primary key \(ref_key, observed_on\)/);
  assert.match(sql, /primary key \(list_key, observed_on, rank\)/);
  for (const c of ["provider", "niche_key", "direction", "observed_on", "rank", "offer_id", "title_zh", "title_ru", "image_url", "category", "sold_text", "sold_min", "sellers", "is_new", "tags"]) assert.ok(migrationColumns("assortment_cn_offer_snapshot").has(c), c);
  for (const c of ["ref_key", "observed_on", "offers", "sellers", "sample_offer_ids"]) assert.ok(migrationColumns("assortment_cn_article_snapshot").has(c), c);
  for (const c of ["provider", "list_key", "observed_on", "rank", "keyword_zh", "keyword_ru", "value_text", "direction"]) assert.ok(migrationColumns("assortment_cn_trend_snapshot").has(c), c);
  assert.doesNotMatch(sql, /^\s*(alter|drop|update|delete|insert)\s+(?!table public\.assortment_cn_\w+ enable row level security)/im, "ничего существующего не меняет");
});

test("сторож границ: в таблицах Китая нет колонок цены, себестоимости, маржи, валюты, продавца и магазина (sellers — только число)", () => {
  for (const table of ["assortment_cn_offer_snapshot", "assortment_cn_article_snapshot", "assortment_cn_trend_snapshot"]) {
    const cols = migrationColumns(table);
    assert.ok(cols.size >= 6, table);
    for (const c of cols) {
      assert.doesNotMatch(c, /price|cost|margin|currency|spp|moq|budget|shop|company|store|member|user|^seller$|seller_|supplier|factory/i, `${table}.${c}`);
    }
  }
  assert.match(sql, /sellers\s+integer/);
});

// ---------------------------------------------------------------------------
// Подставная база

type Row = Record<string, unknown>;
const POSTGREST_MAX_ROWS = 1000;
const COLUMNS: Record<string, Set<string>> = {
  assortment_cn_offer_snapshot: new Set([...migrationColumns("assortment_cn_offer_snapshot")]),
  assortment_cn_article_snapshot: new Set([...migrationColumns("assortment_cn_article_snapshot")]),
  assortment_cn_trend_snapshot: new Set([...migrationColumns("assortment_cn_trend_snapshot")]),
  assortment_ai_usage: new Set(["day", "kind", "calls", "failed_calls", "input_tokens", "output_tokens", "cost_usd", "updated_at"]),
  assortment_sources: new Set(["source_id", "capabilities"]),
};
const KEYS: Record<string, string[]> = {
  assortment_cn_offer_snapshot: ["niche_key", "observed_on", "offer_id"], assortment_cn_article_snapshot: ["ref_key", "observed_on"], assortment_cn_trend_snapshot: ["list_key", "observed_on", "rank"],
  assortment_ai_usage: ["day", "kind"], assortment_sources: ["source_id"],
};

interface FakeInit { tables?: Record<string, Row[]>; missing?: string[] }

function fakeDb(init: FakeInit = {}) {
  const tables: Record<string, Row[]> = {
    assortment_cn_offer_snapshot: [], assortment_cn_article_snapshot: [], assortment_cn_trend_snapshot: [], assortment_ai_usage: [],
    assortment_sources: [{ source_id: CHINA_SOURCE_ID, capabilities: { note: "паспорт" } }], assortment_social_post: [],
    ...(init.tables ?? {}),
  };
  const missing = new Set(init.missing ?? []);
  const log: Array<{ table: string; op: string }> = [];
  const checkColumns = (table: string, row: Row) => {
    const allowed = COLUMNS[table];
    if (!allowed) return null;
    const bad = Object.keys(row).filter((c) => !allowed.has(c));
    return bad.length ? { code: "PGRST204", message: `Could not find the '${bad[0]}' column of '${table}' in the schema cache` } : null;
  };
  const db = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "update" = "select";
      let values: Row = {};
      let returning = false;
      let range: [number, number] | null = null;
      let limit: number | null = null;
      const missErr = { code: "42P01", message: `relation "public.${table}" does not exist` };
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const exec = () => {
        if (missing.has(table)) return { data: null, error: missErr };
        if (op === "update") {
          const err = checkColumns(table, values);
          if (err) return { data: null, error: err };
          const hit = rows();
          for (const r of hit) Object.assign(r, structuredClone(values));
          log.push({ table, op: "update" });
          return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
        }
        log.push({ table, op: "select" });
        let list = rows().map((r) => structuredClone(r));
        if (range) list = list.slice(range[0], Math.min(range[1] + 1, range[0] + POSTGREST_MAX_ROWS));
        else list = list.slice(0, Math.min(limit ?? POSTGREST_MAX_ROWS, POSTGREST_MAX_ROWS));
        return { data: list, error: null };
      };
      const q: Record<string, unknown> = {
        select: () => {
          if (op === "update") returning = true;
          return q;
        },
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        gte: (c: string, v: unknown) => (filters.push((r) => r[c] != null && String(r[c]) >= String(v)), q),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
        not: (c: string, operator: string, v: unknown) => {
          if (operator !== "is" || v !== null) throw new Error(`подставка: not(${operator})`);
          filters.push((r) => r[c] != null);
          return q;
        },
        order: () => q,
        limit: (n: number) => {
          limit = n;
          return Promise.resolve(exec());
        },
        range: (a: number, b: number) => {
          range = [a, b];
          return Promise.resolve(exec());
        },
        maybeSingle: () => {
          const res = exec();
          return Promise.resolve(res.error ? res : { data: (res.data as Row[])[0] ?? null, error: null });
        },
        update: (v: Row) => {
          op = "update";
          values = v;
          return q;
        },
        insert: (row: Row) => {
          if (missing.has(table)) return Promise.resolve({ error: missErr });
          const err = checkColumns(table, row);
          if (err) return Promise.resolve({ error: err });
          const k = KEYS[table];
          if (k && (tables[table] ?? []).some((r) => k.every((c) => r[c] === row[c]))) return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
          (tables[table] ??= []).push(structuredClone(row));
          log.push({ table, op: "insert" });
          return Promise.resolve({ error: null });
        },
        upsert: (input: Row | Row[], options: { onConflict?: string } = {}) => {
          if (missing.has(table)) return Promise.resolve({ error: missErr });
          const list = Array.isArray(input) ? input : [input];
          const shape = list.length ? Object.keys(list[0]).sort().join(",") : "";
          if (list.some((r) => Object.keys(r).sort().join(",") !== shape)) return Promise.resolve({ error: { code: "PGRST102", message: "All object keys must match" } });
          const keys = (options.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
          if (keys.join(",") !== (KEYS[table] ?? []).join(",")) return Promise.resolve({ error: { message: `подставка: onConflict ${options.onConflict} не ключ ${table}` } });
          const seen = new Set<string>();
          for (const row of list) {
            const err = checkColumns(table, row);
            if (err) return Promise.resolve({ error: err });
            const id = keys.map((k) => String(row[k])).join("|");
            if (seen.has(id)) return Promise.resolve({ error: { code: "21000", message: "ON CONFLICT DO UPDATE command cannot affect row a second time" } });
            seen.add(id);
          }
          for (const row of list) {
            const existing = (tables[table] ??= []).find((r) => keys.every((k) => r[k] === row[k]));
            if (existing) Object.assign(existing, structuredClone(row));
            else tables[table].push(structuredClone(row));
          }
          log.push({ table, op: "upsert" });
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(exec()).then(resolve, reject),
      };
      return q;
    },
  };
  return { db: db as never, tables, log };
}

// ---------------------------------------------------------------------------
// Прогон

const MONDAY = Date.parse("2026-10-05T07:00:00Z"); // понедельник, 10:00 МСК
const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
const WIDE: ChinaConfig = { ...chinaConfig({}), maxCallsPerRun: 100, weeklyCalls: 500 };

const posts = (nowMs: number): Row[] => [
  { platform: "instagram", code: "p1", published_at: new Date(nowMs - 3 * DAY).toISOString(), refs: ["zara:8372288"], brand: "zara", direction: "jackets", verdict: "viral", likes: 900, match_status: "catalog", match_gender: "women", hidden_at: null },
  { platform: "instagram", code: "p2", published_at: new Date(nowMs - 5 * DAY).toISOString(), refs: ["uniqlo:487517"], brand: "uniqlo", direction: "jackets", verdict: "strong", likes: 500, match_status: "brand_site", match_gender: "women", hidden_at: null },
  { platform: "instagram", code: "p3", published_at: new Date(nowMs - 2 * DAY).toISOString(), refs: ["zara:1111111"], brand: "zara", direction: "jackets", verdict: "strong", likes: 900, match_status: "men", match_gender: "men", hidden_at: null },
  { platform: "instagram", code: "p4", published_at: new Date(nowMs - 40 * DAY).toISOString(), refs: ["zara:2222222"], brand: "zara", direction: "jackets", verdict: "strong", likes: 900, match_status: null, match_gender: null, hidden_at: null },
];

const OPPORTUNITIES_WITH_BAG = {
  bizData: {
    ...(SK_OPPORTUNITIES.model as { bizData: Record<string, unknown> }).bizData,
    taobao: { hot: { detail: [{ topic: "通勤托特包", rank: 1, content: [{ searchWord: "大容量托特包女", text: "**搜索增速59.06%**" }] }], graphic: { list: [{ topic: "通勤托特包", count: "+120%", isUp: true }] } } },
  },
};

interface Served { host: string; path: string; body: Record<string, unknown> }

/** Подставной 1688: ниши сумок — выдача 腋下包, курток — 女士夹克; номера — выдачи с псевдонимом; тренды и «возможности» — образцы. */
function fakeCaller(over: { fail?: (b: Served, n: number) => Error | null; clock?: { now: number; step: number } } = {}) {
  const served: Served[] = [];
  const call: ChinaCaller = async (host, path, body) => {
    served.push({ host, path, body });
    if (over.clock) over.clock.now += over.clock.step;
    const err = over.fail?.({ host, path, body }, served.length);
    if (err) throw err;
    if (host === "gateway") {
      const q = String(body.query);
      if (q.startsWith("ZA ")) return G_ZARA.data;
      if (q.startsWith("U家 ")) return G_UNIQLO.data;
      const niche = CHINA_NICHES.find((n) => n.zh[0] === q);
      return niche?.direction === "jackets" ? G_JACKETS.data : G_BAGS.data;
    }
    if (body.code === "offer_opportunity") return OPPORTUNITIES_WITH_BAG;
    const query = String((body.bizParams as { query: string }).query);
    const niche = CHINA_NICHES.find((n) => n.trendKey === query);
    return niche?.direction === "jackets" ? SK_TREND_JACKETS.model : SK_TREND_BAGS.model;
  };
  return { call, served };
}

function fakeTranslator(price = { in: 0.07, out: 0.29 }) {
  const batches: string[][] = [];
  const setup: TranslateSetup = {
    model: "google/gemini-2.5-flash-lite",
    price,
    reason: null,
    translate: async (texts) => {
      batches.push(texts);
      return { texts: texts.map((t, i) => `перевод ${i}: ${t.slice(0, 4)}`), inputTokens: 100 * texts.length, outputTokens: 50 * texts.length, costUsd: 0.0001 * texts.length };
    },
  };
  return { setup, batches };
}

function opts(over: Partial<RunChinaOptions> & Pick<RunChinaOptions, "call">, nowMs = MONDAY): RunChinaOptions {
  return { env: ENV, config: WIDE, deadlineMs: nowMs + 10 * 60 * 1000, clock: () => nowMs, sleep: noSleep, ...over };
}

/** Строки топа ниши, как их пишет прогон, — для подставной базы. */
const snapshotRows = (niche: (typeof CHINA_NICHES)[number], week: string, data: unknown): Row[] => nicheRows(niche, week, data, 40) as unknown as Row[];

const usageCalls = (tables: Record<string, Row[]>, kind: string) => (tables.assortment_ai_usage ?? []).filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.calls ?? 0), 0);

test("без ключа ALI_1688_AK прогон не начинается и в базу не ходит: причина одной строкой", async () => {
  const { db, log } = fakeDb();
  const { call, served } = fakeCaller();
  const s = await runChinaSnapshot(db, opts({ call, env: {} }));
  assert.equal(s.skippedBecause, "no_key");
  assert.equal(s.skipped, "ключ 1688 не задан (ALI_1688_AK)");
  assert.equal(served.length, 0);
  assert.equal(log.length, 0);
});

test("без миграции прогон тихо выходит с причиной и без вызовов 1688; выключатель off — тоже без вызовов", async () => {
  const { db } = fakeDb({ missing: ["assortment_cn_offer_snapshot", "assortment_cn_article_snapshot", "assortment_cn_trend_snapshot"] });
  const { call, served } = fakeCaller();
  const s = await runChinaSnapshot(db, opts({ call }));
  assert.equal(s.skippedBecause, "no_migration");
  assert.match(String(s.skipped), /202610070001_assortment_china_1688\.sql/);
  assert.equal(served.length, 0);
  const off = await runChinaSnapshot(fakeDb().db, opts({ call, config: { ...WIDE, enabled: false } }));
  assert.equal(off.skippedBecause, "off");
  assert.equal(served.length, 0);
  const noUsage = await runChinaSnapshot(fakeDb({ missing: ["assortment_ai_usage"] }).db, opts({ call }));
  assert.equal(noUsage.skippedBecause, "no_usage", "без учёта запросов лимиты нечем считать — не начинаем");
  assert.equal(served.length, 0);
});

test("недельный снимок целиком: ниши, номера, тренды, «возможности»; колонки — как в миграции, цен и продавцов в строках нет; запросы — в учёте", async () => {
  const { db, tables } = fakeDb({ tables: { assortment_social_post: posts(MONDAY) } });
  const { call, served } = fakeCaller();
  const tr = fakeTranslator();
  const s = await runChinaSnapshot(db, opts({ call, translator: tr.setup }));
  assert.equal(s.week, "2026-10-05");
  assert.deepEqual(s.refs, ["uniqlo:487517", "zara:8372288"], "мужской и старше 30 дней — не берём");
  assert.equal(served.length, 21 + 2 + 21 + 1);
  assert.equal(s.calls, 45);
  assert.equal(s.complete, true);
  assert.equal(s.stoppedBy, null);
  assert.deepEqual(s.byPhase.niches, { total: 21, closed: 21, done: 21, empty: 0, failed: 0 });
  const offers = tables.assortment_cn_offer_snapshot;
  assert.equal(new Set(offers.map((r) => r.niche_key)).size, 21);
  assert.equal(offers.filter((r) => r.direction === "bags").length, 12 * 39);
  assert.equal(offers.filter((r) => r.direction === "jackets").length, 9 * 19);
  assert.ok(offers.every((r) => r.observed_on === "2026-10-05" && r.provider === "1688"));
  const underarm = offers.filter((r) => r.niche_key === "underarm");
  assert.equal(underarm[0].sellers, 33 - 0, "разных продавцов в топе — числом");
  assert.ok(!underarm.some((r) => r.offer_id === "981988980742"), "реклама не в топе");
  assert.equal(underarm.filter((r) => r.is_new).length, 0, "в выдаче 腋下包 карточек моложе 45 дней нет (оценка по номеру)");
  assert.deepEqual(offers.filter((r) => r.niche_key === "bomber" && r.is_new).map((r) => r.offer_id).sort(), ["1080937217046", "1084197388228"]);
  assert.ok(underarm.find((r) => r.offer_id === "962784378968")!.tags instanceof Array && (underarm.find((r) => r.offer_id === "962784378968")!.tags as string[]).includes("yx"), "значок подборки «严选»");
  assert.doesNotMatch(JSON.stringify(tables.assortment_cn_offer_snapshot), LEAK_RE);
  assert.doesNotMatch(JSON.stringify(tables.assortment_cn_article_snapshot), LEAK_RE);
  assert.doesNotMatch(JSON.stringify(tables.assortment_cn_trend_snapshot), LEAK_RE);
  const zara = tables.assortment_cn_article_snapshot.find((r) => r.ref_key === "zara:8372288")!;
  assert.deepEqual([zara.offers, zara.sellers, zara.direction], [3, 3, "jackets"]);
  assert.equal(tables.assortment_cn_article_snapshot.find((r) => r.ref_key === "uniqlo:487517")!.offers, 2);
  const market = tables.assortment_cn_trend_snapshot.find((r) => r.list_key === "market:underarm")!;
  assert.equal(market.keyword_zh, "腋下包");
  assert.equal(JSON.parse(String(market.value_text)).buyers, 7729.2);
  const opp = tables.assortment_cn_trend_snapshot.filter((r) => String(r.list_key).startsWith("opportunity:"));
  assert.deepEqual(opp.map((r) => [r.list_key, r.keyword_zh, r.direction]), [["opportunity:taobao:hot", "通勤托特包", "bags"]]);
  assert.equal(usageCalls(tables, CHINA_USAGE_KIND), 45, "запросы 1688 — в учёте");
  assert.equal(tables.assortment_ai_usage.filter((r) => r.kind === CHINA_USAGE_KIND).every((r) => Number(r.cost_usd) === 0), true, "0 $");
  const state = readChinaState(tables.assortment_sources[0].capabilities);
  assert.equal(state.week, "2026-10-05");
  assert.ok(state.completedAt);
  assert.equal((tables.assortment_sources[0].capabilities as Row).note, "паспорт", "остальные capabilities источника не затёрты");
  // Перевод: уникальные карточки топа и тема — пачками по 40, расход в учёте движка.
  assert.equal(s.translated, 39 + 19 + 1);
  assert.deepEqual(tr.batches.map((b) => b.length), [40, 19]);
  assert.ok(offers.every((r) => typeof r.title_ru === "string" && String(r.title_ru).startsWith("перевод")));
  assert.equal(usageCalls(tables, CHINA_TRANSLATE_KIND), 2);
  assert.ok(Math.abs(engineWeek(tables.assortment_ai_usage as never).byKind[CHINA_TRANSLATE_KIND] - 0.0059) < 1e-9, "перевод входит в недельный итог движка");
  assert.equal(chinaRunLog(s).status, "ok");
});

test("снимок готов — следующие прогоны недели без работы; новый понедельник — новый снимок, прошлый остаётся для сравнения", async () => {
  const { db, tables } = fakeDb({ tables: { assortment_social_post: posts(MONDAY) } });
  const first = fakeCaller();
  await runChinaSnapshot(db, opts({ call: first.call }));
  const again = fakeCaller();
  const s = await runChinaSnapshot(db, opts({ call: again.call }, MONDAY + 2 * DAY));
  assert.equal(s.skippedBecause, "idle");
  assert.equal(again.served.length, 0);
  const next = fakeCaller();
  const n = await runChinaSnapshot(db, opts({ call: next.call }, MONDAY + 7 * DAY));
  assert.equal(n.week, "2026-10-12");
  assert.equal(next.served.length, 45);
  assert.deepEqual([...new Set(tables.assortment_cn_offer_snapshot.map((r) => r.observed_on))].sort(), ["2026-10-05", "2026-10-12"]);
  assert.equal(chinaWeekOf(Date.parse("2026-10-11T20:59:00Z")), "2026-10-05", "воскресенье 23:59 МСК — ещё прошлая неделя");
  assert.equal(chinaWeekOf(Date.parse("2026-10-11T21:00:00Z")), "2026-10-12", "понедельник 00:00 МСК — новая");
});

test("потолок прогона и время: остановка с хвостом, следующий прогон доделывает недоделанное без повторов", async () => {
  const { db, tables } = fakeDb({ tables: { assortment_social_post: posts(MONDAY) } });
  const a = fakeCaller();
  const s = await runChinaSnapshot(db, opts({ call: a.call, config: { ...WIDE, maxCallsPerRun: 5 } }));
  assert.equal(s.calls, 5);
  assert.equal(s.stoppedBy, "run_cap");
  assert.equal(s.complete, false);
  assert.equal(chinaRunLog(s).status, "partial");
  const clock = { now: MONDAY + HOUR, step: 20_000 };
  const b = fakeCaller({ clock });
  const t = await runChinaSnapshot(db, { ...opts({ call: b.call }, MONDAY + HOUR), clock: () => clock.now, deadlineMs: MONDAY + HOUR + 270_000 });
  assert.equal(t.stoppedBy, "time");
  assert.ok(b.served.length > 0 && b.served.length < 40);
  const bQueries = b.served.map((x) => String(x.body.query ?? ""));
  assert.ok(!bQueries.includes(CHINA_NICHES[0].zh[0]), "сделанная ниша не повторяется");
  const c = fakeCaller();
  const u = await runChinaSnapshot(db, opts({ call: c.call }, MONDAY + 2 * HOUR));
  assert.equal(u.complete, true);
  assert.equal(5 + b.served.length + c.served.length, 45, "каждая задача — один вызов за неделю");
  assert.equal(usageCalls(tables, CHINA_USAGE_KIND), 45);
});

test("потолок недели: 150 запросов за 7 суток — новых вызовов нет", async () => {
  const { db } = fakeDb({ tables: { assortment_ai_usage: [{ day: "2026-10-03", kind: CHINA_USAGE_KIND, calls: 150, failed_calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0, updated_at: "2026-10-03T10:00:00Z" }] } });
  const { call, served } = fakeCaller();
  const s = await runChinaSnapshot(db, opts({ call, config: { ...WIDE, weeklyCalls: 150 } }));
  assert.equal(s.stoppedBy, "week_cap");
  assert.equal(served.length, 0);
  assert.equal(s.weekCalls, 150);
});

test("лимит 1688 (Qos / 429): стоп без траты попытки задачи, пауза следующих прогонов, после паузы — продолжение с той же задачи", async () => {
  const { db, tables } = fakeDb();
  const limited = fakeCaller({ fail: (_b, n) => (n === 3 ? classifyBizError({ code: "QosAppFrequencyLimit" }) : null) });
  const s = await runChinaSnapshot(db, opts({ call: limited.call }));
  assert.equal(s.stoppedBy, "rate_limit");
  assert.equal(limited.served.length, 3);
  assert.equal(s.stopMessage, CHINA_STOP_WORDS.rate_limit);
  const state = readChinaState(tables.assortment_sources[0].capabilities);
  assert.equal(state.stop?.reason, "rate_limit");
  assert.equal(state.marks[`niche:${CHINA_NICHES[2].key}`], undefined, "попытка задачи не потрачена");
  assert.equal(chinaRunLog(s).status, "partial");
  const soon = fakeCaller();
  const p = await runChinaSnapshot(db, opts({ call: soon.call }, MONDAY + RATE_LIMIT_PAUSE_MS - 60_000));
  assert.equal(p.skippedBecause, "rate_limit_pause");
  assert.equal(soon.served.length, 0);
  const later = fakeCaller();
  const l = await runChinaSnapshot(db, opts({ call: later.call }, MONDAY + RATE_LIMIT_PAUSE_MS + 60_000));
  assert.equal(later.served[0].body.query, CHINA_NICHES[2].zh[0], "та же задача — первой");
  assert.equal(l.complete, true);
  assert.equal(readChinaState(tables.assortment_sources[0].capabilities).stop, null, "удачный вызов снимает остановку");
});

test("ключ не принят (SignatureInvalid): остановка одной причиной, журнал — error, блок на экране скрыт с этой причиной", async () => {
  const { db, tables } = fakeDb();
  const bad = fakeCaller({ fail: () => classifyBizError({ code: "SignatureInvalid" }) });
  const s = await runChinaSnapshot(db, opts({ call: bad.call }));
  assert.equal(s.stoppedBy, "auth");
  assert.equal(bad.served.length, 1, "после ключа — ни одного вызова");
  const log = chinaRunLog(s);
  assert.equal(log.status, "error");
  assert.match(String(log.note), /^ключ 1688 недействителен/);
  assert.equal(readChinaState(tables.assortment_sources[0].capabilities).stop?.reason, "auth");
  // Даже со старым снимком блок скрыт.
  tables.assortment_cn_offer_snapshot.push(...snapshotRows(CHINA_NICHES.find((n) => n.key === "underarm")!, "2026-09-28", G_BAGS.data));
  const view = await loadChinaView(db, { direction: "bags", nowMs: MONDAY, env: ENV });
  assert.deepEqual(view, { available: false, reason: CHINA_STOP_WORDS.auth });
});

test("временный сбой задачи: попытка тратится, после трёх неудач задача недели закрывается как неудавшаяся; остальное снимается", async () => {
  const { db, tables } = fakeDb();
  const target = CHINA_NICHES[0].zh[0];
  const flaky = () => fakeCaller({ fail: (b) => (b.body.query === target ? new China1688Error("1688: временный сбой (HTTP 503)", "transient") : null) });
  const runs: ChinaRunSummary[] = [];
  for (let run = 0; run < MAX_TASK_ATTEMPTS; run += 1) {
    const f = flaky();
    runs.push(await runChinaSnapshot(db, opts({ call: f.call }, MONDAY + run * HOUR)));
    assert.equal(f.served.filter((x) => x.body.query === target).length, 1, `прогон ${run + 1}: одна попытка`);
  }
  const last = runs.at(-1);
  assert.equal(chinaRunLog(runs[0]).status, "partial", "сбой при сделанном — partial");
  assert.equal(runs[0].complete, false);
  const state = readChinaState(tables.assortment_sources[0].capabilities);
  assert.equal(state.marks[`niche:${CHINA_NICHES[0].key}`].status, "failed");
  assert.equal(state.marks[`niche:${CHINA_NICHES[0].key}`].attempts, MAX_TASK_ATTEMPTS);
  assert.equal(last!.complete, true, "неудавшаяся задача закрыта — снимок недели завершён");
  assert.equal(last!.byPhase.niches.failed, 1);
  assert.equal(chinaRunLog(last!).status, "error", "прогон, где единственная задача не удалась, — error");
  const idle = fakeCaller();
  assert.equal((await runChinaSnapshot(db, opts({ call: idle.call }, MONDAY + 5 * HOUR))).skippedBecause, "idle");
  const all = fakeCaller({ fail: () => new China1688Error("1688: временный сбой", "transient") });
  const bad = await runChinaSnapshot(fakeDb().db, opts({ call: all.call }));
  assert.equal(chinaRunLog(bad).status, "error", "ни одна задача прогона не удалась — error");
});

test("прогресс пишется после каждой задачи: оборванный прогон не теряет отметку «пусто», следующий её не повторяет", async () => {
  const { db, tables } = fakeDb();
  const emptyQuery = CHINA_NICHES[0].zh[0];
  const crash = fakeCaller({ fail: (_b, n) => (n === 3 ? new Error("платформа оборвала функцию") : null) });
  const wrapped: ChinaCaller = async (host, path, body) => {
    const out = await crash.call(host, path, body);
    return body.query === emptyQuery ? { count: 0, data: [] } : out;
  };
  await assert.rejects(runChinaSnapshot(db, opts({ call: wrapped })), /платформа оборвала/);
  const state = readChinaState(tables.assortment_sources[0].capabilities);
  assert.equal(state.marks[`niche:${CHINA_NICHES[0].key}`]?.status, "empty");
  assert.equal(state.marks[`niche:${CHINA_NICHES[1].key}`]?.status, "done");
  const next = fakeCaller();
  await runChinaSnapshot(db, opts({ call: next.call }, MONDAY + HOUR));
  assert.ok(!next.served.some((x) => x.body.query === emptyQuery), "пустая ниша недели не повторяется");
});

test("замок: идёт другой прогон — этот не начинается", async () => {
  const { db } = fakeDb({ tables: { assortment_ai_usage: [{ day: "2026-10-05", kind: `lock:${CHINA_USAGE_KIND}`, calls: 0, failed_calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0, updated_at: new Date(MONDAY - 60_000).toISOString() }] } });
  const { call, served } = fakeCaller();
  const s = await runChinaSnapshot(db, opts({ call }));
  assert.equal(s.skippedBecause, "busy");
  assert.equal(served.length, 0);
});

test("dryRun и phase: план без вызовов и записей; phase=articles — только номера", async () => {
  const { db, log } = fakeDb({ tables: { assortment_social_post: posts(MONDAY) } });
  const { call, served } = fakeCaller();
  const dry = await runChinaSnapshot(db, opts({ call, dryRun: true }));
  assert.equal(served.length, 0);
  assert.equal(dry.byPhase.niches.total, 21);
  assert.equal(dry.byPhase.articles.total, 2);
  assert.ok(!log.some((l) => l.op !== "select"), "dryRun ничего не пишет");
  const s = await runChinaSnapshot(db, opts({ call, phase: "articles" }));
  assert.deepEqual(served.map((x) => String(x.body.query).split(" ")[0]), ["U家", "ZA"]);
  assert.equal(s.complete, false);
});

test("перевод: уже переведённые карточки прошлых недель не переводятся заново; без ключа Polza — китайские названия и причина", async () => {
  const { db, tables } = fakeDb();
  const underarm = CHINA_NICHES.find((n) => n.key === "underarm")!;
  const prev = snapshotRows(underarm, "2026-09-28", G_BAGS.data).map((r): Row => ({ ...r, title_ru: `старый перевод ${String(r.offer_id)}` }));
  tables.assortment_cn_offer_snapshot.push(...prev);
  const tr = fakeTranslator();
  await runChinaSnapshot(db, opts({ call: fakeCaller().call, translator: tr.setup }));
  const now = tables.assortment_cn_offer_snapshot.filter((r) => r.observed_on === "2026-10-05" && r.niche_key === "underarm");
  assert.ok(now.every((r) => String(r.title_ru).startsWith("старый перевод")), "перевод взят из прошлого снимка");
  assert.ok(!tr.batches.flat().includes(String(prev[0].title_zh)), "и не покупался заново");
  const none = chinaTranslatorFromEnv({});
  assert.equal(none.translate, null);
  assert.equal(none.reason, "нет ключа Polza — названия на китайском");
  const { db: db2, tables: t2 } = fakeDb();
  const s = await runChinaSnapshot(db2, opts({ call: fakeCaller().call, translator: none }));
  assert.equal(s.translateSkipped, "нет ключа Polza — названия на китайском");
  assert.ok(t2.assortment_cn_offer_snapshot.every((r) => r.title_ru === null));
});

test("перевод-мусор не покупается каждый прогон: не больше TRANSLATE_CALLS_PER_WEEK вызовов за неделю снимка, дальше — китайские названия", async () => {
  const { db, tables } = fakeDb();
  let calls = 0;
  const garbage: TranslateSetup = {
    model: "google/gemini-2.5-flash-lite", price: { in: 0.07, out: 0.29 }, reason: null,
    translate: async (texts) => {
      calls += 1;
      return { texts: texts.map(() => null), inputTokens: 10, outputTokens: 10, costUsd: 0.0001 };
    },
  };
  await runChinaSnapshot(db, opts({ call: fakeCaller().call, translator: garbage }));
  assert.equal(calls, 2);
  let last: ChinaRunSummary | null = null;
  for (let run = 1; run <= 8; run += 1) last = await runChinaSnapshot(db, opts({ call: fakeCaller().call, translator: garbage }, MONDAY + run * HOUR));
  assert.equal(calls, TRANSLATE_CALLS_PER_WEEK);
  assert.equal(last!.skippedBecause, "idle", "вызовы перевода недели исчерпаны — работы нет");
  assert.equal(readChinaState(tables.assortment_sources[0].capabilities).translateCalls, TRANSLATE_CALLS_PER_WEEK);
  assert.equal(usageCalls(tables, CHINA_TRANSLATE_KIND), TRANSLATE_CALLS_PER_WEEK, "каждый вызов — в учёте расхода");
  // Остался один вызов недели — прогон делает ровно один, хотя названий на две пачки.
  const one = fakeDb({ tables: { assortment_sources: [{ source_id: CHINA_SOURCE_ID, capabilities: { china: { week: "2026-10-05", translateCalls: TRANSLATE_CALLS_PER_WEEK - 1 } } }] } });
  calls = 0;
  const s = await runChinaSnapshot(one.db, opts({ call: fakeCaller().call, translator: garbage }));
  assert.equal(calls, 1);
  assert.match(String(s.translateSkipped), /исчерпал/);
});

test("перевод упирается в общий потолок движка: остаток статьи ниже оценки пачки — не переводим, причина словами", async () => {
  const spent = { day: "2026-10-04", kind: ENGINE_KIND.catalogAi, calls: 1, failed_calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 20.05, updated_at: "2026-10-04T10:00:00Z" };
  const { db, tables } = fakeDb({ tables: { assortment_ai_usage: [spent] } });
  const tr = fakeTranslator();
  const s = await runChinaSnapshot(db, opts({ call: fakeCaller().call, translator: tr.setup }));
  assert.equal(tr.batches.length, 0);
  assert.match(String(s.translateSkipped), /^общий потолок движка/);
  assert.equal(usageCalls(tables, CHINA_TRANSLATE_KIND), 0);
  assert.equal(isEngineKind(CHINA_TRANSLATE_KIND), true);
  assert.equal(kindTier(CHINA_TRANSLATE_KIND), 2, "перевод отказывает раньше каталогов");
});

test("переводчик Polza: дешёвая модель, ответ — JSON-массив той же длины без сумм; 402 — остановка перевода", async () => {
  const f = fakeFetch([{ status: 200, body: { choices: [{ message: { content: "```json\n[\"Сумка под мышку ￥35\", \"Тоут\"]\n```" } }], usage: { prompt_tokens: 120, completion_tokens: 30, cost_rub: 0.08 } } }]);
  const setup = chinaTranslatorFromEnv({ POLZA_API_KEY: "test-polza" }, f.impl);
  assert.equal(setup.model, "google/gemini-2.5-flash-lite");
  const r = await setup.translate!(["腋下包", "托特包"]);
  assert.deepEqual(r.texts, ["Сумка под мышку", "Тоут"]);
  assert.equal(r.costUsd, 0.001, "факт Polza: 0,08 ₽ по курсу 80");
  assert.equal(JSON.parse(String(f.calls[0].init.body)).model, "google/gemini-2.5-flash-lite");
  assert.deepEqual(parseTranslations("[\"a\"]", 2), [null, null], "длина не совпала — ничего не пишем");
  const g = fakeFetch([{ status: 402, body: { error: { code: "INSUFFICIENT_BALANCE" } } }]);
  await assert.rejects(chinaTranslatorFromEnv({ POLZA_API_KEY: "test-polza" }, g.impl).translate!(["x"]), (e: unknown) => e instanceof TranslateStopError && e.code === "billing");
  assert.match(String(chinaTranslatorFromEnv({ POLZA_API_KEY: "k", ASSORTMENT_CHINA_TRANSLATE_MODEL: "unknown/model" }).reason), /нет цены модели/);
});

// ---------------------------------------------------------------------------
// Чтение для экрана

test("неделя к неделе: нет в прошлом топе — «новое», позиция выше на ≥3 — «поднялось», ниже на ≥3 — «опустилось»; без прошлого снимка — null", () => {
  const prev = [{ offer_id: "a", rank: 10 }, { offer_id: "b", rank: 5 }, { offer_id: "c", rank: 3 }, { offer_id: "d", rank: 4 }];
  const cur = [{ offer_id: "a", rank: 7 }, { offer_id: "b", rank: 3 }, { offer_id: "c", rank: 6 }, { offer_id: "d", rank: 4 }, { offer_id: "e", rank: 1 }];
  const m = compareTop(cur, prev);
  assert.equal(ROSE_MIN_POSITIONS, 3);
  assert.deepEqual(m.get("a"), { kind: "rose", from: 10, to: 7 });
  assert.deepEqual(m.get("b"), { kind: "same" }, "на 2 места — выдача гуляет сама");
  assert.deepEqual(m.get("c"), { kind: "fell", from: 3, to: 6 });
  assert.deepEqual(m.get("d"), { kind: "same" });
  assert.deepEqual(m.get("e"), { kind: "new" });
  assert.equal(compareTop(cur, null).get("e"), null);
});

test("копии по номерам: последний снимок и прирост за неделю; без прошлого снимка прирост не выдумывается", () => {
  const cards = articleCards([
    { ref_key: "zara:8372288", observed_on: "2026-09-28", direction: "jackets", offers: 1, sellers: 1, sample_offer_ids: [] },
    { ref_key: "zara:8372288", observed_on: "2026-10-05", direction: "jackets", offers: 3, sellers: 3, sample_offer_ids: ["1080947777395"] },
    { ref_key: "uniqlo:487517", observed_on: "2026-10-05", direction: "jackets", offers: 2, sellers: 2, sample_offer_ids: ["1083094378976"] },
  ]);
  assert.deepEqual(cards.map((c) => [c.refKey, c.offers, c.delta, c.previousOn]), [["zara:8372288", 3, 2, "2026-09-28"], ["uniqlo:487517", 2, null, null]]);
  assert.deepEqual(cards[0].sampleUrls, ["https://detail.1688.com/offer/1080947777395.html"]);
});

test("блок раздела: без ключа, без миграции и до первого снимка — скрыт с причиной одной строкой", async () => {
  assert.deepEqual(await loadChinaView(fakeDb().db, { direction: "bags", env: {} }), { available: false, reason: CHINA_STOP_WORDS.no_key });
  const noMig = await loadChinaView(fakeDb({ missing: ["assortment_cn_offer_snapshot"] }).db, { direction: "bags", env: ENV, nowMs: MONDAY });
  assert.deepEqual(noMig, { available: false, reason: "таблицы «Китай (1688)» не созданы — нужна миграция 202610070001_assortment_china_1688.sql" });
  const empty = await loadChinaView(fakeDb().db, { direction: "bags", env: ENV, nowMs: MONDAY });
  assert.equal(empty.available, false);
  assert.match((empty as { reason: string }).reason, /первого недельного снимка 1688 ещё нет/);
});

test("блок раздела по двум неделям снимков (>1000 строк — листанием): «новое в топе», «поднялось», копии, тренд; ни цен, ни продавцов наружу", async () => {
  const { db, tables } = fakeDb({ tables: { assortment_social_post: posts(MONDAY) } });
  // Прошлые недели: выдача без первых пяти карточек и в обратном порядке.
  const shifted = { ...(G_BAGS.data as Row), data: [...((G_BAGS.data as { data: Row[] }).data.slice(5))].reverse() };
  for (const week of ["2026-09-14", "2026-09-21", "2026-09-28"]) {
    for (const n of CHINA_NICHES.filter((x) => x.direction === "bags")) tables.assortment_cn_offer_snapshot.push(...snapshotRows(n, week, shifted));
  }
  tables.assortment_cn_article_snapshot.push({ ref_key: "zara:8372288", observed_on: "2026-09-28", direction: "jackets", offers: 1, sellers: 1, sample_offer_ids: [] });
  await runChinaSnapshot(db, opts({ call: fakeCaller().call }));
  assert.ok(tables.assortment_cn_offer_snapshot.filter((r) => r.direction === "bags").length > 1000, "строк раздела больше страницы PostgREST");
  const view = await loadChinaView(db, { direction: "bags", nowMs: MONDAY + DAY, env: ENV });
  assert.equal(view.available, true);
  if (!view.available) return;
  assert.equal(view.niches.length, 12);
  const underarm = view.niches.find((n) => n.key === "underarm")!;
  assert.equal(underarm.observedOn, "2026-10-05");
  assert.equal(underarm.previousOn, "2026-09-28");
  assert.equal(underarm.offers.length, 39);
  assert.equal(underarm.newInTop, 5, "первые пять карточек — новые в топе");
  assert.ok(underarm.rose > 0);
  assert.equal(underarm.offers[0].change?.kind, "new");
  assert.equal(underarm.sellers, 33);
  assert.equal(underarm.market?.buyersPerDay, 7729.2);
  assert.equal(underarm.market?.lastMonth, "202608");
  assert.equal(view.status, null);
  assert.equal(view.kinds.copies, "estimate");
  assert.equal(view.kinds.soldMin, "fact");
  assert.equal(view.kinds.isNew, "estimate");
  assert.equal(view.kinds.opportunities, "hypothesis");
  assert.deepEqual(view.opportunities.map((o) => o.topic), ["通勤托特包"]);
  assert.deepEqual(view.articles, [], "номера курточных рилсов — не в «Сумках»");
  assert.match(view.disclaimer, /не решение о закупке/);
  assert.doesNotMatch(JSON.stringify(view), LEAK_RE);
  const jackets = await loadChinaView(db, { direction: "jackets", nowMs: MONDAY + DAY, env: ENV });
  assert.equal(jackets.available, true);
  if (!jackets.available) return;
  assert.equal(jackets.niches.length, 9);
  assert.equal(jackets.niches[0].previousOn, null, "у курток прошлого снимка нет — без сравнения");
  assert.ok(jackets.niches[0].offers.every((o) => o.change === null));
  const zara = jackets.articles.find((a) => a.refKey === "zara:8372288")!;
  assert.deepEqual([zara.offers, zara.sellers, zara.delta, zara.previousOn], [3, 3, 2, "2026-09-28"]);
  assert.deepEqual(jackets.articles.find((a) => a.refKey === "uniqlo:487517")!.delta, null);
  assert.doesNotMatch(JSON.stringify(jackets), LEAK_RE);
});

test("незавершённый снимок новой недели: показан прошлый снимок и строка состояния", async () => {
  const { db, tables } = fakeDb();
  for (const n of CHINA_NICHES.filter((x) => x.direction === "bags")) tables.assortment_cn_offer_snapshot.push(...snapshotRows(n, "2026-09-28", G_BAGS.data));
  const view = await loadChinaView(db, { direction: "bags", nowMs: MONDAY, env: ENV });
  assert.equal(view.available && view.status, "снимок недели с 05.10.2026 ещё снимается — показан снимок с 28.09.2026");
});

// ---------------------------------------------------------------------------
// Роуты, крон, ключ

test("крон: GET под checkCronAuth, журнал writeSyncLog, maxDuration 300, дедлайн, dryRun и phase; строка в vercel.json; роут экрана — под ролями модуля", () => {
  const route = read("app/api/sync/assortment-china/route.ts");
  assert.match(route, /export async function GET\(request: NextRequest\)/);
  assert.doesNotMatch(route, /export async function POST/, "кроны Vercel зовутся GET");
  assert.match(route, /const authError = await checkCronAuth\(request\);/);
  assert.match(route, /writeSyncLog\(CHINA_JOB,/);
  assert.match(route, /export const maxDuration = 300;/);
  assert.match(route, /deadlineMs: startedAt\.getTime\(\) \+ BUDGET_MS/);
  assert.match(route, /params\.get\("dryRun"\) === "1"/);
  assert.match(route, /\["niches", "articles", "trends"\]/);
  const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons.filter((c) => c.path.startsWith("/api/sync/assortment-china")), [{ path: "/api/sync/assortment-china", schedule: "35 5,11 * * *" }]);
  const api = read("app/api/assortment-development/china/route.ts");
  assert.match(api, /requireApiSession\(ASSORTMENT_ROLES\)/);
  assert.doesNotMatch(api, /export async function (POST|PATCH|PUT|DELETE)/, "экран только читает");
});

test("ключ — только из окружения ALI_1688_AK без значения по умолчанию; длинных base64-строк (похожих на ключ) в коде и образцах нет", () => {
  const client = read("lib/assortment/china1688.ts");
  assert.match(client, /export const CHINA_KEY_ENV = "ALI_1688_AK";/);
  assert.match(client, /return env\[CHINA_KEY_ENV\]\?\.trim\(\) \?\? "";/);
  const files = [
    "lib/assortment/china1688.ts", "lib/assortment/chinaSync.ts", "lib/assortment/chinaStore.ts", "app/api/sync/assortment-china/route.ts",
    "app/api/assortment-development/china/route.ts", `supabase/migrations/${MIGRATION_FILE}`,
    ...readdirSync(join(root, FIXTURES)).map((f) => `${FIXTURES}/${f}`),
  ];
  for (const path of files) {
    const text = read(path);
    const tokens = (text.match(/[A-Za-z0-9_-]{48,}/g) ?? []).filter((t) => /\d/.test(t) && /[A-Z]/.test(t) && /[a-z]/.test(t));
    assert.deepEqual(tokens, [], `${path}: длинная base64-строка`);
    assert.doesNotMatch(text, /x-csk-sign"\s*:\s*"[A-Za-z0-9+/=]{20,}"/, `${path}: подпись в образце`);
  }
  for (const name of readdirSync(join(root, FIXTURES))) assert.doesNotMatch(read(`${FIXTURES}/${name}`), /"x-csk-|"Authorization"/i, `${name}: заголовков авторизации в образцах нет`);
});
