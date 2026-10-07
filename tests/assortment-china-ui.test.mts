import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssortmentSection } from "../components/assortment/AssortmentSection.tsx";
import { ChinaLinksPage } from "../components/assortment/ChinaLinksPage.tsx";
import { CHINA_PAGE, ChinaBody, ChinaIntro, ChinaOfferCardView, ChinaUnavailable } from "../components/assortment/ChinaView.tsx";
import { SocialReelCardView } from "../components/assortment/SocialView.tsx";
import { isFeedView, sectionViewFrom } from "../lib/assortment/catalog.ts";
import { CHINA_NICHES, CHINA_NICHES_VERSION, CHINA_STOP_WORDS, parseOfferHot } from "../lib/assortment/china1688.ts";
import { ALPHASHOP_URL, CHINA_LINKS_PATH, nicheLinks, nicheShortLabel, nichesFor, offerLink, search1688Url, taobaoSearchUrl } from "../lib/assortment/chinaLinks.ts";
import {
  articleCards, buildNicheBlocks, CHINA_DIGEST_MAX_ITEMS, CHINA_DISCLAIMER, CHINA_NUMBER_KINDS, chinaSourceView, loadChinaCopies, loadChinaDigest, loadChinaSourceFacts, loadChinaTab,
  pickChinaDigest, type ChinaDigest, type ChinaOfferCard, type ChinaRefCopies, type ChinaSourceFacts, type ChinaView,
} from "../lib/assortment/chinaStore.ts";
import { CHINA_JOB, CHINA_SOURCE_ID, marketValueText, nicheRows } from "../lib/assortment/chinaSync.ts";
import { chinaCopiesFor, copiesLine, CHINA_SCREEN_NOTE } from "../lib/assortment/chinaUi.ts";
import { ASSORTMENT_BASE_PATH } from "../lib/assortment/constants.ts";
import { digestMessage, type DigestDirection, type DigestFacts } from "../lib/assortment/digest.ts";
import { loadDigestFacts } from "../lib/assortment/digestFacts.ts";
import { jobFreshness, JOBS_STALL_ACTION, WATCHED_JOBS, type JobRun } from "../lib/assortment/jobsWatch.ts";
import { loadSocialFeed } from "../lib/assortment/socialFeedStore.ts";
import type { SocialReelCard } from "../lib/assortment/socialReelsStore.ts";
import { loadAssortmentSources } from "../lib/assortment/sources.ts";

/**
 * «Китай (1688)» — экран (вкладка раздела, страница ссылок на площадки), «ставка фабрик» в ленте «Залетает», раздел воскресной сводки,
 * строка 1688 на «Источниках» и сторож задачи. Разметка — статическим рендером; подставная база применяет фильтры и порядок, режет страницу
 * на 1 000 строк и сверяет читаемые колонки таблиц Китая с миграцией. Образцы — обезличенные ответы 1688 от 07.10.2026.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const flat = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const FIXTURES = "tests/fixtures/assortment-china";
const fixture = (name: string) => JSON.parse(read(`${FIXTURES}/${name}`)) as Record<string, unknown> & { data?: unknown; model?: unknown };
const G_BAGS = fixture("find-product-niche-yexiabao-sold-desc.json");
const G_JACKETS = fixture("find-product-niche-nvshi-jiake-sold-desc.json");
const SK_TREND_BAGS = fixture("shopkeeper-trend-yexiabao.json");
const sql = read("supabase/migrations/202610070001_assortment_china_1688.sql");

/** Признаки цены и продавца в выходе: маркер образцов PRICE, валюта, «N元», shopN, служебные поля магазина. */
const LEAK_RE = /PRICE|¥|￥|\d\s*元|RMB|\bshop\d+\b|company|currentPrice|priceTags|promotionTags|merchantReputation|rankedContent|店铺/;

/** Вымышленный ключ (собирается в тесте): строки, похожей на настоящий ключ, в коде нет. */
const ENV = { ALI_1688_AK: Buffer.from(`${"T".repeat(32)}testkeyid000000001`, "utf8").toString("base64url") };

const MONDAY = Date.parse("2026-10-05T07:00:00Z"); // неделя снимка 05.10
const WEEK = "2026-10-05";
const PREV = "2026-09-28";
const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const noop = () => undefined;

// ---------------------------------------------------------------------------
// Подставная база

type Row = Record<string, unknown>;

function migrationColumns(table: string): Set<string> {
  const block = new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? "";
  return new Set(block.split("\n").map((l) => /^\s{2}([a-z_0-9]+)\s+/.exec(l)?.[1]).filter((c): c is string => Boolean(c) && c !== "primary"));
}
const CN_COLUMNS: Record<string, Set<string>> = Object.fromEntries(["assortment_cn_offer_snapshot", "assortment_cn_article_snapshot", "assortment_cn_trend_snapshot"].map((t) => [t, migrationColumns(t)]));

function fakeDb(init: { tables?: Record<string, Row[]>; missing?: string[]; fail?: string[] } = {}) {
  const tables: Record<string, Row[]> = {
    assortment_social_post: [], assortment_social_account: [], assortment_catalog_heads: [], assortment_source_items: [], sync_log: [],
    assortment_cn_offer_snapshot: [], assortment_cn_article_snapshot: [], assortment_cn_trend_snapshot: [], assortment_sources: [],
    ...(init.tables ?? {}),
  };
  const missing = new Set(init.missing ?? []);
  const fail = new Set(init.fail ?? []);
  const reads: Array<{ table: string; columns: string | null }> = [];
  const cmp = (x: unknown, y: unknown) => (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? "")));
  const db = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const orders: Array<[string, boolean]> = [];
      let columns: string | null = null;
      let op: "select" | "update" = "select";
      let values: Row = {};
      let returning = false;
      let counting = false;
      let range: [number, number] | null = null;
      let limit: number | null = null;
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const exec = () => {
        if (missing.has(table)) return { data: null, count: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } };
        if (fail.has(table)) return { data: null, count: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
        const allowed = CN_COLUMNS[table];
        const bad = allowed && columns ? columns.split(",").map((c) => c.trim()).filter((c) => c && !allowed.has(c)) : [];
        if (bad.length) return { data: null, count: null, error: { code: "42703", message: `column ${table}.${bad[0]} does not exist` } };
        if (op === "update") {
          const hit = rows();
          for (const r of hit) Object.assign(r, structuredClone(values));
          return { data: returning ? hit.map((r) => ({ ...r })) : null, count: null, error: null };
        }
        reads.push({ table, columns });
        const all = rows().map((r) => structuredClone(r));
        if (orders.length) {
          all.sort((a, b) => {
            for (const [c, asc] of orders) {
              const d = cmp(a[c], b[c]);
              if (d !== 0) return asc ? d : -d;
            }
            return 0;
          });
        }
        let list = range ? all.slice(range[0], Math.min(range[1] + 1, range[0] + 1000)) : all.slice(0, 1000);
        if (limit != null) list = list.slice(0, limit);
        return { data: list, count: counting ? all.length : null, error: null };
      };
      const q: Record<string, unknown> = {
        select: (cols?: string, opts?: { count?: string }) => {
          if (op === "update") returning = true;
          else columns = cols ?? null;
          if (opts?.count) counting = true;
          return q;
        },
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        gte: (c: string, v: unknown) => (filters.push((r) => r[c] != null && (typeof v === "number" ? Number(r[c]) >= v : String(r[c]) >= String(v))), q),
        gt: (c: string, v: unknown) => (filters.push((r) => r[c] != null && (typeof v === "number" ? Number(r[c]) > v : String(r[c]) > String(v))), q),
        lt: (c: string, v: unknown) => (filters.push((r) => r[c] != null && String(r[c]) < String(v)), q),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
        contains: (c: string, vs: unknown[]) => (filters.push((r) => Array.isArray(r[c]) && vs.every((v) => (r[c] as unknown[]).includes(v))), q),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
        not: (c: string, operator: string, v: unknown) => {
          if (operator === "is") filters.push((r) => (r[c] ?? null) !== v);
          return q;
        },
        or: () => q,
        order: (c: string, o?: { ascending?: boolean }) => (orders.push([c, o?.ascending !== false]), q),
        limit: (n: number) => {
          limit = n;
          return q;
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
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(exec()).then(resolve, reject),
      };
      return q;
    },
  };
  return { db: db as never, tables, reads };
}

const niche = (key: string) => CHINA_NICHES.find((n) => n.key === key)!;
/** Прошлая неделя: выдача без первых пяти карточек и в обратном порядке (первые пять — «новое в топе», часть — «поднялось»). */
const SHIFTED = { ...(G_BAGS.data as Row), data: [...((G_BAGS.data as { data: Row[] }).data.slice(5))].reverse() };
const offerRows = (key: string, week: string, data: unknown) => nicheRows(niche(key), week, data, 40) as unknown as Row[];
const s104 = (china: Row | null = null): Row => ({
  source_id: CHINA_SOURCE_ID, name: "1688", source_group: "Фабрики и материалы", categories: ["jackets", "bags"], region: "Китай", priority: "P1", adapter_type: "C4 Китай",
  access_status: "untested", access_note: "Кандидат; доступ не проверен", last_success_at: null, last_attempt_at: null, last_error: null, capabilities: china ? { china } : {},
});
const stopState = (reason: "auth" | "rate_limit") => ({ week: WEEK, version: "v", marks: {}, runs: 1, startedAt: null, completedAt: null, stop: { reason, at: iso(MONDAY), message: "x" }, lastRunAt: null, translateCalls: 0 });

type Ready = Extract<ChinaView, { available: true }>;
const ready = (over: Partial<Ready> = {}): Ready => ({
  available: true, direction: "bags", week: WEEK, version: CHINA_NICHES_VERSION, status: null, niches: [], articles: [], opportunities: [], kinds: CHINA_NUMBER_KINDS, disclaimer: CHINA_DISCLAIMER, ...over,
});

/** Ниши сумок: «под мышку» — две недели (со сравнением) и тренд; «ведро» — только эта неделя (без сравнения). */
function bagBlocks() {
  const rows = [...offerRows("underarm", PREV, SHIFTED), ...offerRows("underarm", WEEK, G_BAGS.data), ...offerRows("bucket", WEEK, G_BAGS.data)];
  rows.filter((r) => r.observed_on === WEEK && r.niche_key === "underarm").slice(0, 3).forEach((r, i) => { r.title_ru = `Сумка под мышку ${i + 1}`; });
  const trend = parseOfferHot((SK_TREND_BAGS.model as { bizData: unknown }).bizData)!;
  const trends = [{ list_key: "market:underarm", observed_on: WEEK, rank: 1, keyword_zh: "腋下包", keyword_ru: null, value_text: marketValueText(trend), direction: "bags" }];
  return buildNicheBlocks("bags", rows as never, trends as never);
}

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

// ---------------------------------------------------------------------------
// Ссылки на площадки

test("ссылки на площадки: 1688 — поиск по продажам (utf8, va_rmdarkgmv30), Taobao — по продажам, AlphaShop — главная; ниши раздела; короткие названия без «женская»", () => {
  assert.equal(search1688Url("腋下包 女"), "https://s.1688.com/selloffer/offer_search.htm?keywords=%E8%85%8B%E4%B8%8B%E5%8C%85%20%E5%A5%B3&charset=utf8&sortType=va_rmdarkgmv30&descendOrder=true");
  assert.equal(search1688Url("腋下包", false), "https://s.1688.com/selloffer/offer_search.htm?keywords=%E8%85%8B%E4%B8%8B%E5%8C%85&charset=utf8");
  assert.equal(taobaoSearchUrl("风衣 女"), "https://s.taobao.com/search?q=%E9%A3%8E%E8%A1%A3%20%E5%A5%B3&sort=sale-desc");
  const links = nicheLinks(niche("underarm"));
  assert.deepEqual(links.map((l) => l.platform), ["1688", "taobao", "alphashop"]);
  assert.equal(links[0].url, search1688Url("腋下包 女"), "основной ключ ниши — тот же, что у недельного снимка");
  assert.equal(links[2].url, ALPHASHOP_URL);
  assert.equal(nichesFor("jackets").length, 9);
  assert.equal(nichesFor("bags").length, 12);
  assert.equal(nichesFor(null).length, CHINA_NICHES.length);
  assert.ok(nichesFor("bags").every((n) => n.direction === "bags"));
  assert.equal(nicheShortLabel("Женская сумка кросс-боди"), "Сумка кросс-боди");
  assert.equal(nicheShortLabel("Короткий женский пуховик"), "Короткий пуховик");
  assert.equal(nicheShortLabel("Женский тренч"), "Тренч");
  assert.equal(nicheShortLabel("Сумка-седло (CLÉRIN)"), "Сумка-седло (CLÉRIN)");
  assert.ok(CHINA_LINKS_PATH.startsWith(`${ASSORTMENT_BASE_PATH}/`), "страница — внутри модуля: права по префиксу модуля");
});

test("«На 1688» у карточки: карточка 1688 строится только из номера из цифр, иначе — поиск по названию", () => {
  assert.deepEqual(offerLink("975160314318", "腋下包"), { url: "https://detail.1688.com/offer/975160314318.html", kind: "card" });
  assert.equal(offerLink("12345", "腋下包 女").kind, "search", "номер короче шести цифр — не номер карточки");
  assert.equal(offerLink("9751603143\"><script>", "腋下包").kind, "search");
  assert.equal(offerLink("abc", "腋下包 女").url, search1688Url("腋下包 女", false));
});

// ---------------------------------------------------------------------------
// Карточка топа

const offer = (over: Partial<ChinaOfferCard> = {}): ChinaOfferCard => ({
  offerId: "975160314318", url: "https://detail.1688.com/offer/975160314318.html", rank: 4, titleZh: "2025简约大容量波士顿腋下包包女", titleRu: "Сумка под мышку «Бостон», вместительная",
  imageUrl: "https://cbu01.alicdn.com/img/ibank/O1CN0131hMt025zwOgg7AXX_!!9000000000001-0-cib.jpg", category: "201554511", soldText: "5000+", soldMin: 5000, orders30d: 181,
  isNew: true, badges: ["yx", "inspected", "claims_new"], traits: ["PU"], change: { kind: "rose", from: 9, to: 4 }, ...over,
});

test("карточка топа: фото ссылкой 1688 (no-referrer, без копии), перевод и китайское мелко, «продано 5000+» — факт 1688, «период не указан», «поднялось на N» — расчёт, значки с происхождением, «На 1688»", () => {
  const out = html(createElement(ChinaOfferCardView, { card: offer() }));
  const text = flat(out);
  assert.match(out, /<img src="https:\/\/cbu01\.alicdn\.com\/img\/ibank\/[^"]+" alt="[^"]+" loading="lazy" decoding="async" referrerPolicy="no-referrer"/);
  assert.doesNotMatch(out, /\/api\/assortment-development\/[^"]*photo/, "фото не проксируется и не копируется");
  assert.match(text, /№4 в выдаче 1688 поднялось на 5 расчёт/);
  assert.match(text, /Сумка под мышку «Бостон», вместительная 2025简约大容量波士顿腋下包包女/);
  assert.match(out, /<div lang="zh" class="break-anywhere line-clamp-1 text-xs text-slate-500">2025简约/, "китайское — мелко, под переводом");
  assert.match(out, /<div class="relative aspect-square w-24 shrink-0 self-start overflow-hidden/, "фото — квадрат, не растягивается на высоту карточки");
  assert.match(text, /продано 5000\+ — факт 1688, период не указан/);
  assert.match(text, /заказов за 30 дней: 181 — факт 1688/);
  assert.match(text, /严选 · отбор 1688/);
  assert.match(text, /проверено 1688/);
  assert.match(text, /новинка — оценка/);
  assert.match(text, /«新款» — со слов продавца/);
  assert.match(out, /<a href="https:\/\/detail\.1688\.com\/offer\/975160314318\.html" target="_blank" rel="noopener noreferrer" class="inline-flex h-11[^"]*"><svg[^>]*>.*<\/svg> На 1688<\/a>/);
  assert.match(flat(html(createElement(ChinaOfferCardView, { card: offer({ change: { kind: "new" } }) }))), /№4 в выдаче 1688 новое в топе расчёт/);
  assert.match(flat(html(createElement(ChinaOfferCardView, { card: offer({ change: { kind: "fell", from: 2, to: 9 } }) }))), /опустилось на 7 расчёт/);
  assert.doesNotMatch(out, LEAK_RE);
});

test("карточка без перевода — китайское название крупно и без дубля; «как было» и без сравнения — без метки; нет фото — заглушка; номер не из цифр — «Найти на 1688»", () => {
  const out = html(createElement(ChinaOfferCardView, { card: offer({ titleRu: null, change: { kind: "same" }, imageUrl: null, badges: [], isNew: false, orders30d: null, offerId: "x1" }) }));
  const text = flat(out);
  assert.equal((out.match(/2025简约大容量/g) ?? []).length, 1, "название — один раз (фото нет — и alt нет)");
  assert.doesNotMatch(out, /lang="zh"/, "без перевода китайское не дублируется мелким");
  assert.doesNotMatch(text, /новое в топе|поднялось|опустилось|расчёт/);
  assert.match(text, /фото нет/);
  assert.doesNotMatch(out, /<img/);
  assert.doesNotMatch(text, /заказов за 30 дней|严选|новинка/);
  assert.match(text, /Найти на 1688/);
  assert.equal(flat(html(createElement(ChinaOfferCardView, { card: offer({ change: null }) }))).includes("расчёт"), false, "прошлого снимка нет — не сравниваем");
});

// ---------------------------------------------------------------------------
// Вкладка раздела

test("вкладка по снимку: переключатель ниш (короткие названия, «+N» новых), фильтры без пустых, «Показать ещё», рынок, копии по номерам, «возможности» — гипотеза; цен и продавцов нет", () => {
  const niches = bagBlocks();
  assert.deepEqual(niches.map((n) => [n.key, n.newInTop > 0, n.previousOn]), [["underarm", true, PREV], ["bucket", false, null]]);
  const articles = articleCards([
    { ref_key: "zara:8372288", observed_on: PREV, direction: "bags", offers: 1, sellers: 1, sample_offer_ids: [] },
    { ref_key: "zara:8372288", observed_on: WEEK, direction: "bags", offers: 3, sellers: 3, sample_offer_ids: ["1080947777395", "1083094378976"] },
  ] as never);
  const opportunities = [{ listKey: "opportunity:taobao:hot", platform: "taobao", section: "hot", rank: 1, topic: "通勤托特包", topicRu: "Тоут для офиса", count: "+120%", isUp: true, words: [{ word: "大容量托特包女", growthPct: 59.06 }], observedOn: WEEK }];
  const out = html(createElement(ChinaBody, { data: ready({ niches, articles, opportunities, status: "снимок недели с 05.10.2026 ещё снимается — показан снимок с 28.09.2026" }) }));
  const text = flat(out);
  const underarm = niches[0];
  assert.match(text, new RegExp(`Сумка под мышку · \\+${underarm.newInTop} Сумка-ведро`), "короткие названия, у ниши с новыми — «+N»");
  assert.match(out, /aria-pressed="true"[^>]*>Сумка под мышку/, "по умолчанию — первая ниша");
  assert.match(text, /снимок недели с 05\.10\.2026 ещё снимается/);
  assert.match(text, /Снимок недели с 05\.10, сравнение со снимком 28\.09\./);
  assert.match(text, new RegExp(`Разных продавцов в топе: ${underarm.sellers} — факт 1688; самих продавцов не храним`));
  assert.match(text, new RegExp(`Новое в топе: ${underarm.newInTop}, поднялось: ${underarm.rose} — расчёт, неделя к неделе по позиции в выдаче 1688`));
  assert.match(text, /Покупателей в день на 1688 по ключу «腋下包»: ≈7 729; к прошлому году −6,2% — факт 1688, ряд по 08\.2026 \(отстаёт на 5–6 недель\); к году — расчёт 1688; это просмотры покупателей, не продажи/);
  assert.match(text, new RegExp(`Все · ${underarm.offers.length} Новое в топе · ${underarm.newInTop} Поднялось · ${underarm.rose}`));
  assert.equal((out.match(/№\d+ в выдаче 1688/g) ?? []).length, CHINA_PAGE, `сразу — ${CHINA_PAGE} карточек`);
  assert.match(text, new RegExp(`Показать ещё ${CHINA_PAGE} из ${underarm.offers.length - CHINA_PAGE}`));
  // Остаток меньше страницы — «Показать ещё 3», без «3 из 3».
  const short = { ...underarm, offers: underarm.offers.slice(0, CHINA_PAGE + 3) };
  assert.match(flat(html(createElement(ChinaBody, { data: ready({ niches: [short] }) }))), /Показать ещё 3 Посмотреть/);
  assert.match(text, /Сумка под мышку 1/, "перевод — крупно");
  assert.match(text, /Посмотреть нишу вручную «腋下包 女» ?: 1688 — по продажам Taobao — поиск AlphaShop/);
  assert.match(text, /Копии по номерам из рилсов — «ставки фабрик»/);
  assert.match(text, /Zara 8372\/288 3 копии \(\+2 за неделю\), продавцов от 3 — оценка снизу, прирост — расчёт; снимок 05\.10/);
  assert.match(out, /href="https:\/\/detail\.1688\.com\/offer\/1080947777395\.html"/);
  assert.match(text, /Темы «возможностей» 1688 · 1 — гипотеза/);
  assert.match(text, /Тоут для офиса 通勤托特包 · Taobao · \+120% · 大容量托特包女 \(рост поиска 59\.06%\)/);
  assert.match(out, new RegExp(`href="${CHINA_LINKS_PATH}"`));
  assert.doesNotMatch(out, LEAK_RE, "ни цен, ни продавцов в разметке");
  // Только новые: фильтр открыт — пять новых, без «Показать ещё».
  const onlyNew = html(createElement(ChinaBody, { data: ready({ niches }), initialFilter: "new" }));
  assert.equal((onlyNew.match(/новое в топе<\/span>/g) ?? []).length, underarm.newInTop);
  assert.doesNotMatch(flat(onlyNew), /Показать ещё/);
  // Пустой фильтр прячем, а не серим: «поднялось» без поднявшихся — кнопки нет.
  const noRose = { ...underarm, offers: underarm.offers.map((o) => (o.change?.kind === "rose" ? { ...o, change: { kind: "same" as const } } : o)), rose: 0 };
  const hiddenRose = flat(html(createElement(ChinaBody, { data: ready({ niches: [noRose] }) })));
  assert.doesNotMatch(hiddenRose, /Поднялось ·/);
  assert.match(hiddenRose, /Новое в топе ·/);
});

test("ниша без прошлого снимка: «новое в топе» и «поднялось» не выдумываются — строка «появятся со следующей недели», фильтров и меток нет", () => {
  const bucket = bagBlocks()[1];
  const out = html(createElement(ChinaBody, { data: ready({ niches: [bucket] }) }));
  const text = flat(out);
  assert.match(text, /Снимок недели с 05\.10 — прошлого снимка ниши нет: «новое в топе» и «поднялось» появятся со следующей недели\./);
  assert.doesNotMatch(text, /Новое в топе:|Все ·|расчёт, неделя к неделе/);
  assert.doesNotMatch(out, /новое в топе<\/span>|поднялось на \d/);
  assert.doesNotMatch(text, /Копии по номерам|возможностей/, "пустые разделы не показываются");
});

test("телефон и iPad: все ссылки и кнопки вкладки и страницы ссылок — цель нажатия ≥ 44 px; карточки — одна колонка до md; ряды фильтров едут вбок", () => {
  const niches = bagBlocks();
  const articles = articleCards([{ ref_key: "zara:8372288", observed_on: WEEK, direction: "bags", offers: 3, sellers: 3, sample_offer_ids: ["1080947777395"] }] as never);
  const pages = [
    html(createElement(ChinaBody, { data: ready({ niches, articles, opportunities: [{ listKey: "opportunity:1688:trend", platform: "1688", section: "trend", rank: 1, topic: "腋下包", topicRu: null, count: null, isUp: null, words: [], observedOn: WEEK }] }) })),
    html(createElement(ChinaUnavailable, { reason: "ключ 1688 не задан (ALI_1688_AK)" })),
    html(createElement(ChinaLinksPage, {})),
  ];
  for (const out of pages) {
    const targets = [...out.matchAll(/<(a|button|summary)\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(targets.length > 0);
    for (const tag of targets) assert.match(tag, /\b(h-11|min-h-11)\b/, `мелкая цель нажатия: ${tag.slice(0, 120)}`);
  }
  assert.match(pages[0], /<ul class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">/);
  assert.match(pages[0], /class="chip-row[^"]* lg:flex-wrap" aria-label="Ниши"/, "ниши: на телефоне — вбок, на широком — переносом");
  assert.match(pages[2], /<ul class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">/);
});

test("подпись вкладки: «оптовые продажи в Китае — не спрос WB; цены не показываем»; блок скрыт — причина одной строкой и ссылка на площадки вручную", () => {
  assert.match(flat(html(createElement(ChinaIntro))), /Оптовые продажи в Китае — не спрос WB; цены не показываем\. Это наблюдение рынка 1688, а не решение о закупке\./);
  assert.equal(CHINA_SCREEN_NOTE.includes("не спрос WB"), true);
  const out = html(createElement(ChinaUnavailable, { reason: CHINA_STOP_WORDS.no_key }));
  assert.match(flat(out), /^ Снимка 1688 нет: ключ 1688 не задан \(ALI_1688_AK\)\. Китайские площадки — ссылки по нишам $/);
  assert.match(out, /role="status"/);
  assert.match(out, new RegExp(`href="${CHINA_LINKS_PATH}"`));
});

// ---------------------------------------------------------------------------
// Раздел и роут

test("вкладка «Китай (1688)» в разделе: только при снимке (count=1) или по адресу ?view=china; это не лента находок", () => {
  assert.equal(sectionViewFrom({ view: "china" }), "china");
  assert.equal(isFeedView("china"), false, "запрос ленты для вкладки Китая роут превратил бы в «Новинки»");
  const src = read("components/assortment/AssortmentSection.tsx");
  assert.match(src, /fetch\(`\/api\/assortment-development\/china\?direction=\$\{direction\}&count=1`\)/);
  assert.match(src, /if \(ok && typeof body\?\.visible === "boolean"\) \{\n\s+setChinaVisible\(body\.visible\);/);
  assert.match(src, /\.\.\.\(chinaVisible \|\| chinaCountFailed \|\| view === "china" \? \[\{ id: "china" as const, label: CHINA_TAB_LABEL \}\] : \[\]\)/);
  assert.match(src, /\{view === "china" && <ChinaView key=\{direction\} direction=\{direction\} \/>\}/);
  assert.match(src, /href=\{`\$\{CHINA_LINKS_PATH\}\?direction=\$\{direction\}`\}/, "ссылки на площадки — в строке покрытия раздела");
  // Статический рендер: без снимка (до ответа count) вкладки нет; по адресу — есть и открыта.
  const plain = html(createElement(AssortmentSection, { direction: "bags" }));
  assert.doesNotMatch(plain, /Китай \(1688\)/);
  const opened = html(createElement(AssortmentSection, { direction: "bags", initialView: "china" }));
  assert.match(opened, /aria-selected="true"[^>]*>Китай \(1688\)<\/button>/);
  assert.match(flat(opened), /Загружаем снимок 1688…/);
  assert.doesNotMatch(flat(opened), /Загружаем ленту/);
});

test("роут чтения: под ролями модуля, только GET; ?count=1 — только «есть ли вкладка», без чтения снимка", () => {
  const api = read("app/api/assortment-development/china/route.ts");
  assert.match(api, /const gate = await requireApiSession\(ASSORTMENT_ROLES\);\n\s+if \(gate\) return gate;/);
  assert.doesNotMatch(api, /export async function (POST|PATCH|PUT|DELETE)/);
  assert.match(api, /if \(request\.nextUrl\.searchParams\.get\("count"\) === "1"\) return NextResponse\.json\(await loadChinaTab\(db, \{ direction \}\), \{ headers: NO_STORE \}\);/);
});

test("вкладка видна, только когда ключ задан, таблицы есть, снимок раздела записан и ключ не отвергнут — иначе причина одной строкой", async () => {
  const rows = offerRows("underarm", WEEK, G_BAGS.data);
  assert.deepEqual(await loadChinaTab(fakeDb({ tables: { assortment_cn_offer_snapshot: rows } }).db, { direction: "bags", env: {}, nowMs: MONDAY }), { visible: false, reason: CHINA_STOP_WORDS.no_key });
  assert.deepEqual(await loadChinaTab(fakeDb({ missing: ["assortment_cn_offer_snapshot"] }).db, { direction: "bags", env: ENV, nowMs: MONDAY }), { visible: false, reason: "таблицы «Китай (1688)» не созданы — нужна миграция 202610070001_assortment_china_1688.sql" });
  assert.deepEqual(await loadChinaTab(fakeDb().db, { direction: "bags", env: ENV, nowMs: MONDAY }), { visible: false, reason: "первого недельного снимка 1688 ещё нет" });
  const { db, reads } = fakeDb({ tables: { assortment_cn_offer_snapshot: rows, assortment_sources: [s104()] } });
  assert.deepEqual(await loadChinaTab(db, { direction: "bags", env: ENV, nowMs: MONDAY }), { visible: true, reason: null });
  assert.deepEqual(reads.filter((r) => r.table === "assortment_cn_offer_snapshot").map((r) => r.columns), ["observed_on"], "без чтения снимка");
  assert.equal((await loadChinaTab(db, { direction: "jackets", env: ENV, nowMs: MONDAY })).visible, false, "снимок сумок — не вкладка курток");
  assert.equal((await loadChinaTab(db, { direction: "bags", env: ENV, nowMs: MONDAY + 5 * 7 * DAY })).visible, false, "снимок старше окна чтения (4 недели) — вкладки нет");
  const auth = fakeDb({ tables: { assortment_cn_offer_snapshot: rows, assortment_sources: [s104(stopState("auth"))] } }).db;
  assert.deepEqual(await loadChinaTab(auth, { direction: "bags", env: ENV, nowMs: MONDAY }), { visible: false, reason: CHINA_STOP_WORDS.auth });
  const limit = fakeDb({ tables: { assortment_cn_offer_snapshot: rows, assortment_sources: [s104(stopState("rate_limit"))] } }).db;
  assert.equal((await loadChinaTab(limit, { direction: "bags", env: ENV, nowMs: MONDAY })).visible, true, "лимит 1688 — не повод прятать снимок");
});

// ---------------------------------------------------------------------------
// «Ставка фабрик» в ленте «Залетает»

function reel(over: Partial<SocialReelCard> = {}): SocialReelCard {
  return {
    code: "DdVk7eRtLMC", url: "https://www.instagram.com/reel/DdVk7eRtLMC/", kind: "reel", author: { handle: "jpnbrands", url: "https://www.instagram.com/jpnbrands/", kind: "reseller", followers: null },
    publishedAt: iso(MONDAY - 5 * DAY), brand: "zara", direction: "jackets", captionExcerpt: "Zara jacket ref 8372/288", hashtags: [], refs: ["zara:8372288"], verdict: "strong", preliminary: false,
    ruleVersion: "reels-v1", likes: 12000, likesHidden: false, comments: 60, views: 480000, intent: null, likesRatio: 14, commentsRatio: 6,
    baseline: { likesMedian: 900, commentsMedian: 10, posts: 12 }, checks: 1, lastCheckedAt: iso(MONDAY - DAY), history: [], sameRefAuthors14d: 1, confirmedBySecondAuthor: false,
    match: { status: "brand_site", title: "BOMBER JACKET", image: null, url: "https://www.zara.com/us/en/jacket-p08372288.html", modelKey: null, sourceId: null, itemId: null, gender: "women" },
    kinds: { likes: "estimate", comments: "fact", views: "estimate", intent: "estimate", ratios: "calc", verdict: "calc", publishedAt: "calc", sameRefAuthors: "calc", match: "fact" },
    ...over,
  };
}
const copies = (over: Partial<ChinaRefCopies> = {}): ChinaRefCopies => ({ refKey: "zara:8372288", offers: 3, sellers: 3, delta: 2, observedOn: WEEK, previousOn: PREV, ...over });
const renderReel = (china: ChinaRefCopies | null) => flat(html(createElement(SocialReelCardView, { card: reel(), china, local: {}, onPick: noop, onHideModel: noop, onHideReel: noop, onRestore: noop, onAdd: noop })));

test("«ставка фабрик» в карточке рилса: «На 1688: 3 копии (+2 за неделю)» — оценка снизу, прирост — расчёт; ноль — «не нашли»; без снимка — строки нет", () => {
  assert.match(renderReel(copies()), /На 1688: 3 копии \(\+2 за неделю\) — оценка снизу: поиск 1688 находит часть карточек; прирост — расчёт; снимок 05\.10/);
  assert.match(renderReel(copies({ offers: 1, delta: null, previousOn: null })), /На 1688: 1 копия — оценка снизу: поиск 1688 находит часть карточек; снимок 05\.10/, "без прошлого снимка прирост не выдумывается");
  assert.match(renderReel(copies({ offers: 5, delta: -1 })), /На 1688: 5 копий \(−1 за неделю\)/);
  assert.match(renderReel(copies({ offers: 4, delta: 0 })), /На 1688: 4 копии \(за неделю столько же\)/);
  assert.match(renderReel(copies({ offers: 0, delta: 0 })), /На 1688 копий по номеру не нашли — оценка снизу/);
  assert.doesNotMatch(renderReel(null), /На 1688/);
  assert.deepEqual(copiesLine(copies({ offers: 11, delta: 11 })).text, "На 1688: 11 копий (+11 за неделю)");
  // Номер — первый из рилса, по которому есть снимок.
  const map = { "uniqlo:487517": copies({ refKey: "uniqlo:487517", offers: 2 }) };
  assert.equal(chinaCopiesFor(["zara:1111111", "uniqlo:487517"], map)?.refKey, "uniqlo:487517");
  assert.equal(chinaCopiesFor(["zara:1111111"], map), null);
  const both = { ...map, "zara:8372288": copies() };
  assert.equal(chinaCopiesFor(["zara:8372288", "uniqlo:487517"], both)?.refKey, "zara:8372288", "два номера со снимком — первый по порядку рилса");
  assert.equal(chinaCopiesFor(["uniqlo:487517"], null), null);
  const view = read("components/assortment/SocialView.tsx");
  assert.match(view, /china=\{chinaCopiesFor\(card\.refs, feed\.chinaCopies\)\}/, "лента передаёт карточке её копии");
});

test("копии для ленты: по номерам рилсов пачками (>100 номеров), только zara/uniqlo, последний снимок и прирост; без ключа, таблиц и с отвергнутым ключом — null", async () => {
  const rows: Row[] = [
    { ref_key: "zara:8372288", observed_on: PREV, direction: "jackets", offers: 1, sellers: 1, sample_offer_ids: [] },
    { ref_key: "zara:8372288", observed_on: WEEK, direction: "jackets", offers: 3, sellers: 3, sample_offer_ids: ["1080947777395"] },
    { ref_key: "uniqlo:487517", observed_on: WEEK, direction: "jackets", offers: 2, sellers: 2, sample_offer_ids: [] },
    { ref_key: "zara:2222222", observed_on: "2026-08-10", direction: "jackets", offers: 9, sellers: 9, sample_offer_ids: [] },
  ];
  // 150 лишних номеров: чтение пачками по 100, нужный номер — во второй пачке.
  const filler = Array.from({ length: 150 }, (_, i) => `zara:${String(1000000 + i)}`);
  const { db, reads } = fakeDb({ tables: { assortment_cn_article_snapshot: rows, assortment_sources: [s104()] } });
  const got = await loadChinaCopies(db, [...filler, "uniqlo:487517", "zara:8372288", "zara:8372288", "mango:1234567", "zara:2222222", "zara:837228"], { nowMs: MONDAY + DAY, env: ENV });
  assert.deepEqual(got, {
    "zara:8372288": { refKey: "zara:8372288", offers: 3, sellers: 3, delta: 2, observedOn: WEEK, previousOn: PREV },
    "uniqlo:487517": { refKey: "uniqlo:487517", offers: 2, sellers: 2, delta: null, observedOn: WEEK, previousOn: null },
  }, "снимок старше окна (4 недели) и чужие номера — не в счёт");
  assert.ok(reads.filter((r) => r.table === "assortment_cn_article_snapshot").length >= 2, "номера — пачками");
  assert.equal(await loadChinaCopies(db, ["zara:8372288"], { nowMs: MONDAY, env: {} }), null, "без ключа строки нет");
  assert.deepEqual(await loadChinaCopies(db, ["mango:1"], { nowMs: MONDAY, env: ENV }), {}, "нет номеров Zara/Uniqlo — в базу не ходим");
  assert.equal(await loadChinaCopies(fakeDb({ missing: ["assortment_cn_article_snapshot"] }).db, ["zara:8372288"], { nowMs: MONDAY, env: ENV }), null, "без миграции строки нет");
  const auth = fakeDb({ tables: { assortment_cn_article_snapshot: rows, assortment_sources: [s104(stopState("auth"))] } }).db;
  assert.equal(await loadChinaCopies(auth, ["zara:8372288"], { nowMs: MONDAY, env: ENV }), null, "ключ отвергнут — строки нет, как и блока");
});

function post(code: string, over: Row = {}): Row {
  return {
    platform: "instagram", code, url: `https://www.instagram.com/reel/${code}/`, account_handle: "jpnbrands", published_at: iso(MONDAY - 5 * DAY), first_seen_at: iso(MONDAY - 4 * DAY),
    last_checked_at: iso(MONDAY - DAY), checks: 1, found_via: ["topic"], topics: [], brand: "zara", direction: "jackets", caption_excerpt: "Zara jacket ref 8372/288", hashtags: [],
    refs: ["zara:8372288"], likes: 12000, comments: 60, views: 480000, likes_hidden: false, intent_count: 20, intent_total: 30, likes_ratio: 14, comments_ratio: 6, verdict: "strong",
    verdict_preliminary: false, rule_version: "reels-v1", history: [], match_status: "brand_site", match_model_key: null, match_url: "https://www.zara.com/us/en/jacket-p08372288.html",
    match_title: "BOMBER JACKET", match_image: null, match_gender: "women", match_checked_at: iso(MONDAY - DAY), hidden_at: null, hidden_by: null, last_error: null, ...over,
  };
}
const account = (handle: string): Row => ({ platform: "instagram", handle, kind: "reseller", origin: "seed", status: "watched", note: null, followers: null, likes_median: 900, comments_median: 10, baseline_posts: 12, baseline_at: iso(MONDAY - DAY), appearances: 0, first_seen_at: iso(MONDAY - 10 * DAY), last_checked_at: iso(MONDAY - 2 * DAY), last_error: null });

async function withKey<T>(run: () => Promise<T>): Promise<T> {
  const before = process.env.ALI_1688_AK;
  process.env.ALI_1688_AK = ENV.ALI_1688_AK;
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env.ALI_1688_AK;
    else process.env.ALI_1688_AK = before;
  }
}

test("лента «Залетает» приносит копии на 1688 к номерам своих карточек; сбой чтения копий — строка в warnings, лента не падает; без ключа — копий нет", async () => {
  const tables = {
    assortment_social_post: [post("DdA1111111"), post("DdB2222222", { refs: ["uniqlo:487517"], brand: "uniqlo", verdict: "viral" })],
    assortment_social_account: [account("jpnbrands")],
    assortment_cn_article_snapshot: [
      { ref_key: "zara:8372288", observed_on: PREV, direction: "jackets", offers: 1, sellers: 1, sample_offer_ids: [] },
      { ref_key: "zara:8372288", observed_on: WEEK, direction: "jackets", offers: 3, sellers: 3, sample_offer_ids: [] },
      { ref_key: "zara:9999999", observed_on: WEEK, direction: "jackets", offers: 7, sellers: 7, sample_offer_ids: [] },
    ],
  };
  const feed = await withKey(() => loadSocialFeed(fakeDb({ tables }).db, { direction: "jackets", days: 14, onlyStrong: false, nowMs: MONDAY }));
  assert.ok(feed.available);
  assert.deepEqual(feed.cards.map((c) => c.code).sort(), ["DdA1111111", "DdB2222222"]);
  assert.deepEqual(feed.chinaCopies, { "zara:8372288": { refKey: "zara:8372288", offers: 3, sellers: 3, delta: 2, observedOn: WEEK, previousOn: PREV } }, "только номера карточек ленты");
  assert.deepEqual(feed.warnings, []);
  const failed = await withKey(() => loadSocialFeed(fakeDb({ tables, fail: ["assortment_cn_article_snapshot"] }).db, { direction: "jackets", days: 14, onlyStrong: false, nowMs: MONDAY }));
  assert.ok(failed.available);
  assert.equal(failed.cards.length, 2, "лента на месте");
  assert.equal(failed.chinaCopies, null);
  assert.match(failed.warnings.join(" "), /копии на 1688 не загрузились: .*statement timeout/);
  const noKey = await loadSocialFeed(fakeDb({ tables }).db, { direction: "jackets", days: 14, onlyStrong: false, nowMs: MONDAY });
  assert.ok(noKey.available);
  assert.equal(noKey.chinaCopies, null);
  assert.deepEqual(noKey.warnings, []);
});

// ---------------------------------------------------------------------------
// Воскресная сводка

const block = (key: string, observedOn: string, previousOn: string | null, newRanks: number[], extra = 0) => {
  const n = niche(key);
  const offers = [...newRanks.map((rank) => ({ ...offer({ offerId: `10000000${key.length}${rank}`, rank, titleRu: `${n.ru} №${rank}`, change: { kind: "new" as const } }) })), ...Array.from({ length: extra }, (_, i) => offer({ rank: 30 + i, change: { kind: "same" } }))];
  return { key, direction: n.direction, ru: n.ru, zh: n.zh[0], clerin: false, observedOn, previousOn, sellers: 10, offers, newInTop: newRanks.length, rose: 0, market: null };
};

test("сводка: до 5 «новых в топе» — по одной лучшей карточке ниши по кругу; только снимок этой недели против прошлого; рост копий — только прирост > 0; нечего сказать — раздела нет", () => {
  const blocks = [
    block("underarm", WEEK, PREV, [7, 2, 9]),
    block("tote", WEEK, PREV, [4]),
    block("trench", WEEK, PREV, [5, 1, 3, 8]),
    block("bucket", WEEK, null, [1, 2]), // без прошлого снимка — не «новое»
    block("hobo", PREV, "2026-09-21", [1]), // снимок прошлой недели — не эта неделя
  ];
  const articles = articleCards([
    { ref_key: "zara:8372288", observed_on: PREV, direction: "jackets", offers: 1, sellers: 1, sample_offer_ids: [] },
    { ref_key: "zara:8372288", observed_on: WEEK, direction: "jackets", offers: 3, sellers: 3, sample_offer_ids: [] },
    { ref_key: "uniqlo:487517", observed_on: PREV, direction: "jackets", offers: 4, sellers: 4, sample_offer_ids: [] },
    { ref_key: "uniqlo:487517", observed_on: WEEK, direction: "jackets", offers: 2, sellers: 2, sample_offer_ids: [] },
    { ref_key: "uniqlo:460329", observed_on: WEEK, direction: "jackets", offers: 6, sellers: 6, sample_offer_ids: [] },
    { ref_key: "zara:6318267", observed_on: PREV, direction: "jackets", offers: 2, sellers: 2, sample_offer_ids: [] },
    { ref_key: "zara:6318267", observed_on: WEEK, direction: "jackets", offers: 7, sellers: 5, sample_offer_ids: [] },
  ] as never);
  const d = pickChinaDigest(WEEK, blocks as never, articles)!;
  assert.equal(CHINA_DIGEST_MAX_ITEMS, 5);
  assert.deepEqual(d.items.map((i) => [i.niche, i.rank]), [
    ["Женский тренч", 1], ["Женская сумка под мышку", 2], ["Женский тоут", 4], ["Женский тренч", 3], ["Женская сумка под мышку", 7],
  ], "по кругу: лучшая карточка каждой ниши, ниши с бо́льшим числом новых — первыми");
  assert.equal(d.newTotal, 8);
  assert.equal(d.niches, 3);
  assert.deepEqual(d.growth.map((g) => [g.refKey, g.offers, g.delta]), [["zara:6318267", 7, 5], ["zara:8372288", 3, 2]], "только рост, без прошлого снимка — не рост, падение — не рост");
  assert.equal(pickChinaDigest(WEEK, [block("bucket", WEEK, null, [1])] as never, []), null);
  assert.equal(pickChinaDigest("2026-10-12", blocks as never, articles), null, "снимка этой недели нет — раздела нет");
  assert.equal(pickChinaDigest(WEEK, [], articles.filter((a) => a.refKey === "zara:8372288"))?.items.length, 0, "только рост копий — раздел есть");
});

const emptyDirection = (): DigestDirection => ({ newCount: 0, retailCount: 0, top: [], selected: 0, sampleNeeded: 0, rejected: 0, topReason: null });
const facts = (china: DigestFacts["china"]): DigestFacts => ({ from: "2026-10-04T07:00:00Z", to: "2026-10-11T07:00:00Z", directions: { bags: emptyDirection(), jackets: emptyDirection() }, collections: [], crawl: null, china, baseUrl: "https://panel.example" });

test("сводка: раздел «Китай (1688)» — ссылки на карточки, рост копий, «не спрос WB; цены не показываем», ссылка на вкладку; сбой — строка; без данных — раздела нет", () => {
  const china: ChinaDigest = {
    week: WEEK, newTotal: 8, niches: 3,
    items: [{ direction: "bags", niche: "Женская сумка под мышку", title: "Сумка <мини> & ремень", rank: 2, url: "https://detail.1688.com/offer/1080947777395.html" }],
    growth: [{ refKey: "zara:6318267", brand: "zara", number: "6318267", offers: 7, delta: 5 }, { refKey: "uniqlo:460329", brand: "uniqlo", number: "460329", offers: 1, delta: 1 }],
  };
  const text = digestMessage(facts(china));
  assert.match(text, /<b>Китай \(1688\): топ ниш и копии<\/b>\nСнимок недели с 05\.10\. Оптовые продажи в Китае — не спрос WB; цены не показываем\./);
  assert.match(text, /Новое в топе: 8 в 3 нишах \(к прошлому снимку ниши — расчёт\)\./);
  assert.match(text, /• Женская сумка под мышку: <a href="https:\/\/detail\.1688\.com\/offer\/1080947777395\.html">Сумка &lt;мини&gt; &amp; ремень<\/a> — №2 в выдаче/);
  assert.match(text, /• и ещё 7/);
  assert.match(text, /Копий на 1688 стало больше \(номера из рилсов; оценка снизу, прирост — расчёт\):\n• Zara 6318\/267 — 7 копий \(\+5 за неделю\)\n• Uniqlo 460329 — 1 копия \(\+1 за неделю\)/);
  assert.match(text, /Смотреть: <a href="https:\/\/panel\.example\/assortment-development\/bags\?view=china">Сумки<\/a> · <a href="https:\/\/panel\.example\/assortment-development\/jackets\?view=china">Куртки<\/a>/);
  assert.doesNotMatch(text, /ничего не происходило/, "новое в топе — это событие недели");
  assert.ok(text.indexOf("Китай (1688)") < text.indexOf("Открыть модуль"));
  for (const none of [null, undefined, { ...china, items: [], growth: [] }]) assert.doesNotMatch(digestMessage(facts(none)), /Китай \(1688\)/);
  assert.match(digestMessage(facts({ week: "", items: [], growth: [], newTotal: 0, niches: 0, error: "statement timeout" })), /<b>Китай \(1688\)<\/b>\n⚠️ Не загрузилось: statement timeout/);
  const onlyGrowth = digestMessage(facts({ ...china, items: [], newTotal: 0, niches: 0 }));
  assert.doesNotMatch(onlyGrowth, /Новое в топе/);
  assert.match(onlyGrowth, /Копий на 1688 стало больше/);
  const long = digestMessage(facts({ ...china, items: Array.from({ length: 5 }, (_, i) => ({ ...china.items[0], title: "Ж".repeat(300), rank: i + 1 })) }));
  assert.ok(long.length < 4096, `сообщение Telegram до 4096 знаков (${long.length})`);
  assert.doesNotMatch(long, /Ж{81}/, "название в сводке — не длиннее 80 знаков");
});

test("сводка из базы: два снимка (>1000 строк — листанием) → новое в топе и рост копий; без ключа и без таблиц — раздела нет; loadDigestFacts кладёт раздел", async () => {
  const offers: Row[] = [];
  for (const n of CHINA_NICHES) {
    const data = n.direction === "jackets" ? G_JACKETS.data : G_BAGS.data;
    offers.push(...offerRows(n.key, PREV, n.direction === "bags" ? SHIFTED : data), ...offerRows(n.key, WEEK, data));
  }
  assert.ok(offers.length > 1000, "строк больше страницы PostgREST");
  const articles: Row[] = [
    { ref_key: "zara:8372288", observed_on: PREV, direction: "jackets", offers: 1, sellers: 1, sample_offer_ids: [] },
    { ref_key: "zara:8372288", observed_on: WEEK, direction: "jackets", offers: 3, sellers: 3, sample_offer_ids: [] },
  ];
  const tables = { assortment_cn_offer_snapshot: offers, assortment_cn_article_snapshot: articles, assortment_sources: [s104()] };
  const SUNDAY = Date.parse("2026-10-11T07:00:00Z");
  const d = await loadChinaDigest(fakeDb({ tables }).db, { nowMs: SUNDAY, env: ENV });
  assert.ok(d);
  assert.equal(d.week, WEEK);
  assert.equal(d.items.length, CHINA_DIGEST_MAX_ITEMS);
  assert.equal(d.niches, 12, "новые в топе — у всех ниш сумок (у курток снимки одинаковые)");
  assert.equal(d.newTotal, 12 * 5);
  assert.ok(d.items.every((i) => i.direction === "bags" && /^https:\/\/detail\.1688\.com\/offer\/\d+\.html$/.test(i.url)));
  assert.deepEqual(d.growth.map((g) => [g.refKey, g.delta]), [["zara:8372288", 2]]);
  assert.doesNotMatch(JSON.stringify(d), LEAK_RE);
  assert.equal(await loadChinaDigest(fakeDb({ tables }).db, { nowMs: SUNDAY, env: {} }), null, "без ключа");
  assert.equal(await loadChinaDigest(fakeDb({ missing: ["assortment_cn_offer_snapshot"] }).db, { nowMs: SUNDAY, env: ENV }), null, "без миграции");
  assert.equal(await loadChinaDigest(fakeDb({ tables: { ...tables, assortment_sources: [s104(stopState("auth"))] } }).db, { nowMs: SUNDAY, env: ENV }), null, "ключ отвергнут");
  // Вся сводка: раздел «Китай (1688)» — в фактах недели; сбой чтения — строкой, а не падением сводки.
  const loaded = await withKey(() => loadDigestFacts(fakeDb({ tables }).db, new Date(SUNDAY - 7 * DAY), new Date(SUNDAY), "https://panel.example"));
  assert.equal(loaded.china?.items.length, CHINA_DIGEST_MAX_ITEMS);
  const broken = await withKey(() => loadDigestFacts(fakeDb({ tables, fail: ["assortment_cn_offer_snapshot"] }).db, new Date(SUNDAY - 7 * DAY), new Date(SUNDAY), "https://panel.example"));
  assert.match(String(broken.china?.error), /statement timeout/);
});

// ---------------------------------------------------------------------------
// «Источники»: строка 1688

const sourceFacts = (over: Partial<ChinaSourceFacts> = {}): ChinaSourceFacts => ({ enabled: true, keyConfigured: true, migrationMissing: false, latestOn: WEEK, niches: 21, stop: null, ...over });

test("«Источники», 1688 (S104): выключен, нет ключа, нет миграции, ключ отвергнут, снимка ещё нет, свежий снимок, давно не снимался — статус и строка по факту", () => {
  const now = MONDAY + 2 * DAY;
  const view = (over: Partial<ChinaSourceFacts>) => chinaSourceView(sourceFacts(over), now);
  assert.equal(view({ enabled: false }).accessStatus, "disabled");
  assert.match(view({ enabled: false }).accessNote, /ASSORTMENT_CHINA=off/);
  assert.deepEqual(view({ keyConfigured: false }), { accessStatus: "not_connected", accessNote: "1688: нет ключа — задайте ALI_1688_AK (выдаётся на clawhub.1688.com); недельный снимок не снимается. Вручную — страница «Китайские площадки — ссылки»." });
  assert.equal(view({ migrationMissing: true }).accessStatus, "partial");
  assert.match(view({ migrationMissing: true }).accessNote, /нужна миграция 202610070001_assortment_china_1688\.sql/);
  assert.equal(view({ stop: { reason: "auth", at: iso(MONDAY), message: "x" } }).accessStatus, "unavailable");
  assert.match(view({ stop: { reason: "auth", at: iso(MONDAY), message: "x" } }).accessNote, /ключ 1688 недействителен/);
  assert.equal(view({ latestOn: null }).accessStatus, "partial");
  assert.match(view({ latestOn: null }).accessNote, /первого недельного снимка ещё нет/);
  assert.deepEqual(view({}), { accessStatus: "auto_verified", accessNote: "1688 подключён (официальные навыки 1688): последний снимок — неделя с 05.10.2026, ниш 21 из 21; вкладка «Китай (1688)» в «Куртках» и «Сумках»." });
  assert.equal(view({ latestOn: PREV }).accessStatus, "auto_verified", "прошлая неделя — свежий, пока снимается эта");
  assert.equal(view({ latestOn: "2026-09-21" }).accessStatus, "partial", "две недели без снимка — не «работает»");
  assert.match(view({ latestOn: "2026-09-21" }).accessNote, /свежего снимка нет: последний — неделя с 21\.09\.2026/);
  assert.match(view({ stop: { reason: "rate_limit", at: iso(MONDAY), message: "x" } }).accessNote, /упёрлись в лимит 1688/);
  assert.equal(view({ stop: { reason: "rate_limit", at: iso(MONDAY), message: "x" } }).accessStatus, "auto_verified");
});

test("паспорт источников: S104 показан по факту «Китай (1688)» (последний снимок — по убыванию даты, ниш в нём); сбой чтения — названо, паспорт не падает", async () => {
  const offers = [...offerRows("underarm", PREV, G_BAGS.data), ...offerRows("bucket", PREV, G_BAGS.data), ...offerRows("underarm", WEEK, G_BAGS.data)];
  const factsRead = await loadChinaSourceFacts(fakeDb({ tables: { assortment_cn_offer_snapshot: offers, assortment_sources: [s104()] } }).db, { env: ENV });
  assert.deepEqual(factsRead, { enabled: true, keyConfigured: true, migrationMissing: false, latestOn: WEEK, niches: 1, stop: null }, "последний снимок — неделя 05.10, в нём одна ниша");
  assert.deepEqual(await loadChinaSourceFacts(fakeDb().db, { env: {} }), { enabled: true, keyConfigured: false, migrationMissing: false, latestOn: null, niches: 0, stop: null });
  assert.equal((await loadChinaSourceFacts(fakeDb({ missing: ["assortment_cn_offer_snapshot"] }).db, { env: ENV })).migrationMissing, true);
  assert.equal((await loadChinaSourceFacts(fakeDb().db, { env: { ...ENV, ASSORTMENT_CHINA: "off" } })).enabled, false);

  const other: Row = { ...s104(), source_id: "S001", name: "Zara", access_status: "auto_verified", access_note: null, capabilities: {} };
  const passport = await loadAssortmentSources(null, { db: fakeDb({ tables: { assortment_sources: [s104(), other], assortment_cn_offer_snapshot: offers } }).db, now: MONDAY + DAY, env: ENV, socialEnabled: true });
  assert.ok(passport.ok);
  const cn = passport.sources.find((s) => s.sourceId === CHINA_SOURCE_ID)!;
  assert.equal(cn.accessStatus, "auto_verified");
  assert.match(String(cn.accessNote), /последний снимок — неделя с 05\.10\.2026, ниш 1 из 21/);
  assert.equal(cn.declaredAccessStatus, undefined);
  const noKey = await loadAssortmentSources(null, { db: fakeDb({ tables: { assortment_sources: [s104()] } }).db, now: MONDAY, env: {}, socialEnabled: true });
  assert.ok(noKey.ok);
  assert.equal(noKey.sources[0].accessStatus, "not_connected");
  const broken = await loadAssortmentSources(null, { db: fakeDb({ tables: { assortment_sources: [s104(), other] }, fail: ["assortment_cn_offer_snapshot"] }).db, now: MONDAY, env: ENV, socialEnabled: true });
  assert.ok(broken.ok, "сбой строки 1688 не роняет паспорт");
  const failed = broken.sources.find((s) => s.sourceId === CHINA_SOURCE_ID)!;
  assert.equal(failed.accessStatus, "partial");
  assert.match(String(failed.accessNote), /1688: состояние недельного снимка не прочиталось — .*statement timeout/);
  const disabledPassport = await loadAssortmentSources(null, { db: fakeDb({ tables: { assortment_sources: [{ ...s104(), access_status: "disabled" }] } }).db, now: MONDAY, env: ENV, socialEnabled: true });
  assert.ok(disabledPassport.ok);
  assert.equal(disabledPassport.sources[0].accessStatus, "disabled", "отключённый в паспорте — как записано");
  const sourcesView = read("components/assortment/AssortmentSources.tsx");
  assert.match(sourcesView, /<Link href=\{CHINA_LINKS_PATH\}/, "со страницы «Источники» — ссылки на площадки (доступны всегда)");
});

// ---------------------------------------------------------------------------
// Сторож

test("сторож: «Китай (1688)» — больше 8 суток без строки журнала или 3 ошибки подряд; лимит 1688 — не ошибка; имя задачи — то, что пишет крон", () => {
  const rule = WATCHED_JOBS.find((j) => j.job === CHINA_JOB)!;
  assert.ok(rule, "задача 1688 под сторожем");
  assert.equal(CHINA_JOB, "assortment-china");
  assert.match(read("app/api/sync/assortment-china/route.ts"), /await writeSyncLog\(CHINA_JOB, status,/);
  const NOW = MONDAY + 3 * DAY;
  const run = (status: JobRun["status"], hoursAgo: number, error: string | null = status === "error" ? "ключ 1688 не задан (ALI_1688_AK)" : null): JobRun => ({ job: CHINA_JOB, status, error, started_at: iso(NOW - hoursAgo * HOUR) });
  // Неделя: снимок готов в понедельник — до следующего понедельника строк нет (≈6,75 суток) — это не тишина.
  assert.equal(jobFreshness(rule, [run("ok", 7 * 24 - 6)], NOW).state, "ok");
  assert.equal(jobFreshness(rule, [run("ok", 8 * 24 - 1)], NOW).state, "ok", "7 суток 23 часа — ещё не тревога");
  const silent = jobFreshness(rule, [run("ok", 8 * 24 + 1)], NOW);
  assert.equal(silent.state, "stalled", "больше 8 суток — пропущены понедельник и вторник");
  assert.match(String(silent.reason), /нет прогонов 8 сут/);
  assert.equal(jobFreshness(rule, [run("error", 1), run("error", 7)], NOW).state, "ok", "две ошибки — ещё не тревога");
  const broken = jobFreshness(rule, [run("error", 1), run("error", 7), run("error", 25)], NOW);
  assert.equal(broken.state, "stalled");
  assert.match(String(broken.reason), /3 прогонов подряд с ошибкой/);
  assert.equal(broken.lastError, "ключ 1688 не задан (ALI_1688_AK)");
  assert.equal(jobFreshness(rule, [run("error", 1), run("partial", 7, "упёрлись в лимит 1688"), run("error", 25)], NOW).state, "ok", "лимит 1688 — partial, серию рвёт");
  assert.equal(jobFreshness(rule, [], NOW).state, "awaiting", "до первого прогона — не тревога");
  assert.match(JOBS_STALL_ACTION, /ALI_1688_AK/);
});

// ---------------------------------------------------------------------------
// Страница ссылок

test("страница «Китайские площадки — ссылки»: все ниши с китайским ключом и тремя ссылками, фильтр по разделу, без запросов к серверу; адрес — в модуле", () => {
  const all = html(createElement(ChinaLinksPage, {}));
  const text = flat(all);
  assert.equal((text.match(/1688 — по продажам/g) ?? []).length, CHINA_NICHES.length);
  assert.equal((text.match(/Taobao — поиск/g) ?? []).length, CHINA_NICHES.length);
  assert.equal((all.match(/href="https:\/\/www\.alphashop\.cn\/"/g) ?? []).length, CHINA_NICHES.length);
  for (const n of CHINA_NICHES) {
    assert.ok(text.includes(n.ru), n.ru);
    assert.ok(all.includes(`href="${search1688Url(n.zh[0]).replace(/&/g, "&amp;")}"`), `${n.key}: 1688 по продажам`);
  }
  assert.match(all, /<span lang="zh" class="select-all font-medium text-slate-900">腋下包 女<\/span>/, "ключ можно выделить и скопировать");
  assert.match(text, /Цены на площадках есть — в панель мы их не переносим\. Оптовые продажи в Китае — не спрос WB\./);
  assert.match(all, /target="_blank" rel="noopener noreferrer"/);
  const bags = flat(html(createElement(ChinaLinksPage, { initialFilter: "bags" })));
  assert.equal((bags.match(/1688 — по продажам/g) ?? []).length, 12);
  assert.doesNotMatch(bags, /Женский тренч/);
  assert.doesNotMatch(read("components/assortment/ChinaLinksPage.tsx"), /fetch\(|\/api\//, "без сбора: странице сервер не нужен");
  assert.ok(existsSync(join(root, "app/assortment-development/china-links/page.tsx")));
  assert.match(read("app/assortment-development/china-links/page.tsx"), /initialFilter=\{direction \?\? "all"\}/);
  assert.match(read("lib/auth/roles.ts"), /buyer: \[[^\]]*"\/assortment-development"\]/, "страница под правами модуля (по префиксу)");
});
