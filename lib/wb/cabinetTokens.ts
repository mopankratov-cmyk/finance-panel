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
  is_active: boolean;
}

const CABINET_COLS = "id, name, seller_id, inn, token, token_advert, token_content, is_active";

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
