import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { googleSearchUrl, UnlockerStopError, type UnlockerFormat, type UnlockerResult } from "../lib/assortment/brightdataUnlocker.ts";
import { engineBudgetConfig } from "../lib/assortment/engineBudget.ts";
import { pickSocialDigest } from "../lib/assortment/socialFeed.ts";
import { GOOGLE_QUERIES, googleQuery, HISTORY_LIMIT, parseReelPage, profileUrl, SEED_ACCOUNTS, SEED_TOPICS, shortcodeToDate, socialConfig, topicUrl, uniqloCardUrls, type SocialConfig } from "../lib/assortment/socialReels.ts";
import {
  activeTopics, applyMeasurement, countAppearances, DEFER_MAX_RUNS, DISCOVER_STALL_RUNS, judgePost, loadPosts, loadViralReels, matchDue, mergeCandidate, nextAccountStatus, postMeasureDue,
  pushHistory, readSocialState, runSocialReels, SOCIAL_USAGE_KIND, socialRunLog, type AccountRow, type PostRow, type RunSocialOptions,
} from "../lib/assortment/socialReelsStore.ts";

/**
 * Прогон «Залетает» на подставной базе и подставном Bright Data: подставка применяет фильтры, режет страницу на 1 000 строк и
 * сверяет записываемые колонки с миграцией (опечатка в имени колонки — ошибка, как у PostgREST).
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = join(root, "tests/fixtures/assortment-social");
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8");
const MIGRATION = "supabase/migrations/202610060011_assortment_social_reels.sql";
const sql = readFileSync(join(root, MIGRATION), "utf8");
const NOW = Date.parse("2026-10-06T16:00:00Z");
const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

type Row = Record<string, unknown>;
const POSTGREST_MAX_ROWS = 1000;

function migrationColumns(table: string): Set<string> {
  const block = new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? "";
  return new Set(block.split("\n").map((l) => /^\s{2}([a-z_]+)\s+/.exec(l)?.[1]).filter((c): c is string => Boolean(c) && c !== "primary"));
}
const COLUMNS: Record<string, Set<string>> = {
  assortment_social_account: migrationColumns("assortment_social_account"),
  assortment_social_post: migrationColumns("assortment_social_post"),
  assortment_ai_usage: new Set(["day", "kind", "calls", "failed_calls", "input_tokens", "output_tokens", "cost_usd", "updated_at"]),
};
const KEYS: Record<string, string[]> = {
  assortment_social_account: ["platform", "handle"], assortment_social_post: ["platform", "code"], assortment_ai_usage: ["day", "kind"], assortment_sources: ["source_id"],
};
const DEFAULTS: Record<string, Row> = {
  assortment_social_account: { platform: "instagram", kind: "unknown", origin: "auto", status: "seen", appearances: 0 },
  assortment_social_post: { platform: "instagram", checks: 0, found_via: [], topics: [], hashtags: [], refs: [], history: [], verdict_preliminary: false, hidden_at: null },
};

interface FakeInit { tables?: Record<string, Row[]>; missing?: string[]; failUpsert?: string }

function fakeDb(init: FakeInit = {}) {
  const tables: Record<string, Row[]> = {
    assortment_social_account: [], assortment_social_post: [], assortment_ai_usage: [],
    assortment_sources: [{ source_id: "S068", capabilities: {} }], assortment_source_items: [], assortment_catalog_heads: [],
    ...(init.tables ?? {}),
  };
  const missing = new Set(init.missing ?? []);
  const writes: Array<{ table: string; op: string; rows: Row[] }> = [];
  const reads: Array<{ table: string; range: [number, number] | null }> = [];
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
      const missErr = { code: "42P01", message: `relation "public.${table}" does not exist` };
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const exec = () => {
        if (missing.has(table)) return { data: null, error: missErr };
        if (op === "update") {
          const err = checkColumns(table, values);
          if (err) return { data: null, error: err };
          const hit = rows();
          for (const r of hit) Object.assign(r, structuredClone(values));
          writes.push({ table, op: "update", rows: [values] });
          return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
        }
        reads.push({ table, range });
        let list = rows().map((r) => structuredClone(r));
        if (range) list = list.slice(range[0], Math.min(range[1] + 1, range[0] + POSTGREST_MAX_ROWS));
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
          (tables[table] ??= []).push({ ...(DEFAULTS[table] ?? {}), ...structuredClone(row) });
          writes.push({ table, op: "insert", rows: [row] });
          return Promise.resolve({ error: null });
        },
        upsert: (input: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
          if (missing.has(table)) return Promise.resolve({ error: missErr });
          if (init.failUpsert === table) return Promise.resolve({ error: { message: "база недоступна" } });
          const list = Array.isArray(input) ? input : [input];
          // PostgREST: в пакетной вставке у всех строк одинаковые ключи.
          const shape = list.length ? Object.keys(list[0]).sort().join(",") : "";
          if (list.some((r) => Object.keys(r).sort().join(",") !== shape)) return Promise.resolve({ error: { code: "PGRST102", message: "All object keys must match" } });
          for (const row of list) {
            const err = checkColumns(table, row);
            if (err) return Promise.resolve({ error: err });
          }
          const k = options.onConflict?.split(",") ?? KEYS[table];
          for (const row of list) {
            const existing = (tables[table] ??= []).find((r) => k.every((c) => r[c] === row[c]));
            if (existing) {
              if (!options.ignoreDuplicates) Object.assign(existing, structuredClone(row));
            } else tables[table].push({ ...(DEFAULTS[table] ?? {}), ...structuredClone(row) });
          }
          writes.push({ table, op: "upsert", rows: list });
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(exec()).then(resolve, reject),
      };
      return q;
    },
  };
  return { db: db as never, tables, writes, reads };
}

type Page = string | UnlockerResult | Error | (() => string | UnlockerResult | Error);

function fakeWeb(pages: Record<string, Page>) {
  const calls: string[] = [];
  const fetchPage = async (url: string, _format: UnlockerFormat): Promise<UnlockerResult> => {
    calls.push(url);
    let page = pages[url];
    if (typeof page === "function") page = page();
    if (page === undefined) return { ok: false, kind: "failed", reason: "нет в подставке", ms: 0 };
    if (page instanceof Error) throw page;
    if (typeof page === "string") return { ok: true, body: page, ms: 1 };
    return page;
  };
  return { fetchPage, calls };
}

/** Страница рилса в десктопной вёрстке Instagram (как в образцах): автор, подпись, комментарии, счётчики, сетка автора. */
function reelPage(o: { code: string; author: string; likes: number | null; comments: number; caption?: string; commentTexts?: string[]; grid?: string; kind?: "reel" | "p" }): string {
  const kind = o.kind ?? "reel";
  const blocks = (o.commentTexts ?? []).map((t, i) => `[![u${i}'s profile picture](https://example.invalid/avatar.jpg)](/u${i}/)\n\n[\n\nu${i}\n\n](/u${i}/) [1d](/p/${o.code}/c/1700000000000000${i}/)\n\n${t}\n\nLike\n\nReply`);
  return [
    " Instagram ", `[Log In](/accounts/login/?next=%2F${kind}%2F${o.code}%2F&source=desktop_nav)`, `Never miss a post from ${o.author}`, "Sign up for Instagram to stay in the loop.",
    "![Video by Someone on October 01, 2026. May be an image of jacket.](https://example.invalid/frame.jpg)", "More options", "* * *",
    `[![${o.author}'s profile picture](https://example.invalid/avatar.jpg)](/${o.author}/)`, `[\n\n${o.author}\n\n](/${o.author}/) 3d`, o.caption ?? "Outfit of the day", "Load more comments", ...blocks,
    "Like", ...(o.likes != null ? [String(o.likes)] : []), "Comment", String(o.comments), "Share", "Save", `[3 days ago](/${o.author}/${kind}/${o.code}/)`, "* * *",
    `More posts from [${o.author}](/${o.author}/)`, o.grid ?? "", `[See more posts](/${o.author}/)`,
  ].join("\n\n");
}

const gridCard = (owner: string, code: string, kind: "reel" | "p", date: string) => `[\n\n![${kind === "reel" ? "Video" : "Photo"} by X on ${date}.](https://example.invalid/g.jpg)\n\n${kind === "reel" ? "Clip" : "Carousel"}\n\n](/${owner}/${kind}/${code}/)`;

const reelUrl = (code: string, kind: "reel" | "p" = "reel") => `https://www.instagram.com/${kind}/${code}/`;

const cfg = (over: Partial<SocialConfig> = {}): SocialConfig => ({ ...socialConfig({}), ...over });
const run = (db: never, web: { fetchPage: RunSocialOptions["fetchPage"] }, over: Partial<RunSocialOptions> = {}) =>
  runSocialReels(db, { config: cfg(), hasKey: true, fetchPage: web.fetchPage, now: () => NOW, ...over });

function post(code: string, over: Partial<PostRow> = {}): Row {
  return {
    platform: "instagram", code, url: reelUrl(code), account_handle: null, published_at: null, first_seen_at: iso(NOW - 3 * DAY), last_checked_at: null, checks: 0,
    found_via: ["topic"], topics: [], brand: null, direction: null, caption_excerpt: null, hashtags: [], refs: [], likes: null, comments: null, views: null,
    likes_hidden: null, intent_count: null, intent_total: null, likes_ratio: null, comments_ratio: null, verdict: null, verdict_preliminary: false, rule_version: null,
    history: [], match_status: null, match_model_key: null, match_url: null, match_title: null, match_image: null, match_gender: null, match_checked_at: null,
    hidden_at: null, last_error: null, ...over,
  };
}

const allSeeds = (status: "watched" | "seen" = "watched"): Row[] => SEED_ACCOUNTS.map((s) => ({
  platform: "instagram", handle: s.handle, kind: s.kind, origin: "seed", status, note: s.note, followers: null, likes_median: null, comments_median: null,
  baseline_posts: null, baseline_at: null, appearances: 0, first_seen_at: iso(NOW - 10 * DAY), last_checked_at: iso(NOW - DAY), last_error: null,
}));

/** Стартовые аккаунты, у части — посчитанная база автора (вердикт без базы не выносится). */
const seedsWithBaseline = (bases: Record<string, { likes: number; comments: number; posts?: number }>): Row[] => allSeeds().map((a) => {
  const b = bases[a.handle as string];
  return b ? { ...a, likes_median: b.likes, comments_median: b.comments, baseline_posts: b.posts ?? 9, baseline_at: iso(NOW - DAY) } : a;
});

// --- без миграции, без ключа, выключено ---

test("Без миграции: прогон тихо выходит с причиной и не тратит ни одного запроса; лента — null (вкладку прячем)", async () => {
  const { db } = fakeDb({ missing: ["assortment_social_post", "assortment_social_account"] });
  const web = fakeWeb({});
  const out = await run(db, web);
  assert.equal(out.skippedBecause, "no_schema");
  assert.match(String(out.skipped), /202610060011_assortment_social_reels\.sql/);
  assert.equal(web.calls.length, 0);
  assert.equal(await loadViralReels(db, { direction: "jackets", nowMs: NOW }), null);
});

test("Выключатель ASSORTMENT_SOCIAL=off, нет ключа, нет таблицы учёта, идёт другой прогон — ни одного запроса, причина одной строкой", async () => {
  const web = fakeWeb({});
  assert.equal((await run(fakeDb().db, web, { config: cfg({ enabled: false }) })).skippedBecause, "off");
  const noKey = await run(fakeDb({ tables: { assortment_social_post: [post("Dd4Is8To7B0", { published_at: "2026-09-29T15:58:38.592Z" })] } }).db, web, { hasKey: false });
  assert.equal(noKey.skippedBecause, "no_key");
  assert.match(String(noKey.skipped), /нет ключа Bright Data/);
  assert.equal(noKey.due.measure, 1, "что ждёт работы — посчитано");
  assert.equal((await run(fakeDb({ missing: ["assortment_ai_usage"] }).db, web)).skippedBecause, "no_usage");
  const busy = fakeDb({ tables: { assortment_ai_usage: [{ day: "2026-10-06", kind: `lock:${SOCIAL_USAGE_KIND}`, updated_at: iso(NOW - 60_000) }] } });
  assert.equal((await run(busy.db, web)).skippedBecause, "busy", "замок: второй прогон не начинается");
  assert.equal(web.calls.length, 0);
});

test("Проба (dryRun): что пора делать, без запросов и без записей", async () => {
  const { db, writes } = fakeDb({ tables: { assortment_social_post: [post("Dd4Is8To7B0", { published_at: "2026-09-29T15:58:38.592Z" })] } });
  const web = fakeWeb({});
  const out = await run(db, web, { dryRun: true });
  assert.equal(out.due.discover, true);
  assert.equal(out.due.topics, SEED_TOPICS.length);
  assert.equal(out.due.measure, 1);
  assert.equal(out.due.profiles, SEED_ACCOUNTS.length);
  assert.equal(web.calls.length, 0);
  assert.equal(writes.length, 0);
});

// --- аккаунты ---

test("Стартовые аккаунты вставляются при первом прогоне; исключённый директором и заведённый вручную не перезаписываются", async () => {
  const manual: Row[] = [
    { platform: "instagram", handle: "jpnbrands", kind: "reseller", origin: "owner", status: "excluded", note: "не наш покупатель", appearances: 0 },
  ];
  const { db, tables } = fakeDb({ tables: { assortment_social_account: manual } });
  await run(db, fakeWeb({}), { phase: "measure" });
  const accounts = tables.assortment_social_account;
  assert.equal(accounts.length, SEED_ACCOUNTS.length);
  const jpn = accounts.find((a) => a.handle === "jpnbrands")!;
  assert.deepEqual([jpn.status, jpn.origin, jpn.note], ["excluded", "owner", "не наш покупатель"]);
  const zara = accounts.find((a) => a.handle === "zara")!;
  assert.deepEqual([zara.status, zara.origin, zara.kind], ["watched", "seed", "brand"]);
  assert.match(String(zara.note), /без номеров/);
  await run(db, fakeWeb({}), { phase: "measure" });
  assert.equal(tables.assortment_social_account.length, SEED_ACCOUNTS.length, "повторно не вставляются");
});

test("Авто-аккаунт: ≥2 появлений в выдаче за 30 дней — «наблюдается»; исключённый и стартовый статус не меняют; профиль не в счёт", () => {
  const posts = [
    { account_handle: "a", found_via: ["topic"], first_seen_at: iso(NOW - 2 * DAY) }, { account_handle: "a", found_via: ["google"], first_seen_at: iso(NOW - 20 * DAY) },
    { account_handle: "b", found_via: ["topic"], first_seen_at: iso(NOW - 2 * DAY) }, { account_handle: "b", found_via: ["topic"], first_seen_at: iso(NOW - 40 * DAY) },
    { account_handle: "c", found_via: ["profile"], first_seen_at: iso(NOW - DAY) }, { account_handle: "c", found_via: ["profile"], first_seen_at: iso(NOW - DAY) },
  ] as unknown as PostRow[];
  const n = countAppearances(posts, NOW);
  assert.deepEqual([n.get("a"), n.get("b"), n.get("c")], [2, 1, undefined]);
  assert.equal(nextAccountStatus({ status: "seen", origin: "auto" }, 2), "watched");
  assert.equal(nextAccountStatus({ status: "seen", origin: "auto" }, 1), "seen");
  assert.equal(nextAccountStatus({ status: "excluded", origin: "auto" }, 9), "excluded");
  assert.equal(nextAccountStatus({ status: "seen", origin: "owner" }, 9), "seen", "заведённый вручную — как решил директор");
  assert.equal(nextAccountStatus({ status: "watched", origin: "auto" }, 0), "watched", "обратно сам не понижается");
});

test("Повышение авто-аккаунта пишется условным обновлением: директор успел исключить — его правка остаётся", async () => {
  const accounts: Row[] = [...allSeeds(), { platform: "instagram", handle: "fresh.blog", kind: "unknown", origin: "auto", status: "seen", appearances: 1, first_seen_at: iso(NOW - 5 * DAY) }];
  const posts = [
    post("DdAAAAAAAAA", { account_handle: "fresh.blog", published_at: iso(NOW - 30 * DAY), first_seen_at: iso(NOW - 3 * DAY), found_via: ["topic"] }),
    post("DdBBBBBBBBB", { account_handle: "fresh.blog", published_at: iso(NOW - 30 * DAY), first_seen_at: iso(NOW - 2 * DAY), found_via: ["google"] }),
  ];
  const { db, tables } = fakeDb({ tables: { assortment_social_account: accounts, assortment_social_post: posts } });
  await run(db, fakeWeb({}), { phase: "measure" });
  const fresh = tables.assortment_social_account.find((a) => a.handle === "fresh.blog")!;
  assert.deepEqual([fresh.status, fresh.appearances], ["watched", 2]);
  // Директор исключил аккаунт между чтением и записью: условное обновление по status=seen его не трогает.
  const raced = fakeDb({ tables: { assortment_social_account: [...allSeeds(), { platform: "instagram", handle: "fresh.blog", kind: "unknown", origin: "auto", status: "seen", appearances: 1 }], assortment_social_post: posts } });
  const realFrom = (raced.db as unknown as { from: (t: string) => Record<string, unknown> }).from;
  (raced.db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    const q = realFrom(t);
    if (t === "assortment_social_account") {
      const update = q.update as (v: Row) => unknown;
      q.update = (v: Row) => {
        if (v.status === "watched") raced.tables.assortment_social_account.find((a) => a.handle === "fresh.blog")!.status = "excluded";
        return update(v);
      };
    }
    return q;
  };
  await run(raced.db, fakeWeb({}), { phase: "measure" });
  assert.equal(raced.tables.assortment_social_account.find((a) => a.handle === "fresh.blog")!.status, "excluded");
});

// --- замер, база автора, вердикт, привязка ---

/** Пример владельца 1: Анна, рилс Dd4Is8To7B0 (Zara 5854/722/710). Прошлые посты — из калибровки, Dd08gHjCN0c — живой образец. */
const ANNA_GRID: Record<string, { likes: number | null; comments: number; kind: "reel" | "p" }> = {
  Dd8kIL2IPms: { likes: 113, comments: 0, kind: "reel" }, Dd6RcZgCPXj: { likes: null, comments: 12, kind: "p" }, DdWZZ4uo_kJ: { likes: 359, comments: 8, kind: "reel" },
  DdTcg6lovQ1: { likes: 71, comments: 8, kind: "reel" }, "Dc_k4M-IEYm": { likes: 96, comments: 13, kind: "reel" }, Dc0hxxWou9v: { likes: 48, comments: 2, kind: "reel" },
  DcgVU3zoJlS: { likes: 71, comments: 7, kind: "reel" }, DcvnQ7DiE0S: { likes: null, comments: 6, kind: "p" },
};
function annaPages(): Record<string, Page> {
  const pages: Record<string, Page> = { [reelUrl("Dd4Is8To7B0")]: fixture("reel-desktop-likes-visible.md"), [reelUrl("Dd08gHjCN0c", "p")]: fixture("post-carousel-desktop-likes-hidden.md") };
  for (const [code, p] of Object.entries(ANNA_GRID)) pages[reelUrl(code, p.kind)] = reelPage({ code, author: "by.annamirabelle", likes: p.likes, comments: p.comments, kind: p.kind, caption: "The ZARA Edit" });
  return pages;
}
const annaPost = () => post("Dd4Is8To7B0", { published_at: "2026-09-29T15:58:38.592Z", account_handle: "by.annamirabelle", views: 315_000, topics: ["zara-viral-jacket"], brand: "zara", direction: "jackets" });
const zaraCatalogRow: Row = { source_id: "S001", source_item_id: "5854722", handle: "https://www.zara.com/us/en/high-neck-pocket-jacket-p05854722.html", title: "HIGH-NECK POCKET JACKET", direction: "jackets", model_key: "S001|5854722", image_urls: ["https://static.zara.net/assets/public/abcd/5854722.jpg?w=750"] };

test("Замер и вердикт: пример Анны — «сильный залёт»; база автора по её прошлым постам (83,5 лайка, 8 комментариев); учёт = число запросов", async () => {
  const { db, tables } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: [annaPost()] } });
  const web = fakeWeb(annaPages());
  const out = await run(db, web, { phase: "measure" });
  assert.equal(out.stoppedBy, null);
  assert.equal(out.measured, 1);
  assert.equal(out.baselines, 1);
  assert.equal(web.calls.length, 10, "страница рилса + 9 прошлых постов из сетки");
  const anna = tables.assortment_social_account.find((a) => a.handle === "by.annamirabelle")!;
  assert.deepEqual([anna.likes_median, anna.comments_median, anna.baseline_posts], [83.5, 8, 6]);
  const p = tables.assortment_social_post.find((r) => r.code === "Dd4Is8To7B0")!;
  assert.deepEqual([p.likes, p.comments, p.intent_count, p.intent_total, p.checks], [3700, 59, 9, 15, 1]);
  assert.deepEqual([p.verdict, p.verdict_preliminary, p.rule_version, p.likes_ratio, p.comments_ratio], ["strong", false, "reels-v1", 44.31, 7.38]);
  assert.deepEqual(p.refs, ["zara:5854722"]);
  assert.equal((p.history as unknown[]).length, 1);
  // Свежий пост автора из сетки — тоже кандидат, со своим замером.
  const fresh = tables.assortment_social_post.find((r) => r.code === "Dd8kIL2IPms")!;
  assert.deepEqual([fresh.found_via, fresh.likes, fresh.verdict], [["author"], 113, "normal"]);
  const usage = tables.assortment_ai_usage.find((u) => u.kind === SOCIAL_USAGE_KIND)!;
  assert.deepEqual([usage.calls, usage.cost_usd], [10, 0.015]);
  // Повтор в тот же день: мерить нечего, база свежая — ни одного запроса.
  const again = fakeWeb(annaPages());
  await run(db, again, { phase: "measure" });
  assert.equal(again.calls.length, 0);
});

test("База автора свежая (моложе 7 дней) — прошлые посты не перекачиваем, судим по ней", async () => {
  const accounts = allSeeds().map((a) => (a.handle === "by.annamirabelle" ? { ...a, likes_median: 83.5, comments_median: 8, baseline_posts: 6, baseline_at: iso(NOW - 2 * DAY) } : a));
  const { db, tables } = fakeDb({ tables: { assortment_social_account: accounts, assortment_social_post: [annaPost()] } });
  const web = fakeWeb(annaPages());
  const out = await run(db, web, { phase: "measure" });
  assert.deepEqual(web.calls, [reelUrl("Dd4Is8To7B0")]);
  assert.equal(out.baselines, 0);
  assert.equal(tables.assortment_social_post.find((r) => r.code === "Dd4Is8To7B0")?.verdict, "strong");
});

test("Запись в базу упала посреди прогона — оплаченные запросы всё равно в учёте, замок снят", async () => {
  const { db, tables } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: [annaPost()] }, failUpsert: "assortment_social_post" });
  const web = fakeWeb(annaPages());
  await assert.rejects(run(db, web, { phase: "measure" }), /база недоступна/);
  assert.equal(tables.assortment_ai_usage.find((u) => u.kind === SOCIAL_USAGE_KIND)?.calls, web.calls.length);
  assert.ok(web.calls.length > 0);
  assert.equal(tables.assortment_ai_usage.find((u) => u.kind === `lock:${SOCIAL_USAGE_KIND}`)?.updated_at, "1970-01-01T00:00:00.000Z");
});

test("В базу не уходят ни тексты и ники комментаторов, ни картинки Instagram, ни цены", async () => {
  const { db, writes } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: [annaPost()] } });
  await run(db, fakeWeb(annaPages()), { phase: "measure" });
  const written = JSON.stringify(writes.map((w) => w.rows));
  for (const banned of ["commenter", "Ref number please", "Link please", "This jacket looks perfect", "cdninstagram", "fbcdn", "example.invalid/avatar", "PRICE"]) {
    assert.ok(!written.includes(banned), `в записях нет «${banned}»`);
  }
});

test("Привязка: номер Zara есть в каталоге — модель каталога (S001|…) без запросов; лента показывает фото и название из каталога", async () => {
  const strong = { ...annaPost(), likes: 3700, comments: 59, intent_count: 9, intent_total: 15, checks: 1, last_checked_at: iso(NOW - DAY), verdict: "strong", refs: ["zara:5854722"], rule_version: "reels-v1", likes_ratio: 44.31 };
  const accounts = allSeeds().map((a) => (a.handle === "by.annamirabelle" ? { ...a, likes_median: 83.5, comments_median: 8, baseline_posts: 6, baseline_at: iso(NOW - DAY) } : a));
  const { db, tables } = fakeDb({ tables: { assortment_social_account: accounts, assortment_social_post: [strong], assortment_source_items: [zaraCatalogRow], assortment_catalog_heads: [{ ...zaraCatalogRow, image_urls: ["https://static.zara.net/assets/public/live/5854722-front.jpg?w=750"] }] } });
  const web = fakeWeb({});
  const out = await run(db, web, { phase: "match" });
  assert.equal(web.calls.length, 0);
  assert.equal(out.matched.catalog, 1);
  const p = tables.assortment_social_post[0];
  assert.deepEqual([p.match_status, p.match_model_key, p.match_title, p.match_gender], ["catalog", "S001|5854722", "HIGH-NECK POCKET JACKET", "women"]);
  const feed = (await loadViralReels(db, { direction: "jackets", nowMs: NOW }))!;
  assert.equal(feed.cards.length, 1);
  const card = feed.cards[0];
  assert.deepEqual([card.match.sourceId, card.match.itemId], ["S001", "5854722"]);
  assert.match(String(card.match.image), /static\.zara\.net\/assets\/public\/live\//, "свежее фото из вида голов");
  assert.equal(card.match.url, zaraCatalogRow.handle);
});

test("Привязка Uniqlo вне каталога: карточка на сайте бренда (ES) — название, фото image.uniqlo.com, пол «женское»", async () => {
  const p = post("DdVk7eRtLMC", { published_at: "2026-09-16T05:51:52.572Z", account_handle: "jpnbrands", likes: 6400, comments: 176, intent_count: 11, intent_total: 15, checks: 1, verdict: "strong", refs: ["uniqlo:487882"], brand: "uniqlo", direction: "jackets" });
  const { db, tables } = fakeDb({ tables: { assortment_social_account: seedsWithBaseline({ jpnbrands: { likes: 236, comments: 5 } }), assortment_social_post: [p] } });
  const web = fakeWeb({ [uniqloCardUrls("487882")[0]]: fixture("uniqlo-card-E487882.md") });
  const out = await run(db, web, { phase: "match" });
  assert.equal(out.matched.brand_site, 1);
  assert.deepEqual(web.calls, [uniqloCardUrls("487882")[0]]);
  const row = tables.assortment_social_post[0];
  assert.deepEqual([row.match_status, row.match_title, row.match_gender, row.match_url], ["brand_site", "Hybrid Down Short Jacket", "women", "https://www.uniqlo.com/es/en/products/E487882-000/00"]);
  assert.match(String(row.match_image), /^https:\/\/image\.uniqlo\.com\//);
});

test("Привязка: мужская карточка — «men» и в ленте нет; ES не открылась — пробуем UK; временный сбой — «pending»; без номера — «no_ref» без запроса", async () => {
  const base = { published_at: iso(NOW - 5 * DAY), account_handle: "uniqlousa", likes: 9000, comments: 40, intent_count: 1, intent_total: 10, checks: 1, verdict: "viral", brand: "uniqlo", direction: "jackets" } as const;
  const men = fixture("uniqlo-card-E487882.md").replace("Women's Hybrid", "Men's Hybrid").replace(/\n(\s*)WOMEN\n/, "\n$1MEN\n");
  const posts = [
    post("DdMEN111111", { ...base, refs: ["uniqlo:487882"] }),
    post("DdUK2222222", { ...base, refs: ["uniqlo:412345"] }),
    post("DdTMP333333", { ...base, refs: ["uniqlo:499999"] }),
    post("DdNOREF4444", { ...base, refs: [] }),
  ];
  const [es, uk] = uniqloCardUrls("412345");
  const { db, tables } = fakeDb({ tables: { assortment_social_account: seedsWithBaseline({ uniqlousa: { likes: 800, comments: 20 } }), assortment_social_post: posts } });
  const web = fakeWeb({
    [uniqloCardUrls("487882")[0]]: men,
    [es]: "# Something\n\nProduct not found",
    [uk]: fixture("uniqlo-card-E487882.md").replaceAll("487882", "412345"),
    [uniqloCardUrls("499999")[0]]: { ok: false, kind: "transient", reason: "сбой страницы: proxy_timeout", ms: 0 },
  });
  await run(db, web, { phase: "match" });
  const by = (code: string) => tables.assortment_social_post.find((r) => r.code === code)!;
  assert.equal(by("DdMEN111111").match_status, "men");
  assert.deepEqual([by("DdUK2222222").match_status, by("DdUK2222222").match_url], ["brand_site", uk]);
  assert.equal(by("DdTMP333333").match_status, "pending");
  assert.equal(by("DdNOREF4444").match_status, "no_ref");
  assert.ok(!web.calls.some((u) => u.includes("NOREF")));
  const feed = (await loadViralReels(db, { direction: "jackets", nowMs: NOW }))!;
  assert.ok(!feed.cards.some((c) => c.code === "DdMEN111111"), "мужское в ленте не показываем");
  assert.equal(matchDue(by("DdTMP333333") as unknown as PostRow, NOW), true, "pending — повторим следующим прогоном");
  assert.equal(matchDue(by("DdNOREF4444") as unknown as PostRow, NOW), false, "без номера — пока номер не появится");
});

test("Мало постов у автора — подписчики с профиля и запасное правило «предварительно»", async () => {
  // Сетка — новые сверху, как у Instagram (иначе первый пост сочтётся закреплённым).
  const grid = [gridCard("tiny.blog", "DdGRID22222", "reel", "September 10, 2026"), gridCard("tiny.blog", "DdGRID11111", "reel", "September 10, 2026")].join("\n\n");
  const cand = post("Dd5sjp1A9vC", { published_at: "2026-09-30T00:00:00.000Z", account_handle: "tiny.blog", views: 248_000, brand: "uniqlo", direction: "jackets" });
  const { db, tables } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: [cand] } });
  const web = fakeWeb({
    [reelUrl("Dd5sjp1A9vC")]: reelPage({ code: "Dd5sjp1A9vC", author: "tiny.blog", likes: 700, comments: 5, caption: "Uniqlo fleece jacket", grid }),
    [reelUrl("DdGRID11111")]: reelPage({ code: "DdGRID11111", author: "tiny.blog", likes: 40, comments: 1 }),
    [reelUrl("DdGRID22222")]: reelPage({ code: "DdGRID22222", author: "tiny.blog", likes: 35, comments: 0 }),
    [profileUrl("tiny.blog")]: "Tiny (@tiny.blog) • Instagram photos and videos\n\n## tiny.blog\n\n*   [3,000 followers](#)\n\n*   [50 following](#)",
  });
  await run(db, web, { phase: "measure" });
  const acc = tables.assortment_social_account.find((a) => a.handle === "tiny.blog")!;
  assert.deepEqual([acc.followers, acc.baseline_posts], [3000, 2]);
  const p = tables.assortment_social_post.find((r) => r.code === "Dd5sjp1A9vC")!;
  assert.deepEqual([p.verdict, p.verdict_preliminary], ["viral", true], "700 лайков ≥ 20% от 3 000 подписчиков");
});

// --- деньги и сбои ---

test("Потолок прогона: 5 запросов — ровно 5, остановка «budget», в учёте 5", async () => {
  const posts = Array.from({ length: 8 }, (_, i) => post(`DdCAP${String(i).padStart(6, "0")}`, { published_at: iso(NOW - 5 * DAY) }));
  const { db, tables } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: posts } });
  const web = fakeWeb(Object.fromEntries(posts.map((p) => [p.url as string, reelPage({ code: p.code as string, author: "x.blog", likes: 10, comments: 1 })])));
  const out = await run(db, web, { phase: "measure", config: cfg({ maxRequestsPerRun: 5 }) });
  assert.equal(web.calls.length, 5);
  assert.equal(out.stoppedBy, "budget");
  assert.equal(tables.assortment_ai_usage.find((u) => u.kind === SOCIAL_USAGE_KIND)?.calls, 5);
});

test("Потолок недели: явный ASSORTMENT_SOCIAL_WEEKLY_REQUESTS=1 500 сведён в строку соцсетей ($2,25) — в учёте за 7 дней 1 498 запросов, за прогон не больше 2", async () => {
  const posts = Array.from({ length: 5 }, (_, i) => post(`DdWEK${String(i).padStart(6, "0")}`, { published_at: iso(NOW - 5 * DAY) }));
  const usage = [{ day: "2026-10-01", kind: SOCIAL_USAGE_KIND, calls: 1000, failed_calls: 0, cost_usd: 1.5, updated_at: iso(NOW - 5 * DAY) }, { day: "2026-10-05", kind: SOCIAL_USAGE_KIND, calls: 498, failed_calls: 0, cost_usd: 0.747, updated_at: iso(NOW - DAY) }, { day: "2026-09-20", kind: SOCIAL_USAGE_KIND, calls: 5000, failed_calls: 0, cost_usd: 7.5, updated_at: iso(NOW - 16 * DAY) }];
  const { db } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: posts, assortment_ai_usage: usage } });
  const web = fakeWeb(Object.fromEntries(posts.map((p) => [p.url as string, reelPage({ code: p.code as string, author: "x.blog", likes: 10, comments: 1 })])));
  const out = await run(db, web, { phase: "measure", engine: engineBudgetConfig({ ASSORTMENT_SOCIAL_WEEKLY_REQUESTS: "1500" }) });
  assert.equal(out.weekRequestsBefore, 1498, "запросы 16-дневной давности в неделю не входят");
  assert.equal(out.allowed, 2);
  assert.equal(out.capBy, "social_line");
  assert.equal(web.calls.length, 2);
  assert.equal(out.stoppedBy, "budget");
});

test("402 / «Customer is not active»: прогон останавливается на первом ответе, рилсы неудачными не помечаются", async () => {
  const posts = Array.from({ length: 4 }, (_, i) => post(`DdPAY${String(i).padStart(6, "0")}`, { published_at: iso(NOW - 5 * DAY) }));
  const { db, tables } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: posts } });
  const web = fakeWeb(Object.fromEntries(posts.map((p) => [p.url as string, new UnlockerStopError("Bright Data: аккаунт не активен или нет средств (402)", "billing")])));
  const out = await run(db, web, { phase: "measure", parallel: 1 });
  assert.equal(out.stoppedBy, "billing");
  assert.match(String(out.stopMessage), /нет средств/);
  assert.equal(web.calls.length, 1);
  for (const p of tables.assortment_social_post) assert.deepEqual([p.checks, p.last_error], [0, null]);
});

test("Сбой одной страницы прогон не роняет: временный — один повтор и «повторим потом», остальные мерятся", async () => {
  const a = post("DdFAIL00000", { published_at: iso(NOW - 5 * DAY), views: 9_000_000 });
  const b = post("DdGOOD00000", { published_at: iso(NOW - 5 * DAY) });
  const { db, tables } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: [a, b] } });
  const web = fakeWeb({ [a.url as string]: { ok: false, kind: "transient", reason: "сбой страницы: proxy_timeout", ms: 0 }, [b.url as string]: reelPage({ code: "DdGOOD00000", author: "x.blog", likes: 10, comments: 1 }) });
  const out = await run(db, web, { phase: "measure" });
  assert.equal(web.calls.filter((u) => u === a.url).length, 2, "один повтор");
  assert.equal(out.measured, 1);
  const failed = tables.assortment_social_post.find((r) => r.code === "DdFAIL00000")!;
  assert.deepEqual([failed.checks, failed.last_error], [0, "сбой страницы: proxy_timeout"]);
  const gone = post("DdGONE00000", { published_at: iso(NOW - 5 * DAY) });
  const shell = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: [gone] } });
  await run(shell.db, fakeWeb({ [gone.url as string]: fixture("reel-not-found-shell.md") }), { phase: "measure" });
  const g = shell.tables.assortment_social_post[0];
  assert.deepEqual([g.likes, g.checks], [null, 1], "удалённый рилс — не 0 лайков");
  assert.match(String(g.last_error), /нет/);
});

// --- поиск ---

test("Поиск: темы и Google — только рилсы моложе 21 дня, просмотры со страницы темы; соседние темы (≤10) и пустые темы — в состояние S068", async () => {
  const pages: Record<string, Page> = {
    [topicUrl("zara-viral-jacket")]: fixture("topic-zara-viral-jacket.md"),
    [topicUrl("zara-bag")]: fixture("topic-zara-bag.md"),
    [topicUrl("uniqlo-jacket")]: fixture("topic-uniqlo-jacket.md"),
    [topicUrl("zara-jackets")]: "   Zara Jackets • 0 reels on Instagram   \n\n# Zara Jackets\n",
    [googleSearchUrl(googleQuery(GOOGLE_QUERIES.zara[0], NOW))]: fixture("google-reel-zara-ref.json"),
    [googleSearchUrl(googleQuery(GOOGLE_QUERIES.uniqlo[0], NOW))]: fixture("google-reel-uniqlo-jacket-gl-us.json"),
    [profileUrl("jpnbrands")]: fixture("profile-jpnbrands.md"),
  };
  const seeds = allSeeds().map((a) => (a.handle === "jpnbrands" ? { ...a, last_checked_at: iso(NOW - 7 * DAY) } : a));
  const { db, tables } = fakeDb({ tables: { assortment_social_account: seeds } });
  const web = fakeWeb(pages);
  const out = await run(db, web, { phase: "discover" });
  assert.equal(out.discover.ran, true);
  const codes = new Map(tables.assortment_social_post.map((p) => [p.code as string, p]));
  const ours = codes.get("Dd4Is8To7B0")!;
  assert.deepEqual([ours.views, ours.found_via, ours.topics, ours.brand, ours.direction, ours.account_handle], [315_000, ["topic"], ["zara-viral-jacket"], "zara", "jackets", "by.annamirabelle"]);
  assert.deepEqual(ours.refs, ["zara:5854722"]);
  assert.ok(!codes.has("DTfauF8CL-J"), "январский рилс из темы не берём");
  assert.ok(!codes.has("DcWVxTvMohN"), "август (старше 21 дня) — тоже");
  assert.equal(codes.get("DeExO9NMruK")?.found_via?.toString(), "google");
  assert.equal(codes.get("DeExO9NMruK")?.brand, "zara", "бренд — от запроса Google");
  assert.ok(codes.has("DeJFcB4iWxs"), "свежий рилс наблюдаемого аккаунта из профиля");
  assert.equal(codes.get("DeJFcB4iWxs")?.found_via?.toString(), "profile");
  assert.ok(!codes.has("Dd8nlbbje56"), "чужой пост соавтора в профиле — не рилс аккаунта");
  const jpn = tables.assortment_social_account.find((a) => a.handle === "jpnbrands")!;
  assert.deepEqual([jpn.followers, jpn.last_checked_at], [57_600, iso(NOW)]);
  const auto = tables.assortment_social_account.find((a) => a.handle === "what.bri.wears")!;
  assert.deepEqual([auto.origin, auto.status, auto.kind], ["auto", "seen", "unknown"], "автор кандидата — «увиден»");
  const state = readSocialState(tables.assortment_sources.find((s) => s.source_id === "S068")!.capabilities);
  assert.equal(state.discoveredAt, iso(NOW));
  assert.ok(state.autoTopics.length > 0 && state.autoTopics.length <= 10, `новых тем ${state.autoTopics.length}`);
  assert.ok(state.autoTopics.every((t) => /zara|uniqlo/.test(t.slug)));
  assert.ok(!state.autoTopics.some((t) => t.slug === "zara-tote-bag-price" && false));
  assert.equal(state.topicMisses["zara-jackets"], 1, "пустая тема («0 reels») — промах");
  assert.equal(state.deadTopics["zara-jackets"], undefined, "после одного пустого ответа тема ещё не мёртвая");
  assert.equal(state.pending, null, "поиск дошёл до конца");
  // Тот же день, обычный прогон: поиск не повторяется (раз в 6 дней), темы не качаются.
  const again = fakeWeb(pages);
  await run(db, again, {});
  assert.ok(!again.calls.some((u) => u.includes("/popular/") || u.includes("google.com")));
});

test("Профиль не открылся: нет профиля — следующая попытка через срок; временный сбой — завтра", async () => {
  const accounts = [...allSeeds(), { platform: "instagram", handle: "gone.blog", kind: "unknown", origin: "auto", status: "watched", appearances: 2, last_checked_at: null },
    { platform: "instagram", handle: "flaky.blog", kind: "unknown", origin: "auto", status: "watched", appearances: 2, last_checked_at: null }];
  const state = { social: { discoveredAt: iso(NOW - DAY), autoTopics: [], deadTopics: [] } };
  const { db, tables } = fakeDb({ tables: { assortment_social_account: accounts, assortment_sources: [{ source_id: "S068", capabilities: state }] } });
  const web = fakeWeb({ [profileUrl("gone.blog")]: { ok: false, kind: "failed", reason: "страницы нет (404)", ms: 0 }, [profileUrl("flaky.blog")]: { ok: false, kind: "transient", reason: "сбой страницы: proxy_timeout", ms: 0 } });
  const out = await run(db, web, {});
  assert.equal(out.discover.ran, false, "поиск по темам был вчера");
  const by = (h: string) => tables.assortment_social_account.find((a) => a.handle === h)!;
  assert.deepEqual([by("gone.blog").last_checked_at, by("gone.blog").last_error], [iso(NOW), "страницы нет (404)"]);
  assert.deepEqual([by("flaky.blog").last_checked_at, by("flaky.blog").last_error], [null, "сбой страницы: proxy_timeout"]);
});

test("Слияние кандидата: источники и темы копятся, просмотры обновляются, ручные поля и замеры не трогаются", () => {
  const existing = { ...post("Dd4Is8To7B0", { published_at: "2026-09-29T15:58:38.592Z", found_via: ["google"], likes: 3700, verdict: "strong", hidden_at: "2026-10-05T00:00:00Z" }) } as unknown as PostRow;
  const merged = mergeCandidate(existing, { code: "Dd4Is8To7B0", kind: "reel", author: "by.annamirabelle", caption: "Reference 5854/722/710", hashtags: ["zarajacket"], views: 315_000, via: "topic", topic: "zara-viral-jacket", brandHint: "zara" }, NOW);
  assert.deepEqual(merged.found_via, ["google", "topic"]);
  assert.deepEqual(merged.topics, ["zara-viral-jacket"]);
  assert.equal(merged.views, 315_000);
  assert.deepEqual([merged.likes, merged.verdict, merged.hidden_at], [3700, "strong", "2026-10-05T00:00:00Z"]);
  assert.deepEqual(merged.refs, ["zara:5854722"]);
});

// --- чтение ---

test("PostgREST отдаёт не больше 1 000 строк: рилсы читаются листанием все", async () => {
  const many = Array.from({ length: 1200 }, (_, i) => post(`DdMANY${String(i).padStart(5, "0")}`, { published_at: iso(NOW - 3 * DAY) }));
  const { db, reads } = fakeDb({ tables: { assortment_social_post: many } });
  const loaded = await loadPosts(db, NOW - 30 * DAY);
  assert.equal(loaded.size, 1200);
  assert.ok(reads.filter((r) => r.table === "assortment_social_post").length >= 2, "две страницы");
});

test("Лента «Залетает»: только залетевшие раздела за окно, без скрытых, мужских и исключённых авторов; авторы с тем же номером за 14 дней; метки факт/расчёт/оценка/гипотеза; картинок Instagram нет", async () => {
  const day = (n: number) => iso(NOW - n * DAY);
  const posts = [
    post("DdANNA00000", { account_handle: "by.annamirabelle", published_at: day(7), verdict: "strong", brand: "zara", direction: "jackets", refs: ["zara:5854722"], likes: 3700, comments: 59, views: 315_000, intent_count: 9, intent_total: 15, likes_ratio: 44.31, comments_ratio: 7.38, checks: 1, match_status: "catalog", match_model_key: "S001|5854722", match_title: "HIGH-NECK POCKET JACKET", match_image: "https://static.zara.net/assets/public/x/5854722.jpg" }),
    post("DdBUYR00000", { account_handle: "buyer_services_", published_at: day(1), verdict: null, brand: "zara", direction: "jackets", refs: ["zara:5854722"] }),
    post("DdUAST00000", { account_handle: "ua.stylist", published_at: day(4), verdict: "normal", brand: "zara", direction: "jackets", refs: ["zara:5854722"] }),
    post("DdOLDR00000", { account_handle: "old.one", published_at: day(30), verdict: "normal", brand: "zara", direction: "jackets", refs: ["zara:5854722"] }),
    post("DdPREL00000", { account_handle: "tiny.blog", published_at: day(5), verdict: "viral", verdict_preliminary: true, brand: "uniqlo", direction: "jackets", likes: 700, refs: [], match_status: "no_ref", match_image: "https://scontent.cdninstagram.com/v/x.jpg" }),
    post("DdMENS00000", { account_handle: "a.blog", published_at: day(5), verdict: "strong", brand: "uniqlo", direction: "jackets", match_status: "men" }),
    post("DdHIDE00000", { account_handle: "a.blog", published_at: day(5), verdict: "strong", brand: "zara", direction: "jackets", hidden_at: day(1) }),
    post("DdEXCL00000", { account_handle: "spam.shop", published_at: day(5), verdict: "strong", brand: "zara", direction: "jackets" }),
    post("DdBAGS00000", { account_handle: "a.blog", published_at: day(5), verdict: "strong", brand: "zara", direction: "bags" }),
    post("DdMUJI00000", { account_handle: "a.blog", published_at: day(5), verdict: "strong", brand: null, direction: "jackets" }),
    post("DdTOLD00000", { account_handle: "a.blog", published_at: day(25), verdict: "strong", brand: "zara", direction: "jackets" }),
  ];
  const accounts = [...allSeeds(), { platform: "instagram", handle: "spam.shop", kind: "unknown", origin: "auto", status: "excluded" }, { platform: "instagram", handle: "tiny.blog", kind: "blogger", origin: "auto", status: "seen", followers: 3000 }];
  const { db } = fakeDb({ tables: { assortment_social_post: posts, assortment_social_account: accounts } });
  const feed = (await loadViralReels(db, { direction: "jackets", nowMs: NOW }))!;
  assert.deepEqual(feed.cards.map((c) => c.code), ["DdANNA00000", "DdPREL00000"], "сильный впереди, предварительный — после");
  const anna = feed.cards[0];
  assert.equal(anna.sameRefAuthors14d, 3, "Анна, байер и стилист за ±14 дней; пост 30-дневной давности — нет");
  assert.equal(anna.confirmedBySecondAuthor, true);
  assert.deepEqual(anna.kinds, { likes: "estimate", comments: "fact", views: "estimate", intent: "estimate", ratios: "calc", verdict: "calc", publishedAt: "calc", sameRefAuthors: "calc", match: "fact" });
  assert.deepEqual(anna.intent, { count: 9, total: 15, share: 0.6 });
  assert.equal(anna.author.url, "https://www.instagram.com/by.annamirabelle/");
  assert.equal(anna.match.modelKey, "S001|5854722");
  assert.equal(anna.match.url, null, "строки каталога нет — ссылку не выдумываем");
  const prel = feed.cards[1];
  assert.deepEqual([prel.preliminary, prel.kinds.verdict, prel.kinds.likes, prel.author.followers], [true, "hypothesis", "fact", 3000]);
  assert.equal(prel.match.image, null, "картинку Instagram не показываем");
  assert.deepEqual((await loadViralReels(db, { direction: "jackets", nowMs: NOW, onlyStrong: true }))!.cards.map((c) => c.code), ["DdANNA00000"]);
  assert.deepEqual((await loadViralReels(db, { direction: "bags", nowMs: NOW }))!.cards.map((c) => c.code), ["DdBAGS00000"]);
});

// --- миграция, крон, сторож ---

test("Миграция «Залетает»: одна новая, без цен, оценок «вероятности» и колонок про комментаторов; RLS и revoke как у соседних таблиц", () => {
  const columns = [...COLUMNS.assortment_social_account, ...COLUMNS.assortment_social_post];
  assert.ok(columns.length >= 45, `колонок ${columns.length}`);
  for (const c of columns) {
    assert.doesNotMatch(c, /price|cost|margin|currency|spp|moq|budget|score|probability/i, `колонка ${c}`);
    assert.doesNotMatch(c, /commenter|comment_(?:text|author|user|nick)|nick|follower_list|followers_list/i, `колонка ${c}: людей не храним`);
  }
  for (const c of ["platform", "handle", "kind", "origin", "status", "followers", "likes_median", "comments_median", "baseline_posts", "baseline_at", "appearances", "first_seen_at", "last_checked_at", "last_error"]) assert.ok(COLUMNS.assortment_social_account.has(c), c);
  for (const c of ["code", "url", "account_handle", "published_at", "found_via", "topics", "brand", "direction", "caption_excerpt", "hashtags", "refs", "likes", "comments", "views", "likes_hidden", "intent_count", "intent_total", "likes_ratio", "comments_ratio", "verdict", "rule_version", "history", "match_status", "match_model_key", "match_url", "match_title", "match_image", "match_checked_at", "last_error"]) assert.ok(COLUMNS.assortment_social_post.has(c), c);
  for (const t of ["assortment_social_account", "assortment_social_post"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security;`));
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from anon, authenticated;`));
  }
  assert.match(sql, /primary key \(platform, handle\)/);
  assert.match(sql, /primary key \(platform, code\)/);
  assert.match(sql, /using gin \(refs\)/);
  assert.match(sql, /\(verdict, published_at desc\)/);
  assert.match(sql, /match_status in \('catalog', 'brand_site', 'men', 'kids', 'not_found', 'no_ref', 'pending'\)/);
  assert.doesNotMatch(sql, /language plpgsql|drop |alter table public\.(?!assortment_social_)/i, "только добавление");
  assert.match(sql, /char_length\(caption_excerpt\) <= 500/);
});

test("Крон: GET, checkCronAuth, журнал под именем сторожа, каждые 3 часа в :20 UTC; путь не под assortment-brightdata", () => {
  const route = readFileSync(join(root, "app/api/sync/assortment-social/route.ts"), "utf8");
  assert.match(route, /export async function GET\(request: NextRequest\)/);
  assert.match(route, /const authError = await checkCronAuth\(request\);\s*if \(authError\) return authError;/);
  assert.match(route, /export const maxDuration = 300;/);
  assert.match(route, /export const dynamic = "force-dynamic";/);
  assert.match(route, /const JOB = "assortment-social";/);
  assert.match(route, /writeSyncLog\(JOB/);
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons.filter((c) => c.path.startsWith("/api/sync/assortment-social")), [{ path: "/api/sync/assortment-social", schedule: "20 */3 * * *" }]);
  const store = readFileSync(join(root, "lib/assortment/socialReelsStore.ts"), "utf8");
  // Прогон ≤ maxDuration 300 с, замок 6 мин, между прогонами 3 часа: два прогона разом не идут.
  assert.match(store, /const LEASE_MS = 6 \* 60 \* 1000;/);
  assert.doesNotMatch(store, /\.limit\(/, "чтение — листанием, не .limit()");
});

// --- по ревью: база автора, поиск, вёрстка, сводка ---

const IG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** Код рилса с заданной датой публикации (обратное к shortcodeToDate): 8 знаков времени + 3 знака «шарда». */
function codeAt(msTime: number, salt = 0): string {
  let n = (msTime - 1314220021721) * 32;
  let head = "";
  while (n > 0) {
    head = IG_ALPHABET[n % 64] + head;
    n = Math.floor(n / 64);
  }
  const code = head + [salt % 64, Math.floor(salt / 64) % 64, 7].map((i) => IG_ALPHABET[i]).join("");
  assert.ok(Math.abs((shortcodeToDate(code)?.getTime() ?? 0) - msTime) < 1000, `codeAt ${code}`);
  return code;
}
const gridDate = (msTime: number) => new Date(msTime).toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric", timeZone: "UTC" });

/** Автор с кандидатом и обычными постами в сетке «More posts from»: страницы всех постов, строка кандидата для базы. */
function authorPages(handle: string, salt: number, o: { likes: number; comments: number; candLikes: number; candComments: number; normal?: number; pinned?: number; young?: number; commentTexts?: string[] }) {
  const pages: Record<string, Page> = {};
  const cand = codeAt(NOW - 5 * DAY, salt);
  const grid: string[] = [];
  const add = (code: string, t: number) => {
    grid.push(gridCard(handle, code, "reel", gridDate(t)));
    pages[reelUrl(code)] = reelPage({ code, author: handle, likes: o.likes, comments: o.comments });
  };
  for (let i = 0; i < (o.pinned ?? 0); i += 1) add(codeAt(NOW - (200 + i) * DAY, salt + 100 + i), NOW - (200 + i) * DAY);
  for (let i = 0; i < (o.young ?? 0); i += 1) add(codeAt(NOW - (0.5 + i * 0.2) * DAY, salt + 200 + i), NOW - (0.5 + i * 0.2) * DAY);
  for (let i = 0; i < (o.normal ?? 9); i += 1) add(codeAt(NOW - (6 + i) * DAY, salt + 300 + i), NOW - (6 + i) * DAY);
  pages[reelUrl(cand)] = reelPage({ code: cand, author: handle, likes: o.candLikes, comments: o.candComments, caption: "Uniqlo puffer jacket", commentTexts: o.commentTexts ?? ["so nice", "love it", "wow", "beautiful"], grid: grid.join("\n\n") });
  const row = post(cand, { published_at: iso(NOW - 5 * DAY), account_handle: handle, brand: "uniqlo", direction: "jackets", first_seen_at: iso(NOW - 2 * DAY), found_via: ["profile"] });
  return { pages, row, cand, grid };
}

test("Базы автора нет — вердикта нет (не запасное правило); автор за потолком баз досчитывается следующим прогоном без нового замера — по сетке со страницы рилса", async () => {
  const big = ["big.a", "big.b", "big.c", "big.d"].map((h, i) => authorPages(h, 10 + i * 1000, { likes: 20_000, comments: 3, candLikes: 21_000, candComments: 50 }));
  // Настоящий залёт мелкого автора: 2 000 лайков при медиане 50 (40×), подписчики неизвестны, профиль не открылся.
  const small = authorPages("small.stylist", 9000, { likes: 50, comments: 1, candLikes: 2000, candComments: 10 });
  const all = [...big, small];
  const { db, tables } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: all.map((a) => a.row) } });
  const pages = Object.assign({}, ...all.map((a) => a.pages)) as Record<string, Page>;
  const first = await run(db, fakeWeb(pages), { phase: "measure" });
  assert.equal(first.baselines, 4, "потолок — 4 автора за прогон");
  const by = (code: string) => tables.assortment_social_post.find((r) => r.code === code)!;
  for (const b of big) assert.equal(by(b.cand).verdict, "normal", "крупный аккаунт с базой: 21 000 при медиане 20 000 — «обычно»");
  assert.deepEqual([by(small.cand).verdict, by(small.cand).verdict_preliminary], [null, false], "без базы — не «обычно» по запасному правилу, а «ждёт базы»");
  assert.equal(first.awaitingBaseline, 1);
  assert.equal(socialRunLog(first).status, "ok");
  // Назавтра рилс не мерим (следующий замер — на 7-й день), а базу досчитываем: профиль не открылся — сетка со страницы рилса.
  const web = fakeWeb(pages);
  const second = await run(db, web, { phase: "measure", now: () => NOW + DAY });
  assert.equal(second.baselines, 1);
  assert.deepEqual([by(small.cand).checks, by(small.cand).last_checked_at], [1, iso(NOW)], "страница рилса — ради сетки, замер не засчитан повторно");
  assert.ok(web.calls.includes(profileUrl("small.stylist")) && web.calls.includes(reelUrl(small.cand)));
  const acc = tables.assortment_social_account.find((a) => a.handle === "small.stylist")!;
  assert.deepEqual([acc.baseline_posts, acc.likes_median], [9, 50]);
  assert.deepEqual([by(small.cand).verdict, by(small.cand).verdict_preliminary, by(small.cand).checks], ["viral", false, 1], "основное правило: 40× медианы");
});

test("Очередь баз: сначала авторы, чьи рилсы ждут базы (вердикта нет), а не самые залайканные с устаревшей базой", async () => {
  const stale = authorPages("stale.big", 20, { likes: 20_000, comments: 3, candLikes: 30_000, candComments: 50 });
  const fresh = authorPages("new.small", 4000, { likes: 50, comments: 1, candLikes: 2000, candComments: 10 });
  const accounts = [...allSeeds(), { platform: "instagram", handle: "stale.big", kind: "blogger", origin: "auto", status: "seen", likes_median: 20_000, comments_median: 3, baseline_posts: 9, baseline_at: iso(NOW - 10 * DAY), appearances: 0 }];
  const { db, tables } = fakeDb({ tables: { assortment_social_account: accounts, assortment_social_post: [stale.row, fresh.row] } });
  const out = await run(db, fakeWeb({ ...stale.pages, ...fresh.pages }), { phase: "measure", config: cfg({ maxBaselineAuthorsPerRun: 1 }) });
  assert.equal(out.baselines, 1);
  assert.equal(tables.assortment_social_account.find((a) => a.handle === "new.small")!.baseline_posts, 9, "база — тому, кто без вердикта");
  assert.equal(tables.assortment_social_post.find((r) => r.code === fresh.cand)!.verdict, "viral");
  assert.equal(tables.assortment_social_post.find((r) => r.code === stale.cand)!.verdict, "normal", "устаревшая база — тоже база: вердикт есть");
});

test("Без базы автора: крупный аккаунт с обычным рилсом (≥ 5 000 лайков) не «залетает»; рилс без шанса — «обычно» без базы", () => {
  const account = { ...allSeeds()[0], handle: "big.blog", baseline_posts: null, baseline_at: null } as unknown as AccountRow;
  const p = { ...post("DdBIG000000", { published_at: iso(NOW - 5 * DAY), account_handle: "big.blog", likes: 6500, comments: 45, intent_count: 0, intent_total: 4, checks: 1 }) } as unknown as PostRow;
  assert.equal(judgePost(p, account, NOW).verdict, null, "ждёт базы");
  assert.equal(judgePost(p, undefined, NOW).verdict, null);
  const quiet = { ...p, likes: 120, comments: 4, views: null } as PostRow;
  assert.equal(judgePost(quiet, account, NOW).verdict, "normal", "лайков < 1 000 и комментариев < 30 — «залёта» не даст никакая база");
  const based = { ...account, likes_median: 6000, comments_median: 40, baseline_posts: 9, baseline_at: iso(NOW - DAY) } as AccountRow;
  assert.equal(judgePost(p, based, NOW).verdict, "normal");
  const few = { ...based, baseline_posts: 3 } as AccountRow;
  assert.deepEqual([judgePost(p, few, NOW).verdict, judgePost(p, few, NOW).verdict_preliminary], ["viral", true], "запасное правило — только когда база посчитана и в ней < 6 постов");
});

/** Калибровка 06.10: прошлые посты jpnbrands (лайки, комментарии). */
const JPN_POSTS: Record<string, { likes: number; comments: number; kind: "reel" | "p" }> = {
  DeGmqJRCDPx: { likes: 65, comments: 3, kind: "reel" }, Dd8NdvPi0Yp: { likes: 1482, comments: 176, kind: "reel" }, Dd5ra5iCAzK: { likes: 90, comments: 5, kind: "reel" },
  Dd0mRmIiacc: { likes: 387, comments: 2, kind: "reel" }, Ddqfse0AohS: { likes: 301, comments: 5, kind: "p" }, DdnniDmIw5R: { likes: 111, comments: 3, kind: "reel" },
  DdlO3H9iUKx: { likes: 236, comments: 18, kind: "reel" },
};

test("Пример владельца jpnbrands целиком: сетка рилса даёт 3 поста (закреплённые и соавторский съели её) — база дополняется сеткой профиля; основное правило, без «предварительно»", async () => {
  const pages: Record<string, Page> = { [reelUrl("DdVk7eRtLMC")]: fixture("reel-desktop-edited-hashtag-article.md"), [profileUrl("jpnbrands")]: fixture("profile-jpnbrands.md") };
  for (const [code, p] of Object.entries(JPN_POSTS)) pages[reelUrl(code, p.kind)] = reelPage({ code, author: "jpnbrands", likes: p.likes, comments: p.comments, kind: p.kind });
  const cand = post("DdVk7eRtLMC", { published_at: "2026-09-16T05:51:52.572Z", account_handle: "jpnbrands", brand: "uniqlo", direction: "jackets", found_via: ["profile"] });
  const { db, tables } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: [cand] } });
  const web = fakeWeb(pages);
  const out = await run(db, web, { phase: "measure" });
  assert.equal(out.baselines, 1);
  assert.ok(web.calls.includes(profileUrl("jpnbrands")), "профиль — ради базы");
  const acc = tables.assortment_social_account.find((a) => a.handle === "jpnbrands")!;
  assert.deepEqual([acc.baseline_posts, acc.likes_median, acc.comments_median, acc.followers], [6, 268.5, 5, 57_600], "90, 111, 236, 301, 387, 1 482 → 268,5");
  const p = tables.assortment_social_post.find((r) => r.code === "DdVk7eRtLMC")!;
  assert.deepEqual([p.likes, p.comments, p.intent_count, p.intent_total], [6400, 176, 11, 15]);
  assert.deepEqual([p.verdict, p.verdict_preliminary, p.rule_version], ["strong", false, "reels-v1"]);
  const feed = (await loadViralReels(db, { direction: "jackets", nowMs: NOW }))!;
  const card = feed.cards.find((c) => c.code === "DdVk7eRtLMC")!;
  assert.deepEqual([card.preliminary, card.kinds.verdict], [false, "calc"], "на экране — расчёт, а не «гипотеза: мало постов»");
});

test("Официальный аккаунт: в сетке рилса 3 закреплённых и 2 свежих — база из профиля, обычный рилс (1,1× медианы) не «залетает» по запасному правилу", async () => {
  const a = authorPages("uniqlousa", 1, { likes: 7000, comments: 40, candLikes: 8000, candComments: 45, pinned: 3, young: 2, normal: 4 });
  const more = Array.from({ length: 5 }, (_, i) => codeAt(NOW - (11 + i) * DAY, 500 + i));
  for (const [i, code] of more.entries()) a.pages[reelUrl(code)] = reelPage({ code, author: "uniqlousa", likes: 7000, comments: 40 });
  a.pages[profileUrl("uniqlousa")] = ["UNIQLO USA (@uniqlousa) • Instagram photos and videos", "## uniqlousa", "*   [1.2M followers](#)", ...a.grid, ...more.map((code, i) => gridCard("uniqlousa", code, "reel", gridDate(NOW - (11 + i) * DAY)))].join("\n\n");
  const { db, tables } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: [a.row] } });
  await run(db, fakeWeb(a.pages), { phase: "measure" });
  const acc = tables.assortment_social_account.find((r) => r.handle === "uniqlousa")!;
  assert.ok(Number(acc.baseline_posts) >= 6, `постов в базе ${acc.baseline_posts}`);
  assert.equal(acc.likes_median, 7000);
  const p = tables.assortment_social_post.find((r) => r.code === a.cand)!;
  assert.deepEqual([p.verdict, p.verdict_preliminary], ["normal", false]);
  assert.deepEqual((await loadViralReels(db, { direction: "jackets", nowMs: NOW }))!.cards.map((c) => c.code), [], "в ленте его нет");
});

const LOGIN_WALL = " Instagram \n\n[Log In](/accounts/login/?next=%2Fpopular%2Fzara-jacket%2F&source=desktop_nav)\n\n[Sign Up](/accounts/emailsignup/)\n\nSee more from Instagram";
const emptyTopic = (slug: string) => `   ${slug} • 0 reels on Instagram   \n\n# ${slug}\n`;
const stateOf = (tables: Record<string, Row[]>) => readSocialState(tables.assortment_sources.find((s) => s.source_id === "S068")!.capabilities);
const quietSeeds = () => allSeeds().map((a) => ({ ...a, last_checked_at: iso(NOW + 60 * DAY) }));

test("Стена входа вместо тем (ответ 200) — темы не «мёртвые», прогон — «ошибка» с тревогой, назавтра темы запрашиваются снова", async () => {
  const wall = Object.fromEntries(SEED_TOPICS.map((t) => [topicUrl(t.slug), LOGIN_WALL])) as Record<string, Page>;
  const { db, tables } = fakeDb({ tables: { assortment_social_account: quietSeeds() } });
  const out = await run(db, fakeWeb(wall), { phase: "discover" });
  const state = stateOf(tables);
  assert.deepEqual([Object.keys(state.deadTopics).length, Object.keys(state.topicMisses).length], [0, 0], "сбой страницы — не промах темы");
  assert.equal(out.discover.topicsUnrecognized, SEED_TOPICS.length);
  assert.equal(out.discover.complete, false);
  assert.match(out.alarms.join(" "), /ни одна тема не дала рилсов/);
  assert.equal(socialRunLog(out).status, "error", "сторож увидит");
  assert.equal(state.discoveredAt, null, "поиск не засчитан");
  const again = fakeWeb({});
  await run(db, again, { now: () => NOW + DAY });
  assert.equal(again.calls.filter((u) => u.includes("/popular/")).length, SEED_TOPICS.length, "темы со сбоем повторяем");
});

test("Все темы ответили «страницы нет» (404) — тоже тревога: ни одна тема не дала рилсов", async () => {
  const { db } = fakeDb({ tables: { assortment_social_account: quietSeeds() } });
  const out = await run(db, fakeWeb({}), { phase: "discover" });
  assert.match(out.alarms.join(" "), /ни одна тема не дала рилсов/);
  assert.equal(socialRunLog(out).status, "error");
});

test("Тема «0 reels» мёртвая после трёх пустых ответов подряд; мёртвую перепроверяем через 4 недели; прежний список мёртвых — перепроверяем сразу", async () => {
  const pages: Record<string, Page> = { [topicUrl("zara-viral-jacket")]: fixture("topic-zara-viral-jacket.md"), [topicUrl("zara-jackets")]: emptyTopic("Zara Jackets") };
  const { db, tables } = fakeDb({ tables: { assortment_social_account: quietSeeds() } });
  for (let day = 0; day < 3; day += 1) {
    const out = await run(db, fakeWeb(pages), { phase: "discover", now: () => NOW + day * DAY });
    assert.equal(out.alarms.length, 0, "одна тема с рилсами — разбор жив");
    const state = stateOf(tables);
    assert.equal(state.topicMisses["zara-jackets"], day + 1);
    assert.equal(state.deadTopics["zara-jackets"] != null, day === 2, `день ${day}`);
  }
  const week = fakeWeb(pages);
  await run(db, week, { phase: "discover", now: () => NOW + 9 * DAY });
  assert.ok(!week.calls.includes(topicUrl("zara-jackets")), "мёртвую не запрашиваем");
  const month = fakeWeb(pages);
  await run(db, month, { phase: "discover", now: () => NOW + 31 * DAY });
  assert.ok(month.calls.includes(topicUrl("zara-jackets")), "через 4 недели — перепроверка");
  const legacy = readSocialState({ social: { discoveredAt: null, autoTopics: [], deadTopics: ["zara-jackets"] } });
  assert.ok(activeTopics(legacy, NOW).some((t) => t.slug === "zara-jackets"), "дата неизвестна — перепроверяем");
});

test("Поиск упёрся в потолок прогона: замер идёт из резерва, пройденное запоминается и следующим прогоном продолжается с места; не завершён 8 прогонов (сутки) — тревога", async () => {
  const cand = codeAt(NOW - 4 * DAY, 5);
  const pages: Record<string, Page> = { [reelUrl(cand)]: reelPage({ code: cand, author: "by.annamirabelle", likes: 100, comments: 2 }) };
  for (const t of SEED_TOPICS) pages[topicUrl(t.slug)] = emptyTopic(t.slug);
  const { db, tables } = fakeDb({ tables: { assortment_social_account: quietSeeds(), assortment_social_post: [post(cand, { published_at: iso(NOW - 4 * DAY), account_handle: "by.annamirabelle" })] } });
  const day0 = fakeWeb(pages);
  const out0 = await run(db, day0, { config: cfg({ maxRequestsPerRun: 40 }) });
  assert.equal(out0.requests, 40);
  assert.ok(day0.calls.includes(reelUrl(cand)), "замер не съеден поиском");
  assert.equal(tables.assortment_social_post.find((r) => r.code === cand)!.checks, 1);
  assert.equal(out0.discover.complete, false);
  assert.equal(socialRunLog(out0).status, "partial");
  const pending = stateOf(tables).pending!;
  assert.equal(pending.topics.length + pending.google.length, 39);
  const day1 = fakeWeb(pages);
  const out1 = await run(db, day1, { config: cfg({ maxRequestsPerRun: 40 }), now: () => NOW + DAY });
  assert.equal(day1.calls.filter((u) => u.includes("/popular/")).length, 0, "пройденные темы не повторяем");
  assert.equal(day1.calls.length, SEED_TOPICS.length + 20 - 39, "только оставшиеся запросы Google");
  assert.deepEqual([out1.discover.resumed, out1.discover.complete, stateOf(tables).pending, stateOf(tables).discoveredAt], [true, true, null, iso(NOW + DAY)]);
  // Потолок 5: поиск не успевает 8 прогонов подряд — сутки при кроне раз в 3 часа — тревога; раньше — нет (поиск идёт 2–3 прогона).
  assert.equal(DISCOVER_STALL_RUNS, 8);
  const small = fakeDb({ tables: { assortment_social_account: quietSeeds() } });
  const runs = [];
  for (let i = 0; i < DISCOVER_STALL_RUNS; i += 1) runs.push(await run(small.db, fakeWeb(pages), { config: cfg({ maxRequestsPerRun: 5 }), now: () => NOW + i * 3 * HOUR }));
  assert.deepEqual(runs.map((r) => r.alarms.length > 0), [false, false, false, false, false, false, false, true]);
  assert.match(runs[7].alarms[0], /поиск не завершён прогонов подряд: 8/);
  assert.equal(socialRunLog(runs[7]).status, "error");
});

test("Мобильная вёрстка: при ≥ 30 комментариях — повтор за десктопной; снова мобильная — замер не засчитан, Б «не измерено» (не «обычно»); назавтра десктоп — «залетает»", async () => {
  const mobile = fixture("reel-mobile-layout.md").replace("90 likes", "1,482 likes").replace("View all 5 comments", "View all 176 comments");
  const m = parseReelPage(mobile)!;
  assert.deepEqual([m.layout, m.likes, m.comments, m.visibleComments.length], ["mobile", 1482, 176, 0]);
  const at = Date.parse(m.publishedAt!) + 4 * DAY;
  const desktop = reelPage({ code: m.code, author: "jpnbrands", likes: 1482, comments: 176, caption: "Флисовые брюки Uniqlo", commentTexts: ["Цена?", "Сколько стоит?", "цена", "Где купить?", "Артикул?"] });
  const accounts = () => allSeeds().map((a) => (a.handle === "jpnbrands" ? { ...a, likes_median: 236, comments_median: 5, baseline_posts: 8, baseline_at: iso(at - DAY) } : { ...a, last_checked_at: iso(at) }));
  const row = () => post(m.code, { published_at: m.publishedAt, account_handle: "jpnbrands", brand: "uniqlo", direction: "jackets", first_seen_at: iso(at - 2 * DAY) });
  const { db, tables } = fakeDb({ tables: { assortment_social_account: accounts(), assortment_social_post: [row()] } });
  const twice = fakeWeb({ [reelUrl(m.code)]: mobile });
  const out = await run(db, twice, { phase: "measure", now: () => at });
  assert.equal(twice.calls.length, 2, "повтор за десктопной");
  assert.equal(out.intentUnmeasured, 1);
  const p = tables.assortment_social_post[0];
  assert.deepEqual([p.likes, p.comments, p.intent_total, p.checks, p.verdict], [1482, 176, null, 0, null], "не засчитан и не «обычно»");
  assert.match(String(p.last_error), /мобильная вёрстка/);
  await run(db, fakeWeb({ [reelUrl(m.code)]: desktop }), { phase: "measure", now: () => at + DAY });
  const after = tables.assortment_social_post[0];
  assert.deepEqual([after.checks, after.intent_count, after.intent_total, after.verdict, after.verdict_preliminary], [1, 5, 5, "viral", false], "второй залёт jpnbrands — по Б");
  // Первый ответ мобильный, повтор — десктопный: замер засчитан сразу.
  let n = 0;
  const flip = fakeDb({ tables: { assortment_social_account: accounts(), assortment_social_post: [row()] } });
  await run(flip.db, fakeWeb({ [reelUrl(m.code)]: () => (n++ === 0 ? mobile : desktop) }), { phase: "measure", now: () => at });
  assert.deepEqual([flip.tables.assortment_social_post[0].checks, flip.tables.assortment_social_post[0].verdict], [1, "viral"]);
});

test("Блок счётчиков не распознан: замер не засчитан, причина в рилсе, при массовом сбое — тревога и «ошибка» в журнале", async () => {
  const codes = [0, 1, 2].map((i) => codeAt(NOW - 5 * DAY, 40 + i));
  const pages = Object.fromEntries(codes.map((code) => [reelUrl(code), reelPage({ code, author: "x.blog", likes: 3700, comments: 59 }).replace("\n\nLike\n\n3700\n\n", "\n\nLike\n\n3,700 likes\n\n")])) as Record<string, Page>;
  const { db, tables } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: codes.map((code) => post(code, { published_at: iso(NOW - 5 * DAY) })) } });
  const out = await run(db, fakeWeb(pages), { phase: "measure" });
  assert.deepEqual([out.measured, out.layoutFailures], [0, 3]);
  for (const p of tables.assortment_social_post) {
    assert.deepEqual([p.checks, p.likes, p.last_checked_at], [0, null, null], "три слота замера не съедены");
    assert.match(String(p.last_error), /не распознан блок счётчиков/);
  }
  assert.match(out.alarms.join(" "), /не распознан блок счётчиков/);
  assert.equal(socialRunLog(out).status, "error");
});

test("Десктоп без тел комментариев при ≥ 30 комментариях: замер засчитан, намерение «не измерено» (Б — не «нет»); массово — тревога", async () => {
  const codes = [0, 1, 2].map((i) => codeAt(NOW - 5 * DAY, 60 + i));
  const pages = Object.fromEntries(codes.map((code) => [reelUrl(code), reelPage({ code, author: "by.annamirabelle", likes: 300, comments: 120 })])) as Record<string, Page>;
  const accounts = seedsWithBaseline({ "by.annamirabelle": { likes: 83.5, comments: 8, posts: 6 } });
  const { db, tables } = fakeDb({ tables: { assortment_social_account: accounts, assortment_social_post: codes.map((code) => post(code, { published_at: iso(NOW - 5 * DAY), account_handle: "by.annamirabelle" })) } });
  const out = await run(db, fakeWeb(pages), { phase: "measure" });
  assert.deepEqual([out.measured, out.intentUnmeasured], [3, 3]);
  for (const p of tables.assortment_social_post) {
    assert.deepEqual([p.checks, p.intent_total, p.verdict], [1, null, null], "120 комментариев без тел — не «обычно»");
    assert.match(String(p.last_error), /тела комментариев не распознаны/);
  }
  assert.match(out.alarms.join(" "), /не распознаны тела комментариев/);
});

test("Сводка — по неделе первого «залёта»: рилс «обычно» на первом замере и «залетает» на замере 7-го дня попадает в сводку второй недели; отметка переживает обрезку истории", () => {
  const account = { ...allSeeds()[0], handle: "a.blog", likes_median: 300, comments_median: 4, baseline_posts: 9, baseline_at: "2026-10-02T00:00:00.000Z" } as unknown as AccountRow;
  const published = Date.parse("2026-09-30T10:00:00Z");
  const page = (likes: number) => ({ ...parseReelPage(reelPage({ code: "Dd4Is8To7B0", author: "a.blog", likes, comments: 6, caption: "Zara jacket", commentTexts: ["nice"] }))!, publishedAt: iso(published) });
  let p = { ...post("Dd4Is8To7B0", { published_at: iso(published), account_handle: "a.blog", brand: "zara", direction: "jackets" }) } as unknown as PostRow;
  const first = Date.parse("2026-10-03T06:20:00Z");
  p = judgePost(applyMeasurement(p, page(400), first), account, first);
  assert.equal(p.verdict, "normal");
  const seventh = Date.parse("2026-10-10T06:20:00Z");
  p = judgePost(applyMeasurement(p, page(9000), seventh), account, seventh);
  assert.equal(p.verdict, "viral");
  const week1 = [Date.parse("2026-09-28T00:00:00Z"), Date.parse("2026-10-05T00:00:00Z")] as const;
  const week2 = [week1[1], Date.parse("2026-10-12T00:00:00Z")] as const;
  const digestPost = { ...p, first_seen_at: p.first_seen_at, hidden_at: null };
  assert.equal(pickSocialDigest([digestPost], week1[0], week1[1], new Set()).items.length, 0);
  assert.deepEqual(pickSocialDigest([digestPost], week2[0], week2[1], new Set()).items.map((i) => i.url), [p.url]);
  // Тот же вердикт назавтра — отметка не переезжает.
  const later = judgePost(p, account, seventh + DAY);
  assert.equal(later.history, p.history);
  let history = p.history;
  for (let i = 0; i < 15; i += 1) history = pushHistory(history, { at: iso(seventh + (i + 1) * 3600_000), likes: 9000 + i, comments: 6, views: null });
  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(history.filter((h) => h.verdict === "viral").length, 1, "отметку первого «залёта» не выбрасываем");
  assert.deepEqual(pickSocialDigest([{ ...digestPost, history }], week2[0], week2[1], new Set()).items.length, 1);
});

test("Раздел — по модели каталога и по названию карточки бренда, а не по хэштегу подписи («#baggyjeans» куртку в «Сумки» не уводит)", async () => {
  const base = { published_at: iso(NOW - 5 * DAY), account_handle: "by.annamirabelle", likes: 9000, comments: 10, intent_count: 0, intent_total: 4, checks: 1, verdict: "viral", brand: "zara", direction: "bags", last_checked_at: iso(NOW - DAY) } as const;
  const posts = [post("DdCAT000000", { ...base, refs: ["zara:5854722"] }), post("DdSITE00000", { ...base, brand: "uniqlo", refs: ["uniqlo:487882"] })];
  const { db, tables } = fakeDb({ tables: { assortment_social_account: seedsWithBaseline({ "by.annamirabelle": { likes: 83.5, comments: 8, posts: 6 } }), assortment_social_post: posts, assortment_source_items: [zaraCatalogRow] } });
  await run(db, fakeWeb({ [uniqloCardUrls("487882")[0]]: fixture("uniqlo-card-E487882.md") }), { phase: "match" });
  const by = (code: string) => tables.assortment_social_post.find((r) => r.code === code)!;
  assert.deepEqual([by("DdCAT000000").match_status, by("DdCAT000000").direction], ["catalog", "jackets"]);
  assert.deepEqual([by("DdSITE00000").match_status, by("DdSITE00000").direction], ["brand_site", "jackets"]);
  assert.deepEqual((await loadViralReels(db, { direction: "bags", nowMs: NOW }))!.cards.map((c) => c.code), []);
  assert.deepEqual((await loadViralReels(db, { direction: "jackets", nowMs: NOW }))!.cards.map((c) => c.code).sort(), ["DdCAT000000", "DdSITE00000"]);
});

test("Хэштеги с деньгами не пишутся в базу и не отдаются лентой", async () => {
  const c = { code: "Dd4Is8To7B0", kind: "reel" as const, author: "a.blog", caption: "Куртка Zara 5854/722/710 #цена4990руб #4990тг", hashtags: ["цена4990руб", "4990тг", "zarajacket"], views: 1000, via: "topic" as const, topic: "zara-jacket", brandHint: "zara" as const };
  const fresh = mergeCandidate(undefined, c, NOW);
  assert.deepEqual(fresh.hashtags, ["zarajacket"]);
  assert.equal(fresh.caption_excerpt, "Куртка Zara 5854/722/710");
  assert.deepEqual(fresh.refs, ["zara:5854722"]);
  const merged = mergeCandidate({ ...fresh, hashtags: ["usd70", "zarajacket"] }, c, NOW);
  assert.deepEqual(merged.hashtags, ["zarajacket"]);
});

// --- Ф2: общий потолок движка ---

test("Ф2, общий потолок: рилсы отказывают первыми — при $25 из $30 (резерв под каталоги не выбран) ни одного запроса, причина названа; недельный потолок рилсов один — строка соцсетей ASSORTMENT_SOCIAL_WEEKLY_USD", async () => {
  const posts = Array.from({ length: 4 }, (_, i) => post(`DdENG${String(i).padStart(6, "0")}`, { published_at: iso(NOW - 5 * DAY) }));
  const usage = [
    { day: "2026-10-06", kind: "catalog_attributes", calls: 3000, failed_calls: 0, cost_usd: 23, updated_at: iso(NOW - DAY) },
    { day: "2026-10-05", kind: SOCIAL_USAGE_KIND, calls: 1000, failed_calls: 0, cost_usd: 1.5, updated_at: iso(NOW - DAY) },
    { day: "2026-10-05", kind: "brightdata:asos", calls: 330, failed_calls: 0, cost_usd: 0.5, updated_at: iso(NOW - DAY) },
  ];
  const { db } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: posts, assortment_ai_usage: usage } });
  const web = fakeWeb(Object.fromEntries(posts.map((p) => [p.url as string, reelPage({ code: p.code as string, author: "x.blog", likes: 10, comments: 1 })])));
  const out = await run(db, web, { phase: "measure", engine: { weeklyUsd: 30, socialWeeklyUsd: 3 } });
  assert.equal(web.calls.length, 0, "ни одного платного запроса");
  assert.deepEqual([out.allowed, out.capBy, out.stoppedBy], [0, "engine", "budget"]);
  assert.match(String(out.stopMessage), /общий потолок движка.*соцсети отказывают первыми, каталоги Zara и Uniqlo в приоритете/);
  assert.equal(socialRunLog(out).status, "partial", "упёрлись в потолок — не поломка");

  // Строка соцсетей $2 при потраченных $1,5 — ещё 333 запроса; прогон (1 000) и общий потолок шире: действует строка.
  const roomy = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: [], assortment_ai_usage: [usage[1]] } });
  const probe = await run(roomy.db, fakeWeb({}), { dryRun: true, config: cfg({ maxRequestsPerRun: 1000 }), engine: { weeklyUsd: 30, socialWeeklyUsd: 2 } });
  assert.deepEqual([probe.allowed, probe.capBy], [333, "social_line"]);
  // По умолчанию строка $3 — и она действует (раньше её перекрывал потолок 1 500 запросов ≈ $2,25, и $3 не значили ничего): ещё 1 000 запросов.
  const byDefault = await run(roomy.db, fakeWeb({}), { dryRun: true, config: cfg({ maxRequestsPerRun: 5000 }), engine: engineBudgetConfig({}) });
  assert.deepEqual([byDefault.allowed, byDefault.capBy], [1000, "social_line"]);
  // Владелец поднял строку до $6 — разрешено больше; второго потолка, который бы это съел, нет.
  const raised = await run(roomy.db, fakeWeb({}), { dryRun: true, config: cfg({ maxRequestsPerRun: 5000 }), engine: engineBudgetConfig({ ASSORTMENT_SOCIAL_WEEKLY_USD: "6" }) });
  assert.deepEqual([raised.allowed, raised.capBy], [3000, "social_line"]);
  // Явный потолок запросов недели строже строки — он, сведённый в ту же строку ($1,8 = 1 200 запросов, потрачено 1 000).
  const explicit = await run(roomy.db, fakeWeb({}), { dryRun: true, config: cfg({ maxRequestsPerRun: 5000 }), engine: engineBudgetConfig({ ASSORTMENT_SOCIAL_WEEKLY_REQUESTS: "1200" }) });
  assert.deepEqual([explicit.allowed, explicit.capBy], [200, "social_line"]);
  assert.equal(cfg().weeklyRequests, 2000, "справочно: строка $3 — 2 000 запросов в неделю");
});

test("Ф2, «нет денег» у рилсов: в журнале — метка [stop:billing] в конце строки (по ней сторож задач шлёт одну тревогу на Bright Data), на вкладке метки нет", async () => {
  const posts = [post("DdPAYX000000", { published_at: iso(NOW - 5 * DAY) })];
  const { db } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: posts } });
  const web = fakeWeb({ [posts[0].url as string]: new UnlockerStopError("Bright Data: аккаунт не активен или нет средств (402)", "billing") });
  const out = await run(db, web, { phase: "measure", parallel: 1 });
  const log = socialRunLog(out);
  assert.equal(log.status, "error");
  assert.match(String(log.note), /нет средств \(402\) \[stop:billing\]$/);
  const { loadSocialRunStatus } = await import("../lib/assortment/socialFeedStore.ts");
  const syncLog = { from: () => { const q: Record<string, unknown> = { select: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve({ data: [{ status: "error", error: log.note, started_at: iso(NOW) }], error: null }) }; return q; } } as never;
  const status = await loadSocialRunStatus(syncLog, NOW);
  assert.equal(status.lastNote, "Bright Data: аккаунт не активен или нет средств (402)");
});

// --- 07.10: первый живой прогон упёрся во время (поиск занял всё окно, замер почти не шёл) ---

/** Часы идут вперёд на каждый запрос: страница через Web Unlocker «занимает» stepMs. Запоминаем, на какой секунде прогона ушёл запрос. */
function tickingWeb(pages: Record<string, Page>, stepMs: number) {
  let t = NOW;
  const base = fakeWeb(pages);
  const calls: Array<{ url: string; at: number }> = [];
  return {
    now: () => t,
    calls,
    fetchPage: async (url: string, format: UnlockerFormat): Promise<UnlockerResult> => {
      calls.push({ url, at: t - NOW });
      t += stepMs;
      return base.fetchPage(url, format);
    },
  };
}

test("Время прогона делится: есть что мерить — поиск не начинает новых запросов после половины окна, замер идёт во второй половине; мерить нечего — поиск берёт всё окно", async () => {
  const cand = codeAt(NOW - 4 * DAY, 7);
  const pages: Record<string, Page> = { [reelUrl(cand)]: reelPage({ code: cand, author: "by.annamirabelle", likes: 100, comments: 2 }) };
  for (const t of SEED_TOPICS) pages[topicUrl(t.slug)] = emptyTopic(t.slug);
  const window = 180_000;
  const { db, tables } = fakeDb({ tables: { assortment_social_account: quietSeeds(), assortment_social_post: [post(cand, { published_at: iso(NOW - 4 * DAY), account_handle: "by.annamirabelle" })] } });
  const web = tickingWeb(pages, 10_000);
  const out = await run(db, web, { now: web.now, deadlineMs: NOW + window, parallel: 1 });
  assert.equal(out.searchShare, 0.5);
  const search = web.calls.filter((c) => !c.url.includes("/reel/"));
  assert.equal(search.length, 9, "поиску — 90 с по 10 с на страницу");
  assert.ok(search.every((c) => c.at < window / 2), `поиск — только в первой половине: ${search.map((c) => c.at / 1000).join(", ")}`);
  assert.ok(web.calls.some((c) => c.url === reelUrl(cand) && c.at >= window / 2), "замер — во второй половине");
  assert.equal(tables.assortment_social_post.find((r) => r.code === cand)!.checks, 1, "рилс замерен");
  assert.deepEqual([out.discover.yielded, out.discover.complete, out.stoppedBy, out.measured], ["time", false, null, 1]);
  const log = socialRunLog(out);
  assert.equal(log.status, "partial");
  assert.match(String(log.note), /поиск отдал вторую половину времени замеру — продолжим в следующий прогон/);
  assert.equal(stateOf(tables).pending?.topics.length, 9, "пройденное — в незавершённом поиске, следующий прогон продолжит");

  // Мерить нечего — поиску всё окно (до общего дедлайна), как раньше.
  const empty = fakeDb({ tables: { assortment_social_account: quietSeeds() } });
  const solo = tickingWeb(pages, 10_000);
  const all = await run(empty.db, solo, { now: solo.now, deadlineMs: NOW + window, parallel: 1 });
  assert.equal(all.searchShare, null);
  assert.equal(solo.calls.length, 18, "180 с по 10 с — всё окно поиску");
  assert.deepEqual([all.stoppedBy, all.discover.yielded], ["time", null]);
});

test("Параллельно 6 запросов по умолчанию (ASSORTMENT_SOCIAL_CONCURRENCY, предел 8): потолки прогона и недели не пробиваются — счёт до запроса", async () => {
  const mk = () => Array.from({ length: 30 }, (_, i) => post(`DdPAR${String(i).padStart(6, "0")}`, { published_at: iso(NOW - 5 * DAY) }));
  const pages = Object.fromEntries(mk().map((p) => [p.url as string, reelPage({ code: p.code as string, author: "x.blog", likes: 10, comments: 1 })])) as Record<string, Page>;
  const slow = () => {
    const base = fakeWeb(pages);
    const stat = { max: 0, calls: 0, inFlight: 0 };
    return {
      stat,
      fetchPage: async (url: string, format: UnlockerFormat): Promise<UnlockerResult> => {
        stat.calls += 1;
        stat.inFlight += 1;
        stat.max = Math.max(stat.max, stat.inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2 + (stat.calls % 3)));
        stat.inFlight -= 1;
        return base.fetchPage(url, format);
      },
    };
  };
  const runCap = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: mk() } });
  const web = slow();
  const out = await run(runCap.db, web, { phase: "measure", config: cfg({ maxRequestsPerRun: 10 }) });
  assert.equal(out.concurrency, 6);
  assert.equal(web.stat.max, 6, "шесть запросов разом");
  assert.equal(web.stat.calls, 10, "потолок прогона 10 — ровно 10, хотя шесть потоков ждали ответа разом");
  assert.deepEqual([out.requests, out.stoppedBy, out.capBy], [10, "budget", "run"]);
  assert.equal(runCap.tables.assortment_ai_usage.find((u) => u.kind === SOCIAL_USAGE_KIND)?.calls, 10);
  // Строка недели: остаток 7 запросов ($0,0105) — ровно 7 при шести потоках.
  const weekCap = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: mk() } });
  const web7 = slow();
  const out7 = await run(weekCap.db, web7, { phase: "measure", engine: { weeklyUsd: 30, socialWeeklyUsd: 0.0105 } });
  assert.deepEqual([out7.allowed, out7.capBy, web7.stat.calls, out7.stoppedBy], [7, "social_line", 7, "budget"]);
  // Настройка выше предела — 8.
  const wide = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: mk() } });
  const web8 = slow();
  const out8 = await run(wide.db, web8, { phase: "measure", config: cfg({ concurrency: 12 }) });
  assert.deepEqual([out8.concurrency, web8.stat.max, web8.stat.calls], [8, 8, 30]);
});

test("Перезамер в прогоне — только рилсам с шансом: обычный рилс после первого замера больше не качаем; с 150 000 просмотров и «залетает» — на 3-й день; первый замер — всем", async () => {
  const pub = NOW - 3.2 * DAY;
  const measured = { published_at: iso(pub), checks: 1, last_checked_at: iso(pub + 2.1 * DAY), account_handle: "x.blog", likes: 120, comments: 3 };
  const quiet = post("DdQUIET0000", { ...measured, views: 9000 });
  const loud = post("DdLOUD00000", { ...measured, views: 150_000 });
  const viral = post("DdVIRAL0000", { ...measured, likes: 600, verdict: "viral" });
  const fresh = post("DdFRESH0000", { published_at: iso(pub), account_handle: "x.blog", views: 50 });
  const accounts = [...allSeeds(), { platform: "instagram", handle: "x.blog", kind: "blogger", origin: "auto", status: "seen", likes_median: 100, comments_median: 3, baseline_posts: 9, baseline_at: iso(NOW - DAY), appearances: 0 }];
  const { db } = fakeDb({ tables: { assortment_social_account: accounts, assortment_social_post: [quiet, loud, viral, fresh] } });
  const pages = Object.fromEntries([quiet, loud, viral, fresh].map((p) => [p.url as string, reelPage({ code: p.code as string, author: "x.blog", likes: 130, comments: 3 })])) as Record<string, Page>;
  const dry = await run(db, fakeWeb(pages), { dryRun: true, phase: "measure" });
  assert.deepEqual([dry.due.measure, dry.due.measureWithChance], [3, 2], "к замеру: первый у свежего и перезамеры у двух с шансом");
  assert.equal(postMeasureDue(quiet as unknown as PostRow, NOW), false);
  assert.equal(postMeasureDue(loud as unknown as PostRow, NOW), true);
  const web = fakeWeb(pages);
  await run(db, web, { phase: "measure" });
  assert.deepEqual([...web.calls].sort(), [fresh.url, loud.url, viral.url].sort());
  // Первый замер — сначала рилсам с шансом: числа с прошлой (не засчитанной, мобильной) попытки весомее просмотров темы.
  const plain = post("DdPLAIN0000", { published_at: iso(pub), account_handle: "x.blog", views: 50 });
  const known = post("DdKNOWN0000", { published_at: iso(pub), account_handle: "x.blog", likes: 2000, comments: 200, views: null });
  const order = fakeDb({ tables: { assortment_social_account: accounts, assortment_social_post: [plain, known] } });
  const one = fakeWeb({ [plain.url as string]: reelPage({ code: "DdPLAIN0000", author: "x.blog", likes: 5, comments: 0 }), [known.url as string]: reelPage({ code: "DdKNOWN0000", author: "x.blog", likes: 2100, comments: 210 }) });
  await run(order.db, one, { phase: "measure", config: cfg({ maxRequestsPerRun: 1 }) });
  assert.deepEqual(one.calls, [known.url], "потолок в один запрос — его получает рилс с шансом");
});

test("Google «запрос недавно не удался» (failed_query_rejected): не сбой страницы и без повтора в этом прогоне; запрос и тема остаются в незавершённом поиске и повторяются следующим прогоном", async () => {
  const rejected: UnlockerResult = { ok: false, kind: "transient", reason: "отложено Bright Data: failed_query_rejected (This query recently failed and cannot be attempted at this time)", ms: 0, deferred: true };
  const googleUrl = (template: string, at = NOW) => googleSearchUrl(googleQuery(template, at));
  const key = GOOGLE_QUERIES.zara[1];
  const pages = (deferGoogle: boolean, deferTopic: boolean): Record<string, Page> => {
    const out: Record<string, Page> = {};
    for (const t of SEED_TOPICS) out[topicUrl(t.slug)] = emptyTopic(t.slug);
    out[topicUrl("zara-viral-jacket")] = deferTopic ? rejected : fixture("topic-zara-viral-jacket.md");
    for (const brand of ["zara", "uniqlo"] as const) for (const template of GOOGLE_QUERIES[brand]) out[googleUrl(template)] = fixture("google-reel-zara-ref.json");
    if (deferGoogle) out[googleUrl(key)] = rejected;
    return out;
  };
  const { db, tables } = fakeDb({ tables: { assortment_social_account: quietSeeds() } });
  const first = fakeWeb(pages(true, true));
  const out = await run(db, first, { phase: "discover" });
  assert.equal(first.calls.filter((u) => u === googleUrl(key)).length, 1, "в этом прогоне не повторяем — повтор получил бы тот же отказ");
  assert.equal(first.calls.filter((u) => u === topicUrl("zara-viral-jacket")).length, 1);
  assert.deepEqual([out.deferredRequests, out.failedRequests, out.discover.deferred, out.discover.complete], [2, 0, 2, false]);
  const log = socialRunLog(out);
  assert.equal(log.status, "partial", "не тревога");
  assert.doesNotMatch(String(log.note), /сбоев страниц|failed_query_rejected/, "в «сбоях страниц» и в списке ошибок его нет");
  assert.match(String(log.note), /отложено Bright Data до следующего прогона: 2/);
  const usage = tables.assortment_ai_usage.find((u) => u.kind === SOCIAL_USAGE_KIND)!;
  assert.deepEqual([usage.calls, usage.failed_calls], [first.calls.length, 2], "в учёте — как неудачный запрос");
  const pending = stateOf(tables).pending!;
  assert.ok(!pending.google.includes(`zara:${key}`) && !pending.topics.includes("zara-viral-jacket"), "не пройдены");
  assert.deepEqual(pending.deferred, { [`zara:${key}`]: 1, "topic:zara-viral-jacket": 1 });

  // Следующий прогон (через 3 часа): повторяются только отложенные — и проходят.
  const second = fakeWeb(pages(false, false));
  const out2 = await run(db, second, { phase: "discover", now: () => NOW + 3 * HOUR });
  assert.deepEqual([...second.calls].sort(), [googleUrl(key, NOW + 3 * HOUR), topicUrl("zara-viral-jacket")].sort());
  assert.deepEqual([out2.discover.complete, stateOf(tables).pending], [true, null]);

  // Откладывает DEFER_MAX_RUNS прогонов подряд — пропускаем до следующего поиска, поиск не стоит на одном запросе.
  assert.equal(DEFER_MAX_RUNS, 3);
  const stuck = fakeDb({ tables: { assortment_social_account: quietSeeds() } });
  const outs = [];
  for (let i = 0; i < DEFER_MAX_RUNS; i += 1) outs.push(await run(stuck.db, fakeWeb(pages(true, false)), { phase: "discover", now: () => NOW + i * 3 * HOUR }));
  assert.deepEqual(outs.map((o) => o.discover.complete), [false, false, true]);
  assert.match(outs[2].errors.join(" "), /откладывает запрос 3 прогона подряд — пропускаем до следующего поиска/);
});

test("Замок: два прогона разом не идут — второй «прогон уже идёт» без запросов; прогон, начатый до полуночи по Москве, держит вчерашнюю строку", async () => {
  const p = post("DdLOCK00000", { published_at: iso(NOW - 5 * DAY) });
  const pages = { [p.url as string]: reelPage({ code: "DdLOCK00000", author: "x.blog", likes: 10, comments: 1 }) };
  const { db } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: [p] } });
  const web = fakeWeb(pages);
  const both = await Promise.all([run(db, web, { phase: "measure" }), run(db, web, { phase: "measure" })]);
  assert.deepEqual(both.map((o) => o.skippedBecause).sort(), ["busy", null]);
  assert.equal(web.calls.length, 1, "запросы — только у одного прогона");
  // 00:01 по Москве 07.10: прогон, начатый в 23:59 06.10, держит строку 06.10 — новый ждёт.
  const midnight = Date.parse("2026-10-06T21:01:00Z");
  const lock = (ago: number) => ({ day: "2026-10-06", kind: `lock:${SOCIAL_USAGE_KIND}`, updated_at: iso(midnight - ago) });
  const held = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_ai_usage: [lock(2 * 60_000)] } });
  assert.equal((await run(held.db, fakeWeb({}), { phase: "measure", now: () => midnight })).skippedBecause, "busy");
  const expired = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_ai_usage: [lock(7 * 60_000)] } });
  assert.equal((await run(expired.db, fakeWeb({}), { phase: "measure", now: () => midnight })).skippedBecause, null, "замок старше 6 минут — истёк");
});

test("Неделя выбрана (строка соцсетей): поиск стоит не по своей вине — такие прогоны в серию «не завершён» не идут, тревоги нет", async () => {
  const pages: Record<string, Page> = {};
  for (const t of SEED_TOPICS) pages[topicUrl(t.slug)] = emptyTopic(t.slug);
  const usage = [{ day: "2026-10-05", kind: SOCIAL_USAGE_KIND, calls: 2000, failed_calls: 0, cost_usd: 3, updated_at: iso(NOW - DAY) }];
  const { db, tables } = fakeDb({ tables: { assortment_social_account: quietSeeds(), assortment_ai_usage: usage } });
  const runs = [];
  for (let i = 0; i < DISCOVER_STALL_RUNS + 2; i += 1) runs.push(await run(db, fakeWeb(pages), { now: () => NOW + i * 3 * HOUR, engine: { weeklyUsd: 30, socialWeeklyUsd: 3 } }));
  assert.ok(runs.every((r) => r.discover.ran && r.stoppedBy === "budget" && r.capBy === "social_line" && r.requests === 0));
  assert.ok(runs.every((r) => r.alarms.length === 0 && socialRunLog(r).status === "partial"), "потолок — не поломка");
  assert.equal(stateOf(tables).pending?.runs, 0);
});

test("Профиль, отложенный Bright Data (failed_query_rejected): не сбой и не ошибка аккаунта — срок прежний, следующим прогоном профиль запрашивается снова", async () => {
  const rejected: UnlockerResult = { ok: false, kind: "transient", reason: "отложено Bright Data: failed_query_rejected", ms: 0, deferred: true };
  const accounts = [...quietSeeds(), { platform: "instagram", handle: "late.blog", kind: "unknown", origin: "auto", status: "watched", appearances: 2, last_checked_at: null, last_error: null }];
  const state = { social: { discoveredAt: iso(NOW - DAY), autoTopics: [], deadTopics: {} } };
  const { db, tables } = fakeDb({ tables: { assortment_social_account: accounts, assortment_sources: [{ source_id: "S068", capabilities: state }] } });
  const out = await run(db, fakeWeb({ [profileUrl("late.blog")]: rejected }), {});
  assert.deepEqual([out.deferredRequests, out.failedRequests, out.errors.length], [1, 0, 0]);
  const acc = tables.assortment_social_account.find((a) => a.handle === "late.blog")!;
  assert.deepEqual([acc.last_checked_at, acc.last_error], [null, null]);
  const next = fakeWeb({ [profileUrl("late.blog")]: fixture("profile-jpnbrands.md") });
  await run(db, next, { now: () => NOW + 3 * HOUR });
  assert.deepEqual(next.calls, [profileUrl("late.blog")]);
});
