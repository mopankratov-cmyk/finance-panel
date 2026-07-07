// Источник истины для токенов WB — таблица wb_cabinets, а не ENV.
// Одна модель: основной `token` (в идеале со всеми scope), а token_advert/
// token_content — необязательный fallback для тех, у кого исторически отдельные ключи.

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { WbScope } from "@/lib/wb/token";

export interface WbCabinet {
  id: string;
  name: string;
  seller_id: string | null;
  inn: string | null;
  token: string;
  token_advert: string | null;
  token_content: string | null;
  token_feedbacks: string | null;
  is_active: boolean;
}

const CABINET_COLS = "id, name, seller_id, inn, token, token_advert, token_content, token_feedbacks, is_active";

// Активные WB-кабинеты (для цикла синка по всем юрлицам).
export async function getActiveWbCabinets(): Promise<WbCabinet[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data, error } = await db
    .from("wb_cabinets")
    .select(CABINET_COLS)
    .eq("marketplace", "wb")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data as WbCabinet[];
}

export async function getWbCabinet(id: string): Promise<WbCabinet | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("wb_cabinets").select(CABINET_COLS).eq("id", id).maybeSingle();
  return (data as WbCabinet) ?? null;
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
export async function getWbReportTokens(cabinetId: string | null): Promise<{ key: string; token: string }[]> {
  const cabs = await getActiveWbCabinets();
  if (cabs.length) {
    const sel = cabinetId ? cabs.filter((c) => c.id === cabinetId) : cabs;
    return sel.map((c) => ({ key: c.id, token: c.token }));
  }
  const env = process.env.WB_STATS_TOKEN || process.env.WB_TOKEN_STATISTICS;
  return env ? [{ key: "env", token: env }] : [];
}

// Источники по кабинету (id + имя + токен нужного scope) для живых WB-вызовов.
// cabinetId задан → один кабинет; null → все активные. Нет кабинетов → ENV-фолбэк.
export async function getWbCabinetSources(cabinetId: string | null, scope: WbScope): Promise<{ id: string | null; name: string; token: string }[]> {
  const cabs = await getActiveWbCabinets();
  if (cabs.length) {
    const sel = cabinetId ? cabs.filter((c) => c.id === cabinetId) : cabs;
    return sel.map((c) => ({ id: c.id, name: c.name, token: resolveWbToken(c, scope) }));
  }
  const env =
    scope === "content" ? process.env.WB_TOKEN_CONTENT :
    scope === "advert" ? process.env.WB_TOKEN_ADVERT :
    scope === "feedbacks" ? process.env.WB_TOKEN_FEEDBACKS :
    (process.env.WB_STATS_TOKEN || process.env.WB_TOKEN_STATISTICS);
  return env ? [{ id: null, name: "Магазин", token: env }] : [];
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
