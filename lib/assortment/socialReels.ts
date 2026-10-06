import type { AssortmentDirection } from "./constants";

/**
 * «Залетает в соцсетях» (решение владельца 06.10.2026): рилсы Instagram про Zara и Uniqlo, только женское. Чистые функции без базы
 * и сети: разбор страниц, которые отдаёт Web Unlocker (markdown), номера товаров из подписи, доля комментариев «купить» и правило
 * «залетает». Правило откалибровано на трёх примерах владельца и ~30 обычных постах тех же авторов (scratchpad/reels-probe.json, cal).
 *
 * Людей не храним: ники комментаторов разбор использует только в памяти (свой ответ автора — не спрос), наружу отдаёт тексты
 * комментариев без ников, а в базу уходят только счётчики. Цены из подписей вырезаются до записи (`sanitizeCaption`).
 */

export const SOCIAL_PLATFORM = "instagram";
/** Версия правила: при смене порогов старые вердикты остаются с прежней версией, а не выдаются за новые. */
export const REELS_RULE_VERSION = "reels-v1";

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Окно суждения: моложе 48 ч рано (283 лайка через 9 ч — ещё ничего не значат), старше 21 дня — поздно. */
export const MIN_AGE_MS = 48 * HOUR_MS;
export const MAX_AGE_DAYS = 21;
/** (А) лайки ≥ 10× медианы автора и ≥ 1 000. */
export const LIKES_MULTIPLIER = 10;
export const LIKES_MIN = 1000;
/** (Б) комментарии ≥ 5× медианы, ≥ 30 и ≥ 50% видимых — с намерением купить. */
export const COMMENTS_MULTIPLIER = 5;
export const COMMENTS_MIN = 30;
export const INTENT_MIN_SHARE = 0.5;
/** База автора — последние 12 постов по дате; меньше 6 с видимыми лайками — запасное правило с пометкой «предварительно». */
export const BASELINE_POSTS = 12;
export const MIN_BASELINE_LIKE_POSTS = 6;
/** Запасное (А): лайки ≥ 20% подписчиков или ≥ 5 000. */
export const FALLBACK_FOLLOWER_SHARE = 0.2;
export const FALLBACK_LIKES_MIN = 5000;
/** Страницы прошлых постов автора скачиваем только ради кандидатов, у которых есть шанс: лайки, комментарии или просмотры. */
export const PREFILTER = { likes: 1000, comments: 30, views: 100_000 } as const;
/** Замеры: первый, затем на 3-й и на 7-й день; не больше трёх. */
export const RECHECK_AGES_DAYS = [3, 7] as const;
export const MAX_CHECKS = 3;
export const HISTORY_LIMIT = 10;
export const CAPTION_EXCERPT_MAX = 500;
/** Оценка Bright Data: $1,5 за 1 000 запросов Web Unlocker. */
export const COST_PER_REQUEST_USD = 0.0015;

export type SocialBrand = "zara" | "uniqlo";
export type SocialVerdict = "strong" | "viral" | "normal" | "too_fresh" | "too_old";
export type AccountKind = "stylist" | "buyer" | "reseller" | "brand" | "blogger" | "unknown";

// ---------------------------------------------------------------------------
// Настройки

export interface SocialConfig {
  enabled: boolean;
  /** Потолок запросов за один прогон крона. */
  maxRequestsPerRun: number;
  /** Потолок запросов за 7 дней (по умолчанию 1 500 ≈ $2,25). */
  weeklyRequests: number;
  /** Сколько авторов за прогон досчитываем базой (их прошлые посты — до 12 запросов на автора). */
  maxBaselineAuthorsPerRun: number;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function socialConfig(env: Record<string, string | undefined> = process.env): SocialConfig {
  return {
    enabled: (env.ASSORTMENT_SOCIAL ?? "").trim().toLowerCase() !== "off",
    maxRequestsPerRun: positiveInt(env.ASSORTMENT_SOCIAL_MAX_REQUESTS_PER_RUN, 150),
    weeklyRequests: positiveInt(env.ASSORTMENT_SOCIAL_WEEKLY_REQUESTS, 1500),
    maxBaselineAuthorsPerRun: positiveInt(env.ASSORTMENT_SOCIAL_BASELINE_AUTHORS, 4),
  };
}

// ---------------------------------------------------------------------------
// Дата из кода рилса и числа со страницы

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** Эпоха Instagram, 2011-08-24T21:07:01.721Z. */
const IG_EPOCH_MS = 1314220021721;

/**
 * Время публикации из кода рилса (расчёт): код — media id в base64 Instagram, старшие биты — миллисекунды от эпохи. Последние три
 * символа (18 бит) — шард и счётчик, их отбрасываем целиком: остаётся ≤ 48 бит, точно в Number. Сверено на 42 парах «код ↔ дата».
 * Длиннее 11 символов (закрытые аккаунты) не декодируем.
 */
export function shortcodeToDate(code: string): Date | null {
  if (!/^[A-Za-z0-9_-]{4,11}$/.test(code)) return null;
  let n = 0;
  for (const ch of code.slice(0, -3)) n = n * 64 + ALPHABET.indexOf(ch);
  const ms = Math.floor(n / 32) + IG_EPOCH_MS;
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** «3.7K», «1,482», «1.1M», «3 700», «4,112», «57.6K» → число; непонятное — null (не 0). */
export function parseCount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[\s\u00a0\u202f\u2009]/g, "");
  const m = /^(\d+(?:[.,]\d+)*)(k|m|b|тыс\.?|млн\.?|млрд\.?)?$/i.exec(s);
  if (!m) return null;
  const suffix = m[2]?.toLowerCase().replace(/\.$/, "") ?? "";
  const mult = suffix === "k" || suffix === "тыс" ? 1e3 : suffix === "m" || suffix === "млн" ? 1e6 : suffix === "b" || suffix === "млрд" ? 1e9 : 1;
  let digits = m[1];
  if (mult > 1) {
    // С буквой разделитель — десятичный: «1,5K» и «1.5K».
    digits = /^\d+[.,]\d+$/.test(digits) ? digits.replace(",", ".") : digits.replace(/[.,]/g, "");
  } else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(digits)) {
    digits = digits.replace(/[.,]/g, "");
  } else if (!/^\d+(?:\.\d+)?$/.test(digits)) {
    return null;
  }
  const value = Number(digits) * mult;
  return Number.isFinite(value) ? Math.round(value) : null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** «September 29, 2026» → «2026-09-29» (дата Instagram по Тихоокеанскому времени, без часа). */
export function parseAltDate(raw: string | null | undefined): string | null {
  const m = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec((raw ?? "").trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function codeTime(code: string): number | null {
  return shortcodeToDate(code)?.getTime() ?? null;
}

// ---------------------------------------------------------------------------
// Markdown

/** Снять экранирование markdown: «buyer\_services\_» → «buyer_services_». */
export function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1");
}

/** Подпись в простой текст: ссылки-хэштеги → «#тег», прочие ссылки → их текст, без хвостовых пробелов строк. */
function plainCaption(raw: string): string {
  return unescapeMarkdown(
    raw
      .replace(/\[(#[^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"),
  )
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const HASHTAG_PLAIN = /(?:^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]{1,60})/gu;

function hashtagsOf(rawCaption: string, plain: string): string[] {
  const out: string[] = [];
  const push = (tag: string) => {
    const t = tag.toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  };
  for (const m of rawCaption.matchAll(/\[#[^\]]*\]\(\/explore\/tags\/([^/)\s]+)\/?\)/g)) {
    try {
      push(decodeURIComponent(m[1]));
    } catch {
      push(m[1]);
    }
  }
  for (const m of plain.matchAll(HASHTAG_PLAIN)) push(m[1]);
  return out;
}

// ---------------------------------------------------------------------------
// Сетка постов (страница рилса «More posts from», профиль)

export interface GridPost {
  code: string;
  kind: "reel" | "post";
  /** Чей пост по адресу: в сетке бывает чужой пост соавтора. */
  owner: string;
  /** Дата из подписи картинки (по Тихоокеанскому времени); точнее — из кода. */
  altDate: string | null;
  publishedAt: string | null;
  /** Закреплён: стоит в начале сетки и старше поста после него. */
  pinned: boolean;
}

const GRID_CLOSE = /\]\(\/([A-Za-z0-9._]+)\/(reel|p)\/([A-Za-z0-9_-]+)\/?\)/g;

function parseGrid(section: string): GridPost[] {
  const posts: GridPost[] = [];
  let last = 0;
  for (const m of section.matchAll(GRID_CLOSE)) {
    const chunk = section.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
    if (!chunk.includes("![")) continue;
    const alt = /!\[(?:Video|Photo) by [\s\S]*? on ([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(chunk);
    const code = m[3];
    if (posts.some((p) => p.code === code)) continue;
    const ms = codeTime(code);
    posts.push({ code, kind: m[2] === "reel" ? "reel" : "post", owner: m[1], altDate: parseAltDate(alt?.[1]), publishedAt: ms == null ? null : new Date(ms).toISOString(), pinned: false });
  }
  return markPinned(posts);
}

/** Закреплённые (до трёх) стоят первыми: пост из первых трёх, у которого дальше по сетке есть пост новее, — закреплён. */
export function markPinned<T extends { code: string; publishedAt: string | null; pinned?: boolean }>(posts: T[]): T[] {
  const times = posts.map((p) => (p.publishedAt ? Date.parse(p.publishedAt) : null));
  return posts.map((p, i) => {
    const t = times[i];
    const pinned = i < 3 && t != null && times.slice(i + 1).some((later) => later != null && later > t);
    return { ...p, pinned };
  });
}

// ---------------------------------------------------------------------------
// Страница рилса или поста

export interface ReelComment {
  text: string;
  /** Ответ самого автора — не спрос. Ник не отдаём. */
  byAuthor: boolean;
}

export interface ParsedReel {
  code: string;
  kind: "reel" | "post";
  layout: "desktop" | "mobile";
  author: string | null;
  coauthors: string[];
  caption: string;
  /** Мобильная вёрстка обрезает подпись на «… more»: полной подписи нет. */
  captionTruncated: boolean;
  hashtags: string[];
  /** null — лайки скрыты автором (не 0). */
  likes: number | null;
  likesHidden: boolean;
  /** null — число не нашлось (мобильная вёрстка без «View all»). */
  comments: number | null;
  visibleComments: ReelComment[];
  distinctCommenters: number;
  /** Подпись картинки Instagram (ИИ-описание кадра): «overcoat, parka, purse». Текст с кадра (OCR) не берём. */
  altItems: string[];
  altDate: string | null;
  publishedAt: string | null;
  otherPosts: GridPost[];
}

const COUNTS_DESKTOP = /\n[ \t]*Like[ \t]*\n+(?:[ \t]*(\d[\d.,]*[ \t]*[KMBkmb]?)[ \t]*\n+)?[ \t]*Comment[ \t]*\n+(?:[ \t]*(\d[\d.,]*[ \t]*[KMBkmb]?)[ \t]*\n+)?[ \t]*Share[ \t]*\n+[ \t]*Save/;
const COMMENT_BLOCK = /\]\(\/([A-Za-z0-9._]+)\/\)[ \t\u00a0]+\[\d+[smhdwy]\]\(\/p\/[A-Za-z0-9_-]+\/c\/\d+\/?\)[ \t]*\n+([\s\S]*?)\n+[ \t]*(?:Like|\d[\d.,]*[KMkm]?[ \t]+likes?)[ \t]*\n+[ \t]*Reply/g;
const CAPTION_HEAD = /\]\(\/([A-Za-z0-9._]+)\/\)[ \t\u00a0]+(?:Edited[ \t\u00a0]*•[ \t\u00a0]*)?\d+[smhdwy][ \t]*\n/g;

function altItemsOf(tail: string): string[] {
  const m = /May be (?:an? [a-z ]+? )?of ([\s\S]+)$/i.exec(tail);
  if (!m) return [];
  const list = m[1].replace(/ and text(?: that says[\s\S]*)?\.?$/i, "").replace(/ that says[\s\S]*$/i, "").replace(/\.$/, "");
  return list.split(/, | and /).map((s) => s.trim()).filter((s) => s && s.length <= 40 && !/^text$/i.test(s));
}

/** Пустая оболочка (рилса нет или закрыт): ни «Never miss a post», ни блока счётчиков. Это «страницы нет», а не «0 лайков». */
export function isEmptyReelShell(md: string): boolean {
  return !/Never miss a post from/.test(md) && !COUNTS_DESKTOP.test(md) && !/\[Save\]\(intent:/.test(md);
}

export function parseReelPage(md: string): ParsedReel | null {
  if (!md || isEmptyReelShell(md)) return null;
  const login = /\/accounts\/login\/\?next=%2F(reel|p)%2F([A-Za-z0-9_-]+)%2F/.exec(md);
  const intent = /intent:\/\/instagram\.com\/reels\/videos\/([A-Za-z0-9_-]+)/.exec(md);
  const code = login?.[2] ?? intent?.[1] ?? null;
  if (!code) return null;
  const kind: "reel" | "post" = login?.[1] === "p" ? "post" : "reel";
  const authorRaw = /Never miss a post from ([^\n]+)/.exec(md)?.[1];
  const author = authorRaw ? unescapeMarkdown(authorRaw).trim() : null;
  const layout: "desktop" | "mobile" = /\[Save\]\(intent:\/\//.test(md) ? "mobile" : "desktop";

  const morePostsAt = md.indexOf("More posts from");
  const body = morePostsAt >= 0 ? md.slice(0, morePostsAt) : md;

  const coauthors: string[] = [];
  const co = /\]\(\/([A-Za-z0-9._]+)\/\)and\[\s*[^\]]*?\s*\]\(\/([A-Za-z0-9._]+)\/\)/.exec(body);
  if (co) for (const h of [co[1], co[2]]) if (h !== author && !coauthors.includes(h)) coauthors.push(h);

  // Подпись картинки самого поста — между «Sign up…» и «More options» (в мобильной вёрстке её нет).
  const signUp = body.indexOf("Sign up for Instagram to stay in the loop.");
  const options = body.indexOf("More options");
  const altRegion = signUp >= 0 && options > signUp ? body.slice(signUp, options) : "";
  const alt = /!\[(?:Video|Photo) by [\s\S]*? on ([A-Z][a-z]+ \d{1,2}, \d{4})\.?([^\]]*)\]\(/.exec(altRegion);

  let likes: number | null = null;
  let likesHidden = false;
  let comments: number | null = null;
  let caption = "";
  let captionRaw = "";
  let captionTruncated = false;
  const visibleComments: ReelComment[] = [];
  const commenters = new Set<string>();

  if (layout === "desktop") {
    const counts = COUNTS_DESKTOP.exec(body);
    if (counts) {
      likes = parseCount(counts[1]);
      likesHidden = counts[1] == null;
      comments = counts[2] == null ? 0 : parseCount(counts[2]);
    }
    const countsAt = counts?.index ?? body.length;
    const sep = body.indexOf("* * *", options >= 0 ? options : 0);
    CAPTION_HEAD.lastIndex = sep >= 0 ? sep : 0;
    const head = CAPTION_HEAD.exec(body);
    const loadMore = body.indexOf("Load more comments");
    if (head && head.index < countsAt && (loadMore < 0 || head.index < loadMore)) {
      const start = head.index + head[0].length;
      const ends = [body.indexOf("\nLoad more comments", start), body.indexOf("\n[![", start), countsAt].filter((i) => i >= start);
      captionRaw = body.slice(start, Math.min(...ends));
    }
    const segment = loadMore >= 0 ? body.slice(loadMore, countsAt) : "";
    for (const m of segment.matchAll(COMMENT_BLOCK)) {
      const text = unescapeMarkdown(m[2]).replace(/\s+/g, " ").trim();
      if (!text) continue;
      commenters.add(m[1]);
      visibleComments.push({ text, byAuthor: author != null && m[1] === author });
    }
  } else {
    const saveAt = body.indexOf("[Save](intent://");
    const after = saveAt >= 0 ? body.slice(saveAt) : body;
    const likesLine = /\n[ \t]*(\d[\d.,]*[ \t]*[KMBkmb]?)[ \t]+likes?[ \t]*\n/.exec(after);
    likes = likesLine ? parseCount(likesLine[1]) : null;
    likesHidden = !likesLine;
    const viewAll = /\[View all (\d[\d.,]*[KMkm]?) comments?\]/.exec(after) ?? /\[View (1) comment\]/.exec(after);
    comments = viewAll ? parseCount(viewAll[1]) : null;
    const cap = /\]\(\/[A-Za-z0-9._]+\/\)[ \t\u00a0]*\n+([\s\S]*?)(?:\n[ \t]*\.\.\.[ \t\u00a0]*\n+[ \t]*more\b|\n\[View |\n\[\d+ \w+ ago\]|$)/.exec(likesLine ? after.slice(likesLine.index + likesLine[0].length) : "");
    if (cap) {
      captionRaw = cap[1].replace(/^#[ \t]+/, "");
      captionTruncated = /\n[ \t]*\.\.\.[ \t\u00a0]*\n+[ \t]*more\b/.test(cap[0]);
    }
  }
  caption = plainCaption(captionRaw);
  // Конец сетки — «See more posts» или подвал; ответ бывает обрезан на середине сетки — тогда до конца текста.
  const gridEnds = [md.indexOf("[See more posts]", morePostsAt), md.indexOf("[Meta](", morePostsAt)].filter((i) => i > morePostsAt);
  const otherSection = morePostsAt >= 0 ? md.slice(morePostsAt, gridEnds.length ? Math.min(...gridEnds) : md.length) : "";
  const ms = codeTime(code);
  return {
    code,
    kind,
    layout,
    author,
    coauthors,
    caption,
    captionTruncated,
    hashtags: hashtagsOf(captionRaw, caption),
    likes,
    likesHidden,
    comments,
    visibleComments,
    distinctCommenters: commenters.size,
    altItems: alt ? altItemsOf(alt[2]) : [],
    altDate: parseAltDate(alt?.[1]),
    publishedAt: ms == null ? null : new Date(ms).toISOString(),
    otherPosts: otherSection ? parseGrid(otherSection) : [],
  };
}

// ---------------------------------------------------------------------------
// Страница темы /popular/<slug>/

export interface TopicCard {
  code: string;
  author: string;
  caption: string;
  hashtags: string[];
  views: number | null;
  verified: boolean;
  publishedAt: string | null;
}

export interface ParsedTopic {
  title: string | null;
  /** Сколько рилсов в теме (оценка Instagram, «4.3K»). */
  total: number | null;
  neighbors: Array<{ slug: string; name: string }>;
  cards: TopicCard[];
}

const TOPIC_CARD_CLOSE = /\]\(\/reel\/([A-Za-z0-9_-]+)\/\?utm_source=popular_topic_grid\)/g;

export function parseTopicPage(md: string): ParsedTopic | null {
  if (!md) return null;
  const head = /^\s*(.+?)\s*•\s*(\d[\d.,]*\s*[KMBkmb]?)\s+reels? on Instagram/m.exec(md);
  if (!head && !md.includes("utm_source=popular_topic_grid")) return null;
  const neighbors: ParsedTopic["neighbors"] = [];
  for (const m of md.matchAll(/##\s*\[([^\]]+)\]\(\/popular\/([^/?\s)]+)\/?\?utm_source=topic_pill\)/g)) {
    let slug = m[2];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      // оставляем как есть
    }
    if (!neighbors.some((n) => n.slug === slug)) neighbors.push({ slug, name: unescapeMarkdown(m[1]).trim() });
  }
  const cards: TopicCard[] = [];
  let last = 0;
  for (const m of md.matchAll(TOPIC_CARD_CLOSE)) {
    const chunk = md.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
    const code = m[1];
    if (cards.some((c) => c.code === code)) continue;
    const avatarAt = chunk.indexOf("[[![");
    const imgAt = chunk.indexOf("![");
    let captionRaw = "";
    if (imgAt >= 0 && avatarAt > imgAt) {
      const altEnd = chunk.lastIndexOf("](", avatarAt);
      if (altEnd > imgAt) captionRaw = chunk.slice(imgAt + 2, altEnd);
    }
    const author = /\]\(\/([A-Za-z0-9._]+)\/?\)\]\(\/([A-Za-z0-9._]+)\/?\)/.exec(chunk)?.[2] ?? /\[[^\]]*\]\(\/([A-Za-z0-9._]+)\)[ \t]*\n/.exec(chunk)?.[1];
    if (!author) continue;
    const views = /views[ \t]*(\d[\d.,]*[ \t]*[KMBkmb]?)/.exec(chunk);
    if (!captionRaw && views) captionRaw = chunk.slice((views.index ?? 0) + views[0].length);
    const caption = plainCaption(captionRaw);
    const ms = codeTime(code);
    cards.push({
      code,
      author,
      caption,
      hashtags: hashtagsOf(captionRaw, caption),
      views: views ? parseCount(views[1]) : null,
      verified: /\n[ \t]*Verified[ \t]*\n/.test(chunk),
      publishedAt: ms == null ? null : new Date(ms).toISOString(),
    });
  }
  return { title: /^# (.+)$/m.exec(md)?.[1]?.trim() ?? head?.[1]?.trim() ?? null, total: parseCount(head?.[2]), neighbors, cards };
}

// ---------------------------------------------------------------------------
// Профиль /<ник>/

export interface ParsedProfile {
  handle: string;
  followers: number | null;
  posts: GridPost[];
}

export function parseProfilePage(md: string): ParsedProfile | null {
  if (!md) return null;
  const handle = /^##\s+([A-Za-z0-9._\\]+)\s*$/m.exec(md)?.[1] ?? /\(@([A-Za-z0-9._]+)\) • Instagram/.exec(md)?.[1];
  const followersRaw = /\[(\d[\d.,]*[ \t]*[KMBkmb]?)[ \t]+followers?\]/i.exec(md)?.[1];
  if (!handle && !followersRaw) return null;
  const tagged = md.search(/\n\[\s*\n+\s*Tagged\s*\n+\s*\]/);
  const end = md.indexOf("[Meta](");
  const section = md.slice(tagged >= 0 ? tagged : 0, end > 0 ? end : md.length);
  return { handle: unescapeMarkdown(handle ?? ""), followers: parseCount(followersRaw), posts: parseGrid(section) };
}

// ---------------------------------------------------------------------------
// Выдача Google (parsed_light)

export interface GoogleReel {
  code: string;
  kind: "reel" | "post";
  url: string;
}

/** Коды рилсов из выдачи Google. Описанию выдачи не верим (Google подмешивает текст соседних постов) — только ссылки. */
export function parseGoogleReels(input: unknown): GoogleReel[] {
  let data = input;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  const organic = (data as { organic?: unknown } | null)?.organic;
  if (!Array.isArray(organic)) return [];
  const out: GoogleReel[] = [];
  for (const item of organic) {
    const link = typeof (item as { link?: unknown })?.link === "string" ? String((item as { link: string }).link) : "";
    const m = /^https:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(reel|reels|p)\/([A-Za-z0-9_-]{5,40})/.exec(link);
    if (!m || out.some((r) => r.code === m[2])) continue;
    const kind = m[1] === "p" ? "post" : "reel";
    out.push({ code: m[2], kind, url: postUrl(m[2], kind) });
  }
  return out;
}

export function postUrl(code: string, kind: "reel" | "post" = "reel"): string {
  return `https://www.instagram.com/${kind === "post" ? "p" : "reel"}/${code}/`;
}

export function profileUrl(handle: string): string {
  return `https://www.instagram.com/${handle}/`;
}

export function topicUrl(slug: string): string {
  return `https://www.instagram.com/popular/${encodeURIComponent(slug)}/`;
}

// ---------------------------------------------------------------------------
// Карточки бренда

export type CardGender = "women" | "men" | "kids" | "unisex" | "unknown";

export interface BrandCard {
  name: string;
  /** Пол — только по карточке: подпись продавца («унисекс») не в счёт. Zara в markdown пола не пишет — «unknown». */
  gender: CardGender;
  image: string | null;
  color: string | null;
}

/** Карточка Zara US по p-коду: номер MMMM/QQQ должен стоять на странице, иначе это не та модель (или страница поиска). */
export function parseZaraCard(md: string, model7: string): BrandCard | null {
  if (!/^\d{7}$/.test(model7) || !md) return null;
  const mm = model7.slice(0, 4);
  const qq = model7.slice(4);
  const ref = new RegExp(`(?:^|\\n)\\s*([A-Za-z][A-Za-z /-]{0,40}?)?\\s*${mm}\\/${qq}(?:\\/(\\d{3}))?(?!\\d)`).exec(md);
  if (!ref) return null;
  const name = /^# (.+)$/m.exec(md)?.[1]?.trim();
  if (!name) return null;
  return { name: unescapeMarkdown(name), gender: "unknown", image: null, color: ref[1]?.trim() || null };
}

/** Карточка Uniqlo: «Product ID: 487882», название, пол из заголовка «Women's …» или из хлебных крошек, фото image.uniqlo.com. */
export function parseUniqloCard(md: string, id6: string): BrandCard | null {
  if (!/^\d{6}$/.test(id6) || !md || /Product not found/i.test(md)) return null;
  if (!new RegExp(`Product ID:\\s*${id6}(?!\\d)`).test(md) && !md.includes(`/imagesgoods/${id6}/`)) return null;
  const name = /^# (.+)$/m.exec(md)?.[1]?.trim();
  if (!name) return null;
  const title = md.split("\n", 1)[0].trim();
  const crumb = /\n\s*1\.\s+\[\s*\n*\s*(WOMEN|MEN|KIDS|BABY)\s*\n*\s*\]/i.exec(md)?.[1]?.toUpperCase();
  let gender: CardGender = "unknown";
  if (/^Women'?s\b/i.test(title) || crumb === "WOMEN") gender = "women";
  else if (/^Men'?s\b/i.test(title) || crumb === "MEN") gender = "men";
  else if (/^(?:Kids|Baby|Girls|Boys)\b/i.test(title) || crumb === "KIDS" || crumb === "BABY") gender = "kids";
  else if (/\bUnisex\b/i.test(title)) gender = "unisex";
  const image = new RegExp(`!\\[[^\\]]*\\]\\((https:\\/\\/image\\.uniqlo\\.com\\/[^)\\s]*\\/imagesgoods\\/${id6}\\/item\\/[^)\\s]+)\\)`).exec(md)?.[1] ?? null;
  const color = /^Colour:\s*\d*\s*([A-Z ]+)$/m.exec(md)?.[1]?.trim() ?? null;
  return { name: unescapeMarkdown(name), gender, image, color };
}

export function zaraCardUrl(model7: string): string {
  return `https://www.zara.com/us/en/x-p0${model7}.html`;
}

/** Витрины Uniqlo по очереди: наша (ES), затем UK и US. */
export function uniqloCardUrls(id6: string): string[] {
  return ["es", "uk", "us"].map((c) => `https://www.uniqlo.com/${c}/en/products/E${id6}-000/00`);
}

// ---------------------------------------------------------------------------
// Номера товаров, бренд, раздел, пол

export interface ProductRef {
  /** «zara:5854722» (модель + качество, без цвета) или «uniqlo:487882». */
  key: string;
  brand: SocialBrand;
  model: string;
  color: string | null;
  raw: string;
}

const MONEY_AFTER = /^[ \t\u00a0]?(?:[$€₽£¥₸₺₴]|руб|р\.|тг|тенге|eur|usd|kzt|byn|pln|zł|грн|сум|сом|tl\b|lira)/i;
const ZARA_MARKER = /(?:ref(?:erence)?s?|code|cod|art(?:ikel)?|артикул\p{L}*|арт|номер|zara)[\s.:#№|/-]*$/iu;

/**
 * Номера товаров из подписи. Zara: MMMM/QQQ/CCC («Reference 5854/722/710», «ZARA | 5854/722/710») — всегда; MMMM/QQQ без цвета —
 * только рядом с «ref / code / артикул / ZARA» или если рилс про Zara (иначе это может быть что угодно). Uniqlo: «артикул / арт /
 * product id / id / 品番» + шесть цифр на 4 или хэштег #4NNNNN — если рилс не про Zara. Даты (2026/10/06) и суммы рядом с валютой
 * номерами не считаются.
 */
export function extractRefs(text: string, brandHint: SocialBrand | null = null): ProductRef[] {
  const out: ProductRef[] = [];
  const push = (ref: ProductRef) => {
    if (!out.some((r) => r.key === ref.key)) out.push(ref);
  };
  const src = unescapeMarkdown(text ?? "");
  if (brandHint !== "uniqlo") {
    for (const m of src.matchAll(/(?<![\d/.,])(\d{4})\/(\d{3})(?:\/(\d{3}))?(?![\d/])/g)) {
      const at = m.index ?? 0;
      if (MONEY_AFTER.test(src.slice(at + m[0].length, at + m[0].length + 6))) continue;
      if (/[$€₽£¥₸₺₴][ \t\u00a0]?$/.test(src.slice(Math.max(0, at - 2), at))) continue;
      const year = Number(m[1]);
      if (!m[3] && year >= 1990 && year <= 2099 && !ZARA_MARKER.test(src.slice(Math.max(0, at - 30), at))) continue;
      if (!m[3] && brandHint !== "zara" && !ZARA_MARKER.test(src.slice(Math.max(0, at - 30), at))) continue;
      push({ key: `zara:${m[1]}${m[2]}`, brand: "zara", model: `${m[1]}${m[2]}`, color: m[3] ?? null, raw: m[0] });
    }
  }
  if (brandHint !== "zara") {
    const uniqloPatterns = [
      /(?:артикул\p{L}*|арт\.?|product[ \t]*id|item[ \t]*(?:no\.?|number|code)|品番|(?<![\p{L}])id)[ \t\u00a0]*[:#№.]*[ \t\u00a0]*#?[ \t\u00a0]*E?(4\d{5})(?![\d])/giu,
      /(?<![\p{L}\p{N}_&])#(4\d{5})(?![\p{N}\p{L}_])/gu,
      /(?<![\p{L}\p{N}])E(4\d{5})-\d{3}(?!\d)/gu,
    ];
    for (const pattern of uniqloPatterns) {
      for (const m of src.matchAll(pattern)) {
        const at = (m.index ?? 0) + m[0].length;
        if (MONEY_AFTER.test(src.slice(at, at + 6))) continue;
        push({ key: `uniqlo:${m[1]}`, brand: "uniqlo", model: m[1], color: null, raw: m[0].trim() });
      }
    }
  }
  return out;
}

const ZARA_WORD = /zara|(?<![\p{L}])зар[аыеу](?![\p{L}])/iu;
const UNIQLO_WORD = /uniqlo|юникло|ユニクロ|lifewear/iu;

/** Бренд рилса: по подписи и хэштегам, при двух брендах — по номерам товаров, затем по теме; без упоминаний — по теме. */
export function detectBrand(input: { caption?: string | null; hashtags?: string[] | null; topic?: string | null; refs?: ProductRef[] }): SocialBrand | null {
  const text = `${input.caption ?? ""} ${(input.hashtags ?? []).map((h) => `#${h}`).join(" ")}`;
  const zara = ZARA_WORD.test(text);
  const uniqlo = UNIQLO_WORD.test(text);
  const topicBrand: SocialBrand | null = input.topic ? (ZARA_WORD.test(input.topic) ? "zara" : UNIQLO_WORD.test(input.topic) ? "uniqlo" : null) : null;
  if (zara && !uniqlo) return "zara";
  if (uniqlo && !zara) return "uniqlo";
  // Оба бренда или ни одного: решают номера товаров (у перепродавца «АРТИКУЛ: #487882» без слова Uniqlo), затем тема.
  const brands = new Set((input.refs ?? []).map((r) => r.brand));
  if (brands.size === 1) return [...brands][0];
  return topicBrand;
}

const JACKET_WORDS = /(?<![\p{L}])(?:jackets?|coats?|overcoat|bombers?|puffers?|parkas?|blousons?|anoraks?|windbreakers?|trench(?:coat)?|outerwear|куртк\p{L}*|пуховик\p{L}*|пальто|телогрейк\p{L}*|плащ\p{L}*|шуб[аыук]|анорак\p{L}*|бомбер\p{L}*|парк[аиуе](?![\p{L}])|ветровк\p{L}*|тренч\p{L}*|дубл[её]нк\p{L}*|косух\p{L}*|chaquetas?|cazadoras?|abrigos?|plum[ií]fero|giacca|giubbotto|piumino|cappotto|ceket|mont|kaban|kurtka|veste|manteau|doudoune|jacke|mantel|płaszcz)(?![\p{L}])/iu;
const BAG_WORDS = /(?<![\p{L}])(?:bags?|handbags?|purses?|totes?|clutch(?:es)?|crossbody|сумк\p{L}*|сумочк\p{L}*|клатч\p{L}*|шопер\p{L}*|bolsos?|borsa|borse|çanta|sac|sacs|tasche|torebk\p{L}*|torba)(?![\p{L}])/iu;

function hits(pattern: RegExp, text: string): number {
  return [...text.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))].length;
}

/** Слитные хэштеги («zarajacket», «chanelbag»): ищем корень внутри тега. */
const JACKET_TAG = /jacket|coat|bomber|puffer|parka|blouson|outerwear|куртк|пуховик|пальто|ceket|chaqueta|cazadora|abrigo|kurtka|jacke|manteau|doudoune/i;
const BAG_TAG = /bag|purse|tote|clutch|сумк|bolso|borsa|çanta|tasche/i;

/** Раздел: куртки или сумки — по словам подписи, хэштегам, подписи картинки и теме; при обоих — по теме, затем по числу слов; иначе null. */
export function detectDirection(input: { caption?: string | null; hashtags?: readonly string[] | null; alt?: readonly string[] | string | null; topic?: string | null; title?: string | null }): AssortmentDirection | null {
  const alt = Array.isArray(input.alt) ? input.alt.join(", ") : (input.alt as string | null | undefined) ?? "";
  const text = `${input.title ?? ""}\n${input.caption ?? ""}\n${alt}`.replace(/ё/g, "е");
  const topic = (input.topic ?? "").replace(/[-_]/g, " ");
  const tags = input.hashtags ?? [];
  const jt = JACKET_WORDS.test(topic);
  const bt = BAG_WORDS.test(topic);
  const j = hits(JACKET_WORDS, text) + (jt ? 1 : 0) + tags.filter((t) => JACKET_TAG.test(t)).length;
  const b = hits(BAG_WORDS, text) + (bt ? 1 : 0) + tags.filter((t) => BAG_TAG.test(t)).length;
  if (j > 0 && b === 0) return "jackets";
  if (b > 0 && j === 0) return "bags";
  if (j === 0 && b === 0) return null;
  if (jt !== bt) return jt ? "jackets" : "bags";
  return j > b ? "jackets" : b > j ? "bags" : null;
}

const MENSWEAR = /(?<![\p{L}])(?:men'?s|menswear|for men|zara ?man|мужск\p{L}*|для мужчин|hombre|uomo|herren|homme|erkek)(?![\p{L}])/iu;

/** Явно мужская вещь по подписи — только чтобы исключить (женское подтверждает лишь карточка бренда или каталог). */
export function looksMenswear(...texts: Array<string | null | undefined>): boolean {
  return texts.some((t) => MENSWEAR.test(t ?? ""));
}

// ---------------------------------------------------------------------------
// Намерение купить в комментариях

const L = String.raw`\p{L}`;
const NO_L_BEFORE = `(?<![${L}])`;
const NO_L_AFTER = `(?![${L}])`;
const SP = String.raw`[\s\u00a0]+`;

/** Словарь из калибровки (cal.proposedRule): link, ref, where, how much, price; цена/цену/стоимость, сколько стоит, где купить/приобрести, «артик…», «заказ…», «размер … есть». */
export const INTENT_PATTERNS: readonly RegExp[] = [
  new RegExp(`${NO_L_BEFORE}links?${NO_L_AFTER}`, "iu"),
  new RegExp(`${NO_L_BEFORE}ref(?:erence)?s?${NO_L_AFTER}`, "iu"),
  new RegExp(`${NO_L_BEFORE}where${NO_L_AFTER}`, "iu"),
  new RegExp(`${NO_L_BEFORE}how${SP}much${NO_L_AFTER}`, "iu"),
  new RegExp(`${NO_L_BEFORE}prices?${NO_L_AFTER}`, "iu"),
  new RegExp(`${NO_L_BEFORE}цен[аеуы]${NO_L_AFTER}`, "iu"),
  new RegExp(`${NO_L_BEFORE}стоимост${L}*`, "iu"),
  new RegExp(`${NO_L_BEFORE}сколько(?:${SP}${L}+)?${SP}сто(?:ит|ят)${NO_L_AFTER}`, "iu"),
  new RegExp(`${NO_L_BEFORE}где(?:${SP}${L}+)?${SP}(?:купить|приобрести)${NO_L_AFTER}`, "iu"),
  new RegExp(`${NO_L_BEFORE}артик${L}*`, "iu"),
  new RegExp(`${NO_L_BEFORE}заказ${L}*`, "iu"),
  new RegExp(`${NO_L_BEFORE}размер${L}*[\\s\\S]{0,40}?${NO_L_BEFORE}есть${NO_L_AFTER}|${NO_L_BEFORE}есть${NO_L_AFTER}[\\s\\S]{0,40}?${NO_L_BEFORE}размер`, "iu"),
];

export function isIntentComment(text: string): boolean {
  const t = text.replace(/ё/gi, "е");
  return INTENT_PATTERNS.some((p) => p.test(t));
}

const PASSWORD_VERB = String.raw`(?:comment|type|write|mention|напиши(?:те)?|пиши(?:те)?|оставь(?:те)?|комментируй(?:те)?|scrivi|commenta|escribe|comenta|kommentiere|schreib(?:e|t)?|napisz|yaz)`;
const PASSWORD_FILLER = String.raw`(?:me|the|word|below|in|for|a|an|comments?|в|комментариях|комментарии|комментах|слово|кодовое|nei|commenti|en|los|comentarios|unten|w|komentarzu)`;
const PASSWORD = new RegExp(`${NO_L_BEFORE}${PASSWORD_VERB}(?:${SP}${PASSWORD_FILLER}${NO_L_AFTER})*[\\s\\u00a0]*[«"“'‘„]?([\\p{L}\\p{N}]{2,20})`, "giu");
const PASSWORD_STOP = new Set(["and", "to", "if", "it", "of", "your", "you", "this", "below", "и", "чтобы", "если", "мне", "e", "y", "und", "i"]);

/** Слова-пароли, которые просит сама подпись («Comment “LINKS”», «напишите ИНСТРУКЦИЯ»): такие комментарии — накрутка, а не спрос. */
export function passwordWords(caption: string): string[] {
  const out: string[] = [];
  for (const m of (caption ?? "").matchAll(PASSWORD)) {
    const word = m[1].toLowerCase();
    if (!PASSWORD_STOP.has(word) && !out.includes(word)) out.push(word);
  }
  return out;
}

function isPasswordEcho(text: string, passwords: string[]): boolean {
  if (!passwords.length) return false;
  const tokens: string[] = text.toLowerCase().replace(/ё/g, "е").match(/[\p{L}\p{N}]+/gu) ?? [];
  const first = tokens[0];
  if (first === undefined || tokens.length > 4) return false;
  return passwords.some((p) => first === p || (first.length >= 3 && (p.startsWith(first) || first.startsWith(p))));
}

export interface IntentShare {
  count: number;
  total: number;
  share: number | null;
}

/** Доля видимых комментариев с намерением купить: без ответов автора и без слов-паролей из подписи. */
export function intentShare(comments: ReadonlyArray<ReelComment | string>, caption = ""): IntentShare {
  const passwords = passwordWords(caption);
  let count = 0;
  let total = 0;
  for (const c of comments) {
    const text = typeof c === "string" ? c : c.text;
    if (typeof c !== "string" && c.byAuthor) continue;
    if (!text.trim() || isPasswordEcho(text, passwords)) continue;
    total += 1;
    if (isIntentComment(text)) count += 1;
  }
  return { count, total, share: total > 0 ? count / total : null };
}

// ---------------------------------------------------------------------------
// Подпись для хранения: без @упоминаний и без цен

const CURRENCY = "[$€₽£¥₸₺₴]";
const MONEY_UNIT = String.raw`(?:руб(?:\.|л\p{L}*)?|р\.|тг|тенге|сом|сум|грн|byn|kzt|rub|eur(?:os?)?|евро|usd|долл\p{L}*|dollars?|zł|zl|pln|tl|lira|lei|kč|chf|yen|円|元|юан\p{L}*|rmb|cny|uah)`;
const AMOUNT = String.raw`\d{1,3}(?:[ \u00a0.,']\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const PRICE = new RegExp(`${CURRENCY}[ \\u00a0]?(?:${AMOUNT})|(?:${AMOUNT})[ \\u00a0]?(?:${CURRENCY}|${MONEY_UNIT}(?![\\p{L}]))`, "giu");

/** Вырезать суммы: число с валютой или «тг/руб/₽/$/€» (цены из подписей не собираем и не храним). */
export function stripPrices(text: string): string {
  return text.replace(PRICE, "…").replace(new RegExp(CURRENCY, "g"), "");
}

/** Отрывок подписи для базы: ≤ 500 знаков, без @упоминаний и без сумм. */
export function sanitizeCaption(text: string | null | undefined, max = CAPTION_EXCERPT_MAX): string | null {
  const plain = unescapeMarkdown(text ?? "")
    .replace(/@[\p{L}\p{N}._]+/gu, "")
    .replace(/https?:\/\/\S+/g, "");
  const cleaned = stripPrices(plain).replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) return null;
  // Режем по символам, а не по UTF-16: половинка эмодзи — невалидный текст для базы.
  const chars = Array.from(cleaned);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : cleaned;
}

// ---------------------------------------------------------------------------
// База автора и правило

export interface BaselinePost {
  code: string;
  publishedAtMs: number | null;
  /** null — лайки скрыты. */
  likes: number | null;
  comments: number | null;
  pinned?: boolean;
  owner?: string | null;
}

export interface Baseline {
  likesMedian: number | null;
  commentsMedian: number | null;
  /** Постов с видимыми лайками в медиане. */
  likesPosts: number;
  commentsPosts: number;
  codes: string[];
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Медиана автора: последние 12 постов ПО ДАТЕ (не по порядку в сетке); не входят закреплённые, сам кандидат, посты младше 48 ч
 * и чужие (соавторские) посты; для лайков — ещё и посты со скрытыми лайками.
 */
export function medianBaseline(posts: readonly BaselinePost[], options: { candidateCode?: string | null; nowMs: number; author?: string | null }): Baseline {
  const seen = new Set<string>();
  const eligible = posts
    .filter((p) => {
      if (seen.has(p.code)) return false;
      seen.add(p.code);
      if (p.code === options.candidateCode || p.pinned || p.publishedAtMs == null) return false;
      if (options.author && p.owner && p.owner !== options.author) return false;
      return options.nowMs - p.publishedAtMs >= MIN_AGE_MS;
    })
    .sort((a, b) => (b.publishedAtMs ?? 0) - (a.publishedAtMs ?? 0))
    .slice(0, BASELINE_POSTS);
  const likes = eligible.filter((p) => p.likes != null).map((p) => p.likes as number);
  const comments = eligible.filter((p) => p.comments != null).map((p) => p.comments as number);
  return { likesMedian: median(likes), commentsMedian: median(comments), likesPosts: likes.length, commentsPosts: comments.length, codes: eligible.map((p) => p.code) };
}

export interface VerdictInput {
  publishedAtMs: number;
  nowMs: number;
  likes: number | null;
  comments: number | null;
  intent: { count: number; total: number } | null;
  baseline: Pick<Baseline, "likesMedian" | "commentsMedian" | "likesPosts"> | null;
  followers: number | null;
}

export interface VerdictResult {
  verdict: SocialVerdict;
  /** Запасное правило (мало постов у автора): вердикт предварительный, подтверждается вторым автором с тем же номером. */
  preliminary: boolean;
  rule: "main" | "fallback";
  a: boolean;
  b: boolean;
  likesRatio: number | null;
  commentsRatio: number | null;
  intentShare: number | null;
  ageDays: number;
  ruleVersion: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Правило reels-v1. Возраст 2–21 день. (А) лайки ≥ 10× медианы автора и ≥ 1 000; (Б) комментарии ≥ 5× медианы, ≥ 30 и ≥ 50%
 * видимых — с намерением купить. А и Б — «strong», одно — «viral», иначе «normal». Мало постов у автора (< 6 с видимыми лайками) —
 * запасное: лайки ≥ 20% подписчиков или ≥ 5 000; комментарии ≥ 30 и ≥ 50% намерения — с пометкой «предварительно».
 */
export function verdictV1(input: VerdictInput): VerdictResult {
  const ageMs = input.nowMs - input.publishedAtMs;
  const ageDays = round2(ageMs / DAY_MS);
  const share = input.intent && input.intent.total > 0 ? input.intent.count / input.intent.total : null;
  const intentOk = share != null && share >= INTENT_MIN_SHARE;
  const base = input.baseline;
  const main = Boolean(base && base.likesPosts >= MIN_BASELINE_LIKE_POSTS && base.likesMedian != null && base.commentsMedian != null);
  const likesRatio = input.likes != null && base?.likesMedian != null ? round2(input.likes / Math.max(base.likesMedian, 1)) : null;
  const commentsRatio = input.comments != null && base?.commentsMedian != null ? round2(input.comments / Math.max(base.commentsMedian, 1)) : null;
  const result = (verdict: SocialVerdict, a: boolean, b: boolean): VerdictResult => ({
    verdict, preliminary: !main && (verdict === "viral" || verdict === "strong"), rule: main ? "main" : "fallback", a, b,
    likesRatio, commentsRatio, intentShare: share == null ? null : round2(share), ageDays, ruleVersion: REELS_RULE_VERSION,
  });
  if (ageMs < MIN_AGE_MS) return result("too_fresh", false, false);
  if (ageMs > MAX_AGE_DAYS * DAY_MS) return result("too_old", false, false);
  let a: boolean;
  let b: boolean;
  if (main && base) {
    a = input.likes != null && input.likes >= LIKES_MIN && input.likes >= LIKES_MULTIPLIER * (base.likesMedian as number);
    b = input.comments != null && input.comments >= COMMENTS_MIN && input.comments >= COMMENTS_MULTIPLIER * (base.commentsMedian as number) && intentOk;
  } else {
    a = input.likes != null && (input.likes >= FALLBACK_LIKES_MIN || (input.followers != null && input.followers > 0 && input.likes >= FALLBACK_FOLLOWER_SHARE * input.followers));
    b = input.comments != null && input.comments >= COMMENTS_MIN && intentOk;
  }
  return result(a && b ? "strong" : a || b ? "viral" : "normal", a, b);
}

/** Стоит ли докачивать прошлые посты автора ради этого кандидата. */
export function passesPrefilter(p: { likes: number | null; comments: number | null; views: number | null }): boolean {
  return (p.likes ?? 0) >= PREFILTER.likes || (p.comments ?? 0) >= PREFILTER.comments || (p.views ?? 0) >= PREFILTER.views;
}

/** Пора ли мерить пост: первый замер в окне 2–21 день, затем на 3-й и на 7-й день; не больше трёх замеров. */
export function measureDue(post: { publishedAtMs: number | null; checks: number; lastCheckedAtMs: number | null }, nowMs: number): boolean {
  if (post.publishedAtMs == null) return false;
  const age = nowMs - post.publishedAtMs;
  if (age < MIN_AGE_MS || age > MAX_AGE_DAYS * DAY_MS || post.checks >= MAX_CHECKS) return false;
  if (post.checks <= 0 || post.lastCheckedAtMs == null) return true;
  const lastAge = post.lastCheckedAtMs - post.publishedAtMs;
  return RECHECK_AGES_DAYS.some((day) => age >= day * DAY_MS && lastAge < day * DAY_MS);
}

/** Возраст поста по коду в окне поиска: не старше 21 дня (и не из будущего). */
export function withinDiscoveryWindow(code: string, nowMs: number): boolean {
  const t = codeTime(code);
  return t != null && t <= nowMs + HOUR_MS && nowMs - t <= MAX_AGE_DAYS * DAY_MS;
}

// ---------------------------------------------------------------------------
// Стартовые источники

export interface SeedAccount {
  handle: string;
  kind: AccountKind;
  note: string;
}

/**
 * Стартовые аккаунты (разведка 06.10, disc.seedAccounts): публичные аккаунты стилистов, байеров, перепродавцов и брендов — женское
 * или нейтральное. Владелец разрешил хранить их как источники; обходятся не реже раза в неделю.
 */
export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  { handle: "jpnbrands", kind: "reseller", note: "Uniqlo/GU/MUJI из Японии, русскоязычный; номер товара в каждой подписи" },
  { handle: "aida.uniq", kind: "reseller", note: "Uniqlo, Астана; русскоязычная аудитория" },
  { handle: "vocation.kz", kind: "reseller", note: "Uniqlo/COS/Arket, Казахстан; покупатели из РФ" },
  { handle: "kawaii_japanbox", kind: "reseller", note: "Uniqlo из Японии; артикул и состав в подписи" },
  { handle: "365.prosto", kind: "blogger", note: "распаковки Uniqlo с артикулами, RU" },
  { handle: "buyer_services_", kind: "buyer", note: "байер из Варшавы, Zara с полным номером" },
  { handle: "olga.bogdann", kind: "stylist", note: "стилист, Минск; подборки Zara с номерами" },
  { handle: "inkarbekovaz", kind: "stylist", note: "стилист, Алматы; подборки Zara с номерами" },
  { handle: "wannathis.dress", kind: "blogger", note: "сумки Zara почти каждый день, номер в подписи" },
  { handle: "xopi_fashion", kind: "blogger", note: "обзоры Zara: сумки и куртки" },
  { handle: "by.annamirabelle", kind: "stylist", note: "стилист (EN), номера Zara в подписях" },
  { handle: "heel.and.chic", kind: "blogger", note: "блок «Zara reference numbers» в подписях" },
  { handle: "carlabelleeee", kind: "blogger", note: "подборки курток Zara с номерами, Франция" },
  { handle: "mirimuse", kind: "stylist", note: "стилист, Испания; номера Zara" },
  { handle: "lisarosii", kind: "blogger", note: "еженедельные «ZARA New-In»" },
  { handle: "hanna.peeters", kind: "blogger", note: "серия «new in Zara fall jackets»" },
  { handle: "itsyourgirlsamanthaaa", kind: "blogger", note: "Uniqlo (US); комментарии-пароли «Fall»" },
  { handle: "rachtrinity", kind: "blogger", note: "Uniqlo (CA)" },
  { handle: "44sacchan", kind: "blogger", note: "Uniqlo (JP), номер 品番 в подписи" },
  { handle: "s_mai57", kind: "blogger", note: "Uniqlo (JP), ранний сигнал из Азии" },
  { handle: "uniqlomyofficial", kind: "brand", note: "официальный Uniqlo Малайзия, Product ID в подписях" },
  { handle: "uniqlousa", kind: "brand", note: "официальный Uniqlo США, Product ID в подписи" },
  { handle: "uniqlocanada", kind: "brand", note: "официальный Uniqlo Канада" },
  { handle: "zara", kind: "brand", note: "официальный аккаунт Zara — без номеров товаров в подписях, контрольная точка новинок" },
];

export interface SeedTopic {
  slug: string;
  brand: SocialBrand;
}

/** Стартовые темы /popular/ — женские куртки и сумки (проверены 06.10 или найдены через Google и «соседние темы»). */
export const SEED_TOPICS: readonly SeedTopic[] = [
  ...[
    "zara-viral-jacket", "zara-jacket", "zara-jackets", "zara-high-collar-jacket", "zara-bomber-jacket-collection", "zara-winter-jacket-collection",
    "zara-clothing-jackets", "zara-best-jackets", "zara-kurtka-viral", "zara-красная-куртка", "viral-zara-bomber-jacket", "zara-bag", "zara-bags", "zara-viral-bag",
  ].map((slug) => ({ slug, brand: "zara" as const })),
  ...[
    "uniqlo-jacket", "uniqlo-jackets", "viral-uniqlo-jacket", "uniqlo-down-jacket", "uniqlo-zip-up-jacket", "uniqlo-fleece-jacket", "uniqlo-puffer-jacket",
    "uniqlo-women-jacket", "uniqlo-outerwear", "uniqlo-bag", "uniqlo-round-mini-shoulder-bag", "uniqlo-shoulder-bag",
  ].map((slug) => ({ slug, brand: "uniqlo" as const })),
];

/** Шаблоны поиска Google (≈10 на бренд): к каждому добавляется `site:instagram.com/reel` и `after:` на 7 дней назад. */
export const GOOGLE_QUERIES: Readonly<Record<SocialBrand, readonly string[]>> = {
  zara: [
    "zara ref jacket", "zara reference jacket", "zara артикул куртка", "zara куртка", "zara new in jacket", "zara viral jacket",
    "zara bag ref", "zara сумка артикул", "zara bag new in", "zara bomber ref",
  ],
  uniqlo: [
    "uniqlo jacket", "uniqlo артикул куртка", "uniqlo артикул пуховик", "uniqlo product id jacket", "uniqlo down jacket women",
    "uniqlo fleece jacket", "uniqlo new in jacket", "uniqlo bag", "uniqlo сумка", "uniqlo round mini shoulder bag",
  ],
};

export function googleQuery(template: string, nowMs: number): string {
  const after = new Date(nowMs - 7 * DAY_MS).toISOString().slice(0, 10);
  return `site:instagram.com/reel ${template} after:${after}`;
}

const TOPIC_MEN = new Set(["men", "mens", "man", "menswear", "мужская", "мужские", "мужской", "мужская", "hombre", "uomo", "herren", "homme", "erkek", "kids", "baby", "boys"]);

/** Соседняя тема годится в список: про Zara или Uniqlo, про куртки или сумки, не мужская и не детская. */
export function acceptNeighborTopic(slug: string): SocialBrand | null {
  const s = slug.toLowerCase();
  const brand: SocialBrand | null = /zara|зара/.test(s) ? "zara" : /uniqlo|юникло/.test(s) ? "uniqlo" : null;
  if (!brand) return null;
  const tokens = s.split(/[-_\s]+/);
  if (tokens.some((t) => TOPIC_MEN.has(t))) return null;
  return detectDirection({ topic: s }) ? brand : null;
}
