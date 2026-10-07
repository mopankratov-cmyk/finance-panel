import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/auth/permissions";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { moscowToday } from "@/lib/sync/moscowDay";
import { CHINA_STOP_WORDS, chinaKeyConfigured } from "./china1688";
import type { AssortmentDirection } from "./constants";
import { isMissingAssortmentSchema } from "./errors";
import type { FactoryCard, FactoryFlag, RegistryFacts } from "./factoryCards";
import type { EntityKind, FactoryClusterKey } from "./factoryGuide";
import {
  CHECKLIST_VALUE_LABEL, CHECKLIST_VALUES, FACTORY_CHECKLIST, FACTORY_STATUS_LABEL, FACTORY_STATUSES, parseFactoryStatus,
  type ChecklistKey, type ChecklistKind, type FactoryStatus,
} from "./factoryUi";

/**
 * «Фабрики сумок (1688)» — шорт-лист: только фабрики, которые человек сам отправил кнопкой «В шорт-лист». Снимок показателей и цен
 * берётся с сервера (из кэша поиска по searchId), а не с экрана. У юрлица — название, ссылка и кредитный код (если проверяли в 88查), у ИП
 * и неясных — псевдоним «Фабрика N» и ссылка. Статус (кандидат → написали → видеозвонок → образец заказан → образец получен → одобрен /
 * отклонён с причиной) с историей «кто и когда», ручной чек-лист (пункты раздельно, без суммы), заметка — без телефонов, WeChat и почты.
 *
 * Права (решение владельца 07.10): смотреть — все роли модуля (director, buyer, wb_manager), искать, проверять и править — director и
 * buyer. Без миграции шорт-лист скрыт (причина одной строкой), без ключа 1688 вкладки «Фабрики (1688)» нет.
 */

export const FACTORY_MIGRATION = "202610070010_assortment_cn_factories.sql";
export const FACTORY_SEARCH_TABLE = "assortment_cn_factory_search";
export const SHORTLIST_TABLE = "assortment_cn_factory";

export const FACTORY_MIGRATION_WORDS = `шорт-лист фабрик не создан — нужна миграция ${FACTORY_MIGRATION}`;
export const FACTORY_ONLY_BAGS_WORDS = "фабрики 1688 — только в разделе «Сумки» (куртки в Китае не закупаем)";

/** Кто ищет, проверяет и правит шорт-лист: закупщик и директор. wb_manager — только смотрит. */
export const FACTORY_EDIT_ROLES: readonly Role[] = ["director", "buyer"];

export function canEditFactories(roles: readonly Role[]): boolean {
  return roles.some((role) => FACTORY_EDIT_ROLES.includes(role));
}

/** Вкладка «Фабрики (1688)»: только в «Сумках» и только с ключом 1688. */
export function factoriesTab(direction: AssortmentDirection | null, env: Record<string, string | undefined> = process.env): { visible: boolean; reason: string | null } {
  if (direction !== "bags") return { visible: false, reason: FACTORY_ONLY_BAGS_WORDS };
  if (!chinaKeyConfigured(env)) return { visible: false, reason: CHINA_STOP_WORDS.no_key };
  return { visible: true, reason: null };
}

// Статусы и чек-лист — словарь экрана и сервера один (lib/assortment/factoryUi.ts: экран не тянет node:crypto и базу).
export {
  CHECKLIST_VALUE_LABEL, CHECKLIST_VALUES, FACTORY_CHECKLIST, FACTORY_STATUS_LABEL, FACTORY_STATUSES, parseFactoryStatus,
  type ChecklistKey, type ChecklistKind, type FactoryStatus,
};

export interface ChecklistMark {
  value: string | number;
  by: string;
  at: string;
}

export class FactoryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactoryInputError";
  }
}

export class FactoryConflictError extends Error {
  constructor(message = "запись уже изменили — обновите страницу") {
    super(message);
    this.name = "FactoryConflictError";
  }
}

export class FactoryNotFoundError extends Error {
  constructor(message = "фабрики нет в шорт-листе") {
    super(message);
    this.name = "FactoryNotFoundError";
  }
}

export class FactoryTableMissingError extends Error {
  constructor() {
    super(FACTORY_MIGRATION_WORDS);
    this.name = "FactoryTableMissingError";
  }
}

/** Значение пункта чек-листа: null — снять отметку; иначе — по виду пункта (да / нет / не ясно, оценка, число). */
export function checklistValue(key: string, value: unknown): string | number | null {
  const item = FACTORY_CHECKLIST.find((i) => i.key === key);
  if (!item) throw new FactoryInputError(`нет такого пункта чек-листа: ${key}`);
  if (value === null) return null;
  if (item.kind === "number") {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new FactoryInputError(`${item.label}: целое число от 0`);
    return n;
  }
  if (typeof value !== "string" || !CHECKLIST_VALUES[item.kind].includes(value)) throw new FactoryInputError(`${item.label}: ${CHECKLIST_VALUES[item.kind].join(" / ")}`);
  return value;
}

/** Слова перед числом, после которых это не телефон: номер карточки 1688, трек образца, номер заказа, артикул. */
const NOT_PHONE_CONTEXT = /(?:карточк\S*|offer\S*|оффер\S*|трек\S*|track\S*|заказ\S*|order\S*|артикул\S*|арт\.|накладн\S*|№|#)\s*[:：]?\s*$/i;

/**
 * Похоже ли на номер телефона: КНР — мобильный 1[3-9] + 9 цифр (с +86 / 86 спереди или без), городской 0 + код + номер (10–12 цифр); РФ —
 * +7 / 7 / 8 и 10 цифр; любой номер, записанный с «+», — 10–15 цифр. Номера карточек 1688 (12–13 цифр), трек-номера (SF…, 12–15 цифр),
 * партии «1000 2000 3000» и даты — не телефоны.
 */
function looksLikePhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return digits.length >= 10 && digits.length <= 15;
  return /^(?:86)?1[3-9]\d{9}$/.test(digits) || /^(?:86)?0[1-9]\d{8,10}$/.test(digits) || /^[78]\d{10}$/.test(digits);
}

/**
 * Телефоны, WeChat и почта в заметке или причине — нельзя (решение владельца: контакты людей не храним). Ответ — что найдено, или null.
 * Номером считается только то, что похоже на телефон КНР или РФ (looksLikePhone); цепочка цифр вплотную к буквам (SF1234567890123) и число
 * после слов «карточка / offer / трек / заказ / артикул / №» — не телефон: это то, что закупщик пишет на шагах «образец заказан / получен».
 */
export function contactProblem(text: string): string | null {
  // Цепочка цифр с пробелами, скобками и дефисами; внутри — окна из соседних групп: «партия 300 13800000000» — телефон во втором окне.
  for (const m of text.matchAll(/(?<![\p{L}\d])\+?\d[\d\s()-]{6,}\d(?![\p{L}\d])/gu)) {
    const start = m.index ?? 0;
    const groups = [...m[0].matchAll(/\+?\d+/g)].map((g) => ({ text: g[0], at: start + (g.index ?? 0) }));
    for (let i = 0; i < groups.length; i += 1) {
      if (NOT_PHONE_CONTEXT.test(text.slice(Math.max(0, groups[i].at - 24), groups[i].at))) continue;
      let joined = "";
      for (let j = i; j < groups.length && j < i + 6; j += 1) {
        joined += groups[j].text;
        if (looksLikePhone(joined)) return "похоже на номер телефона";
      }
    }
  }
  if (/微信|wechat|weixin|(?<![a-z])(?:vx|wx)\s*[:：号]/i.test(text)) return "похоже на WeChat";
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text)) return "похоже на почту";
  return null;
}

function cleanFreeText(value: unknown, max: number, what: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new FactoryInputError(`${what}: текст`);
  const text = value.replace(/\r\n/g, "\n").trim();
  if (!text) return null;
  if (text.length > max) throw new FactoryInputError(`${what}: не длиннее ${max} знаков`);
  const problem = contactProblem(text);
  if (problem) throw new FactoryInputError(`${what}: ${problem} — контакты людей не храним (телефоны, WeChat, почта)`);
  return text;
}

// ---------------------------------------------------------------------------
// Чтение

export interface StatusStep {
  status: FactoryStatus;
  reason: string | null;
  by: string;
  at: string;
}

export interface ShortlistItem {
  id: string;
  factoryKey: string;
  entity: EntityKind;
  /** Название юрлица или псевдоним «Фабрика N». */
  displayName: string;
  name: string | null;
  pseudonym: string | null;
  shopUrl: string | null;
  creditCode: string | null;
  province: string | null;
  city: string | null;
  cluster: FactoryClusterKey | null;
  offerIds: string[];
  queryZh: string | null;
  snapshot: ShortlistSnapshot;
  snapshotOn: string;
  status: FactoryStatus;
  statusLabel: string;
  rejectReason: string | null;
  history: StatusStep[];
  checklist: Partial<Record<ChecklistKey, ChecklistMark>>;
  note: string | null;
  registry: StoredRegistry | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Снимок на дату добавления: что человек видел — показатели, флаги, цены, партия, карточки (без фото: в адресе фото зашит id загрузившего). */
export interface ShortlistSnapshot {
  origin: FactoryCard["origin"];
  region: string | null;
  supplierRank: number | null;
  productRank: number | null;
  indicators: FactoryCard["indicators"];
  flags: FactoryFlag[];
  prices: FactoryCard["prices"];
  moq: FactoryCard["moq"];
  offers: Array<{ offerId: string; titleZh: string; detailUrl: string; priceMin: number | null; priceMax: number | null; moq: number | null; orders30d: number | null }>;
}

export type StoredRegistry = Omit<RegistryFacts, "indicators"> & { checkedBy: string; checkedAt: string };

interface Row {
  id: string;
  factory_key: string;
  entity: EntityKind;
  company_name: string | null;
  pseudonym: string | null;
  shop_url: string | null;
  credit_code: string | null;
  province: string | null;
  city: string | null;
  cluster_key: string | null;
  offer_ids: string[] | null;
  query_zh: string | null;
  snapshot: ShortlistSnapshot;
  snapshot_on: string;
  status: FactoryStatus;
  reject_reason: string | null;
  status_history: StatusStep[] | null;
  checklist: Record<string, ChecklistMark> | null;
  note: string | null;
  registry: StoredRegistry | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

const COLUMNS = "id,factory_key,entity,company_name,pseudonym,shop_url,credit_code,province,city,cluster_key,offer_ids,query_zh,snapshot,snapshot_on,status,reject_reason,status_history,checklist,note,registry,created_by,created_at,updated_by,updated_at";

function missing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || isMissingAssortmentSchema(new Error(error.message ?? ""));
}

type Page<R> = PromiseLike<{ data: R[] | null; error: { message: string } | null }>;

function toItem(r: Row): ShortlistItem {
  const status = parseFactoryStatus(r.status) ?? "candidate";
  return {
    id: r.id,
    factoryKey: r.factory_key,
    entity: r.entity,
    displayName: r.entity === "company" && r.company_name ? r.company_name : r.pseudonym ?? "Фабрика",
    name: r.entity === "company" ? r.company_name : null,
    pseudonym: r.pseudonym,
    shopUrl: r.shop_url,
    creditCode: r.entity === "company" ? r.credit_code : null,
    province: r.province,
    city: r.city,
    cluster: (r.cluster_key as FactoryClusterKey | null) ?? null,
    offerIds: r.offer_ids ?? [],
    queryZh: r.query_zh,
    snapshot: r.snapshot,
    snapshotOn: r.snapshot_on,
    status,
    statusLabel: FACTORY_STATUS_LABEL[status],
    rejectReason: r.reject_reason,
    history: Array.isArray(r.status_history) ? r.status_history : [],
    checklist: (r.checklist ?? {}) as ShortlistItem["checklist"],
    note: r.note,
    registry: r.registry,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface ShortlistView {
  tab: { visible: boolean; reason: string | null };
  shortlist: { available: boolean; reason: string | null };
  canEdit: boolean;
  items: ShortlistItem[];
}

/** Шорт-лист целиком (листанием по 1 000), порядок — по времени добавления. Без миграции — available: false и причина. */
export async function loadShortlist(db: SupabaseClient): Promise<{ available: boolean; reason: string | null; items: ShortlistItem[] }> {
  try {
    const rows = await loadAllSupabasePages<Row>((from, to) => db.from(SHORTLIST_TABLE).select(COLUMNS)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to) as unknown as Page<Row>, { label: "Шорт-лист фабрик" });
    return { available: true, reason: null, items: rows.map(toItem) };
  } catch (error) {
    if (missing(error as { message?: string }) || isMissingAssortmentSchema(error)) return { available: false, reason: FACTORY_MIGRATION_WORDS, items: [] };
    throw error;
  }
}

async function loadRow(db: SupabaseClient, column: "id" | "factory_key", value: string): Promise<Row | null> {
  const { data, error } = await db.from(SHORTLIST_TABLE).select(COLUMNS).eq(column, value).maybeSingle();
  if (error) {
    if (missing(error)) throw new FactoryTableMissingError();
    throw new Error(`${SHORTLIST_TABLE}: ${error.message}`);
  }
  return (data as Row | null) ?? null;
}

/**
 * Стереть выдачи старше 7 дней (решение владельца: «поиск — кэш 7 дней»; в кэше — названия юрлиц, ссылки на магазины и адреса фото).
 * Зовётся в начале каждого поиска (и при попадании в кэш) и при открытии вкладки — не только после записи новой выдачи. Без миграции и при
 * сбое — тихо: уборка не должна ронять поиск.
 */
export async function purgeExpiredSearches(db: SupabaseClient, nowMs: number): Promise<void> {
  try {
    await db.from(FACTORY_SEARCH_TABLE).delete().lt("expires_at", new Date(nowMs).toISOString());
  } catch {
    // уборка — по возможности
  }
}

/** 23505 по уникальному псевдониму (а не по ключу фабрики): «Фабрику N» успел занять другой — берём следующий номер. */
const pseudonymTaken = (error: { code?: string; message?: string } | null | undefined) => error?.code === "23505" && /pseudonym/i.test(error.message ?? "");

/** Следующий номер псевдонима: «Фабрика N» — больше всех занятых (уникальность держит индекс миграции, гонку — повтор при 23505). */
async function nextPseudonym(db: SupabaseClient): Promise<string> {
  const rows = await loadAllSupabasePages<{ pseudonym: string | null }>((from, to) => db.from(SHORTLIST_TABLE).select("id,pseudonym").not("pseudonym", "is", null)
    .order("id", { ascending: true }).range(from, to) as unknown as Page<{ pseudonym: string | null }>, { label: "Псевдонимы фабрик" });
  const max = rows.reduce((m, r) => Math.max(m, Number(/^Фабрика (\d{1,5})$/.exec(r.pseudonym ?? "")?.[1] ?? 0)), 0);
  return `Фабрика ${max + 1}`;
}

// ---------------------------------------------------------------------------
// «В шорт-лист»

export function snapshotOf(card: FactoryCard): ShortlistSnapshot {
  return {
    origin: card.origin,
    region: card.region,
    supplierRank: card.supplierRank,
    productRank: card.productRank,
    indicators: card.indicators,
    flags: card.flags,
    prices: card.prices,
    moq: card.moq,
    offers: card.offers.slice(0, 20).map((o) => ({ offerId: o.offerId, titleZh: o.titleZh, detailUrl: o.detailUrl, priceMin: o.priceMin, priceMax: o.priceMax, moq: o.moq, orders30d: o.orders30d })),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Запись шорт-листа с любой из этих карточек 1688: карточка принадлежит одному продавцу, значит это он же (под старым ключом). */
async function loadByOffers(db: SupabaseClient, offerIds: readonly string[]): Promise<Row | null> {
  if (offerIds.length === 0) return null;
  const { data, error } = await db.from(SHORTLIST_TABLE).select(COLUMNS).overlaps("offer_ids", [...offerIds]).order("created_at", { ascending: true }).limit(1);
  if (error) {
    if (missing(error)) throw new FactoryTableMissingError();
    throw new Error(`${SHORTLIST_TABLE}: ${error.message}`);
  }
  return ((data ?? []) as Row[])[0] ?? null;
}

/**
 * «В шорт-лист» { searchId, key }: карточка берётся из кэша поиска на сервере (не старше 7 дней), снимок — на сегодня. Фабрика уже в
 * шорт-листе — возвращается существующая запись (created: false; у отклонённой — со статусом и причиной), снимок не переписывается. «Уже в
 * шорт-листе» — по ключу фабрики (он один для всех поисков: юрлицо — по названию, ИП — псевдоним-HMAC) или по общей карточке 1688.
 */
export async function addToShortlist(
  db: SupabaseClient, input: { searchId: string; key: string; who: string; nowMs?: number },
): Promise<{ item: ShortlistItem; created: boolean }> {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const { data, error } = await db.from(FACTORY_SEARCH_TABLE).select("id,query_zh,result,expires_at").eq("id", input.searchId).maybeSingle();
  if (error) {
    if (missing(error)) throw new FactoryTableMissingError();
    throw new Error(`${FACTORY_SEARCH_TABLE}: ${error.message}`);
  }
  const search = data as { id: string; query_zh: string; result: unknown; expires_at: string } | null;
  if (!search || !(Date.parse(search.expires_at) > nowMs)) throw new FactoryInputError("результат поиска не найден или старше 7 дней — повторите поиск");
  const result = isRecord(search.result) ? search.result : {};
  const cards = [...(Array.isArray(result.factories) ? result.factories : []), ...(Array.isArray(result.sellers) ? result.sellers : [])] as FactoryCard[];
  const card = cards.find((c) => isRecord(c) && c.key === input.key);
  if (!card || !card.key) throw new FactoryInputError("этой фабрики нет в результате поиска");

  const offerIds = card.offers.slice(0, 20).map((o) => o.offerId);
  const already = async () => (await loadRow(db, "factory_key", card.key as string)) ?? (await loadByOffers(db, offerIds));
  const existing = await already();
  if (existing) return { item: toItem(existing), created: false };

  const company = card.entity === "company" && Boolean(card.name);
  const row: Row = {
    id: randomUUID(),
    factory_key: card.key,
    entity: company ? "company" : card.entity === "company" ? "unknown" : card.entity,
    company_name: company ? (card.name as string).slice(0, 120) : null,
    pseudonym: company ? null : await nextPseudonym(db),
    shop_url: card.shopUrl,
    credit_code: null,
    province: card.province,
    city: card.city,
    cluster_key: card.cluster,
    offer_ids: offerIds,
    query_zh: search.query_zh,
    snapshot: snapshotOf(card),
    snapshot_on: moscowToday(nowMs),
    status: "candidate",
    reject_reason: null,
    status_history: [{ status: "candidate", reason: null, by: input.who, at: nowIso }],
    checklist: {},
    note: null,
    registry: null,
    created_by: input.who.slice(0, 200),
    created_at: nowIso,
    updated_by: input.who.slice(0, 200),
    updated_at: nowIso,
  };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { error: insertError } = await db.from(SHORTLIST_TABLE).insert(row);
    if (!insertError) return { item: toItem(row), created: true };
    if (missing(insertError)) throw new FactoryTableMissingError();
    if ((insertError as { code?: string }).code !== "23505") throw new Error(`${SHORTLIST_TABLE}: ${insertError.message}`);
    // Её только что добавил другой человек — отдаём его запись; «Фабрику N» занял другой ИП — следующий номер.
    const raced = await already();
    if (raced) return { item: toItem(raced), created: false };
    if (!pseudonymTaken(insertError) || row.pseudonym == null) throw new Error(`${SHORTLIST_TABLE}: ${insertError.message}`);
    row.pseudonym = await nextPseudonym(db);
  }
  throw new Error(`${SHORTLIST_TABLE}: псевдоним не выдался — повторите`);
}

// ---------------------------------------------------------------------------
// Правка: статус, чек-лист, заметка

export interface ShortlistPatch {
  status?: unknown;
  reason?: unknown;
  checklist?: unknown;
  note?: unknown;
  /** updated_at, который видел человек: запись успели изменить — конфликт, а не тихая перезапись. */
  updatedAt?: unknown;
}

/**
 * Правка записи: статус ставит только человек (отклонение — с причиной), каждая смена статуса — в историю «кто и когда»; пункты
 * чек-листа — по одному, без суммы; заметка — без контактов людей. Сравнение-и-замена по updated_at.
 */
export async function patchShortlist(db: SupabaseClient, input: { id: string; patch: ShortlistPatch; who: string; nowMs?: number }): Promise<ShortlistItem> {
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();
  const row = await loadRow(db, "id", input.id);
  if (!row) throw new FactoryNotFoundError();
  const p = input.patch;
  if (typeof p.updatedAt === "string" && p.updatedAt !== row.updated_at) throw new FactoryConflictError();
  const next: Partial<Row> = {};

  if (p.status !== undefined) {
    const status = parseFactoryStatus(p.status);
    if (!status) throw new FactoryInputError(`статус: ${FACTORY_STATUSES.join(" / ")}`);
    const reason = cleanFreeText(p.reason, 500, "Причина");
    if (status === "rejected" && !reason) throw new FactoryInputError("отклонить можно только с причиной");
    if (status !== row.status || (status === "rejected" && reason !== row.reject_reason)) {
      next.status = status;
      next.reject_reason = status === "rejected" ? reason : null;
      next.status_history = [...(Array.isArray(row.status_history) ? row.status_history : []), { status, reason: status === "rejected" ? reason : null, by: input.who, at: nowIso }];
    }
  }

  if (p.checklist !== undefined) {
    if (!isRecord(p.checklist)) throw new FactoryInputError("чек-лист: { пункт: значение }");
    const checklist: Record<string, ChecklistMark> = { ...(row.checklist ?? {}) };
    for (const [key, raw] of Object.entries(p.checklist)) {
      const value = checklistValue(key, raw);
      if (value === null) delete checklist[key];
      else checklist[key] = { value, by: input.who, at: nowIso };
    }
    next.checklist = checklist;
  }

  if (p.note !== undefined) next.note = cleanFreeText(p.note, 2000, "Заметка");

  if (Object.keys(next).length === 0) return toItem(row);
  const update = { ...next, updated_by: input.who.slice(0, 200), updated_at: nowIso };
  const { data, error } = await db.from(SHORTLIST_TABLE).update(update).eq("id", row.id).eq("updated_at", row.updated_at).select("id");
  if (error) {
    if (missing(error)) throw new FactoryTableMissingError();
    throw new Error(`${SHORTLIST_TABLE}: ${error.message}`);
  }
  if (!data || (data as unknown[]).length === 0) throw new FactoryConflictError();
  return toItem({ ...row, ...update } as Row);
}

// ---------------------------------------------------------------------------
// Проверка в реестре → запись шорт-листа

/**
 * Сохранить проверку 88查 в запись шорт-листа: факты реестра без имён и текстов дел. Кредитный код — только у юрлица. Реестр сказал «ИП» —
 * запись становится ИП: название и код стираются, остаётся псевдоним, а ключ «name:<название>» заменяется псевдонимом-HMAC (sellerKey; без
 * него — случайным): название ИП не остаётся и в ключе. Без миграции или без записи — { saved: false, reason }.
 */
export async function saveRegistryCheck(
  db: SupabaseClient,
  input: { id: string; facts: RegistryFacts; creditCode: string | null; who: string; nowMs?: number; sellerKey?: ((normalizedName: string) => string | null) | null },
): Promise<{ saved: boolean; reason: string | null }> {
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();
  const { indicators: _indicators, ...facts } = input.facts;
  const registry: StoredRegistry = { ...facts, checkedBy: input.who.slice(0, 200), checkedAt: nowIso };
  let pseudonym: string | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    let row: Row | null;
    try {
      row = await loadRow(db, "id", input.id);
    } catch (error) {
      if (error instanceof FactoryTableMissingError) return { saved: false, reason: FACTORY_MIGRATION_WORDS };
      throw error;
    }
    if (!row) return { saved: false, reason: "фабрики нет в шорт-листе — проверка не сохранена" };
    const update: Partial<Row> = { registry, updated_by: input.who.slice(0, 200), updated_at: nowIso };
    if (facts.entity === "individual") {
      update.entity = "individual";
      update.company_name = null;
      update.credit_code = null;
      pseudonym = row.pseudonym ?? pseudonym ?? await nextPseudonym(db);
      update.pseudonym = pseudonym;
      if (row.factory_key.startsWith("name:")) {
        const norm = row.factory_key.slice(5);
        const key = input.sellerKey?.(norm) ?? null;
        update.factory_key = key && /^ps:[0-9a-f]{32,128}$/.test(key) ? key : `ps:${createHash("sha256").update(randomUUID()).digest("hex")}`;
      }
    } else if (row.entity === "company" && input.creditCode && /^[0-9A-Z]{18}$/.test(input.creditCode)) {
      update.credit_code = input.creditCode;
    }
    const { data, error } = await db.from(SHORTLIST_TABLE).update(update).eq("id", row.id).eq("updated_at", row.updated_at).select("id");
    if (error) {
      if (pseudonymTaken(error) && row.pseudonym == null) {
        pseudonym = await nextPseudonym(db);
        continue;
      }
      if ((error as { code?: string }).code === "23505") return { saved: false, reason: "этот продавец уже есть в шорт-листе другой записью — проверка не сохранена" };
      throw new Error(`${SHORTLIST_TABLE}: ${error.message}`);
    }
    if (!data || (data as unknown[]).length === 0) return { saved: false, reason: "запись шорт-листа изменили во время проверки — проверка не сохранена, повторите" };
    return { saved: true, reason: null };
  }
  return { saved: false, reason: "псевдоним не выдался — проверка не сохранена, повторите" };
}
