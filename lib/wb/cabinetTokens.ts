// Источник истины для токенов WB — таблица wb_cabinets, а не ENV.
// Одна модель: основной `token` (в идеале со всеми scope), а token_advert/
// token_content — необязательный fallback для тех, у кого исторически отдельные ключи.

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { WbScope } from "@/lib/wb/token";
import { cabinetBrandFilters, type WbProductScope } from "@/lib/wb/productScope";

export interface WbCabinet {
  id: string;
  name: string;
  trade_mark: string | null;
  seller_id: string | null;
  inn: string | null;
  token: string;
  token_advert: string | null;
  token_content: string | null;
  token_feedbacks: string | null;
  brand_filters: string[];
  allowed_nm_ids: number[] | null;
  is_active: boolean;
}

type RawWbCabinet = Omit<WbCabinet, "brand_filters" | "allowed_nm_ids"> & { brand_filters?: unknown };

const CABINET_COLS = "id, name, trade_mark, seller_id, inn, token, token_advert, token_content, token_feedbacks, brand_filters, is_active";
const LEGACY_CABINET_COLS = "id, name, trade_mark, seller_id, inn, token, token_advert, token_content, token_feedbacks, is_active";

async function attachProductScopes(cabinets: RawWbCabinet[]): Promise<WbCabinet[]> {
  const db = getSupabaseAdmin();
  const normalized = cabinets.map((cab) => ({
    ...cab,
    brand_filters: cabinetBrandFilters(`${cab.name} ${cab.trade_mark ?? ""}`, cab.brand_filters),
    allowed_nm_ids: null,
  }));
  const scopedIds = normalized.filter((cab) => cab.brand_filters.length > 0).map((cab) => cab.id);
  if (!db || !scopedIds.length) return normalized;

  const { data, error } = await db
    .from("wb_cabinet_product_scope")
    .select("cabinet_id, nm_id")
    .in("cabinet_id", scopedIds)
    .limit(10_000);
  if (error) {
    // Без allowlist пропускаем только строки, где WB явно вернул разрешённый бренд;
    // записи без nm_id/brand остаются закрытыми и не смешивают кабинет целиком.
    return normalized.map((cab) => cab.brand_filters.length ? { ...cab, allowed_nm_ids: [] } : cab);
  }

  const byCabinet = new Map<string, number[]>();
  for (const row of data ?? []) {
    const id = String(row.cabinet_id);
    const nm = Number(row.nm_id);
    if (!Number.isFinite(nm)) continue;
    const list = byCabinet.get(id) ?? [];
    list.push(nm);
    byCabinet.set(id, list);
  }
  return normalized.map((cab) => cab.brand_filters.length
    ? { ...cab, allowed_nm_ids: [...new Set(byCabinet.get(cab.id) ?? [])] }
    : cab);
}

export function cabinetProductScope(cabinet: WbCabinet): WbProductScope {
  return { brandFilters: cabinet.brand_filters, allowedNmIds: cabinet.allowed_nm_ids };
}

// Активные WB-кабинеты (для цикла синка по всем юрлицам).
export async function getActiveWbCabinets(): Promise<WbCabinet[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const primary = await db
    .from("wb_cabinets")
    .select(CABINET_COLS)
    .eq("marketplace", "wb")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  let data = primary.data as RawWbCabinet[] | null;
  let error = primary.error;
  // Deploy кода и SQL-миграции могут разойтись на несколько минут. Пока
  // brand_filters ещё нет, сохраняем старое поведение вместо пустого списка кабинетов.
  if (error?.code === "42703") {
    const legacy = await db
      .from("wb_cabinets")
      .select(LEGACY_CABINET_COLS)
      .eq("marketplace", "wb")
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    data = legacy.data as RawWbCabinet[] | null;
    error = legacy.error;
  }
  if (error || !data) return [];
  return attachProductScopes(data as RawWbCabinet[]);
}

export async function getWbCabinet(id: string): Promise<WbCabinet | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const primary = await db.from("wb_cabinets").select(CABINET_COLS).eq("id", id).maybeSingle();
  let data = primary.data as RawWbCabinet | null;
  let error = primary.error;
  if (error?.code === "42703") {
    const legacy = await db.from("wb_cabinets").select(LEGACY_CABINET_COLS).eq("id", id).maybeSingle();
    data = legacy.data as RawWbCabinet | null;
    error = legacy.error;
  }
  if (error) return null;
  if (!data) return null;
  return (await attachProductScopes([data as RawWbCabinet]))[0] ?? null;
}

// Какой токен использовать для конкретной категории API.
// Статистика/Аналитика — основной токен; Продвижение/Контент — спец-токен при наличии,
// иначе тот же основной (если он выпущен со всеми scope).
export function resolveWbToken(cabinet: WbCabinet, scope: WbScope): string {
  switch (scope) {
    case "advert":
      return cabinet.token_advert || cabinet.token;
    case "content":
      return cabinet.token_content || cabinet.token;
    case "feedbacks":
      return cabinet.token_feedbacks || cabinet.token;
    case "statistics":
    case "analytics":
    default:
      return cabinet.token;
  }
}

// Токены для финотчёта WB (reportDetailByPeriod) с ключом кэша на токен.
// cabinetId задан → только этот кабинет; null → все активные (для сводного).
// Нет кабинетов в БД → ENV-токен (legacy). key используется как разделитель кэша Next.
export async function getWbReportTokens(cabinetId: string | null): Promise<Array<{ key: string; token: string; scope: WbProductScope }>> {
  const cabs = await getActiveWbCabinets();
  if (cabs.length) {
    const sel = cabinetId ? cabs.filter((c) => c.id === cabinetId) : cabs;
    return sel.map((c) => ({ key: c.id, token: c.token, scope: cabinetProductScope(c) }));
  }
  const env = process.env.WB_STATS_TOKEN || process.env.WB_TOKEN_STATISTICS;
  return env ? [{ key: "env", token: env, scope: { brandFilters: [], allowedNmIds: null } }] : [];
}

// Источники по кабинету (id + имя + токен нужного scope) для живых WB-вызовов.
// cabinetId задан → один кабинет; null → все активные. Нет кабинетов → ENV-фолбэк.
export async function getWbCabinetSources(cabinetId: string | null, scope: WbScope): Promise<Array<{ id: string | null; name: string; token: string; productScope: WbProductScope }>> {
  const cabs = await getActiveWbCabinets();
  if (cabs.length) {
    const sel = cabinetId ? cabs.filter((c) => c.id === cabinetId) : cabs;
    return sel.map((c) => ({ id: c.id, name: c.name, token: resolveWbToken(c, scope), productScope: cabinetProductScope(c) }));
  }
  const env =
    scope === "content" ? process.env.WB_TOKEN_CONTENT :
    scope === "advert" ? process.env.WB_TOKEN_ADVERT :
    scope === "feedbacks" ? process.env.WB_TOKEN_FEEDBACKS :
    (process.env.WB_STATS_TOKEN || process.env.WB_TOKEN_STATISTICS);
  return env ? [{ id: null, name: "Магазин", token: env, productScope: { brandFilters: [], allowedNmIds: null } }] : [];
}

// Токен кабинета, которому принадлежит SKU (по cabinet_id из остатков/заказов).
// Чинит 401 при per-cabinet данных: запрос по nm идёт токеном правильного юрлица.
// Не нашли кабинет → ENV-токен (legacy).
export async function wbTokenForNm(nmId: number, scope: WbScope): Promise<string | null> {
  const envTok = process.env.WB_STATS_TOKEN || process.env.WB_TOKEN_STATISTICS || null;
  const db = getSupabaseAdmin();
  if (!db) return envTok;
  let cabId: string | null = null;
  for (const table of ["wb_stocks", "wb_orders"]) {
    const { data } = await db.from(table).select("cabinet_id").eq("nm_id", nmId).not("cabinet_id", "is", null).limit(1).maybeSingle();
    if (data?.cabinet_id) { cabId = data.cabinet_id as string; break; }
  }
  if (!cabId) return envTok;
  const cab = await getWbCabinet(cabId);
  return cab ? resolveWbToken(cab, scope) : envTok;
}

// Кабинет-владелец SKU (по cabinet_id в стоках/заказах) — для диагностики (без раскрытия токена).
export async function wbCabinetForNm(nmId: number): Promise<{ id: string; name: string } | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  for (const table of ["wb_stocks", "wb_orders"]) {
    const { data } = await db.from(table).select("cabinet_id").eq("nm_id", nmId).not("cabinet_id", "is", null).limit(1).maybeSingle();
    if (data?.cabinet_id) {
      const cab = await getWbCabinet(data.cabinet_id as string);
      return cab ? { id: cab.id, name: cab.name } : null;
    }
  }
  return null;
}
