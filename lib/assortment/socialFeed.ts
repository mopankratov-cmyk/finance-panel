import { plural } from "@/lib/warehouse/plural";
import type { AssortmentDirection } from "./constants";
import type { AccountKind, SocialBrand } from "./socialReels";
import type { HistoryPoint, MatchStatus, SocialReelCard } from "./socialReelsStore";
import { sampleLinks, type SampleLink } from "./whereToBuy";

/**
 * Лента «Залетает в соцсетях» — чистые функции для экрана, роутов и сводки (без базы и сети, годятся и для браузера).
 *
 * Границы: лайки и просмотры — не продажи (это то, что видно за рубежом); цен нет; людей не показываем, кроме публичных
 * аккаунтов-источников; картинки Instagram не показываем — превью модели только с сайта бренда или из каталога.
 */

export const FEED_PERIODS = [7, 14, 30] as const;
export type FeedPeriod = (typeof FEED_PERIODS)[number];
export const DEFAULT_FEED_PERIOD: FeedPeriod = 14;

/** Период ленты из адреса: только 7, 14 или 30 дней — иначе по умолчанию 14. */
export function parseFeedPeriod(raw: string | null | undefined): FeedPeriod {
  const n = Number(raw);
  return (FEED_PERIODS as readonly number[]).includes(n) ? (n as FeedPeriod) : DEFAULT_FEED_PERIOD;
}

export const BRAND_LABEL: Record<SocialBrand, string> = { zara: "Zara", uniqlo: "Uniqlo" };
export const VERDICT_LABEL: Record<"strong" | "viral", string> = { strong: "Сильный залёт", viral: "Залетает" };

export const ACCOUNT_KINDS: readonly AccountKind[] = ["stylist", "buyer", "reseller", "brand", "blogger", "unknown"];
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  stylist: "стилист",
  buyer: "байер",
  reseller: "перепродавец",
  brand: "бренд",
  blogger: "блогер",
  unknown: "вид не определён",
};
export const ACCOUNT_ORIGIN_LABEL: Record<"seed" | "auto" | "owner", string> = { seed: "стартовый", auto: "найден сбором", owner: "добавлен вручную" };

/** Ежедневный крон сбора (vercel.json «20 6 * * *», UTC) — для строки «следующий прогон». */
export const SOCIAL_CRON = { path: "/api/sync/assortment-social", schedule: "20 6 * * *", hourUtc: 6, minuteUtc: 20 } as const;
export const SOCIAL_JOB = "assortment-social";

/** Ближайший прогон крона после `nowMs` (ISO). */
export function nextSocialRun(nowMs: number): string {
  const d = new Date(nowMs);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), SOCIAL_CRON.hourUtc, SOCIAL_CRON.minuteUtc);
  return new Date(today > nowMs ? today : today + 24 * 3600 * 1000).toISOString();
}

export type MatchTone = "ok" | "warn" | "muted";

/** Статус привязки рилса к модели — одной фразой. */
export function matchLabel(status: MatchStatus | null): { text: string; tone: MatchTone } {
  switch (status) {
    case "catalog":
      return { text: "В нашем каталоге", tone: "ok" };
    case "brand_site":
      return { text: "Есть у бренда, нет в нашем каталоге", tone: "warn" };
    case "no_ref":
      return { text: "Номера нет — модель не определена", tone: "muted" };
    case "not_found":
      return { text: "Номер есть, но на сайте бренда модель не нашлась", tone: "muted" };
    default:
      return { text: "Модель ещё ищем по номеру", tone: "muted" };
  }
}

/** «1 234» → «1,2 тыс.», «12 345» → «12 тыс.», «1 234 567» → «1,2 млн». Меньше тысячи — как есть. */
export function compactRu(n: number): string {
  const abs = Math.abs(n);
  const fmt = (value: number, digits: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  // 999 600 округлилось бы в «1 000 тыс.» — это уже миллион.
  if (abs >= 999_500) return `${fmt(Math.round(n / 100_000) / 10, 1)} млн`;
  if (abs >= 10_000) return `${fmt(Math.round(n / 1000), 0)} тыс.`;
  if (abs >= 1000) return `${fmt(Math.round(n / 100) / 10, 1)} тыс.`;
  return fmt(Math.round(n), 0);
}

/** Во сколько раз выше обычного: «12», «6,5». */
export function ratioText(ratio: number): string {
  return ratio >= 10 ? Math.round(ratio).toLocaleString("ru-RU") : (Math.round(ratio * 10) / 10).toLocaleString("ru-RU");
}

/** «в 12 раз», «в 2 раза», «в 6,5 раза» выше обычного у автора. */
export function timesPhrase(ratio: number): string {
  const text = ratioText(ratio);
  const whole = !text.includes(",");
  return `в ${text} ${whole ? plural(Number(text.replace(/\s/g, "")), "раз", "раза", "раз") : "раза"}`;
}

/** Происхождение числа на карточке: факт площадки, наш расчёт, оценка, гипотеза (мало данных). */
export const KIND_TEXT: Record<"fact" | "calc" | "estimate" | "hypothesis", string> = { fact: "факт", calc: "расчёт", estimate: "оценка", hypothesis: "гипотеза" };

/** Номер товара для поиска образца: «zara:5854722» → «5854/722», «uniqlo:487882» → «487882». */
export function refArticle(key: string | null | undefined): string | null {
  if (!key) return null;
  const [brand, model] = key.split(":");
  if (brand === "zara" && /^\d{7}$/.test(model ?? "")) return `${model.slice(0, 4)}/${model.slice(4)}`;
  if (brand === "uniqlo" && /^\d{6}$/.test(model ?? "")) return model;
  return null;
}

/** Заголовок карточки: название модели с сайта бренда или из каталога; нет — выдержка подписи автора. */
export function cardTitle(card: Pick<SocialReelCard, "match" | "captionExcerpt" | "brand">): { text: string; fromCaption: boolean } {
  const title = card.match.title?.trim();
  if (title) return { text: title, fromCaption: false };
  const caption = card.captionExcerpt?.replace(/\s+/g, " ").trim();
  if (caption) return { text: caption.length > 160 ? `${caption.slice(0, 159).trimEnd()}…` : caption, fromCaption: true };
  return { text: card.brand ? `${BRAND_LABEL[card.brand]} — модель не определена` : "Модель не определена", fromCaption: false };
}

/** «Где купить образец»: карточка бренда и поиск по названию и номеру — те же ссылки, что в карточке модели. */
export function sampleLinksFor(card: Pick<SocialReelCard, "match" | "refs" | "brand">): SampleLink[] {
  const article = card.refs.map(refArticle).find((a): a is string => Boolean(a)) ?? null;
  const title = card.match.title?.trim() || null;
  if (!title && !article && !card.match.url) return [];
  return sampleLinks({ brand: card.brand ? BRAND_LABEL[card.brand] : null, title, article, url: card.match.url && !isInstagramUrl(card.match.url) ? card.match.url : null });
}

export function isInstagramUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return /(^|\.)instagram\.com$|(^|\.)cdninstagram\.com$|(^|\.)fbcdn\.net$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Ссылка на карточку бренда, которую можно отдать в «Добавить в находки»: только https и не Instagram (картинки Instagram не копируем). */
export function importableBrandUrl(card: Pick<SocialReelCard, "match">): string | null {
  const url = card.match.url;
  if (card.match.status !== "brand_site" || !url || !/^https:\/\//.test(url) || isInstagramUrl(url)) return null;
  return url;
}

/** Модель каталога, к которой привязан рилс: для «Отобрать» и «Не интересно» каталога. */
export function catalogTarget(card: Pick<SocialReelCard, "match">): { sourceId: string; itemId: string } | null {
  const { status, sourceId, itemId } = card.match;
  return status === "catalog" && sourceId && /^S\d{3,4}$/.test(sourceId) && itemId ? { sourceId, itemId } : null;
}

// ---------------------------------------------------------------------------
// Аккаунты-источники

const RESERVED_PATHS = new Set(["p", "reel", "reels", "tv", "explore", "popular", "accounts", "stories", "direct", "about", "legal", "developer"]);

/** Ник Instagram из ввода директора: «@ник», «ник», ссылка на профиль. Чужие сайты, пути рилсов и мусор — null. */
export function parseHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value || value.length > 200) return null;
  const link = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#\s]+)\/?(?:[?#].*)?$/i.exec(value);
  if (link) value = link[1];
  // Чужие адреса и пути рилсов («/», «:») отсекает проверка формата ника ниже.
  value = value.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(value) || /^\.+$/.test(value) || RESERVED_PATHS.has(value)) return null;
  return value;
}

export function parseAccountKind(raw: unknown): AccountKind {
  return ACCOUNT_KINDS.find((k) => k === raw) ?? "unknown";
}

// ---------------------------------------------------------------------------
// Воскресная сводка: новые «залёты» недели

export interface SocialDigestPost {
  code: string;
  url: string;
  account_handle: string | null;
  published_at: string | null;
  first_seen_at: string | null;
  brand: SocialBrand | null;
  direction: AssortmentDirection | null;
  caption_excerpt: string | null;
  likes: number | null;
  views: number | null;
  verdict: string | null;
  match_status: MatchStatus | null;
  match_title: string | null;
  hidden_at: string | null;
  history: HistoryPoint[] | null;
}

export interface SocialDigestItem {
  direction: AssortmentDirection;
  brand: SocialBrand;
  title: string;
  views: number | null;
  likes: number | null;
  verdict: "strong" | "viral";
  url: string;
}

export interface SocialDigest {
  items: SocialDigestItem[];
  /** Сколько всего новых «залётов» за неделю (в сообщении — не больше пяти). */
  total: number;
  /** Чтение не удалось: в сводке — строка с причиной, а не молчание (и не падение всей сводки). */
  error?: string | null;
}

/** Когда рилс впервые замерили (первая точка истории с лайками или комментариями); замеров нет — когда нашли. */
export function firstMeasuredAt(post: Pick<SocialDigestPost, "history" | "first_seen_at">): string | null {
  const point = (post.history ?? []).find((h) => h && (h.likes != null || h.comments != null));
  return point?.at ?? post.first_seen_at ?? null;
}

/**
 * Когда рилс впервые «залетел»: точка истории с отметкой вердикта (замер 3-го или 7-го дня, запоздалая база автора). Отметки нет
 * (записи до неё) — первый замер.
 */
export function firstViralAt(post: Pick<SocialDigestPost, "history" | "first_seen_at">): string | null {
  const mark = (post.history ?? []).find((h) => h && (h.verdict === "viral" || h.verdict === "strong"));
  return mark?.at ?? firstMeasuredAt(post);
}

/**
 * Новые «залёты» недели [from, to): «залетает» или «сильный залёт», ВПЕРВЫЕ получивший этот вердикт за эту неделю (рилс не
 * повторяется из недели в неделю, а «залетевший» на повторном замере не теряется), не скрыт, не мужское и не детское, автор не
 * исключён, бренд и раздел известны. Сначала сильные, затем по просмотрам и лайкам.
 */
export function pickSocialDigest(posts: readonly SocialDigestPost[], fromMs: number, toMs: number, excluded: ReadonlySet<string>, limit = 5): SocialDigest {
  const fresh = posts.filter((p) => {
    if (p.verdict !== "strong" && p.verdict !== "viral") return false;
    if (p.hidden_at || p.match_status === "men" || p.match_status === "kids") return false;
    if (!p.brand || !p.direction || (p.account_handle && excluded.has(p.account_handle))) return false;
    const at = Date.parse(firstViralAt(p) ?? "");
    return Number.isFinite(at) && at >= fromMs && at < toMs;
  });
  fresh.sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === "strong" ? -1 : 1) || (b.views ?? -1) - (a.views ?? -1) || (b.likes ?? -1) - (a.likes ?? -1) || a.code.localeCompare(b.code));
  const items = fresh.slice(0, limit).map((p): SocialDigestItem => {
    const title = p.match_title?.trim() || p.caption_excerpt?.replace(/\s+/g, " ").trim() || "модель не определена";
    return {
      direction: p.direction as AssortmentDirection,
      brand: p.brand as SocialBrand,
      title: title.length > 80 ? `${title.slice(0, 79).trimEnd()}…` : title,
      views: p.views,
      likes: p.likes,
      verdict: p.verdict as "strong" | "viral",
      url: p.url,
    };
  });
  return { items, total: fresh.length };
}
