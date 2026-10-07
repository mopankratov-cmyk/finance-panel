import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialBadge } from "../components/assortment/CatalogView.tsx";
import { SocialAccountsList, SocialEmpty, SocialIntro, SocialReelCardView, SocialRunLine, SocialUnavailable, type CardLocal } from "../components/assortment/SocialView.tsx";
import { isFeedView, sectionViewFrom, type CatalogCard } from "../lib/assortment/catalog.ts";
import { digestMessage, type DigestDirection, type DigestFacts } from "../lib/assortment/digest.ts";
import { loadDigestFacts } from "../lib/assortment/digestFacts.ts";
import { buildEvidence } from "../lib/assortment/evidence.ts";
import { normalizeProductUrl } from "../lib/assortment/extract.ts";
import { jobFreshness, WATCHED_JOBS, type JobRun } from "../lib/assortment/jobsWatch.ts";
import {
  cardTitle, compactRu, firstMeasuredAt, importableBrandUrl, nextSocialRun, parseFeedPeriod, parseHandle, pickSocialDigest, refArticle, sampleLinksFor, SOCIAL_CRON,
  SOCIAL_RUNS_PER_DAY, socialCronMskTimes, socialPassPlan, socialPassText, socialProgressText, socialQueuePending, timesPhrase, type SocialDigestPost, type SocialProgress,
} from "../lib/assortment/socialFeed.ts";
import {
  addSocialAccount, attachSocialFlags, countSocialFeed, loadModelSocial, loadSocialAccountsView, loadSocialFeed, loadSocialProgress, loadSocialRunStatus, setReelHidden, setSocialAccountStatus,
  SOCIAL_ALERT_STREAK,
} from "../lib/assortment/socialFeedStore.ts";
import { uniqloCardUrls, zaraCardUrl } from "../lib/assortment/socialReels.ts";
import type { SocialReelCard } from "../lib/assortment/socialReelsStore.ts";

/**
 * «Залетает в соцсетях» — экран, роуты, метка в каталоге, строка в карточке модели, раздел воскресной сводки и сторож. Подставная
 * база применяет фильтры (eq/gte/in/is/not), считает count до среза страницы и отдаёт «таблицы нет», как PostgREST.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const flat = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const NOW = Date.parse("2026-10-06T16:00:00Z");
const DAY = 24 * 3600 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const noop = () => undefined;

// ---------------------------------------------------------------------------
// Подставная база

type Row = Record<string, unknown>;

function fakeDb(init: { tables?: Record<string, Row[]>; missing?: string[]; fail?: string[] } = {}) {
  const tables: Record<string, Row[]> = { assortment_social_post: [], assortment_social_account: [], assortment_catalog_heads: [], assortment_source_items: [], sync_log: [], ...(init.tables ?? {}) };
  const missing = new Set(init.missing ?? []);
  const fail = new Set(init.fail ?? []);
  const reads: string[] = [];
  const db = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
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
        if (op === "update") {
          const hit = rows();
          for (const r of hit) Object.assign(r, structuredClone(values));
          return { data: returning ? hit.map((r) => ({ ...r })) : null, count: null, error: null };
        }
        reads.push(table);
        const all = rows().map((r) => structuredClone(r));
        let list = all;
        if (range) list = list.slice(range[0], Math.min(range[1] + 1, range[0] + 1000));
        if (limit != null) list = list.slice(0, limit);
        return { data: list, count: counting ? all.length : null, error: null };
      };
      const q: Record<string, unknown> = {
        select: (_cols?: string, opts?: { count?: string }) => {
          if (op === "update") returning = true;
          if (opts?.count) counting = true;
          return q;
        },
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        gte: (c: string, v: unknown) => (filters.push((r) => r[c] != null && (typeof v === "number" ? Number(r[c]) >= v : String(r[c]) >= String(v))), q),
        lt: (c: string, v: unknown) => (filters.push((r) => r[c] != null && String(r[c]) < String(v)), q),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
        contains: (c: string, vs: unknown[]) => (filters.push((r) => Array.isArray(r[c]) && vs.every((v) => (r[c] as unknown[]).includes(v))), q),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
        not: (c: string, operator: string, v: unknown) => {
          if (operator !== "is" || v !== null) throw new Error(`подставка: not(${operator})`);
          filters.push((r) => r[c] != null);
          return q;
        },
        order: () => q,
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
        insert: (row: Row) => {
          if (missing.has(table)) return Promise.resolve({ error: { code: "42P01", message: `relation "public.${table}" does not exist` } });
          if (table === "assortment_social_account" && (tables[table] ?? []).some((r) => r.handle === row.handle)) return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
          (tables[table] ??= []).push({ first_seen_at: iso(NOW), appearances: 0, note: null, last_checked_at: null, last_error: null, followers: null, ...structuredClone(row) });
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(exec()).then(resolve, reject),
      };
      return q;
    },
  };
  return { db: db as never, tables, reads };
}

function post(code: string, over: Row = {}): Row {
  return {
    platform: "instagram", code, url: `https://www.instagram.com/reel/${code}/`, account_handle: "jpnbrands", published_at: iso(NOW - 5 * DAY), first_seen_at: iso(NOW - 4 * DAY),
    last_checked_at: iso(NOW - DAY), checks: 1, found_via: ["topic"], topics: [], brand: "zara", direction: "jackets", caption_excerpt: "Zara jacket ref 5854/722/710", hashtags: [],
    refs: ["zara:5854722"], likes: 12000, comments: 60, views: 480000, likes_hidden: false, intent_count: 20, intent_total: 30, likes_ratio: 14, comments_ratio: 6, verdict: "strong",
    verdict_preliminary: false, rule_version: "reels-v1", history: [{ at: iso(NOW - DAY), likes: 12000, comments: 60, views: 480000 }], match_status: "catalog",
    match_model_key: "S001|5854722", match_url: "https://www.zara.com/us/en/jacket-p05854722.html", match_title: "BOMBER JACKET", match_image: "https://static.zara.net/assets/public/live/a.jpg",
    match_gender: "women", match_checked_at: iso(NOW - DAY), hidden_at: null, hidden_by: null, last_error: null, ...over,
  };
}

function account(handle: string, over: Row = {}): Row {
  return { platform: "instagram", handle, kind: "reseller", origin: "seed", status: "watched", note: null, followers: null, likes_median: 900, comments_median: 10, baseline_posts: 12, baseline_at: iso(NOW - DAY), appearances: 0, first_seen_at: iso(NOW - 10 * DAY), last_checked_at: iso(NOW - 2 * DAY), last_error: null, ...over };
}

function card(over: Partial<SocialReelCard> = {}, match: Partial<SocialReelCard["match"]> = {}): SocialReelCard {
  return {
    code: "DdVk7eRtLMC", url: "https://www.instagram.com/reel/DdVk7eRtLMC/", kind: "reel", author: { handle: "jpnbrands", url: "https://www.instagram.com/jpnbrands/", kind: "reseller", followers: null },
    publishedAt: iso(NOW - 5 * DAY), brand: "zara", direction: "jackets", captionExcerpt: "Zara jacket ref 5854/722/710", hashtags: [], refs: ["zara:5854722"], verdict: "strong", preliminary: false,
    ruleVersion: "reels-v1", likes: 12000, likesHidden: false, comments: 60, views: 480000, intent: { count: 20, total: 30, share: 0.67 }, likesRatio: 14, commentsRatio: 6,
    baseline: { likesMedian: 900, commentsMedian: 10, posts: 12 }, checks: 1, lastCheckedAt: iso(NOW - DAY), history: [], sameRefAuthors14d: 3, confirmedBySecondAuthor: true,
    match: { status: "catalog", title: "BOMBER JACKET", image: "https://static.zara.net/assets/public/live/a.jpg", url: "https://www.zara.com/us/en/jacket-p05854722.html", modelKey: "S001|5854722", sourceId: "S001", itemId: "5854722", gender: "women", ...match },
    kinds: { likes: "estimate", comments: "fact", views: "estimate", intent: "estimate", ratios: "calc", verdict: "calc", publishedAt: "calc", sameRefAuthors: "calc", match: "fact" },
    ...over,
  };
}

const renderCard = (c: SocialReelCard, local: CardLocal = {}) => renderToStaticMarkup(createElement(SocialReelCardView, { card: c, local, onPick: noop, onHideModel: noop, onHideReel: noop, onRestore: noop, onAdd: noop }));

// ---------------------------------------------------------------------------
// Вкладка раздела

test("Вкладка «Залетает»: вид из адреса, не лента находок (нет запроса /references, нет «Находок пока нет»), видна только при данных", () => {
  assert.equal(sectionViewFrom({ view: "social" }), "social");
  assert.equal(isFeedView("social"), false, "иначе раздел запросил бы /references?view=social, а роут молча отдал бы «Новинки»");
  assert.equal(isFeedView("catalog"), false);
  assert.equal(isFeedView("forms"), false);
  assert.equal(isFeedView("new"), true);
  const section = read("components/assortment/AssortmentSection.tsx");
  assert.doesNotMatch(section, /view !== "catalog" && view !== "forms"/, "все проверки «это лента?» — одной функцией");
  assert.equal((section.match(/isFeedView\(view\)/g) ?? []).length, 5);
  assert.match(section, /social\?\.collected \|\| socialCountFailed \|\| view === "social" \? \[\{ id: "social" as const/, "без записей вкладки нет; сбой счёта или открытие по адресу — есть");
  assert.match(section, /body\?\.available === false\) \{\n\s+setSocial\(null\)/, "таблиц нет — вкладки нет (а не «сбой»)");
  assert.match(section, /\{view === "social" && <SocialView key=\{direction\} direction=\{direction\} \/>\}/);
  const view = read("components/assortment/SocialView.tsx");
  assert.match(view, /grid grid-cols-1 gap-3 md:grid-cols-2/, "телефон — одна колонка");
});

test("Счёт для вкладки: таблиц нет — available:false (вкладки нет); таблица пуста — collected 0 (вкладки нет); есть «залетевшие» — число", async () => {
  assert.deepEqual(await countSocialFeed(fakeDb({ missing: ["assortment_social_post"] }).db, "jackets", NOW), { available: false, reason: "Сбор рилсов включится после обновления базы (миграция 202610060011_assortment_social_reels.sql)." });
  assert.deepEqual(await countSocialFeed(fakeDb().db, "jackets", NOW), { available: true, total: 0, collected: 0 });
  const { db } = fakeDb({ tables: {
    assortment_social_account: [account("jpnbrands")],
    assortment_social_post: [post("DdA1111111"), post("DdB2222222", { verdict: "normal" }), post("DdC3333333", { direction: "bags" }), post("DdD4444444", { published_at: iso(NOW - 20 * DAY) })],
  } });
  assert.deepEqual(await countSocialFeed(db, "jackets", NOW), { available: true, total: 1, collected: 4 }, "обычный, сумки и старше 14 дней — не в числе вкладки");
  await assert.rejects(countSocialFeed(fakeDb({ fail: ["assortment_social_post"] }).db, "jackets", NOW), /statement timeout/, "сбой — ошибка (вкладка покажется без числа), а не «таблиц нет»");
});

test("Лента: период, «только сильные», скрытый рилс уходит; сколько замерено; строка сбора по журналу; сбой журнала назван", async () => {
  const { db, tables } = fakeDb({ tables: {
    assortment_social_account: [account("jpnbrands"), account("aida.uniq")],
    assortment_social_post: [
      post("DdA1111111"),
      post("DdB2222222", { verdict: "viral", account_handle: "aida.uniq", likes_ratio: 11 }),
      post("DdC3333333", { verdict: "normal" }),
      post("DdOLD33333", { published_at: iso(NOW - 25 * DAY) }),
      post("DdNEW44444", { checks: 0, verdict: null, likes: null, comments: null, last_checked_at: null }),
    ],
    sync_log: [
      { job: "assortment-social", status: "ok", error: null, started_at: iso(NOW - 2 * DAY) },
      { job: "assortment-social", status: "partial", error: "кончилось время прогона", started_at: iso(NOW - 3600_000) },
      { job: "assortment-digest", status: "error", error: "чужая задача", started_at: iso(NOW - 60_000) },
    ],
  } });
  const feed = await loadSocialFeed(db, { direction: "jackets", days: 14, onlyStrong: false, nowMs: NOW });
  assert.ok(feed.available);
  assert.deepEqual(feed.cards.map((c) => c.code), ["DdA1111111", "DdB2222222"], "сильный первым; обычный и старше периода — нет");
  assert.equal(feed.measured, 3, "замерено за 14 дней: три рилса раздела (с обычным, без ещё не замеренного)");
  assert.deepEqual([feed.run?.lastStatus, feed.run?.lastNote, feed.run?.lastOkAt], ["partial", "кончилось время прогона", iso(NOW - 3600_000)]);
  assert.equal(feed.run?.nextRunAt, "2026-10-06T18:20:00.000Z", "крон каждые 3 часа: после 16:00 UTC — 18:20 UTC");
  const wide = await loadSocialFeed(db, { direction: "jackets", days: 30, onlyStrong: false, nowMs: NOW });
  assert.ok(wide.available && wide.cards.some((c) => c.code === "DdOLD33333"), "30 дней — и старый «залёт» виден");
  const strong = await loadSocialFeed(db, { direction: "jackets", days: 14, onlyStrong: true, nowMs: NOW });
  assert.ok(strong.available && strong.cards.every((c) => c.verdict === "strong"));

  assert.equal(await setReelHidden(db, "DdA1111111", true, "director@example.invalid", NOW), "ok");
  assert.equal(tables.assortment_social_post[0].hidden_at, iso(NOW));
  const after = await loadSocialFeed(db, { direction: "jackets", days: 14, onlyStrong: false, nowMs: NOW });
  assert.ok(after.available && !after.cards.some((c) => c.code === "DdA1111111"), "«Не интересно» — рилс уходит из ленты");
  assert.ok(after.cards.some((c) => c.code === "DdB2222222"), "скрыт только этот рилс");
  assert.equal(await setReelHidden(db, "DdA1111111", false, "x", NOW), "ok");
  assert.equal(tables.assortment_social_post[0].hidden_at, null, "«Вернуть»");
  assert.equal(await setReelHidden(db, "DdNOPE0000", true, "x", NOW), "not_found");
  assert.equal(await setReelHidden(fakeDb({ missing: ["assortment_social_post"] }).db, "DdA1111111", true, "x", NOW), "migration_missing");

  const noLog = await loadSocialFeed(fakeDb({ tables: { assortment_social_post: [post("DdA1111111")], assortment_social_account: [account("jpnbrands")] }, fail: ["sync_log"] }).db, { direction: "jackets", days: 14, onlyStrong: false, nowMs: NOW });
  assert.ok(noLog.available);
  assert.equal(noLog.run, null);
  assert.match(noLog.warnings.join(" "), /журнал сбора не загрузился: canceling statement/, "сбой назван, а не спрятан");
  assert.deepEqual(await loadSocialFeed(fakeDb({ missing: ["assortment_social_post"] }).db, { direction: "jackets", days: 14, onlyStrong: false, nowMs: NOW }), { available: false, reason: "Сбор рилсов включится после обновления базы (миграция 202610060011_assortment_social_reels.sql)." });
});

// ---------------------------------------------------------------------------
// Роуты: права и «без миграции»

test("Роуты: каждый под сессией модуля; аккаунты правит только директор (403 до записи), читать — все роли; без миграции — причина, а не 500", () => {
  const feedRoute = read("app/api/assortment-development/social/route.ts");
  const accountsRoute = read("app/api/assortment-development/social/accounts/route.ts");
  for (const route of [feedRoute, accountsRoute]) {
    for (const fn of route.matchAll(/export async function (GET|POST|PATCH)\([^)]*\) \{\n\s+const gate = await requireApiSession\(ASSORTMENT_ROLES\);\n\s+if \(gate\) return gate;/g)) assert.ok(fn[1]);
    assert.equal((route.match(/export async function/g) ?? []).length, (route.match(/requireApiSession\(ASSORTMENT_ROLES\)/g) ?? []).length, "у каждого метода своя проверка круга ролей");
  }
  assert.match(accountsRoute, /if \(!sessionRoles\(session\)\.includes\("director"\)\) return \{ session, denied: NextResponse\.json\(\{ error: "Аккаунты-источники правит директор" \}, \{ status: 403 \}\) \}/);
  for (const method of ["POST", "PATCH"]) {
    const body = accountsRoute.slice(accountsRoute.indexOf(`export async function ${method}`));
    const guard = body.indexOf("await directorOnly()");
    assert.ok(guard > 0 && guard < body.indexOf("getSupabaseAdmin()"), `${method}: директор проверяется до базы`);
  }
  assert.match(accountsRoute, /const canEdit = sessionRoles\(session\)\.includes\("director"\);[\s\S]*\{ available: true, \.\.\.result, canEdit \}/, "GET отдаёт canEdit — у остальных кнопок нет");
  assert.match(accountsRoute, /if \(!result\) return NextResponse\.json\(\{ available: false, reason: SOCIAL_UNAVAILABLE, canEdit: false \}/);
  assert.match(feedRoute, /return NextResponse\.json\(await countSocialFeed\(db, direction, nowMs\)/, "счёт без таблиц — 200 { available:false } из стора");
  assert.match(feedRoute, /if \(result === "migration_missing"\) return NextResponse\.json\(\{ error: SOCIAL_UNAVAILABLE \}, \{ status: 503 \}\)/);
  assert.match(feedRoute, /\/\^\[A-Za-z0-9_-\]\{4,40\}\$\/\.test\(body\.code\)/, "код рилса проверяется до базы");
});

test("Ник аккаунта: «@ник», ник и ссылка на профиль — да; рилс, чужой сайт, служебные пути и мусор — нет", () => {
  assert.equal(parseHandle("@JpnBrands"), "jpnbrands");
  assert.equal(parseHandle(" aida.uniq "), "aida.uniq");
  assert.equal(parseHandle("https://www.instagram.com/olga.bogdann/?hl=en"), "olga.bogdann");
  assert.equal(parseHandle("instagram.com/xopi_fashion"), "xopi_fashion");
  for (const bad of ["https://www.instagram.com/reel/DdVk7eRtLMC/", "https://evil.example/zara", "reel", "explore", "...", "a b", "<script>", "x".repeat(31), "", 42]) assert.equal(parseHandle(bad), null, String(bad));
});

test("Аккаунты: наблюдаемые и исключённые с числом залётов; исключить и вернуть — условно; добавить вручную — без затирания", async () => {
  const { db, tables } = fakeDb({ tables: {
    assortment_social_account: [account("jpnbrands"), account("zara", { kind: "brand" }), account("noisy", { status: "excluded" }), account("passer", { origin: "auto", status: "seen" })],
    assortment_social_post: [post("DdA1111111"), post("DdB2222222", { verdict: "viral" }), post("DdC3333333", { verdict: "normal" }), post("DdD4444444", { account_handle: "noisy" })],
  } });
  const view = (await loadSocialAccountsView(db))!;
  assert.deepEqual(view.accounts.map((a) => [a.handle, a.status, a.viral]), [["jpnbrands", "watched", 2], ["zara", "watched", 0], ["noisy", "excluded", 1]]);
  assert.equal(view.seen, 1, "встречавшиеся — числом, без списка");
  assert.equal(view.accounts[0].url, "https://www.instagram.com/jpnbrands/");

  assert.equal(await setSocialAccountStatus(db, "jpnbrands", "exclude"), "ok");
  assert.equal(tables.assortment_social_account[0].status, "excluded");
  assert.equal(await setSocialAccountStatus(db, "jpnbrands", "exclude"), "unchanged");
  assert.equal(await setSocialAccountStatus(db, "jpnbrands", "restore"), "ok");
  assert.equal(tables.assortment_social_account[0].status, "watched");
  assert.equal(await setSocialAccountStatus(db, "ghost", "exclude"), "not_found");

  assert.equal(await addSocialAccount(db, "new.stylist", "stylist"), "created");
  const created = tables.assortment_social_account.find((a) => a.handle === "new.stylist")!;
  assert.deepEqual([created.origin, created.status, created.kind], ["owner", "watched", "stylist"]);
  assert.equal(await addSocialAccount(db, "passer", "buyer"), "watched");
  const passer = tables.assortment_social_account.find((a) => a.handle === "passer")!;
  assert.deepEqual([passer.status, passer.origin], ["watched", "owner"], "найденный сбором становится ручным — прогон его статус не трогает");
  assert.equal(await addSocialAccount(db, "zara", "stylist"), "already");
  assert.equal(tables.assortment_social_account.find((a) => a.handle === "zara")!.kind, "brand", "известный вид не перетирается");
  assert.equal(await addSocialAccount(db, "noisy", "unknown"), "watched", "исключённый по нику возвращается");

  const missing = fakeDb({ missing: ["assortment_social_account"] }).db;
  assert.equal(await loadSocialAccountsView(missing), null);
  assert.equal(await setSocialAccountStatus(missing, "x", "exclude"), "migration_missing");
  assert.equal(await addSocialAccount(missing, "x", "unknown"), "migration_missing");
});

test("Исключённый автор — не в ленте; исключение условное: если статус успели сменить, правка не затирает чужую", async () => {
  const { db, tables } = fakeDb({ tables: { assortment_social_account: [account("jpnbrands", { status: "excluded" })], assortment_social_post: [post("DdA1111111")] } });
  const feed = await loadSocialFeed(db, { direction: "jackets", days: 14, onlyStrong: false, nowMs: NOW });
  assert.ok(feed.available && feed.cards.length === 0);
  // Между чтением и записью директор в другой вкладке уже вернул аккаунт: обновление с прежним статусом ничего не меняет.
  const racing = {
    from(table: string) {
      const real = (db as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> }).from(table);
      const origUpdate = real.update;
      real.update = (v: unknown) => {
        tables.assortment_social_account[0].status = "watched";
        return origUpdate(v);
      };
      return real;
    },
  };
  assert.equal(await setSocialAccountStatus(racing as never, "jpnbrands", "restore"), "conflict");
});

// ---------------------------------------------------------------------------
// Карточка ленты (статический рендер)

test("Карточка модели каталога: фото с сайта бренда, числа с происхождением, «в N раз», доля «купить», авторы за 14 дней, «Отобрать / Не интересно», рилс ссылкой", () => {
  const html = renderCard(card());
  const text = flat(html);
  assert.match(text, /Сильный залёт/);
  assert.match(text, /BOMBER JACKET/);
  assert.match(text, /В нашем каталоге/);
  assert.match(text, /480 тыс\. просмотров · 12 тыс\. лайков · 60 комментариев — факт площадки, Instagram округляет, замер 05\.10/);
  assert.match(text, /Лайков в 14 раз, комментариев в 6 раз выше обычного у автора — расчёт/);
  assert.match(text, /«Где купить», «цена», «ссылка» — 67% комментариев \(из 30 видимых\) — оценка/);
  assert.match(text, /Вещь показали 3 автора за 14 дней — расчёт по номеру товара/);
  assert.match(text, /Опубликован 01\.10 \(по коду рилса\) · @jpnbrands, перепродавец/);
  assert.match(text, /Отобрать/);
  assert.match(text, /Не интересно/);
  assert.doesNotMatch(text, /Добавить в находки/, "у модели каталога — наши «Отобрать», а не импорт");
  assert.match(html, /<img src="https:\/\/static\.zara\.net\/assets\/public\/live\/a\.jpg"/);
  assert.match(html, /<a href="https:\/\/www\.instagram\.com\/reel\/DdVk7eRtLMC\/" target="_blank" rel="noopener noreferrer"[^>]*>.*Рилс/);
  assert.match(text, /Где купить образец/);
  assert.match(html, /google\.com\/search\?q=%225854%2F722%22%20Zara/, "поиск образца по номеру Zara");
  assert.doesNotMatch(text, /₽|€|\$|цена модели|стоимост/i);
});

test("Карточка: касание ≥ 44 px у каждой кнопки, ссылки и раскрывашки; картинку Instagram не показываем, даже если попала в базу", () => {
  for (const html of [renderCard(card()), renderCard(card({}, { status: "brand_site", sourceId: null, itemId: null, modelKey: null })), renderCard(card(), { hidden: "model" })]) {
    const targets = [...html.matchAll(/<(a|button|summary)\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(targets.length > 0);
    for (const t of targets) assert.match(t, /\b(min-)?h-11\b/, `цель нажатия меньше 44 px: ${t}`);
  }
  const insta = renderCard(card({}, { image: "https://scontent-ams2-1.cdninstagram.com/v/t51/frame.jpg" }));
  assert.doesNotMatch(insta, /cdninstagram/);
  assert.match(flat(insta), /фото модели нет/);
});

test("Карточка бренда вне каталога: «есть у бренда, нет в каталоге», «Добавить в находки» (импорт по ссылке на сайт бренда), пол не указан — сказано", () => {
  const c = card({}, { status: "brand_site", sourceId: null, itemId: null, modelKey: null, gender: "unknown" });
  const text = flat(renderCard(c));
  assert.match(text, /Есть у бренда, нет в нашем каталоге · пол на карточке не указан/);
  assert.match(text, /Добавить в находки/);
  assert.doesNotMatch(text, /Отобрать/);
  assert.equal(importableBrandUrl(c), "https://www.zara.com/us/en/jacket-p05854722.html");
  assert.equal(importableBrandUrl(card({}, { status: "brand_site", url: "https://www.instagram.com/reel/DdVk7eRtLMC/" })), null, "рилс в импорт не уходит: importReference скопировал бы картинку Instagram");
  const added = flat(renderCard(c, { added: { href: "/assortment-development/jackets/r1" } }));
  assert.match(added, /В находках · открыть/);
  assert.doesNotMatch(added, /Не интересно/);
  const view = read("components/assortment/SocialView.tsx");
  assert.match(view, /send\("\/api\/assortment-development\/import", "POST", \{ direction, url, title: card\.match\.title \}\)/, "существующий импорт по ссылке");
  assert.match(view, /send\("\/api\/assortment-development\/catalog\/pick", "POST", target\)/, "существующий «Отобрать»");
  assert.match(view, /send\("\/api\/assortment-development\/catalog\/hide", "PATCH", \{ \.\.\.target, hidden: true \}\)/, "существующий «Не интересно» каталога");
});

test("Карточка без номера: «модель не определена», заголовок — выдержка подписи с пометкой; предварительный вердикт — гипотеза; скрытая — «Вернуть»", () => {
  const c = card({ refs: [], preliminary: true, confirmedBySecondAuthor: false, likesRatio: null, commentsRatio: null, intent: null, captionExcerpt: "Новая куртка, обожаю" }, { status: "no_ref", title: null, image: null, url: null, sourceId: null, itemId: null, modelKey: null });
  const text = flat(renderCard(c));
  assert.match(text, /Номера нет — модель не определена/);
  assert.match(text, /«Новая куртка, обожаю» выдержка из подписи автора/);
  assert.match(text, /предварительно/);
  assert.match(text, /Мало постов у автора — сравнили с подписчиками — гипотеза/);
  assert.doesNotMatch(text, /авторов за 14 дней|показал один автор/, "без номера повторы у других авторов не считаем");
  assert.doesNotMatch(text, /Где купить образец/, "нечего искать");
  assert.match(text, /Не интересно/);
  assert.match(flat(renderCard(c, { hidden: "reel" })), /Рилс скрыт из ленты Вернуть/);
  assert.match(flat(renderCard(card(), { picked: { href: "/x", label: "Отобрана" } })), /Отобрана · открыть/);
  assert.match(flat(renderCard(card({ sameRefAuthors14d: 1 }))), /Пока вещь показал один автор/);
});

test("Пустые состояния: без таблиц — одна строка причины; ничего не залетело — сколько замерено и что попробовать; подписи «не продажи»", () => {
  assert.equal(flat(renderToStaticMarkup(createElement(SocialUnavailable, { reason: "Сбор рилсов включится после обновления базы." }))).trim(), "Сбор рилсов включится после обновления базы.");
  const empty = flat(renderToStaticMarkup(createElement(SocialEmpty, { days: 14, onlyStrong: true, measured: 37, onAllVerdicts: noop, onWiden: noop })));
  assert.match(empty, /Сильных залётов за 14 дней нет/);
  assert.match(empty, /Замерено рилсов раздела за период: 37/);
  assert.match(empty, /Показать и «залетает»/);
  assert.match(empty, /За 30 дней/);
  const wide = flat(renderToStaticMarkup(createElement(SocialEmpty, { days: 30, onlyStrong: false, measured: null, onAllVerdicts: noop, onWiden: noop })));
  assert.match(wide, /За 30 дней ничего не залетело/);
  assert.doesNotMatch(wide, /Показать и|За 30 дней ничего.*За 30 дней/);
  assert.match(flat(renderToStaticMarkup(createElement(SocialIntro))), /Лайки и просмотры — не продажи; за рубежом видно/);
});

test("Строка сбора: последний и следующий прогон, счётчики одной строкой, остальное — свёрнуто; плашка — при серии ошибок или «нет денег», не от одного мелкого прогона", () => {
  const base = { lastRunAt: "2026-10-06T06:20:00Z", lastOkAt: "2026-10-06T06:20:00Z", nextRunAt: "2026-10-06T09:20:00.000Z", errorStreak: 0, alert: null };
  const ok = flat(renderToStaticMarkup(createElement(SocialRunLine, { run: { ...base, lastStatus: "ok", lastNote: null }, warnings: [] })));
  assert.match(ok, /^\s*Сбор каждые 3 часа; последний прогон — 06\.10 09:20; следующий — 06\.10 12:20\./);
  assert.match(ok, /Подробнее о сборе Прогоны в 00:20, 03:20 … 21:20 МСК: замер, база авторов, привязка; поиск новых рилсов — раз в 6 дней, доделывается следующими прогонами\./);
  const okHtml = renderToStaticMarkup(createElement(SocialRunLine, { run: { ...base, lastStatus: "partial", lastNote: "кончилось время прогона" }, warnings: [] }));
  assert.match(okHtml, /<details[^>]*><summary[^>]*>Подробнее о сборе<\/summary>.*Пометка прогона: кончилось время прогона\./s, "пометка — внутри свёрнутого блока");
  // Одна мелкая ошибка (1–3 запроса при кроне раз в 3 часа) — пометкой, без красной плашки.
  const single = renderToStaticMarkup(createElement(SocialRunLine, { run: { ...base, lastStatus: "error", lastNote: "сбоев страниц: 6 из 6", errorStreak: 1 }, warnings: [] }));
  assert.equal((single.match(/role="alert"/g) ?? []).length, 0);
  assert.match(flat(single), /последний прогон — 06\.10 09:20 — с ошибкой.*Пометка прогона: сбоев страниц: 6 из 6\./);
  const bad = renderToStaticMarkup(createElement(SocialRunLine, { run: { ...base, lastStatus: "error", lastNote: "сбоев страниц: 9 из 9", lastOkAt: null, errorStreak: 3, alert: "сбоев страниц: 9 из 9" }, warnings: ["журнал сбора не загрузился: timeout"] }));
  assert.equal((bad.match(/role="alert"/g) ?? []).length, 2);
  assert.match(flat(bad), /Прогонов с ошибкой подряд: 3\. сбоев страниц: 9 из 9/);
  assert.doesNotMatch(flat(bad), /Пометка прогона/, "текст ошибки — в плашке, не дважды");
  assert.match(flat(bad), /Не загрузилось: журнал сбора не загрузился: timeout/);
  const billing = flat(renderToStaticMarkup(createElement(SocialRunLine, { run: { ...base, lastStatus: "error", lastNote: "Bright Data: нет денег на счёте", errorStreak: 1, alert: "Bright Data: нет денег на счёте" }, warnings: [] })));
  assert.match(billing, /Последний прогон с ошибкой: Bright Data: нет денег на счёте/);
  assert.match(flat(renderToStaticMarkup(createElement(SocialRunLine, { run: null, warnings: [] }))), /прогонов ещё не было/);
});

test("Ревью 07.10: плашка ошибки по журналу — серия из двух и больше (прогоны без работы её не рвут) или «нет денег» сразу; одна ошибка — нет", async () => {
  const log = (status: string, hoursAgo: number, error: string | null = null) => ({ job: "assortment-social", status, error, started_at: iso(NOW - hoursAgo * 3600_000), rows_affected: 0 });
  const status = async (rows: Row[]) => loadSocialRunStatus(fakeDb({ tables: { sync_log: rows } }).db, NOW);
  const one = await status([log("error", 1, "сбоев страниц: 5 из 5"), log("ok", 4)]);
  assert.deepEqual([one.errorStreak, one.alert, one.lastNote], [1, null, "сбоев страниц: 5 из 5"]);
  const two = await status([log("partial", 1, "дневная доля строки соцсетей выбрана [stop:idle]"), log("error", 4, "сбоев страниц: 5 из 5"), log("error", 7, "сбоев страниц: 7 из 7"), log("ok", 10)]);
  assert.deepEqual([two.errorStreak, two.alert, two.lastStatus, two.lastNote], [2, "сбоев страниц: 5 из 5", "partial", "дневная доля строки соцсетей выбрана"], "прогон без работы серию не рвёт; метка [stop:idle] на вкладке не видна");
  const money = await status([log("error", 1, "Bright Data: аккаунт не активен (402) [stop:billing]")]);
  assert.deepEqual([money.errorStreak, money.alert], [1, "Bright Data: аккаунт не активен (402)"]);
  assert.equal(SOCIAL_ALERT_STREAK, 2);
});

test("Список аккаунтов: ник со ссылкой, вид, когда проверяли, залёты; «Исключить», «Вернуть» и форма — только директору", () => {
  const data = { accounts: [
    { handle: "jpnbrands", url: "https://www.instagram.com/jpnbrands/", kind: "reseller" as const, origin: "seed" as const, status: "watched" as const, note: null, lastCheckedAt: "2026-10-05T06:20:00Z", lastError: null, viral: 2 },
    { handle: "noisy", url: "https://www.instagram.com/noisy/", kind: "unknown" as const, origin: "auto" as const, status: "excluded" as const, note: null, lastCheckedAt: null, lastError: "профиль не открылся", viral: 0 },
  ], seen: 3 };
  const props = { data, busy: null, error: null, onExclude: noop, onRestore: noop, onAdd: async () => true };
  const viewer = renderToStaticMarkup(createElement(SocialAccountsList, { ...props, canEdit: false }));
  const text = flat(viewer);
  assert.match(viewer, /<a href="https:\/\/www\.instagram\.com\/jpnbrands\/" target="_blank" rel="noopener noreferrer"[^>]*min-h-11/);
  assert.match(text, /@jpnbrands перепродавец · стартовый проверяли 05\.10 залётов: 2/);
  assert.match(text, /@noisy вид не определён · найден сбором ещё не проверяли залётов: 0 исключён профиль не открылся/);
  assert.match(text, /Ещё 3 автора встречались в выдаче/);
  assert.doesNotMatch(text, /Исключить|Вернуть|Добавить/, "не директору — кнопок нет (прятать, а не серить)");
  assert.doesNotMatch(viewer, /<form|<input/);
  const director = flat(renderToStaticMarkup(createElement(SocialAccountsList, { ...props, canEdit: true })));
  assert.match(director, /@jpnbrands.*Исключить.*@noisy.*Вернуть/);
  assert.match(director, /Добавить/);
});

// ---------------------------------------------------------------------------
// Чистые функции экрана

test("Числа и слова: «1,2 тыс.», «480 тыс.», «1,2 млн»; «в 14 раз», «в 2 раза», «в 6,5 раза»; номер для поиска образца; период ленты", () => {
  assert.deepEqual([950, 1234, 12_345, 480_000, 999_600, 1_234_567].map(compactRu), ["950", "1,2 тыс.", "12 тыс.", "480 тыс.", "1 млн", "1,2 млн"]);
  assert.deepEqual([14, 2, 6.5, 5, 21.4].map(timesPhrase), ["в 14 раз", "в 2 раза", "в 6,5 раза", "в 5 раз", "в 21 раз"]);
  assert.equal(refArticle("zara:5854722"), "5854/722");
  assert.equal(refArticle("uniqlo:487882"), "487882");
  assert.equal(refArticle("zara:12"), null);
  assert.deepEqual(["7", "14", "30", "60", null, "abc"].map(parseFeedPeriod), [7, 14, 30, 14, 14, 14]);
  assert.deepEqual(cardTitle(card({ captionExcerpt: "x" }, { title: null })), { text: "x", fromCaption: true });
  assert.deepEqual(sampleLinksFor(card({ refs: [] }, { title: null, url: null })), []);
  assert.equal(sampleLinksFor(card({}, { url: "https://www.instagram.com/p/x/" }))[0].label, "Lyst", "ссылка на Instagram — не «сайт бренда»");
});

test("Крон сбора каждые 3 часа: строка расписания совпадает с vercel.json; следующий прогон — ближайшая отметка :20 часов UTC, кратных трём", () => {
  const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons.filter((c) => c.path === SOCIAL_CRON.path), [{ path: SOCIAL_CRON.path, schedule: SOCIAL_CRON.schedule }]);
  assert.equal(SOCIAL_CRON.schedule, `${SOCIAL_CRON.minuteUtc} */${SOCIAL_CRON.everyHours} * * *`);
  assert.equal(SOCIAL_CRON.schedule, "20 */3 * * *");
  assert.equal(SOCIAL_RUNS_PER_DAY, 8);
  assert.equal(nextSocialRun(Date.parse("2026-10-06T00:10:00Z")), "2026-10-06T00:20:00.000Z");
  assert.equal(nextSocialRun(Date.parse("2026-10-06T05:00:00Z")), "2026-10-06T06:20:00.000Z");
  assert.equal(nextSocialRun(Date.parse("2026-10-06T06:20:00Z")), "2026-10-06T09:20:00.000Z", "ровно в момент прогона — следующий");
  assert.equal(nextSocialRun(Date.parse("2026-10-07T06:20:00Z")), "2026-10-07T09:20:00.000Z", "первый живой прогон 07.10 09:20 МСК — следующий в 12:20 МСК, а не завтра");
  assert.equal(nextSocialRun(Date.parse("2026-10-06T21:30:00Z")), "2026-10-07T00:20:00.000Z", "через полночь UTC");
  assert.deepEqual(socialCronMskTimes(), ["00:20", "03:20", "06:20", "09:20", "12:20", "15:20", "18:20", "21:20"]);
});

test("Честные счётчики: по разделу — найдено, замерено, ждут замера и с шансом; без раздела — по всем разделам; сколько прогонов до полного прохода", async () => {
  const fresh = (code: string, over: Row = {}) => post(code, { checks: 0, last_checked_at: null, likes: null, comments: null, views: null, verdict: null, likes_ratio: null, ...over });
  const { db } = fakeDb({ tables: {
    assortment_social_account: [account("jpnbrands"), account("spam.shop", { status: "excluded" })],
    assortment_social_post: [
      post("DdA1111111"),
      post("DdC3333333", { verdict: "normal", likes: 300, comments: 2, views: 5000 }),
      fresh("DdW1111111", { views: 150_000 }),
      fresh("DdW2222222", { views: 2000 }),
      fresh("DdU1111111", { direction: null }),
      fresh("DdU2222222", { direction: null, views: 300_000 }),
      fresh("DdB1111111", { direction: "bags" }),
      fresh("DdHIDE1111", { hidden_at: iso(NOW - DAY) }),
      fresh("DdEXCL1111", { account_handle: "spam.shop" }),
      fresh("DdYOUNG111", { published_at: iso(NOW - DAY) }),
      fresh("DdOLD11111", { published_at: iso(NOW - 25 * DAY) }),
    ],
  } });
  const progress = await loadSocialProgress(db, { direction: "jackets", days: 14, nowMs: NOW });
  assert.deepEqual(progress.section, { found: 5, measured: 2, waiting: 2, waitingWithChance: 1, awaitingBaseline: 0 }, "скрытый, исключённый автор, сумки и старше периода — не в счёте; моложе 2 суток — найден, но мерить рано");
  assert.deepEqual(progress.unsorted, { found: 2, waiting: 2, waitingWithChance: 1, measured: 0 });
  assert.deepEqual(progress.pass, {
    waiting: 5, perRun: 60, dayShare: 286, weeklyRequests: 2000, runs: 1, hours: 3, finishAt: "2026-10-06T18:20:00.000Z", blockedBy: null, resumeAt: null,
  }, "очередь всех разделов, а не только курток");
  const feed = await loadSocialFeed(db, { direction: "jackets", days: 14, onlyStrong: false, nowMs: NOW });
  assert.ok(feed.available);
  assert.deepEqual([feed.measured, feed.progress?.section.found], [2, 5]);

  const text = socialProgressText(progress, "Куртки");
  assert.equal(text.section, "Куртки за 14 дней: найдено рилсов 5, замерено 2, ждут замера 2, из них с шансом 1.");
  assert.equal(text.unsorted, "Ещё 2 рилса без раздела — по всем разделам: ждут замера 2, из них с шансом 1 — раздел станет известен после замера.");
  assert.equal(text.pass, "До полного прохода очереди (5 рилсов, все разделы) — ≈1 прогон, ≈3 ч, к 06.10 21:20 МСК (оценка: ~60 замеров за прогон, не больше 286 запросов в сутки — седьмая часть строки; поиск и база авторов тратят ту же строку).");
  const long = socialPassText(socialPassPlan({ waiting: 4500, perRun: 60, dayShare: 286, weeklyRequests: 2000, spentByDay: {}, engineRoomRequests: null, nowMs: NOW })) ?? "";
  assert.match(long, /≈79 прогонов, ≈16 суток, к 22\.10 06:20 МСК/, "упирается в дневную долю: 286 в сутки, а не 60 × 8");
  assert.equal(socialPassPlan({ waiting: 0, perRun: 60, dayShare: 286, weeklyRequests: 2000, spentByDay: {}, engineRoomRequests: null, nowMs: NOW }), null, "очередь пуста — строки нет");

  // Строка сбора на телефоне: счётчики раздела — одной строкой, без раздела и проход — в свёрнутом блоке.
  const html = renderToStaticMarkup(createElement(SocialRunLine, { run: null, warnings: [], progress, sectionLabel: "Куртки" }));
  assert.match(html, /<p[^>]*>Куртки за 14 дней: найдено рилсов 5, замерено 2, ждут замера 2, из них с шансом 1\.<\/p><details/);
  assert.match(flat(html), /Подробнее о сборе .* Ещё 2 рилса без раздела .* До полного прохода очереди \(5 рилсов, все разделы\) — ≈1 прогон/);
  const empty = flat(renderToStaticMarkup(createElement(SocialEmpty, { days: 14, onlyStrong: false, measured: 2, progress, onAllVerdicts: noop, onWiden: noop })));
  assert.match(empty, /За 14 дней ничего не залетело/);
  assert.doesNotMatch(empty, /[Нн]айдено рилсов|[Зз]амерено/, "счётчики в пустом состоянии не повторяются — они в строке сбора");
  assert.match(empty, /«ничего не залетело» значит «ещё не измерено», а не «нечего мерить»/);
  assert.match(empty, /До полного прохода очереди \(5 рилсов, все разделы\) — ≈1 прогон/, "сколько до конца — при пустой ленте");
  const done: SocialProgress = { days: 14, section: { found: 40, measured: 40, waiting: 0, waitingWithChance: 0, awaitingBaseline: 0 }, unsorted: { found: 0, waiting: 0, waitingWithChance: 0, measured: 0 }, pass: null };
  const settled = flat(renderToStaticMarkup(createElement(SocialEmpty, { days: 14, onlyStrong: false, measured: 40, progress: done, onAllVerdicts: noop, onWiden: noop })));
  assert.doesNotMatch(settled, /ещё не измерено/, "всё замерено — «ничего не залетело» правда");
  const noLine = flat(renderToStaticMarkup(createElement(SocialRunLine, { run: null, warnings: [], progress: done, sectionLabel: "Куртки" })));
  assert.doesNotMatch(noLine, /До полного прохода|без раздела/);
});

test("Ревью 07.10: «ждут базы автора» — замерен, с шансом, базы нет: вердикт впереди, «ничего не залетело» — «ещё не измерено»; замеренные без раздела — без обещания «станет известен»", async () => {
  const { db } = fakeDb({ tables: {
    assortment_social_account: [account("jpnbrands"), account("hot.author", { origin: "auto", status: "seen", likes_median: null, comments_median: null, baseline_posts: null, baseline_at: null })],
    assortment_social_post: [
      // Куртка с шансом: замерена, 8 000 лайков, перезамер 3-го дня уже был, базы автора нет — вердикта нет.
      post("DdHOT000001", { account_handle: "hot.author", checks: 2, last_checked_at: iso(NOW - 1.5 * DAY), likes: 8000, comments: 40, views: null, verdict: null, likes_ratio: null, comments_ratio: null, rule_version: null }),
      // Замерены (Google), раздел по подписи не определился.
      post("DdUNS000001", { direction: null, found_via: ["google"], checks: 1, last_checked_at: iso(NOW - 3 * DAY), likes: 40, comments: 1, views: null, verdict: "normal" }),
      post("DdUNS000002", { direction: null, found_via: ["google"], checks: 1, last_checked_at: iso(NOW - 3 * DAY), likes: 70, comments: 0, views: null, verdict: "normal" }),
      // Без раздела, ждёт первого замера; и совсем свежий — мерить рано.
      post("DdUNS000003", { direction: null, checks: 0, last_checked_at: null, likes: null, comments: null, views: null, verdict: null }),
      post("DdUNS000004", { direction: null, checks: 0, last_checked_at: null, likes: null, comments: null, views: null, verdict: null, published_at: iso(NOW - DAY) }),
    ],
  } });
  const progress = await loadSocialProgress(db, { direction: "jackets", days: 14, nowMs: NOW });
  assert.deepEqual(progress.section, { found: 1, measured: 1, waiting: 0, waitingWithChance: 0, awaitingBaseline: 1 });
  assert.deepEqual(progress.unsorted, { found: 4, waiting: 1, waitingWithChance: 0, measured: 2 });
  const text = socialProgressText(progress, "Куртки");
  assert.equal(text.section, "Куртки за 14 дней: найдено рилсов 1, замерено 1, ждут замера 0, из них с шансом 0, ждут базы автора 1.");
  assert.equal(text.unsorted, "Ещё 4 рилса без раздела — по всем разделам: ждут замера 1, из них с шансом 0 — раздел станет известен после замера; уже замерены, а раздел по подписи не определился — 2; моложе 2 суток, мерить рано — 1.");
  assert.equal(socialQueuePending(progress), true);
  const empty = flat(renderToStaticMarkup(createElement(SocialEmpty, { days: 14, onlyStrong: false, measured: 1, progress, onAllVerdicts: noop, onWiden: noop })));
  assert.match(empty, /Вердикт — после замера и базы автора: пока очередь не пройдена .*«ещё не измерено», а не «нечего мерить»/);
  // Только ждут базы (очередь замера пуста) — тоже «ещё не измерено».
  const onlyBase: SocialProgress = { ...progress, unsorted: { found: 0, waiting: 0, waitingWithChance: 0, measured: 0 }, pass: null };
  assert.equal(socialQueuePending(onlyBase), true);
  assert.equal(socialQueuePending({ ...onlyBase, section: { ...onlyBase.section, awaitingBaseline: 0 } }), false);
});

test("Ревью 07.10: «до полного прохода» читает учёт — дневная доля выбрана, строка недели выбрана, общий потолок движка; не обещает «≈15 ч», когда замер стоит", async () => {
  const queue = Array.from({ length: 300 }, (_, i) => post(`DdQ${String(i).padStart(8, "0")}`, { direction: "bags", checks: 0, last_checked_at: null, likes: null, comments: null, views: null, verdict: null, published_at: iso(NOW - 4 * DAY) }));
  const progressWith = async (usage: Row[], engine = { weeklyUsd: 30, socialWeeklyUsd: 3 }) =>
    (await loadSocialProgress(fakeDb({ tables: { assortment_social_account: [account("jpnbrands")], assortment_social_post: queue, assortment_ai_usage: usage } }).db, { direction: "jackets", days: 14, nowMs: NOW, engine })).pass!;
  const social = (day: string, calls: number) => ({ day, kind: "brightdata_social", calls, cost_usd: calls * 0.0015 });
  // Строка недели выбрана вчера (2 000 запросов): замер стоит до выхода 05.10 из окна — 12.10 00:20 МСК, а не «≈5 прогонов, ≈15 ч».
  const week = await progressWith([social("2026-10-05", 2000)]);
  assert.deepEqual([week.blockedBy, week.resumeAt, week.runs], ["social_line", "2026-10-11T21:20:00.000Z", 6]);
  assert.match(socialPassText(week) ?? "", /^Замер стоит: строка соцсетей недели \(2\s000 запросов\) выбрана — продолжится ≈12\.10 00:20 МСК, когда старые дни выйдут из 7-дневного окна\. До полного прохода очереди \(300 рилсов, все разделы\) — ≈6 прогонов, ≈7 суток/);
  // Дневная доля на сегодня выбрана — завтра с 00:20 МСК; 300 рилсов — за двое суток по 286.
  const day = await progressWith([social("2026-10-06", 286)]);
  assert.deepEqual([day.blockedBy, day.resumeAt, day.finishAt], ["day_share", "2026-10-06T21:20:00.000Z", "2026-10-07T21:20:00.000Z"]);
  assert.match(socialPassText(day) ?? "", /^Замер стоит: дневная доля строки соцсетей \(286 запросов в сутки\) на сегодня выбрана — продолжится 07\.10 00:20 МСК\./);
  // Общий потолок движка выбран (резерв под каталоги) — срок не обещаем.
  const engine = await progressWith([{ day: "2026-10-06", kind: "catalog_attributes", calls: 3000, cost_usd: 29 }]);
  assert.deepEqual([engine.blockedBy, engine.finishAt], ["engine", null]);
  assert.match(socialPassText(engine) ?? "", /общий потолок движка на неделю выбран .* продолжится, когда он освободится; в очереди 300 рилсов/);
  // Строка выключена владельцем (0).
  const off = await progressWith([], { weeklyUsd: 30, socialWeeklyUsd: 0 });
  assert.equal(off.blockedBy, "off");
  // Учёт пуст — по скорости: 300 рилсов по ~60 за прогон — 5 прогонов (60 сегодня в 21:20 МСК, 240 завтра — в дневной доле 286).
  const clean = await progressWith([]);
  assert.deepEqual([clean.blockedBy, clean.runs, clean.finishAt], [null, 5, "2026-10-07T06:20:00.000Z"]);
});

// ---------------------------------------------------------------------------
// Метка в каталоге брендов и строка в карточке модели

const catalogCard = (sourceId: string, itemId: string): CatalogCard => ({
  sourceId, itemId, title: "Bomber", brand: "Zara", productUrl: null, images: [], firstSeenAt: iso(NOW - 40 * DAY), lastSeenAt: iso(NOW), isNew: false, badges: [], variants: 1, form: null, referenceId: null,
});

test("Метка «залетает» в каталоге: модель Zara/Uniqlo с «залетевшим» рилсом за 30 дней; скрытый, обычный, исключённый автор — нет; без таблиц — каталог без метки", async () => {
  const cards = [catalogCard("S001", "5854722"), catalogCard("S003", "E487882-000"), catalogCard("S001", "1111111"), catalogCard("S014", "5854722")];
  const { db, reads } = fakeDb({ tables: {
    assortment_social_account: [account("jpnbrands"), account("noisy", { status: "excluded" })],
    assortment_social_post: [
      post("DdA1111111"), post("DdB2222222", { verdict: "viral" }),
      post("DdU3333333", { match_model_key: "S003|E487882-000", verdict: "viral" }),
      post("DdH4444444", { match_model_key: "S001|1111111", hidden_at: iso(NOW) }),
      post("DdN5555555", { match_model_key: "S001|1111111", verdict: "normal" }),
      post("DdX6666666", { match_model_key: "S001|1111111", account_handle: "noisy" }),
      post("DdO7777777", { match_model_key: "S001|1111111", published_at: iso(NOW - 40 * DAY) }),
    ],
  } });
  assert.equal(await attachSocialFlags(db, cards, NOW), true);
  assert.deepEqual(cards.map((c) => c.social ?? null), [{ verdict: "strong", reels: 2 }, { verdict: "viral", reels: 1 }, null, null]);
  assert.equal(reads.filter((t) => t === "assortment_social_post").length, 1, "одна выборка на порцию каталога");
  const noTables = [catalogCard("S001", "5854722")];
  assert.equal(await attachSocialFlags(fakeDb({ missing: ["assortment_social_post"] }).db, noTables, NOW), false);
  assert.equal(noTables[0].social, undefined);
  const others = fakeDb();
  assert.equal(await attachSocialFlags(others.db, [catalogCard("S014", "x")], NOW), false);
  assert.equal(others.reads.length, 0, "у других брендов рилсов нет — запроса нет");
  assert.match(flat(renderToStaticMarkup(createElement(SocialBadge, { social: { verdict: "viral", reels: 2 } }))), /Залетает · 2 рилса/);
  assert.match(read("components/assortment/CatalogView.tsx"), /\{card\.social && <SocialBadge social=\{card\.social\} \/>\}/);
  assert.equal((read("lib/assortment/catalogStore.ts").match(/Promise\.all\(\[attachStatuses\(db, cards\), attachSocialFlags\(db, cards, nowMs\)\]\)/g) ?? []).length, 2, "метка — и в обычной выдаче, и в выдаче по форме");
});

test("Карточка модели: «Независимые публикации» — по привязанным рилсам вместо заглушки; без привязки — честно «не найдено», не Zara/Uniqlo — «не собираем»", async () => {
  const placeholder = buildEvidence([], null).spread.find((r) => r.label === "Независимые публикации")!;
  // Рилсы подключены (#1553), остальные соцсети — нет: «соцсети не подключены» было бы неправдой (Ф2).
  assert.deepEqual([placeholder.value, placeholder.detail], ["нет данных", "рилсы Instagram сюда не подгружались; другие соцсети не подключены — Этап 6 ждёт решения владельца"], "без данных (и в снимке подборки) — заглушка честно называет, что подключено");

  const { db } = fakeDb({ tables: {
    assortment_source_items: [{ source_id: "S001", source_item_id: "5854722", reference_id: "ref-1" }],
    assortment_social_account: [account("jpnbrands"), account("aida.uniq"), account("noisy", { status: "excluded" })],
    assortment_social_post: [
      post("DdA1111111", { views: 480000 }), post("DdB2222222", { verdict: "viral", account_handle: "aida.uniq", views: 1_200_000, url: "https://www.instagram.com/reel/DdB2222222/" }),
      post("DdH3333333", { hidden_at: iso(NOW) }), post("DdX4444444", { account_handle: "noisy" }),
      post("DdS5555555", { match_status: "brand_site", match_model_key: null, match_url: "https://www.uniqlo.com/es/en/products/E487882-000/00", account_handle: "aida.uniq", brand: "uniqlo", refs: ["uniqlo:487882"] }),
    ],
  } });
  const social = (await loadModelSocial(db, { id: "ref-1", url: "https://www.zara.com/us/en/jacket-p05854722.html", brand: "Zara" }))!;
  assert.deepEqual([social.reels, social.authors, social.strong, social.topUrl, social.topViews], [2, 2, true, "https://www.instagram.com/reel/DdB2222222/", 1_200_000]);
  const row = buildEvidence([], null, social).spread.find((r) => r.label === "Независимые публикации")!;
  assert.equal(row.value, "2 рилса у 2 авторов · сильный залёт");
  assert.equal(row.missing, false);
  assert.equal(row.sourceUrl, "https://www.instagram.com/reel/DdB2222222/");
  assert.match(row.detail, /Instagram Reels · наблюдение системы · правило reels-v1 — расчёт · больше всего 1,2 млн просмотров · замер 05\.10\.2026 · лайки и просмотры — не продажи/);

  const byUrl = (await loadModelSocial(db, { id: "ref-2", url: "https://www.uniqlo.com/es/en/products/E487882-000/00", brand: "Uniqlo" }))!;
  assert.equal(byUrl.reels, 1, "находка, добавленная ссылкой на карточку бренда, — по адресу карточки");
  const none = (await loadModelSocial(db, { id: "ref-3", url: "https://www.zara.com/us/en/other-p01111111.html", brand: "Zara" }))!;
  assert.deepEqual(buildEvidence([], null, none).spread.find((r) => r.label === "Независимые публикации")!.value, "не найдено");
  const polene = (await loadModelSocial(db, { id: "ref-4", url: "https://www.polene-paris.com/products/numero-un", brand: "Polène" }))!;
  assert.equal(polene.outOfScope, true);
  assert.match(buildEvidence([], null, polene).spread.find((r) => r.label === "Независимые публикации")!.detail, /только про Zara и Uniqlo; другие соцсети не подключены — Этап 6 ждёт решения владельца/);
  assert.equal(await loadModelSocial(fakeDb({ missing: ["assortment_social_post"], tables: { assortment_source_items: [{ source_id: "S001", source_item_id: "5854722", reference_id: "ref-1" }] } }).db, { id: "ref-1", url: null, brand: "Zara" }), null, "таблиц нет — заглушка");
  const failed = (await loadModelSocial(fakeDb({ fail: ["assortment_social_post"], tables: { assortment_source_items: [{ source_id: "S001", source_item_id: "5854722", reference_id: "ref-1" }] } }).db, { id: "ref-1", url: null, brand: "Zara" }))!;
  assert.match(buildEvidence([], null, failed).spread.find((r) => r.label === "Независимые публикации")!.value, /не загрузилось/, "сбой назван");
  assert.match(read("lib/assortment/model.ts"), /buildEvidence\(obs, otherBrands, social\)/);
});

test("«Добавить в находки» из ленты → карточка модели видит рилс: адрес находки нормализован (без www, Uniqlo — без витрины), сверяем по номеру модели", async () => {
  const zaraUrl = zaraCardUrl("5854722");
  const uniqloUrl = uniqloCardUrls("487882")[0];
  const { db } = fakeDb({ tables: {
    assortment_social_account: [account("x.blog"), account("y.blog")],
    assortment_social_post: [
      post("DdZ1111111", { account_handle: "x.blog", verdict: "viral", match_status: "brand_site", match_model_key: null, match_url: zaraUrl, refs: ["zara:5854722"], views: 315000 }),
      post("DdU2222222", { account_handle: "y.blog", verdict: "strong", brand: "uniqlo", match_status: "brand_site", match_model_key: null, match_url: uniqloUrl, refs: ["uniqlo:487882"], views: 90000 }),
    ],
  } });
  // Так находку сохраняет importReference: normalizeProductUrl снимает www., у Uniqlo — витрину /es/en и /00.
  const zaraRef = normalizeProductUrl(zaraUrl);
  const uniqloRef = normalizeProductUrl(uniqloUrl);
  assert.notEqual(zaraRef, zaraUrl);
  assert.notEqual(uniqloRef, uniqloUrl);
  const zara = (await loadModelSocial(db, { id: "ref-z", url: zaraRef, brand: "Zara" }))!;
  assert.deepEqual([zara.reels, zara.topUrl], [1, "https://www.instagram.com/reel/DdZ1111111/"]);
  assert.equal(buildEvidence([], null, zara).spread.find((r) => r.label === "Независимые публикации")!.value, "1 рилс у 1 автора · залетает");
  const uniqlo = (await loadModelSocial(db, { id: "ref-u", url: uniqloRef, brand: "Uniqlo" }))!;
  assert.deepEqual([uniqlo.reels, uniqlo.strong], [1, true]);
  const other = (await loadModelSocial(db, { id: "ref-o", url: normalizeProductUrl(zaraCardUrl("1111111")), brand: "Zara" }))!;
  assert.equal(other.reels, 0, "другой номер — «не найдено»");
});

// ---------------------------------------------------------------------------
// Воскресная сводка

const digestPost = (code: string, over: Partial<SocialDigestPost> = {}): SocialDigestPost => ({
  code, url: `https://www.instagram.com/reel/${code}/`, account_handle: "jpnbrands", published_at: "2026-10-01T00:00:00Z", first_seen_at: "2026-10-02T00:00:00Z", brand: "zara",
  direction: "jackets", caption_excerpt: "Zara jacket", likes: 12000, views: 480000, verdict: "strong", match_status: "catalog", match_title: "BOMBER JACKET", hidden_at: null,
  history: [{ at: "2026-10-03T06:20:00Z", likes: null, comments: null, views: 300000 }, { at: "2026-10-05T06:20:00Z", likes: 12000, comments: 60, views: 480000 }], ...over,
});
const FROM = Date.parse("2026-10-04T07:00:00Z");
const TO = Date.parse("2026-10-11T07:00:00Z");

test("Сводка: новые «залёты» недели — впервые замерены за неделю; скрытые, мужское, исключённые, обычные — нет; сильные первыми; до пяти", () => {
  assert.equal(firstMeasuredAt(digestPost("a")), "2026-10-05T06:20:00Z", "точка истории только с просмотрами (поиск) — ещё не замер");
  const posts = [
    digestPost("DdOLD00000", { history: [{ at: "2026-10-01T06:20:00Z", likes: 9000, comments: 10, views: null }] }),
    digestPost("DdHID00000", { hidden_at: "2026-10-06T00:00:00Z" }),
    digestPost("DdMEN00000", { match_status: "men" }),
    digestPost("DdEXC00000", { account_handle: "noisy" }),
    digestPost("DdNOR00000", { verdict: "normal" }),
    digestPost("DdVIR00000", { verdict: "viral", views: 2_000_000 }),
    ...Array.from({ length: 5 }, (_, i) => digestPost(`DdSTR0000${i}`, { views: 100_000 * (i + 1) })),
  ];
  const digest = pickSocialDigest(posts, FROM, TO, new Set(["noisy"]));
  assert.equal(digest.total, 6);
  assert.equal(digest.items.length, 5);
  assert.deepEqual(digest.items.map((i) => i.url.slice(-11, -1)), ["DdSTR00004", "DdSTR00003", "DdSTR00002", "DdSTR00001", "DdSTR00000"], "сильные первыми, внутри — по просмотрам");
});

test("Сводка: раздел «Залетает в соцсетях» — бренд, название, просмотры и лайки, ссылка; без данных раздела нет; сбой — строкой; длина в пределах Telegram", async () => {
  const empty = (): DigestDirection => ({ newCount: 0, retailCount: 0, top: [], selected: 0, sampleNeeded: 0, rejected: 0, topReason: null });
  const facts = (social: DigestFacts["social"]): DigestFacts => ({ from: "2026-10-04T07:00:00Z", to: "2026-10-11T07:00:00Z", directions: { bags: empty(), jackets: empty() }, collections: [], crawl: null, social, baseUrl: "https://panel.example" });
  const item = { direction: "jackets" as const, brand: "zara" as const, title: "BOMBER <JACKET> & Co", views: 1_200_000, likes: 45_000, verdict: "strong" as const, url: "https://www.instagram.com/reel/DdA1111111/" };
  const text = digestMessage(facts({ items: [item], total: 1 }));
  assert.match(text, /<b>Залетает в соцсетях<\/b>\nНовых за неделю: 1 \(рилсы Instagram про Zara и Uniqlo; лайки и просмотры — не продажи\)\./);
  assert.match(text, /• Zara · BOMBER &lt;JACKET&gt; &amp; Co \(куртки\) — 1,2 млн просмотров, 45 тыс\. лайков, сильный залёт — <a href="https:\/\/www\.instagram\.com\/reel\/DdA1111111\/">рилс<\/a>/);
  assert.match(text, /Лента: <a href="https:\/\/panel\.example\/assortment-development\/jackets\?view=social">Куртки<\/a>/);
  assert.doesNotMatch(text, /ничего не происходило/, "залёты недели — это событие");
  assert.ok(text.indexOf("Залетает в соцсетях") < text.indexOf("Открыть модуль"));
  for (const none of [null, undefined, { items: [], total: 0 }]) assert.doesNotMatch(digestMessage(facts(none)), /Залетает/);
  assert.match(digestMessage(facts({ items: [], total: 0, error: "statement timeout" })), /<b>Залетает в соцсетях<\/b>\n⚠️ Не загрузилось: statement timeout/);
  const long = digestMessage(facts({ items: Array.from({ length: 5 }, () => ({ ...item, title: "Ж".repeat(80) })), total: 40 }));
  assert.ok(long.length < 4096, `сообщение Telegram до 4096 знаков (${long.length})`);

  // Чтение для сводки — подставкой сводки (её методы) из таблицы рилсов и аккаунтов.
  const rows = (table: string, data: Row[]) => [table, data] as const;
  const tables = Object.fromEntries([
    rows("assortment_references", []), rows("assortment_observations", []), rows("assortment_decisions", []), rows("assortment_collections", []), rows("assortment_sources", []), rows("assortment_run", []),
    rows("assortment_social_post", [{ ...digestPost("DdA1111111"), platform: "instagram" }, { ...digestPost("DdB2222222", { verdict: null }), platform: "instagram" }]),
    rows("assortment_social_account", [{ handle: "noisy", platform: "instagram", status: "excluded" }]),
  ]);
  const digestDb = {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      const list = () => ((tables as Record<string, Row[]>)[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const q: Record<string, unknown> = {
        select: () => q, order: () => q, limit: () => q, or: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        gte: (c: string, v: unknown) => (filters.push((r) => String(r[c] ?? "") >= String(v)), q),
        lt: (c: string, v: unknown) => (filters.push((r) => String(r[c] ?? "") < String(v)), q),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
        not: (c: string, _op: string, v: unknown) => (filters.push((r) => (r[c] ?? null) !== v), q),
        range: (a: number, b: number) => Promise.resolve({ data: list().slice(a, b + 1), error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: list(), error: null }).then(resolve),
      };
      return q;
    },
  };
  const loaded = await loadDigestFacts(digestDb as never, new Date(FROM), new Date(TO), "https://panel.example");
  assert.deepEqual(loaded.social, { items: [{ direction: "jackets", brand: "zara", title: "BOMBER JACKET", views: 480000, likes: 12000, verdict: "strong", url: "https://www.instagram.com/reel/DdA1111111/" }], total: 1 });
});

// ---------------------------------------------------------------------------
// Сторож

test("Сторож: «Залетает» — 8 ошибок подряд (сутки) или сутки тишины (крон каждые 3 часа); имя задачи совпадает с кроном", () => {
  const rule = WATCHED_JOBS.find((j) => j.job === "assortment-social")!;
  assert.ok(rule);
  const run = (status: JobRun["status"], hoursAgo: number): JobRun => ({ job: rule.job, status, error: status === "error" ? "Bright Data ответил 502" : null, started_at: iso(NOW - hoursAgo * 3600_000) });
  const errors = (n: number) => Array.from({ length: n }, (_, i) => run("error", 1 + i * 3));
  assert.equal(jobFreshness(rule, errors(7), NOW).state, "ok", "семь ошибок за 21 час — ещё не тревога (при ежедневном пороге 3 это было бы 9 часов)");
  const stalled = jobFreshness(rule, errors(8), NOW);
  assert.equal(stalled.state, "stalled");
  assert.match(String(stalled.reason), /8 прогонов подряд/);
  assert.equal(jobFreshness(rule, [run("ok", 23)], NOW).state, "ok");
  assert.equal(jobFreshness(rule, [run("ok", 24)], NOW).state, "stalled", "сутки без записи — восемь прогонов пропало, крон пропал");
  assert.equal(/const JOB = "([^"]+)"/.exec(read("app/api/sync/assortment-social/route.ts"))?.[1], rule.job);
  // Подписи расписания — под крон каждые 3 часа: ни «ежедневно», ни «через три дня» (ревью 07.10).
  for (const file of ["app/api/sync/assortment-social/route.ts", "lib/assortment/stage6Sources.ts", "lib/assortment/jobsWatch.ts", "components/assortment/SocialView.tsx"]) {
    assert.doesNotMatch(read(file), /крон ежедневн|сторож скажет через три дня|ежедневно в 09:20/, file);
  }
  assert.match(read("app/api/sync/assortment-social/route.ts"), /сторож скажет через сутки — 8 ошибок подряд/);
});
