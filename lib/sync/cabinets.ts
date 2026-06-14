// Цели синхронизации WB: по одному на активный кабинет из wb_cabinets.
// Если кабинетов ещё нет — fallback на ENV-токены (поведение 1:1 как раньше,
// существующие строки помечены cabinet_id = NULL).

import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export interface SyncTarget {
  cabinetId: string | null; // null = ENV-кабинет (legacy-строки)
  name: string;
  statsToken: string; // Статистика + Аналитика (orders/sales/stocks/funnel)
  advertToken: string; // Продвижение (adverts/advert-stats)
}

export async function getWbSyncTargets(): Promise<SyncTarget[]> {
  const cabs = await getActiveWbCabinets();
  if (cabs.length) {
    return cabs.map((c) => ({
      cabinetId: c.id,
      name: c.name,
      statsToken: c.token,
      advertToken: c.token_advert || c.token,
    }));
  }
  const env = process.env.WB_STATS_TOKEN || process.env.WB_TOKEN_STATISTICS;
  if (!env) return [];
  return [
    {
      cabinetId: null,
      name: "env",
      statsToken: env,
      advertToken: process.env.WB_TOKEN_ADVERT || env,
    },
  ];
}

// Курсор: последняя дата в таблице в разрезе кабинета (для инкрементального dateFrom).
export async function lastSyncDate(table: string, cabinetId: string | null): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  let q = db.from(table).select("date").order("date", { ascending: false }).limit(1);
  q = cabinetId === null ? q.is("cabinet_id", null) : q.eq("cabinet_id", cabinetId);
  const { data } = await q.maybeSingle();
  return (data as { date?: string } | null)?.date ?? null;
}
