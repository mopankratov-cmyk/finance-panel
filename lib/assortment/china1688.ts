import { createHash, createHmac, randomUUID } from "node:crypto";
import type { ChinaNiche } from "./chinaNiches";
import type { AssortmentDirection } from "./constants";

/**
 * «Китай (1688)» — клиент официальных ИИ-навыков 1688 и чистые функции разбора ответов (решение владельца 07.10.2026: ключ выдан на
 * clawhub.1688.com). Два хоста: gateway.1688.com (навык 1688-product-find 1.7.0 — поиск товаров) и ainext.1688.com (навык
 * 1688-shopkeeper 1.0.1 — тренды и «возможности»). Один ключ AK на оба, подпись — как у официальных клиентов (scripts/_auth.py).
 *
 * Границы модуля: ЦЕН НЕ ХРАНИМ И НЕ ПОКАЗЫВАЕМ. В ответах 1688 цены есть почти везде (currentPrice, priceTags, promotionTags, price,
 * «￥13.5-￥24» внутри rankedContent, раздел «淘宝爆款概况» тренда), поэтому разбор идёт по БЕЛОМУ списку полей: что не названо здесь —
 * не читается вовсе. Продавцов не храним: имя магазина (company — у ИП это имя человека) остаётся внутри разбора, наружу выходит только
 * обезличенный номер продавца в пределах одного ответа (`sellerSlot`) — чтобы посчитать, сколько РАЗНЫХ продавцов. Людей не храним.
 *
 * Ключ — только из переменной окружения ALI_1688_AK (то же имя, что у официальных навыков), без значения по умолчанию. Ключ не попадает
 * ни в тело запроса, ни в сообщения об ошибках, ни в журнал.
 */

export const CHINA_PROVIDER = "1688";
/** Имя переменной с ключом — как у официальных навыков (primaryEnv в SKILL.md). */
export const CHINA_KEY_ENV = "ALI_1688_AK";

export const GATEWAY_BASE = "https://gateway.1688.com";
/** Путь поиска товаров с суффиксом канала «/github» — он входит и в подпись, и в адрес. */
export const FIND_PRODUCT_PATH = "/api/alibaba.1688.find.product/1.0.0/github";
export const GATEWAY_VERSION = "1.7.0";
export const GATEWAY_SKILL_CODE = "1688-product-find";

export const AINEXT_BASE = "https://ainext.1688.com";
export const SEARCHOFFER_PATH = "/1688claw/skill/searchoffer";
export const WORKFLOW_PATH = "/1688claw/skill/workflow";
export const AINEXT_VERSION = "1.0.1";

/** Таймаут одного вызова (как HTTP_TIMEOUT официального клиента): поиск отвечает за 4–7 с, тренд — за 1–2 с. */
export const CALL_TIMEOUT_MS = 30_000;
/** Сколько раз повторить временный сбой (5xx, ISPInvokeTimeout, сеть, наш таймаут). Остальное не повторяем. */
export const TRANSIENT_RETRIES = 1;
export const RETRY_DELAY_MS = 2_000;

export type ChinaHost = "gateway" | "ainext";

const HOSTS: Record<ChinaHost, { base: string; version: string }> = {
  gateway: { base: GATEWAY_BASE, version: GATEWAY_VERSION },
  ainext: { base: AINEXT_BASE, version: AINEXT_VERSION },
};

// ---------------------------------------------------------------------------
// Ключ и подпись

export interface AkKeys {
  id: string;
  secret: string;
}

/** Строка ключа из окружения; пусто — ключа нет. Значение дальше этой функции и подписи не уходит. */
export function chinaKeyRaw(env: Record<string, string | undefined> = process.env): string {
  return env[CHINA_KEY_ENV]?.trim() ?? "";
}

export function chinaKeyConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return chinaKeyRaw(env).length > 0;
}

/**
 * Разбор ключа как у официального клиента (extract_ak_keys): base64url → первые 32 символа — секрет, остаток — id ключа. Не
 * декодируется (не base64url или не UTF-8) или после декодирования id пуст — режем исходную строку по тем же 32 символам.
 */
export function parseAk(raw: string | null | undefined): AkKeys | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const bare = value.replace(/=+$/, "");
  // Длина с остатком 1 по модулю 4 — не base64 (Python urlsafe_b64decode падает), Buffer же молча дочитал бы мусор.
  if (/^[A-Za-z0-9_-]+={0,2}$/.test(value) && bare.length % 4 !== 1) {
    try {
      const padded = bare + "=".repeat((4 - (bare.length % 4)) % 4);
      const decoded = Array.from(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(padded, "base64url")));
      const secret = decoded.slice(0, 32).join("");
      const id = decoded.slice(32).join("");
      if (id) return { id, secret };
    } catch {
      // не UTF-8 — ниже, по исходной строке
    }
  }
  const chars = Array.from(value);
  if (chars.length > 32) return { id: chars.slice(32).join(""), secret: chars.slice(0, 32).join("") };
  return null;
}

/** base64(md5(точные байты тела в UTF-8)); пустое тело — пустая строка. */
export function contentMd5(body: string): string {
  if (!body) return "";
  return createHash("md5").update(Buffer.from(body, "utf8")).digest("base64");
}

/** Путь без хоста; query — пары по ключу и значению, percent-encoding (как _get_canonicalized_resource). */
export function canonicalResource(pathWithQuery: string): string {
  const [path, query] = pathWithQuery.split("?", 2);
  if (!query) return path || "/";
  const pairs = query.split("&").filter(Boolean).map((part) => {
    const [k, v = ""] = part.split("=", 2);
    return [decodeURIComponent(k.replace(/\+/g, " ")), decodeURIComponent(v.replace(/\+/g, " "))] as const;
  });
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${path || "/"}?${pairs.map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&")}`;
}

export interface SignInput {
  method: string;
  path: string;
  body: string;
  keys: AkKeys;
  version: string;
  /** Секунды unix. */
  timestamp: number;
  /** 8 hex-символов. */
  nonce: string;
}

/**
 * Заголовки подписи x-csk-*: строка для подписи — METHOD, contentMD5, Content-Type, время, по строке «ключ:значение» на каждый x-csk-*
 * в порядке сортировки и путь; подпись — base64(HMAC-SHA256(секрет, строка)).
 */
export function signHeaders(input: SignInput): Record<string, string> {
  const contentType = "application/json";
  const md5 = contentMd5(input.body);
  const csk: Record<string, string> = {
    "x-csk-ak": input.keys.id,
    "x-csk-time": String(input.timestamp),
    "x-csk-nonce": input.nonce,
    "x-csk-content-md5": md5,
    "x-csk-version": input.version,
  };
  const canonicalHeaders = Object.keys(csk).sort().map((k) => `${k.toLowerCase()}:${csk[k].trim()}\n`).join("");
  const stringToSign = `${input.method.toUpperCase()}\n${md5}\n${contentType}\n${input.timestamp}\n${canonicalHeaders}${canonicalResource(input.path)}`;
  const sign = createHmac("sha256", Buffer.from(input.keys.secret, "utf8")).update(Buffer.from(stringToSign, "utf8")).digest("base64");
  return { "Content-Type": contentType, "x-csk-sign": sign, ...csk };
}

// ---------------------------------------------------------------------------
// Вызов и ошибки

/**
 * Почему вызов не удался:
 * - no_key — ключа нет в окружении; auth — ключ не принят (HTTP 401, SignatureInvalid, 1688_token_*): остановка прогона одной причиной;
 * - rate_limit — 429, QosAppFrequencyLimit / QosApiFrequencyLimit: прогон откладывается без траты попытки задачи;
 * - transient — 5xx, ISPInvokeTimeout, сеть, наш таймаут (повторены TRANSIENT_RETRIES раз); param — 400, ParamMissing, APIUnsupported;
 * - service — прочее (HTTP 403 и другие не-200, ISPInvokeError, неизвестная бизнес-ошибка, ответ без ожидаемого содержимого). 403 — не
 *   ключ: официальные клиенты считают его сбоем сервиса (у product-find любой не-200 — ServiceError, у shopkeeper AuthError — только 401),
 *   а 403 даёт и WAF / геоблокировка на пути от Vercel. Исправный ключ из-за него не объявляется недействительным.
 */
export type ChinaErrorKind = "no_key" | "auth" | "rate_limit" | "transient" | "param" | "service";

export class China1688Error extends Error {
  constructor(message: string, readonly kind: ChinaErrorKind, readonly code: string | null = null, readonly status: number | null = null) {
    super(message);
    this.name = "China1688Error";
  }
}

/** Причина одной строкой — для журнала и экрана. */
export const CHINA_STOP_WORDS: Record<"no_key" | "auth" | "rate_limit", string> = {
  no_key: `ключ 1688 не задан (${CHINA_KEY_ENV})`,
  auth: "ключ 1688 недействителен (401 / SignatureInvalid)",
  rate_limit: "упёрлись в лимит 1688 (429 / Qos*) — снимок доделается следующими прогонами",
};

const AUTH_CODES = new Set(["SignatureInvalid", "1688_token_expired", "1688_invalid_token", "1688_token_revoked", "1688_token_unauthorized", "1688_no_scope_specified", "1688_invalid_scope"]);

/** Бизнес-ошибка (HTTP 200, success:false) → вид ошибки: gateway — по полю code, ainext — по числу в msgCode (как _handle_biz_error). */
export function classifyBizError(payload: Record<string, unknown>): China1688Error {
  const code = String(payload.code ?? "");
  const msgCode = String(payload.msgCode ?? "");
  const snippet = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (AUTH_CODES.has(code) || AUTH_CODES.has(msgCode)) return new China1688Error(CHINA_STOP_WORDS.auth, "auth", code || msgCode);
  if (code === "QosAppFrequencyLimit" || code === "QosApiFrequencyLimit") return new China1688Error(CHINA_STOP_WORDS.rate_limit, "rate_limit", code);
  if (code === "ParamMissing" || code === "APIUnsupported") return new China1688Error(`1688: параметры запроса не приняты (${code})`, "param", code);
  if (code === "ISPInvokeTimeout") return new China1688Error("1688: таймаут сервиса (ISPInvokeTimeout)", "transient", code);
  if (code === "ISPInvokeError") return new China1688Error("1688: ошибка сервиса (ISPInvokeError)", "service", code);
  const normalized = /\b(400|401|429|500)\b/.exec(msgCode)?.[1] ?? "";
  if (normalized === "401") return new China1688Error(CHINA_STOP_WORDS.auth, "auth", msgCode);
  if (normalized === "429") return new China1688Error(CHINA_STOP_WORDS.rate_limit, "rate_limit", msgCode);
  if (normalized === "400") return new China1688Error("1688: параметры запроса не приняты (400)", "param", msgCode);
  if (normalized === "500") return new China1688Error("1688: сбой сервиса (500)", "transient", msgCode);
  return new China1688Error(`1688: ${snippet(payload.message ?? payload.msgInfo ?? (code || msgCode)) || "неизвестная ошибка"}`, "service", code || msgCode || null);
}

/** HTTP-статус (не 200) → вид ошибки. Ключ — только 401; 403 — сбой сервиса (попытка задачи), не «ключ недействителен». */
export function classifyHttpStatus(status: number): China1688Error {
  if (status === 401) return new China1688Error(CHINA_STOP_WORDS.auth, "auth", null, status);
  if (status === 429) return new China1688Error(CHINA_STOP_WORDS.rate_limit, "rate_limit", null, status);
  if (status >= 500) return new China1688Error(`1688: временный сбой (HTTP ${status})`, "transient", null, status);
  if (status === 400) return new China1688Error("1688: параметры запроса не приняты (HTTP 400)", "param", null, status);
  if (status === 403) return new China1688Error("1688: доступ запрещён (HTTP 403)", "service", null, status);
  return new China1688Error(`1688: ответ HTTP ${status}`, "service", null, status);
}

/**
 * Ошибка вызова 1688 — и когда класс пришёл из другой копии модуля (тестовый загрузчик грузит модуль по двум путям): по имени и виду.
 */
export function isChina1688Error(error: unknown): error is China1688Error {
  if (error instanceof China1688Error) return true;
  return error instanceof Error && error.name === "China1688Error" && typeof (error as { kind?: unknown }).kind === "string";
}

/** Обрыв нашим таймаутом или сетью — временный сбой. */
function isNetworkError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  return name === "TimeoutError" || name === "AbortError" || /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network/i.test(message);
}

export interface CallOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Для тестов: время и nonce подписи. */
  now?: () => number;
  nonce?: () => string;
}

/** Вызов 1688 — функция для прогона: хост, путь и тело; ответ — полезная часть конверта (data у gateway, model у ainext). */
export type ChinaCaller = (host: ChinaHost, path: string, body: Record<string, unknown>) => Promise<unknown>;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Один вызов 1688 с подписью. Повтор — только временного сбоя (5xx, ISPInvokeTimeout, сеть, таймаут) и не больше `retries` раз; 429 и
 * Qos* не повторяются (прогон откладывается), ключ — остановка. Ответ — полезная часть конверта: у gateway `data`, у ainext `model`.
 */
export async function call1688(host: ChinaHost, path: string, body: Record<string, unknown>, options: CallOptions = {}): Promise<unknown> {
  const keys = parseAk(chinaKeyRaw(options.env ?? process.env));
  if (!keys) throw new China1688Error(CHINA_STOP_WORDS.no_key, "no_key");
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = Math.max(0, options.retries ?? TRANSIENT_RETRIES);
  const sleep = options.sleep ?? defaultSleep;
  const { base, version } = HOSTS[host];
  const text = JSON.stringify(body);
  let last: China1688Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep((options.retryDelayMs ?? RETRY_DELAY_MS) * attempt);
    const headers = signHeaders({
      method: "POST",
      path,
      body: text,
      keys,
      version,
      timestamp: Math.floor((options.now?.() ?? Date.now()) / 1000),
      nonce: options.nonce?.() ?? randomUUID().replace(/-/g, "").slice(0, 8),
    });
    if (host === "gateway") {
      headers["x-skill-code"] = GATEWAY_SKILL_CODE;
      headers["x-skill-version"] = GATEWAY_VERSION;
      headers["x-request-id"] = randomUUID().replace(/-/g, "");
    }
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, { method: "POST", headers, body: text, signal: AbortSignal.timeout(options.timeoutMs ?? CALL_TIMEOUT_MS) });
    } catch (error) {
      if (!isNetworkError(error)) throw new China1688Error("1688: запрос не ушёл", "service");
      last = new China1688Error("1688: сеть или таймаут", "transient");
      continue;
    }
    if (response.status !== 200) {
      last = classifyHttpStatus(response.status);
      if (last.kind === "transient") continue;
      throw last;
    }
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") {
      last = new China1688Error("1688: ответ не JSON (обрыв чтения)", "transient");
      continue;
    }
    if (payload.success === false) {
      last = classifyBizError(payload);
      if (last.kind === "transient") continue;
      throw last;
    }
    const inner = host === "gateway" ? payload.data : payload.model;
    if (!inner || typeof inner !== "object") throw new China1688Error("1688: в ответе нет содержимого", "service");
    return inner;
  }
  throw last ?? new China1688Error("1688: временный сбой", "transient");
}

/** Вызов с ключом из окружения — для крона. */
export function makeChinaCaller(options: CallOptions = {}): ChinaCaller {
  return (host, path, body) => call1688(host, path, body, options);
}

// ---------------------------------------------------------------------------
// Деньги и чистка текста

/** Признаки цены в тексте: ¥/￥, «N元», RMB, маркер PRICE образцов. Для сторожей и чистки. */
const MONEY_RE = /[¥￥]|\d\s*(?:元|块钱?)|\brmb\b|人民币|PRICE/i;

export function containsChinaMoney(text: string): boolean {
  return MONEY_RE.test(text);
}

/** Вырезать суммы из названия: «￥13.5-￥24», «35元», «RMB 42–98»; лишние пробелы — схлопнуть. */
export function stripChinaMoney(text: string): string {
  return text
    .replace(/[¥￥]\s*\d+(?:[.,]\d+)?(?:\s*[-~～–—]\s*[¥￥]?\s*\d+(?:[.,]\d+)?)?/g, " ")
    .replace(/\brmb\s*\d+(?:[.,]\d+)?(?:\s*[-~～–—]\s*\d+(?:[.,]\d+)?)?/gi, " ")
    .replace(/\d+(?:[.,]\d+)?\s*(?:元|块钱?|rmb\b)/gi, " ")
    .replace(/[¥￥]|人民币|PRICE/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const cleanTitle = (value: unknown): string => stripChinaMoney(String(value ?? "")).slice(0, 200);

// ---------------------------------------------------------------------------
// Товар: разбор по белому списку

/** Значки карточки (что можно показать бейджем; всё — со слов 1688 или продавца, см. kind в chinaStore). */
export type ChinaBadge = "yx" | "inspected" | "claims_new" | "unisex";

export interface ChinaOffer {
  offerId: string;
  /** Позиция в выдаче 1688 (с 1). */
  position: number;
  titleZh: string;
  /** Главное фото — ссылка alicdn (в имени файла зашит числовой id загрузившего; храним только у показанных карточек). */
  imageUrl: string | null;
  /** Листовая категория 1688 (cate_id) или путь категории (у shopkeeper). */
  category: string | null;
  /** Счётчик продаж как его даёт 1688 («5000+», «100+», «<10»): накопленный и округлённый — нижняя граница. */
  soldText: string | null;
  soldMin: number | null;
  /** Оплаченные заказы за 30 дней (find.product: oldReputationTags.pay_ord_cnt_30d) — факт 1688. */
  orders30d: number | null;
  /** Дата размещения (shopkeeper earliestListingTime) — факт 1688, только у поиска shopkeeper. */
  listedOn: string | null;
  /** Платное размещение (offerICTagInfo.isYuanbaoadOffer): в топ не идёт. */
  isAd: boolean;
  badges: ChinaBadge[];
  /** Свойства из sellingPoints (материал, крой) — до пяти, без сумм. */
  traits: string[];
  /** Обезличенный номер продавца В ЭТОМ ответе (0, 1, …) — только чтобы посчитать разных продавцов; не хранится. */
  sellerSlot: number | null;
}

export interface ChinaSearchResult {
  /** Сколько карточек 1688 насчитал (data.count) — у урезанных образцов больше, чем пришло. */
  count: number | null;
  offers: ChinaOffer[];
  /** Разных продавцов среди пришедших карточек. */
  sellers: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function offerIdOf(value: unknown): string | null {
  const s = typeof value === "number" ? (Number.isSafeInteger(value) ? String(value) : null) : typeof value === "string" ? value.trim() : null;
  return s && /^\d{6,16}$/.test(s) ? s : null;
}

function imageOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim().split(/[?#]/)[0];
  return /^https:\/\/[a-z0-9.-]*alicdn\.com\/[^\s"'<>]+$/.test(url) ? url : null;
}

function nonNegInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** «100+», «90+», «<10», «1.2万+» → нижняя граница числом. */
export function soldLowerBound(text: string | null | undefined): number | null {
  const s = String(text ?? "").trim();
  if (!s) return null;
  if (/^<\s*\d/.test(s)) return 0;
  const m = /^(\d+(?:\.\d+)?)\s*(万)?\s*\+?/.exec(s);
  if (!m) return null;
  return Math.floor(Number(m[1]) * (m[2] ? 10_000 : 1));
}

function cateIdOf(qualityTags: unknown): string | null {
  if (!isRecord(qualityTags)) return null;
  const raw = qualityTags.core_decision_attr;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as { cate_id?: unknown };
    const id = String(parsed?.cate_id ?? "").trim();
    return /^\d{1,12}$/.test(id) ? id : null;
  } catch {
    return /"cate_id"\s*:\s*"(\d{1,12})"/.exec(raw)?.[1] ?? null;
  }
}

const CLAIMS_NEW_RE = /(?:20)?\d\d(?:年)?(?:春夏|秋冬|春|夏|秋|冬)?季?(?:新款|新品)|新款|新品|上新/;

function badgesOf(title: string, item: Record<string, unknown>): ChinaBadge[] {
  const out: ChinaBadge[] = [];
  if (typeof item.recallSource === "string" && /yx/i.test(item.recallSource)) out.push("yx");
  const ic = isRecord(item.offerICTagInfo) ? item.offerICTagInfo : {};
  const quality = isRecord(item.qualityTags) ? item.qualityTags : {};
  if (ic.isOfficialInspection === true || quality.is_official_inspect === "Y") out.push("inspected");
  if (CLAIMS_NEW_RE.test(title)) out.push("claims_new");
  if (title.includes("男") && title.includes("女")) out.push("unisex");
  return out;
}

function traitsOf(sellingPoints: unknown): string[] {
  if (!Array.isArray(sellingPoints)) return [];
  const out: string[] = [];
  for (const point of sellingPoints) {
    if (!isRecord(point) || point.type !== "industryCPV" || typeof point.value !== "string") continue;
    const value = point.value.trim();
    if (!value || value.length > 20 || containsChinaMoney(value) || /\d{3,}/.test(value)) continue;
    if (!out.includes(value)) out.push(value);
    if (out.length >= 5) break;
  }
  return out;
}

/** Номера продавцов по порядку появления: строка магазина остаётся здесь. */
function sellerSlots(): (company: unknown) => number | null {
  const seen = new Map<string, number>();
  return (company) => {
    const key = typeof company === "string" ? company.trim() : "";
    if (!key) return null;
    if (!seen.has(key)) seen.set(key, seen.size);
    return seen.get(key) ?? null;
  };
}

const distinctSellers = (offers: readonly Pick<ChinaOffer, "sellerSlot">[]) => new Set(offers.map((o) => o.sellerSlot).filter((s): s is number => s != null)).size;

/**
 * Ответ find.product (полезная часть конверта gateway — `data`) → карточки. Берутся ТОЛЬКО: itemId, title, imageUrl, soldOut,
 * oldReputationTags.pay_ord_cnt_30d, qualityTags.core_decision_attr.cate_id, recallSource, offerICTagInfo (реклама, проверка),
 * qualityTags.is_official_inspect, sellingPoints[industryCPV]; company — только для номера продавца. Цены, промо, показатели магазина,
 * rankedContent, serviceInfos и прочее не читаются.
 *
 * Элементы выдачи — на уровне SKU (у каждого skuId / skuTitle): одна карточка может прийти несколькими строками. Карточка считается один
 * раз — по первой позиции; иначе копий по номеру было бы больше, чем карточек, а в топе ниши — меньше разных карточек, чем мест.
 */
export function parseFindProduct(data: unknown): ChinaSearchResult {
  const root = isRecord(data) ? data : {};
  const list = Array.isArray(root.data) ? root.data : [];
  const slot = sellerSlots();
  const offers: ChinaOffer[] = [];
  const seen = new Set<string>();
  list.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const offerId = offerIdOf(raw.itemId);
    const titleZh = cleanTitle(raw.title);
    if (!offerId || !titleZh || seen.has(offerId)) return;
    seen.add(offerId);
    const sold = nonNegInt(raw.soldOut);
    const rep = isRecord(raw.oldReputationTags) ? raw.oldReputationTags : {};
    const ic = isRecord(raw.offerICTagInfo) ? raw.offerICTagInfo : {};
    offers.push({
      offerId,
      position: index + 1,
      titleZh,
      imageUrl: imageOf(raw.imageUrl),
      category: cateIdOf(raw.qualityTags),
      soldText: sold == null ? null : `${sold}+`,
      soldMin: sold,
      orders30d: nonNegInt(rep.pay_ord_cnt_30d),
      listedOn: null,
      isAd: ic.isYuanbaoadOffer === true,
      badges: badgesOf(titleZh, raw),
      traits: traitsOf(raw.sellingPoints),
      sellerSlot: slot(raw.company),
    });
  });
  const count = nonNegInt(root.count);
  return { count, offers, sellers: distinctSellers(offers) };
}

/**
 * Ответ searchoffer (shopkeeper, `model`) → карточки. Берутся: offerId, title, image, stats.totalSales (счётчик), stats.earliestListingTime
 * (дата размещения — факт), stats.categoryListName. Цена (price), оценки, отзывы и прочие показатели не читаются; продавца в ответе нет.
 */
export function parseSearchOffer(model: unknown): ChinaSearchResult {
  const root = isRecord(model) ? model : {};
  const data = isRecord(root.data) ? root.data : {};
  const offers: ChinaOffer[] = [];
  Object.values(data).forEach((raw) => {
    if (!isRecord(raw)) return;
    const stats = isRecord(raw.stats) ? raw.stats : {};
    const offerId = offerIdOf(raw.offerId ?? stats.offerId);
    const titleZh = cleanTitle(raw.title);
    if (!offerId || !titleZh) return;
    const soldText = typeof stats.totalSales === "string" && /^[<\d][\d.+万<\s]*$/.test(stats.totalSales.trim()) ? stats.totalSales.trim() : null;
    const listed = typeof stats.earliestListingTime === "string" ? /^(\d{4}-\d{2}-\d{2})/.exec(stats.earliestListingTime)?.[1] ?? null : null;
    const path = typeof stats.categoryListName === "string" ? stats.categoryListName.replace(/\s+/g, " ").trim().slice(0, 120) : null;
    offers.push({
      offerId,
      position: offers.length + 1,
      titleZh,
      imageUrl: imageOf(raw.image),
      category: path || null,
      soldText,
      soldMin: soldLowerBound(soldText),
      orders30d: null,
      listedOn: listed,
      isAd: false,
      badges: badgesOf(titleZh, {}),
      traits: [],
      sellerSlot: null,
    });
  });
  return { count: offers.length, offers, sellers: 0 };
}

// ---------------------------------------------------------------------------
// Только женское

const KIDS_RE = /童|儿童|宝宝|婴|幼/;

/**
 * Женское ли (или унисекс) по названию: детское — нет; «男» без «女» — мужское, нет. Без указания пола (сумки часто без «女») — да:
 * ниши и так ищутся с «女».
 */
export function isWomenTitle(title: string): boolean {
  if (KIDS_RE.test(title)) return false;
  if (title.includes("男") && !title.includes("女")) return false;
  return true;
}

/** Топ ниши: без платных размещений и без мужского/детского, не больше `limit`, порядок — как в выдаче 1688. */
export function nicheTop(result: ChinaSearchResult, limit: number): { offers: ChinaOffer[]; sellers: number } {
  const offers = result.offers.filter((o) => !o.isAd && isWomenTitle(o.titleZh)).slice(0, Math.max(0, limit));
  return { offers, sellers: distinctSellers(offers) };
}

// ---------------------------------------------------------------------------
// Новизна по номеру карточки (оценка)

/**
 * Опорные точки «номер карточки → дата размещения» (проба 06–07.10.2026): номера растут со временем, ≈2,8–5 млрд в неделю. Это ОЦЕНКА:
 * переразмещённая карточка получает новый номер, а точной даты в поиске товаров нет.
 */
export const OFFER_ID_ANCHORS: ReadonlyArray<readonly [number, string]> = [
  [963_177_545_730, "2025-07-20"],
  [1_007_558_400_078, "2025-12-24"],
  [1_029_094_443_070, "2026-03-12"],
  [1_064_913_903_100, "2026-07-14"],
  [1_087_400_000_000, "2026-09-30"],
  [1_090_400_000_000, "2026-10-06"],
];
/** За пределами опорных точек — средний темп (номеров в сутки). */
const IDS_PER_DAY = 300_000_000;
const DAY_MS = 24 * 3600 * 1000;
/** «Новинка» — по оценке размещена не раньше, чем за столько дней до снимка. */
export const NEW_OFFER_DAYS = 45;

const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Оценка даты размещения по номеру карточки (ГГГГ-ММ-ДД) или null. */
export function estimateListedOn(offerId: string): string | null {
  const id = Number(offerId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const a = OFFER_ID_ANCHORS;
  if (id <= a[0][0]) return isoDay(dayMs(a[0][1]) - ((a[0][0] - id) / IDS_PER_DAY) * DAY_MS);
  for (let i = 1; i < a.length; i += 1) {
    const [id0, d0] = a[i - 1];
    const [id1, d1] = a[i];
    if (id <= id1) return isoDay(dayMs(d0) + ((id - id0) / (id1 - id0)) * (dayMs(d1) - dayMs(d0)));
  }
  const [lastId, lastDay] = a[a.length - 1];
  return isoDay(dayMs(lastDay) + ((id - lastId) / IDS_PER_DAY) * DAY_MS);
}

/** Новинка по оценке: размещена не раньше NEW_OFFER_DAYS дней до дня снимка. */
export function isNewOffer(offerId: string, observedOn: string, days = NEW_OFFER_DAYS): boolean {
  const listed = estimateListedOn(offerId);
  if (!listed) return false;
  return dayMs(observedOn) - dayMs(listed) <= days * DAY_MS;
}

// ---------------------------------------------------------------------------
// Ниши (проба 06.10.2026) — в chinaNiches.ts (чистый модуль: его импортирует экран)

export { CHINA_NICHES, CHINA_NICHES_VERSION, type ChinaNiche } from "./chinaNiches";

/** Тело поиска топа ниши: основной ключ, 40 карточек, по продажам (sold_desc), пул товаров по умолчанию. */
export function nicheSearchBody(niche: Pick<ChinaNiche, "zh">, pageSize = 40): Record<string, unknown> {
  return { query: niche.zh[0], pageSize, purchaseAmount: 1, sortType: "sold_desc", scoreLevel: "high", tags: "4306497" };
}

// ---------------------------------------------------------------------------
// Номера товаров брендов: поиск копий

export type ChinaBrand = "zara" | "uniqlo";

export interface BrandRef {
  key: string;
  brand: ChinaBrand;
  /** Zara — 7 цифр (модель + качество без «/»), Uniqlo — 6 цифр. */
  number: string;
}

/** «zara:8372288» / «uniqlo:487517» → номер; остальное — null. */
export function parseRefKey(key: string): BrandRef | null {
  const m = /^(zara|uniqlo):(\d+)$/.exec(String(key ?? "").trim());
  if (!m) return null;
  const brand = m[1] as ChinaBrand;
  if (brand === "zara" && !/^\d{7}$/.test(m[2])) return null;
  if (brand === "uniqlo" && !/^\d{6}$/.test(m[2])) return null;
  return { key: `${brand}:${m[2]}`, brand, number: m[2] };
}

/** Как продавцы 1688 называют бренды (прямые «ZARA同款» / «优衣库同款» 1688 фильтрует): первый — для запроса. */
export const BRAND_ALIASES: Record<ChinaBrand, readonly string[]> = {
  zara: ["ZA", "Za", "Z家", "ZA家", "PB&ZA", "TAOP&ZA", "MYST&ZA", "Mzbs&Za", "UC&ZA", "ZAZA", "TRAF"],
  uniqlo: ["U家", "Uの", "日单", "优衣库"],
};

/** Слово категории для запроса по номеру: поиск смысловой, голый номер даёт мусор. */
const REF_CATEGORY_WORD: Record<AssortmentDirection, string> = { jackets: "外套", bags: "包" };

/** Запрос по номеру: псевдоним бренда, номер, категория раздела, «女» (как в пробе: «ZA 8372288 夹克 女»). */
export function refQuery(ref: BrandRef, direction: AssortmentDirection | null): string {
  return [BRAND_ALIASES[ref.brand][0], ref.number, direction ? REF_CATEGORY_WORD[direction] : null, "女"].filter(Boolean).join(" ");
}

/** Тело поиска по номеру: 40 карточек по релевантности (сортировка по продажам тут не нужна). */
export function refSearchBody(ref: BrandRef, direction: AssortmentDirection | null, pageSize = 40): Record<string, unknown> {
  return { query: refQuery(ref, direction), pageSize, purchaseAmount: 1, scoreLevel: "high", tags: "4306497" };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Стоит ли номер в названии (правило «Как считаем» на экране):
 * - Zara — эти 7 цифр (модель + качество) не внутри другого числа; цвет бывает через пробел («6318268 600») или приклеен — ровно три
 *   цифры («8372288600», полный номер Zara без косых); «ZA8372288» — да. 8 или 11 цифр подряд — уже другое число, не номер.
 * - Uniqlo — эти 6 цифр не внутри другого числа; впереди допускается одна заглавная буква («R487517», «E469955»), в том числе сразу после
 *   года («2025R487517»), и приклеенное название бренда («UNIQLO487517»). Не номер: буква — часть слова («AR487517»), строчная буква
 *   («x487517»), семь цифр («款号 4875171»).
 * Номер в другом написании (с косыми, через дефис, словами) не засчитывается: копии — оценка снизу.
 */
export function titleHasRef(title: string, ref: Pick<BrandRef, "brand" | "number">): boolean {
  const n = escapeRe(ref.number);
  const re = ref.brand === "zara"
    ? new RegExp(`(?<!\\d)${n}(?:\\d{3})?(?!\\d)`)
    : new RegExp(`(?:(?<![A-Za-z])[A-Z]|(?<![\\dA-Za-z])|(?<=[Uu][Nn][Ii][Qq][Ll][Oo]))${n}(?!\\d)`);
  return re.test(title);
}

/** Псевдоним бренда в названии (без номера такая карточка — только кандидат). */
export function titleHasAlias(title: string, brand: ChinaBrand): boolean {
  if (brand === "zara") return /(?<![A-Za-z])(?:PB&ZA|TAOP&ZA|MYST&ZA|Mzbs&Za|UC&ZA|ZAZA|ZA家|Z家|ZA|Za|TRAF)(?![a-z])/.test(title);
  return /U家|Uの|日单|优衣库/.test(title);
}

export interface RefCopies {
  /** Карточек с номером в названии (среди пришедших). */
  offers: number;
  /** Разных продавцов среди них — число, без самих продавцов. Полнота поиска 6–8% — нижняя граница, оценка. */
  sellers: number;
  /** Из них с псевдонимом бренда в названии. */
  withAlias: number;
  /** До пяти номеров карточек — для ссылок «посмотреть на 1688». */
  sampleOfferIds: string[];
}

/** Копии номера в выдаче: карточки, где номер стоит в названии. Платные размещения не исключаются — это тоже копия. */
export function countRefCopies(offers: readonly ChinaOffer[], ref: Pick<BrandRef, "brand" | "number">): RefCopies {
  const hits = offers.filter((o) => titleHasRef(o.titleZh, ref));
  return {
    offers: hits.length,
    sellers: distinctSellers(hits),
    withAlias: hits.filter((o) => titleHasAlias(o.titleZh, ref.brand)).length,
    sampleOfferIds: hits.slice(0, 5).map((o) => o.offerId),
  };
}

// ---------------------------------------------------------------------------
// Тренд ключа (shopkeeper offer_hot): markdown → числа

export interface MarketTrend {
  keyword: string | null;
  /** Среднесуточно просматривающих покупателей (市场规模) — факт 1688. */
  buyersPerDay: number | null;
  /** Среднесуточно показанных товаров (供给规模) — факт 1688. */
  supplyPerDay: number | null;
  /** Соотношение покупателей и товаров (供需比) — расчёт 1688. */
  ratio: number | null;
  /** Изменение к прошлому году, % (年同比) — расчёт 1688. */
  yoyPct: number | null;
  /** Помесячный ряд «ГГГГММ → покупателей в день» (отставание 5–6 недель). */
  series: Array<{ month: string; value: number }>;
  /** Хиты Taobao: число товаров и доли TOP1 / TOP3 в трафике, %. Цены раздела не читаются. */
  taobaoItems: number | null;
  top1Pct: number | null;
  top3Pct: number | null;
}

const numOf = (s: string | undefined) => {
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * Разбор markdown тренда. Читаются только строки: 查询关键词, 市场规模, 供给规模, 供需比, 年同比增长, ряд «- ГГГГММ: N» (до раздела
 * «淘宝爆款概况»), а в разделе хитов Taobao — 商品数量 и 流量分布 (TOP1 / TOP3). Средняя и медианная цена и распределение цен не
 * читаются вовсе.
 */
export function parseOfferHot(bizData: unknown): MarketTrend | null {
  if (typeof bizData !== "string" || !bizData.trim()) return null;
  const [trendPart, taobaoPart = ""] = bizData.split(/^##\s*淘宝爆款概况/m);
  const keyword = /\*\*查询关键词\*\*[：:]\s*([^\n]+)/.exec(trendPart)?.[1]?.trim().slice(0, 40) ?? null;
  const buyersPerDay = numOf(/\*\*市场规模\*\*[：:]\s*日均\s*([\d,]+(?:\.\d+)?)/.exec(trendPart)?.[1]);
  const supplyPerDay = numOf(/\*\*供给规模\*\*[：:]\s*日均\s*([\d,]+(?:\.\d+)?)/.exec(trendPart)?.[1]);
  const ratio = numOf(/供需比\s*([\d.]+)/.exec(trendPart)?.[1]);
  const yoyPct = numOf(/\*\*年同比增长\*\*[：:]\s*([+-]?[\d.]+)%/.exec(trendPart)?.[1]);
  const series: MarketTrend["series"] = [];
  const monthly = /####\s*\d+\.\s*月度趋势[^\n]*\n([\s\S]*?)(?=\n####|\n##|$)/.exec(trendPart)?.[1] ?? "";
  for (const m of monthly.matchAll(/^-\s*(20\d{2}(?:0[1-9]|1[0-2]))\s*[：:]\s*([\d,]+(?:\.\d+)?)/gm)) {
    const value = numOf(m[2]);
    if (value != null && !series.some((p) => p.month === m[1])) series.push({ month: m[1], value });
  }
  series.sort((a, b) => a.month.localeCompare(b.month));
  const taobaoItems = numOf(/\*\*商品数量\*\*[：:]\s*([\d,]+)/.exec(taobaoPart)?.[1]);
  const top1Pct = numOf(/TOP1\s*占比[：:]\s*([\d.]+)%/.exec(taobaoPart)?.[1]);
  const top3Pct = numOf(/TOP3\s*占比[：:]\s*([\d.]+)%/.exec(taobaoPart)?.[1]);
  if (buyersPerDay == null && series.length === 0) return null;
  return { keyword, buyersPerDay, supplyPerDay, ratio, yoyPct, series, taobaoItems, top1Pct, top3Pct };
}

/** Тело запроса тренда. */
export function trendBody(keyword: string): Record<string, unknown> {
  return { code: "offer_hot", bizParams: { query: keyword } };
}

// ---------------------------------------------------------------------------
// «Возможности» (shopkeeper offer_opportunity): темы последнего часа, все категории вперемешку

export interface OpportunityTopic {
  platform: string;
  section: "trend" | "hot";
  rank: number;
  topic: string;
  /** «+166%» или «777.1万» — как дал 1688. */
  count: string | null;
  isUp: boolean | null;
  /** Поисковые слова темы и рост поиска, % («搜索增速NN%»). */
  words: Array<{ word: string; growthPct: number | null }>;
  direction: AssortmentDirection;
}

const JACKET_WORDS = /外套|夹克|茄克|风衣|羽绒|棉服|棉衣|皮衣|大衣|冲锋衣|摇粒绒|抓绒|面包服|棒球服/;
/**
 * Сумки — только названия видов сумок: голое «包» значит и «пачку» (大包抽纸 — салфетки), и хлеб (面包), и «包邮» (бесплатная доставка).
 */
const BAG_WORDS = /包包|女包|手提包|单肩包|斜挎包|托特|腋下包|水桶包|双肩包|背包|法棍包|饺子包|马鞍包|信封包|流浪包|帆布包|链条包|手拿包|枕头包|波士顿包|贝壳包|菜篮子包|hobo|购物袋/i;

/** Раздел темы по словам; не наша категория, мужское или детское — null. */
export function topicDirection(text: string): AssortmentDirection | null {
  if (!isWomenTitle(text)) return null;
  if (JACKET_WORDS.test(text)) return "jackets";
  if (BAG_WORDS.test(text)) return "bags";
  return null;
}

const OPPORTUNITY_PLATFORMS = ["1688", "taobao", "xiaohongshu"] as const;

/** Разбор «возможностей»: только темы наших категорий (куртки, сумки) и не мужские/детские. */
export function parseOpportunities(model: unknown): OpportunityTopic[] {
  const root = isRecord(model) ? model : {};
  const biz = isRecord(root.bizData) ? root.bizData : {};
  const out: OpportunityTopic[] = [];
  for (const platform of OPPORTUNITY_PLATFORMS) {
    const byPlatform = isRecord(biz[platform]) ? biz[platform] : {};
    for (const section of ["trend", "hot"] as const) {
      const block = isRecord(byPlatform[section]) ? byPlatform[section] : {};
      const detail = Array.isArray(block.detail) ? block.detail : [];
      const graphic = isRecord(block.graphic) && Array.isArray(block.graphic.list) ? block.graphic.list : [];
      for (const raw of detail) {
        if (!isRecord(raw) || typeof raw.topic !== "string") continue;
        const topic = cleanTitle(raw.topic).slice(0, 40);
        const words = (Array.isArray(raw.content) ? raw.content : []).filter(isRecord).map((c) => ({
          word: cleanTitle(c.searchWord).slice(0, 40),
          growthPct: numOf(/搜索增速\s*([\d.]+)%/.exec(String(c.text ?? ""))?.[1]),
        })).filter((w) => w.word);
        const direction = topicDirection([topic, ...words.map((w) => w.word)].join(" "));
        if (!topic || !direction) continue;
        const g = graphic.find((item) => isRecord(item) && item.topic === raw.topic) as Record<string, unknown> | undefined;
        const count = typeof g?.count === "string" && /^[+-]?[\d.]+%$|^[\d.]+万?$/.test(g.count.trim()) ? g.count.trim() : null;
        out.push({
          platform,
          section,
          rank: nonNegInt(raw.rank) ?? out.length + 1,
          topic,
          count,
          isUp: typeof g?.isUp === "boolean" ? g.isUp : null,
          words,
          direction,
        });
      }
    }
  }
  return out;
}

export const OPPORTUNITY_BODY: Record<string, unknown> = { code: "offer_opportunity" };
