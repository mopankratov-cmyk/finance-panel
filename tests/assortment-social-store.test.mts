import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { googleSearchUrl, UnlockerStopError, type UnlockerFormat, type UnlockerResult } from "../lib/assortment/brightdataUnlocker.ts";
import { GOOGLE_QUERIES, googleQuery, profileUrl, SEED_ACCOUNTS, SEED_TOPICS, socialConfig, topicUrl, uniqloCardUrls, type SocialConfig } from "../lib/assortment/socialReels.ts";
import {
  countAppearances, loadPosts, loadViralReels, matchDue, mergeCandidate, nextAccountStatus, readSocialState, runSocialReels, SOCIAL_USAGE_KIND, type PostRow, type RunSocialOptions,
} from "../lib/assortment/socialReelsStore.ts";

/**
 * Прогон «Залетает» на подставной базе и подставном Bright Data: подставка применяет фильтры, режет страницу на 1 000 строк и
 * сверяет записываемые колонки с миграцией (опечатка в имени колонки — ошибка, как у PostgREST).
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = join(root, "tests/fixtures/assortment-social");
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8");
const MIGRATION = "supabase/migrations/202610060006_assortment_social_reels.sql";
const sql = readFileSync(join(root, MIGRATION), "utf8");
const NOW = Date.parse("2026-10-06T16:00:00Z");
const DAY = 24 * 3600 * 1000;
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

// --- без миграции, без ключа, выключено ---

test("Без миграции: прогон тихо выходит с причиной и не тратит ни одного запроса; лента — null (вкладку прячем)", async () => {
  const { db } = fakeDb({ missing: ["assortment_social_post", "assortment_social_account"] });
  const web = fakeWeb({});
  const out = await run(db, web);
  assert.equal(out.skippedBecause, "no_schema");
  assert.match(String(out.skipped), /202610060006_assortment_social_reels\.sql/);
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
  const p = post("DdVk7eRtLMC", { published_at: "2026-09-16T05:51:52.572Z", account_handle: "jpnbrands", likes: 6400, comments: 176, checks: 1, verdict: "strong", refs: ["uniqlo:487882"], brand: "uniqlo", direction: "jackets" });
  const { db, tables } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: [p] } });
  const web = fakeWeb({ [uniqloCardUrls("487882")[0]]: fixture("uniqlo-card-E487882.md") });
  const out = await run(db, web, { phase: "match" });
  assert.equal(out.matched.brand_site, 1);
  assert.deepEqual(web.calls, [uniqloCardUrls("487882")[0]]);
  const row = tables.assortment_social_post[0];
  assert.deepEqual([row.match_status, row.match_title, row.match_gender, row.match_url], ["brand_site", "Hybrid Down Short Jacket", "women", "https://www.uniqlo.com/es/en/products/E487882-000/00"]);
  assert.match(String(row.match_image), /^https:\/\/image\.uniqlo\.com\//);
});

test("Привязка: мужская карточка — «men» и в ленте нет; ES не открылась — пробуем UK; временный сбой — «pending»; без номера — «no_ref» без запроса", async () => {
  const base = { published_at: iso(NOW - 5 * DAY), account_handle: "uniqlousa", likes: 9000, comments: 40, checks: 1, verdict: "viral", brand: "uniqlo", direction: "jackets" } as const;
  const men = fixture("uniqlo-card-E487882.md").replace("Women's Hybrid", "Men's Hybrid").replace(/\n(\s*)WOMEN\n/, "\n$1MEN\n");
  const posts = [
    post("DdMEN111111", { ...base, refs: ["uniqlo:487882"] }),
    post("DdUK2222222", { ...base, refs: ["uniqlo:412345"] }),
    post("DdTMP333333", { ...base, refs: ["uniqlo:499999"] }),
    post("DdNOREF4444", { ...base, refs: [] }),
  ];
  const [es, uk] = uniqloCardUrls("412345");
  const { db, tables } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: posts } });
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

test("Потолок недели: в учёте за 7 дней 1 498 из 1 500 — за прогон не больше 2 запросов", async () => {
  const posts = Array.from({ length: 5 }, (_, i) => post(`DdWEK${String(i).padStart(6, "0")}`, { published_at: iso(NOW - 5 * DAY) }));
  const usage = [{ day: "2026-10-01", kind: SOCIAL_USAGE_KIND, calls: 1000, failed_calls: 0, cost_usd: 1.5, updated_at: iso(NOW - 5 * DAY) }, { day: "2026-10-05", kind: SOCIAL_USAGE_KIND, calls: 498, failed_calls: 0, cost_usd: 0.747, updated_at: iso(NOW - DAY) }, { day: "2026-09-20", kind: SOCIAL_USAGE_KIND, calls: 5000, failed_calls: 0, cost_usd: 7.5, updated_at: iso(NOW - 16 * DAY) }];
  const { db } = fakeDb({ tables: { assortment_social_account: allSeeds(), assortment_social_post: posts, assortment_ai_usage: usage } });
  const web = fakeWeb(Object.fromEntries(posts.map((p) => [p.url as string, reelPage({ code: p.code as string, author: "x.blog", likes: 10, comments: 1 })])));
  const out = await run(db, web, { phase: "measure" });
  assert.equal(out.weekRequestsBefore, 1498, "запросы 16-дневной давности в неделю не входят");
  assert.equal(out.allowed, 2);
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
    [topicUrl("zara-jackets")]: " Instagram \n\n# Zara Jackets\n",
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
  assert.ok(state.deadTopics.includes("zara-jackets"), "пустая тема — в мёртвые");
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

test("Крон: GET, checkCronAuth, журнал под именем сторожа, ежедневно 06:20 UTC; путь не под assortment-brightdata", () => {
  const route = readFileSync(join(root, "app/api/sync/assortment-social/route.ts"), "utf8");
  assert.match(route, /export async function GET\(request: NextRequest\)/);
  assert.match(route, /const authError = await checkCronAuth\(request\);\s*if \(authError\) return authError;/);
  assert.match(route, /export const maxDuration = 300;/);
  assert.match(route, /export const dynamic = "force-dynamic";/);
  assert.match(route, /const JOB = "assortment-social";/);
  assert.match(route, /writeSyncLog\(JOB/);
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons.filter((c) => c.path.startsWith("/api/sync/assortment-social")), [{ path: "/api/sync/assortment-social", schedule: "20 6 * * *" }]);
  const store = readFileSync(join(root, "lib/assortment/socialReelsStore.ts"), "utf8");
  assert.doesNotMatch(store, /\.limit\(/, "чтение — листанием, не .limit()");
});
