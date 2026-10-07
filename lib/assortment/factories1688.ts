import { randomUUID } from "node:crypto";
import {
  call1688, China1688Error, CHINA_STOP_WORDS, chinaKeyRaw, classifyBizError, classifyHttpStatus, FIND_PRODUCT_PATH, isChina1688Error, parseAk, signHeaders,
  type CallOptions,
} from "./china1688";
import { entityFromName, type EntityKind } from "./factoryGuide";

/**
 * «Фабрики сумок (1688)» — клиент навыков поиска поставщиков (1688-source-suppliers) и 88查 (1688-common-cha88-company-risk) и разбор
 * ответов в «режиме фабрик». Подпись x-csk-* — та же, что у поиска товаров (china1688.ts), ключ — тот же ALI_1688_AK; хост навыков —
 * skills-gateway.1688.com, версия в подписи — 1.0.0 (как в _const.py официальных клиентов).
 *
 * ВЖИВУЮ НЕ ПРОВЕРЕНО: файла ключа для пробы не было, поэтому source_suppliers и 88查 разобраны по исходникам официальных навыков (их
 * парсеры — эталон формы ответа), а разбор терпим к отсутствующим полям. Поиск товаров (find.product) проверен вживую 07.10 — здесь он же,
 * но со своим разбором: «режим фабрик» ЧИТАЕТ свойства магазина, цены и минимальную партию (решение владельца 07.10: «по ценам я пойму
 * качество товара» — только в разделе фабрик). Трендовый разбор parseFindProduct не меняется: в трендах цен и продавцов по-прежнему нет.
 *
 * Людей не читаем: из 88查 legal_name (законный представитель — человек) и contentChinese (тексты дел с именами сторон) вырезаются при
 * разборе, из адреса остаётся только регион, город и район. Телефонов, WeChat и логинов в этих ответах нет — и не появятся в разборе:
 * поля берутся по белому списку. Пишущие навыки 1688 (запросы поставщикам, закупка, сообщения) не вызываются и не встроены.
 */

export const SKILLS_GATEWAY_BASE = "https://skills-gateway.1688.com";
export const SOURCE_SUPPLIERS_PATH = "/api/1688_source_suppliers/1.0.0";
export const COMPANY_SEARCH_PATH = "/api/companySearch/1.0.0";
export const COMPANY_RISK_PATH = "/api/companyRisk/1.0.0";
export const SKILLS_GATEWAY_VERSION = "1.0.0";
/** Поиск поставщиков отвечает потоком; официальный клиент ждёт до 60 с. */
export const SUPPLIERS_TIMEOUT_MS = 60_000;
export const CHA88_TIMEOUT_MS = 30_000;
/** Поиск товаров для фабрик: как в пробе (40 карточек по продажам), без повторов — на поиск не больше двух запросов 1688. */
export const FACTORY_PRODUCTS_PAGE = 40;
/** Риски компании за один запрос (официальный клиент по умолчанию берёт 10; больше — счёт по типам полнее). */
export const RISK_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Ошибки: одной строкой

export type FactorySourceStatus = "ok" | "unavailable" | "rate_limit" | "no_key" | "error";

export const FACTORY_WORDS = {
  unavailable: "этот навык 1688 нашим ключом недоступен",
  rate_limit: "1688 просит подождать (лимит запросов) — повторите через пару минут",
  no_key: CHINA_STOP_WORDS.no_key,
} as const;

/** Коды, которыми шлюз говорит «у ключа нет права на этот навык». */
const UNAVAILABLE_CODES = new Set(["APIUnsupported", "1688_no_scope_specified", "1688_invalid_scope", "1688_token_unauthorized"]);

/**
 * Ошибка вызова → состояние источника: ключ не принят (401, SignatureInvalid), навык не в правах ключа (APIUnsupported,
 * 1688_no_scope_specified) — «этот навык нашим ключом недоступен»; 429 / Qos* — «подождать» (повторит человек, автоматически не
 * повторяем); прочее — сбой одной строкой.
 */
export function factoryErrorState(error: unknown): { status: Exclude<FactorySourceStatus, "ok">; reason: string } {
  if (!isChina1688Error(error)) return { status: "error", reason: "1688: сбой запроса" };
  if (error.kind === "no_key") return { status: "no_key", reason: FACTORY_WORDS.no_key };
  if (error.kind === "auth" || (error.code != null && UNAVAILABLE_CODES.has(error.code))) return { status: "unavailable", reason: FACTORY_WORDS.unavailable };
  if (error.kind === "rate_limit") return { status: "rate_limit", reason: FACTORY_WORDS.rate_limit };
  return { status: "error", reason: error.message.slice(0, 160) };
}

// ---------------------------------------------------------------------------
// Вызов skills-gateway

export type SkillsGatewayOptions = Pick<CallOptions, "env" | "fetchImpl" | "now" | "nonce"> & { timeoutMs?: number };

function isNetworkError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  return name === "TimeoutError" || name === "AbortError" || /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network/i.test(message);
}

/**
 * Один подписанный POST на skills-gateway; ответ — тело как текст (у поиска поставщиков — склейка потока). Повторов нет: на поиск
 * фабрик — не больше двух запросов 1688, на проверку компании — двух. Ключ не уходит ни в тело, ни в сообщения об ошибках.
 */
export async function callSkillsGateway(path: string, body: Record<string, unknown>, options: SkillsGatewayOptions = {}): Promise<string> {
  const keys = parseAk(chinaKeyRaw(options.env ?? process.env));
  if (!keys) throw new China1688Error(CHINA_STOP_WORDS.no_key, "no_key");
  const fetchImpl = options.fetchImpl ?? fetch;
  const text = JSON.stringify(body);
  const headers = signHeaders({
    method: "POST",
    path,
    body: text,
    keys,
    version: SKILLS_GATEWAY_VERSION,
    timestamp: Math.floor((options.now?.() ?? Date.now()) / 1000),
    nonce: options.nonce?.() ?? randomUUID().replace(/-/g, "").slice(0, 8),
  });
  let response: Response;
  try {
    response = await fetchImpl(`${SKILLS_GATEWAY_BASE}${path}`, { method: "POST", headers, body: text, signal: AbortSignal.timeout(options.timeoutMs ?? CHA88_TIMEOUT_MS) });
  } catch (error) {
    throw isNetworkError(error) ? new China1688Error("1688: сеть или таймаут", "transient") : new China1688Error("1688: запрос не ушёл", "service");
  }
  if (response.status !== 200) throw classifyHttpStatus(response.status);
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    throw new China1688Error("1688: ответ оборвался при чтении", "transient");
  }
  if (!raw.trim()) throw new China1688Error("1688: пустой ответ", "service");
  return raw;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function dig(value: unknown, ...path: string[]): unknown {
  let cur: unknown = value;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** JSON-ответ 88查: success:false — бизнес-ошибка (как _handle_biz_error); полезная часть — data. */
export function cha88Payload(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new China1688Error("1688: ответ 88查 не JSON", "service");
  }
  if (!isRecord(parsed)) throw new China1688Error("1688: ответ 88查 не объект", "service");
  if (parsed.success === false) throw classifyBizError(parsed);
  const data = parsed.data;
  if (!isRecord(data)) throw new China1688Error("1688: в ответе 88查 нет data", "service");
  return data;
}

// ---------------------------------------------------------------------------
// Поток поиска поставщиков

/** Объекты JSON верхнего уровня подряд в тексте (куски потока, строки «data: {...}», NDJSON) — по скобкам вне строк. */
export function splitJsonObjects(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      if (depth > 0) inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          // битый кусок — пропускаем
        }
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Поток source_suppliers → один объект ответа. Как у официального клиента: все куски склеиваются и разбираются одним JSON. Не разобрался
 * (куски SSE «data: …» или объекты подряд) — фазы собираются в originResponses; кусок с success:false — ответ-ошибка.
 */
export function readSupplierStream(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  try {
    const one = JSON.parse(trimmed) as unknown;
    if (isRecord(one)) return one;
  } catch {
    // ниже — по кускам
  }
  const objects = splitJsonObjects(trimmed).filter(isRecord);
  if (objects.length === 0) throw new China1688Error("1688: ответ поиска поставщиков не разобран", "service");
  const failure = objects.find((o) => o.success === false);
  if (failure) return failure;
  const phases: unknown[] = [];
  for (const o of objects) {
    if (typeof o.currentPhase === "string") phases.push(o);
    for (const list of [o.originResponses, dig(o, "data", "result", "originResponses"), dig(o, "data", "result", "model")]) {
      if (Array.isArray(list)) phases.push(...list);
    }
  }
  return { success: true, originResponses: phases };
}

/** Фаза RETRIEVAL с непустым списком (как _find_retrieval_data). */
function retrievalData(list: unknown): unknown[] {
  if (!Array.isArray(list)) return [];
  for (const item of list) {
    if (!isRecord(item) || item.currentPhase !== "RETRIEVAL") continue;
    const data = dig(item, "responseData", "data");
    if (Array.isArray(data) && data.length > 0) return data;
  }
  return [];
}

/** Записи фабрик из ответа: originResponses сверху, data.result.originResponses или data.result.model (три формы официального клиента). */
export function supplierRecords(result: Record<string, unknown>): unknown[] {
  const top = Array.isArray(result.originResponses) && result.originResponses.length > 0 ? result.originResponses : dig(result, "data", "result", "originResponses");
  const found = retrievalData(top);
  if (found.length > 0) return found;
  return retrievalData(dig(result, "data", "result", "model"));
}

export interface SupplierFactory {
  /** № в выдаче поиска поставщиков (score 1688 не выводится и оценкой не называется). */
  rank: number;
  /** Название как дал 1688 — внутри разбора; наружу выходит только у юрлиц (см. factoryCards). */
  companyName: string;
  /** Ссылка на магазин 1688 (фактически id продавца). */
  companyUrl: string | null;
  /** OEM / ODM — заявление продавца. */
  oemModes: string[];
  /** 清加工 (давальческий) / 包工包料 (полный цикл) — заявление продавца. */
  manufactureTypes: string[];
  province: string | null;
  city: string | null;
  factoryLevel: string | null;
  factoryTypeTags: string[];
  recTags: string[];
  /** Удовлетворённость как дал 1688 (формула неизвестна) и число, если читается. */
  satisfiedText: string | null;
  satisfiedPct: number | null;
  /** pay_ord_byr_cnt_1m_004: «заказов или покупателей за месяц» — смысл не подтверждён. */
  monthBuyers: number | null;
  /** «Делает образцы» (打样) — заявление; null — нет данных (отсутствие поля не значит «нет»). */
  proofing: true | null;
}

const cleanText = (value: unknown, max: number): string => String(value ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = cleanText(value, 120);
  return name || null;
}

/** Ссылка на магазин: только https на домене 1688.com (http повышается, хост — строчными), без якоря и не длиннее 400 знаков. */
export function shopUrlOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw) || /[\s"'<>]/.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!/^([a-z0-9-]+\.)*1688\.com$/.test(host) || parsed.username || parsed.password || parsed.port) return null;
  const url = `https://${host}${parsed.pathname}${parsed.search}`;
  return url.length <= 400 ? url : null;
}

/** Поле-список: массив, строка JSON-массива («["OEM","ODM"]») или перечисление через запятую. До 10 значений по 40 знаков. */
export function listField(value: unknown): string[] {
  let items: unknown[] = [];
  if (Array.isArray(value)) items = value;
  else if (typeof value === "string" && value.trim()) {
    const s = value.trim();
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s) as unknown;
        items = Array.isArray(parsed) ? parsed : [];
      } catch {
        items = [];
      }
    } else items = s.split(/[,，;；、|]/);
  }
  const out: string[] = [];
  for (const item of items) {
    const v = cleanText(item, 40);
    if (v && v !== "null" && !out.includes(v)) out.push(v);
    if (out.length >= 10) break;
  }
  return out;
}

/** Счётчик: число или строка («1234», «1.2万+», «100+»); иначе null. */
export function countOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  if (typeof value !== "string") return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(万)?\s*\+?\s*$/.exec(value.replace(/,/g, ""));
  if (!m) return null;
  return Math.floor(Number(m[1]) * (m[2] ? 10_000 : 1));
}

/** Удовлетворённость: «98%», «0.98», «满意度98%» → проценты; текст — как дал 1688. */
export function satisfiedOf(value: unknown): { text: string | null; pct: number | null } {
  if (value == null || value === "") return { text: null, pct: null };
  const text = cleanText(value, 40) || null;
  if (!text) return { text: null, pct: null };
  const m = /(\d+(?:\.\d+)?)\s*(%)?/.exec(text);
  if (!m) return { text, pct: null };
  const n = Number(m[1]);
  const pct = m[2] ? n : n <= 1 ? n * 100 : n <= 100 ? n : null;
  return { text, pct: pct == null || !Number.isFinite(pct) ? null : Math.round(pct * 10) / 10 };
}

const yes = (value: unknown) => value === true || value === "Y" || value === "y" || value === "true" || value === 1;

/**
 * Ответ source_suppliers → фабрики по порядку выдачи. Терпимо к отсутствующим полям: без названия запись не берётся (как у официального
 * клиента), а нехватка OEM / типа производства — «не указано», а не выброс записи (официальный клиент такие выбрасывает молча). Повтор
 * названия — один раз, по первой позиции. extInfos ищется в записи, а поля — и на верхнем уровне записи.
 */
export function parseSourceSuppliers(result: Record<string, unknown>): SupplierFactory[] {
  const out: SupplierFactory[] = [];
  const seen = new Set<string>();
  for (const raw of supplierRecords(result)) {
    if (!isRecord(raw)) continue;
    const companyName = cleanName(raw.companyName);
    if (!companyName) continue;
    const key = companyName.normalize("NFKC").replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const ext = isRecord(raw.extInfos) ? raw.extInfos : {};
    const field = (name: string) => (ext[name] ?? raw[name]);
    const satisfied = satisfiedOf(field("satisfied_rate_std_001"));
    out.push({
      rank: out.length + 1,
      companyName,
      companyUrl: shopUrlOf(raw.companyUrl),
      oemModes: listField(field("oem_mode")).map((m) => (/^(oem|odm|obm)$/i.test(m) ? m.toUpperCase() : m)),
      manufactureTypes: listField(field("manufacture_type")),
      province: cleanText(field("reg_prov_name"), 20) || null,
      city: cleanText(field("reg_city_name"), 20) || null,
      factoryLevel: cleanText(field("factory_level"), 40) || null,
      factoryTypeTags: listField(field("factory_type_tag")),
      recTags: listField(field("rec_tags")),
      satisfiedText: satisfied.text,
      satisfiedPct: satisfied.pct,
      monthBuyers: countOf(field("pay_ord_byr_cnt_1m_004")),
      proofing: yes(field("is_proofing")) ? true : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Поиск товаров в «режиме фабрик»: свойства магазина, цены, минимальная партия

/** Ступень цены от партии: от minQty штук — price ¥ за шт. */
export interface PriceTier {
  minQty: number;
  price: number;
}

export interface ShopProps {
  /** shop_year_count — стаж на 1688, лет (что считается — стаж 诚信通 или возраст магазина — не документировано). */
  years: number | null;
  /** repeated_rate — доля повторных покупателей (回头率), 0–1. */
  repeatRate: number | null;
  /** customer_scale — масштаб клиентской базы (определение не документировано). */
  customerScale: number | null;
  officialPartner: boolean | null;
}

export interface FactoryOffer {
  offerId: string;
  /** Позиция в выдаче 1688 (с 1; строки SKU одной карточки — по первой). */
  position: number;
  titleZh: string;
  imageUrl: string | null;
  detailUrl: string;
  categoryId: string | null;
  /** Продавец как дал 1688 (company) — внутри разбора: наружу — по правилам карточки фабрики. */
  seller: string | null;
  /** Цена карточки, ¥ за шт.: минимум и максимум по строкам SKU (currentPrice). */
  priceMin: number | null;
  priceMax: number | null;
  /** Ступени цены от партии — если 1688 дал их списком (в живых образцах 07.10 priceTags — только флаги, ступеней нет). */
  priceTiers: PriceTier[];
  /** quantityBegin — минимальная партия, шт. */
  moq: number | null;
  unit: string | null;
  orders30d: number | null;
  puhuo30d: number | null;
  officialInspection: boolean;
  /** rfd_quality_rate — возвраты по качеству, %. */
  qualityRefundPct: number | null;
  invoice: "special" | "ordinary" | null;
  /** lgt_3m_24h_avg — доля передачи курьеру за 24 ч, 0–1 (0 не отличить от «нет данных»). */
  ship24h: number | null;
  lateShipCompensate: boolean | null;
  payLater: boolean;
  ship48h: boolean;
  shop: ShopProps | null;
}

function offerIdOf(value: unknown): string | null {
  const s = typeof value === "number" ? (Number.isSafeInteger(value) ? String(value) : null) : typeof value === "string" ? value.trim() : null;
  return s && /^\d{6,16}$/.test(s) ? s : null;
}

function imageOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim().split(/[?#]/)[0];
  return /^https:\/\/[a-z0-9.-]*alicdn\.com\/[^\s"'<>]+$/.test(url) ? url : null;
}

function nonNeg(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const MAX_PRICE = 1_000_000;

/** Цена: число, строка «12.8» или диапазон «12.8-15» → [мин, макс]; «PRICE» обезличенных образцов и мусор — null. */
export function priceRangeOf(value: unknown): [number, number] | null {
  const nums: number[] = [];
  if (typeof value === "number") nums.push(value);
  else if (typeof value === "string") for (const m of value.matchAll(/\d+(?:\.\d+)?/g)) nums.push(Number(m[0]));
  const ok = nums.filter((n) => Number.isFinite(n) && n > 0 && n < MAX_PRICE);
  if (ok.length === 0) return null;
  return [Math.min(...ok), Math.max(...ok)];
}

const QTY_KEYS = ["minQty", "startQuantity", "beginAmount", "quantity", "minQuantity", "begin", "start_quantity", "amount"];
const PRICE_KEYS = ["price", "value", "unitPrice"];

/**
 * Ступени цены: любой список объектов «от N шт. — цена» в priceTags (массив или строка JSON). Флаги вида is_price_stable_30d (так выглядел
 * priceTags в живых образцах) ступенями не считаются. До 6 ступеней, по возрастанию партии.
 */
export function priceTiersOf(priceTags: unknown): PriceTier[] {
  if (!isRecord(priceTags) && !Array.isArray(priceTags)) return [];
  const lists: unknown[] = Array.isArray(priceTags) ? [priceTags] : Object.values(priceTags);
  for (const candidate of lists) {
    let list: unknown = candidate;
    if (typeof list === "string" && list.trim().startsWith("[")) {
      try {
        list = JSON.parse(list);
      } catch {
        continue;
      }
    }
    if (!Array.isArray(list)) continue;
    const tiers: PriceTier[] = [];
    for (const item of list) {
      if (!isRecord(item)) continue;
      const qtyKey = QTY_KEYS.find((k) => item[k] != null);
      const priceKey = PRICE_KEYS.find((k) => item[k] != null);
      if (!qtyKey || !priceKey) continue;
      const minQty = nonNeg(item[qtyKey]);
      const price = priceRangeOf(item[priceKey])?.[0] ?? null;
      if (minQty == null || minQty < 1 || price == null) continue;
      if (!tiers.some((t) => t.minQty === Math.floor(minQty))) tiers.push({ minQty: Math.floor(minQty), price });
    }
    if (tiers.length > 0) return tiers.sort((a, b) => a.minQty - b.minQty).slice(0, 6);
  }
  return [];
}

function cateIdOf(qualityTags: unknown): string | null {
  if (!isRecord(qualityTags)) return null;
  const raw = qualityTags.core_decision_attr;
  if (typeof raw !== "string") return null;
  try {
    const id = String((JSON.parse(raw) as { cate_id?: unknown })?.cate_id ?? "").trim();
    return /^\d{1,12}$/.test(id) ? id : null;
  } catch {
    return /"cate_id"\s*:\s*"(\d{1,12})"/.exec(raw)?.[1] ?? null;
  }
}

function invoiceOf(serviceTags: Record<string, unknown>): "special" | "ordinary" | null {
  const raw = serviceTags.invoice_content;
  let kp: unknown = null;
  if (typeof raw === "string") {
    try {
      kp = (JSON.parse(raw) as { kp_type?: unknown })?.kp_type ?? null;
    } catch {
      kp = /专票|普票/.exec(raw)?.[0] ?? null;
    }
  } else if (isRecord(raw)) kp = raw.kp_type;
  if (kp === "专票") return "special";
  if (kp === "普票") return "ordinary";
  return null;
}

/** «0.0%» → 0, «3.5%» → 3.5. */
function percentOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(value);
  return m ? Number(m[1]) : null;
}

function shopOf(raw: Record<string, unknown>): ShopProps | null {
  const m = isRecord(raw.merchantReputationTags) ? raw.merchantReputationTags : null;
  if (!m) return null;
  const years = nonNeg(m.shop_year_count);
  let repeat = nonNeg(m.repeated_rate);
  if (repeat != null && repeat > 1) repeat = repeat <= 100 ? repeat / 100 : null;
  const scale = nonNeg(m.customer_scale);
  return {
    years: years == null || years > 60 ? null : Math.floor(years),
    repeatRate: repeat == null ? null : Math.round(repeat * 10_000) / 10_000,
    customerScale: scale == null ? null : Math.floor(scale),
    officialPartner: m.is_official_partner === "Y" ? true : m.is_official_partner === "N" ? false : null,
  };
}

function serviceValues(raw: Record<string, unknown>): string[] {
  return (Array.isArray(raw.serviceInfos) ? raw.serviceInfos : []).filter(isRecord).map((s) => String(s.value ?? ""));
}

/**
 * Ответ find.product (`data` конверта gateway) → карточки для фабрик. Строки SKU одной карточки сворачиваются по номеру (позиция — первая,
 * цена — от минимума до максимума по строкам). Читаются: название, фото, номер, категория, продавец (company), цена (currentPrice),
 * ступени цены (priceTags, если это список), минимальная партия (quantityBegin), свойства магазина (merchantReputationTags), сервис
 * (serviceTags, serviceInfos), качество (qualityTags.rfd_quality_rate, offerICTagInfo.isOfficialInspection), заказы и перепродавцы за 30 дней
 * (oldReputationTags). Не читаются: rankedContent (пересказ ИИ 1688), promotionTags, offerTags, userId / memberId.
 */
export function parseFactoryProducts(data: unknown): FactoryOffer[] {
  const root = isRecord(data) ? data : {};
  const list = Array.isArray(root.data) ? root.data : [];
  const byId = new Map<string, FactoryOffer>();
  const out: FactoryOffer[] = [];
  list.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const offerId = offerIdOf(raw.itemId);
    if (!offerId) return;
    const price = priceRangeOf(raw.currentPrice);
    const prev = byId.get(offerId);
    if (prev) {
      if (price) {
        prev.priceMin = prev.priceMin == null ? price[0] : Math.min(prev.priceMin, price[0]);
        prev.priceMax = prev.priceMax == null ? price[1] : Math.max(prev.priceMax, price[1]);
      }
      if (prev.priceTiers.length === 0) prev.priceTiers = priceTiersOf(raw.priceTags);
      return;
    }
    const titleZh = cleanText(raw.title, 200);
    if (!titleZh) return;
    const service = isRecord(raw.serviceTags) ? raw.serviceTags : {};
    const quality = isRecord(raw.qualityTags) ? raw.qualityTags : {};
    const rep = isRecord(raw.oldReputationTags) ? raw.oldReputationTags : {};
    const ic = isRecord(raw.offerICTagInfo) ? raw.offerICTagInfo : {};
    const services = serviceValues(raw);
    const ship = nonNeg(service.lgt_3m_24h_avg);
    const moq = nonNeg(raw.quantityBegin);
    const offer: FactoryOffer = {
      offerId,
      position: index + 1,
      titleZh,
      imageUrl: imageOf(raw.imageUrl),
      detailUrl: `https://detail.1688.com/offer/${offerId}.html`,
      categoryId: cateIdOf(raw.qualityTags),
      seller: cleanName(raw.company),
      priceMin: price?.[0] ?? null,
      priceMax: price?.[1] ?? null,
      priceTiers: priceTiersOf(raw.priceTags),
      moq: moq == null || moq < 1 ? null : Math.floor(moq),
      unit: cleanText(raw.unit, 6) || null,
      orders30d: countOf(rep.pay_ord_cnt_30d),
      puhuo30d: countOf(rep.puhuo_cnt_30d),
      officialInspection: ic.isOfficialInspection === true || services.includes("官方验货"),
      qualityRefundPct: percentOf(quality.rfd_quality_rate),
      invoice: invoiceOf(service),
      ship24h: ship == null || ship > 1 ? null : ship,
      lateShipCompensate: service.is_late_ship_compensate === "Y" ? true : service.is_late_ship_compensate === "N" ? false : null,
      payLater: services.includes("先采后付"),
      ship48h: services.some((v) => /(24|48)小时发货/.test(v)),
      shop: shopOf(raw),
    };
    byId.set(offerId, offer);
    out.push(offer);
  });
  return out;
}

/** Тело поиска товаров для фабрик: тот же запрос, 40 карточек по продажам, пул по умолчанию (как у снимка ниш). */
export function factoryProductsBody(queryZh: string): Record<string, unknown> {
  return { query: queryZh, pageSize: FACTORY_PRODUCTS_PAGE, purchaseAmount: 1, sortType: "sold_desc", scoreLevel: "high", tags: "4306497" };
}

// ---------------------------------------------------------------------------
// 88查: поиск компании и риски

export type RegistryEntity = EntityKind;

export interface CompanyCandidate {
  entity: RegistryEntity;
  /** Название — только у юрлица (без разметки <em>). */
  name: string | null;
  /** Единый кредитный код (统一社会信用代码) — только у юрлица. */
  creditCode: string | null;
  status: string | null;
  /** Действует (存续 / 在业 / 开业): true; ликвидирована, отозвана и т. п.: false; иначе null. */
  active: boolean | null;
  establishedOn: string | null;
  entType: string | null;
  /** Уставный капитал как в реестре (легко подогнать — не опора). */
  regCapText: string | null;
  /** Регион, город и район из адреса — без улицы и дома. */
  area: string | null;
}

/** Вид лица по типу из реестра: 个体 / 个人独资 — ИП (человек), 公司 / 企业 / 合作社 — юрлицо. */
export function entityFromType(entType: string | null | undefined): RegistryEntity {
  const t = String(entType ?? "");
  if (/个体|个人独资/.test(t)) return "individual";
  if (/公司|企业|合作社|集团/.test(t)) return "company";
  return "unknown";
}

export function statusActive(status: string | null | undefined): boolean | null {
  const s = String(status ?? "");
  if (!s) return null;
  if (/注销|吊销|撤销|迁出|停业|清算|歇业/.test(s)) return false;
  if (/存续|在业|开业|在营|正常/.test(s)) return true;
  return null;
}

/** Дата в ГГГГ-ММ-ДД: «2015-03-12», «2015-03-12 00:00:00», «2015/3/2» или миллисекунды. */
export function isoDayOf(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(value.trim());
  if (!m) return /^\d{12,13}$/.test(value.trim()) ? isoDayOf(Number(value)) : null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/** Из адреса — только провинция, город и район (до 区 / 县 / 旗 / 市 / 镇 второго уровня); улица и дом отрезаются. */
export function areaOf(address: unknown): string | null {
  if (typeof address !== "string") return null;
  const s = address.normalize("NFKC").replace(/\s+/g, "");
  const m = /^((?:[^省市区县]{2,7}(?:省|自治区))?)((?:[^省市区县路街道号巷村楼室弄]{2,7}(?:市|自治州|地区|盟))?)((?:[^省市区县镇乡路街道号巷村楼室弄栋层厦场城]{1,6}(?:区|县|旗|市))?)/.exec(s);
  const area = m ? `${m[1]}${m[2]}${m[3]}` : "";
  return area || null;
}

function stripEm(value: unknown): string {
  return cleanText(String(value ?? "").replace(/<\/?em>/gi, ""), 120);
}

function regCapOf(row: Record<string, unknown>): string | null {
  const cap = cleanText(row.reg_cap, 30);
  if (!cap) return null;
  const currency = cleanText(row.currencyType, 10);
  return currency && !cap.includes(currency) ? `${cap} (${currency})` : cap;
}

/**
 * Ответ companySearch (`data`) → кандидаты. legal_name (это человек) не читается вовсе; у ИП (个体工商户) — ни названия, ни кредитного
 * кода (по решению владельца у ИП храним только псевдоним и ссылку; тёзок человек сверяет по городу); из адреса — только регион и район.
 */
export function parseCompanySearch(data: unknown): { total: number | null; candidates: CompanyCandidate[] } {
  const root = isRecord(data) ? data : {};
  const list = Array.isArray(root.data) ? root.data : Array.isArray(root.list) ? root.list : Array.isArray(dig(root, "result", "data")) ? (dig(root, "result", "data") as unknown[]) : [];
  const candidates: CompanyCandidate[] = [];
  for (const raw of list) {
    if (!isRecord(raw)) continue;
    const entType = cleanText(raw.ent_type, 40) || null;
    const name = stripEm(raw.ent_name);
    // Тип из реестра — главный признак; его нет — оценка по названию (суффикс 有限公司 и т. п.).
    let entity = entityFromType(entType);
    if (entity === "unknown") entity = entityFromName(name);
    const code = typeof raw.social_credit_code === "string" && /^[0-9A-Z]{18}$/.test(raw.social_credit_code.trim()) ? raw.social_credit_code.trim() : null;
    const status = cleanText(raw.ent_status, 20) || null;
    candidates.push({
      entity,
      name: entity === "company" && name ? name : null,
      creditCode: entity === "company" ? code : null,
      status,
      active: statusActive(status),
      establishedOn: isoDayOf(raw.es_date),
      entType,
      regCapText: regCapOf(raw),
      area: areaOf(raw.address),
    });
    if (candidates.length >= 10) break;
  }
  return { total: countOf(root.total), candidates };
}

export interface RiskTypeCount {
  mainType: string;
  subType: string | null;
  count: number;
  lastOn: string | null;
}

export interface CompanyRisk {
  /** Сколько рисков насчитал 88查 (total). */
  total: number | null;
  /** Сколько записей пришло в этом ответе (одна страница — счёт по типам может быть неполным). */
  fetched: number;
  byType: RiskTypeCount[];
  lastOn: string | null;
  /** 失信被执行人 — «недобросовестный должник». */
  dishonest: number;
  /** 经营异常 — «нарушения в деятельности»: число и дата последнего. */
  abnormal: { count: number; lastOn: string | null };
}

/**
 * Ответ companyRisk (`data`, у шлюза — ещё одна вложенная data) → число рисков по типам и дата последнего. contentChinese (тексты дел
 * с именами сторон), companyName и rowId не читаются.
 */
export function parseCompanyRisk(data: unknown): CompanyRisk {
  const outer = isRecord(data) ? data : {};
  const inner = isRecord(outer.data) && ("riskMap" in outer.data || "total" in outer.data) ? outer.data : outer;
  const riskMap = isRecord(inner.riskMap) ? inner.riskMap : {};
  const counts = new Map<string, RiskTypeCount>();
  let fetched = 0;
  let lastOn: string | null = null;
  let dishonest = 0;
  const abnormal = { count: 0, lastOn: null as string | null };
  for (const [mainTypeRaw, records] of Object.entries(riskMap)) {
    const mainType = cleanText(mainTypeRaw, 20) || "прочее";
    for (const r of Array.isArray(records) ? records : []) {
      if (!isRecord(r)) continue;
      fetched += 1;
      const subType = cleanText(r.subType, 20) || null;
      const on = isoDayOf(r.time) ?? isoDayOf(r.timeStamp);
      const key = `${mainType}|${subType ?? ""}`;
      const prev = counts.get(key) ?? { mainType, subType, count: 0, lastOn: null };
      prev.count += 1;
      if (on && (!prev.lastOn || on > prev.lastOn)) prev.lastOn = on;
      counts.set(key, prev);
      if (on && (!lastOn || on > lastOn)) lastOn = on;
      const both = `${mainType} ${subType ?? ""}`;
      if (/失信/.test(both)) dishonest += 1;
      if (/经营异常/.test(both)) {
        abnormal.count += 1;
        if (on && (!abnormal.lastOn || on > abnormal.lastOn)) abnormal.lastOn = on;
      }
    }
  }
  const byType = [...counts.values()].sort((a, b) => b.count - a.count || a.mainType.localeCompare(b.mainType));
  return { total: countOf(inner.total), fetched, byType, lastOn, dishonest, abnormal };
}

export const companySearchBody = (name: string): Record<string, unknown> => ({ query: name, pageNo: 1, pageSize: 10 });

/** Тело запроса рисков: как у официального клиента — page и pageSize строками, companyId пустой. */
export const companyRiskBody = (creditCode: string): Record<string, unknown> => ({ companyId: "", pageSize: String(RISK_PAGE_SIZE), page: "1", socialCreditCode: creditCode });

// ---------------------------------------------------------------------------
// Вызовы для поиска и проверки (подставляются тестами)

export interface FactoryCallers {
  /** source_suppliers → объект ответа (поток уже склеен). */
  suppliers(queryZh: string): Promise<Record<string, unknown>>;
  /** find.product → `data` конверта gateway. */
  products(queryZh: string): Promise<unknown>;
  /** companySearch → `data`. */
  companySearch(name: string): Promise<Record<string, unknown>>;
  /** companyRisk → `data`. */
  companyRisk(creditCode: string): Promise<Record<string, unknown>>;
}

/** Настоящие вызовы с ключом из окружения. Ответ success:false поиска поставщиков — бизнес-ошибка (как у официального клиента). */
export function makeFactoryCallers(options: SkillsGatewayOptions = {}): FactoryCallers {
  return {
    async suppliers(queryZh) {
      const raw = await callSkillsGateway(SOURCE_SUPPLIERS_PATH, { query: queryZh }, { ...options, timeoutMs: options.timeoutMs ?? SUPPLIERS_TIMEOUT_MS });
      const result = readSupplierStream(raw);
      if (result.success === false) throw classifyBizError(result);
      return result;
    },
    products: (queryZh) => call1688("gateway", FIND_PRODUCT_PATH, factoryProductsBody(queryZh), { env: options.env, fetchImpl: options.fetchImpl, now: options.now, nonce: options.nonce, retries: 0 }),
    async companySearch(name) {
      return cha88Payload(await callSkillsGateway(COMPANY_SEARCH_PATH, companySearchBody(name), options));
    },
    async companyRisk(creditCode) {
      return cha88Payload(await callSkillsGateway(COMPANY_RISK_PATH, companyRiskBody(creditCode), options));
    },
  };
}
