// Цели синхронизации WB: по одному на активный кабинет из wb_cabinets.
// Если кабинетов ещё нет — fallback на ENV-токены (поведение 1:1 как раньше,
// существующие строки помечены cabinet_id = NULL).

import { cabinetProductScope, getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import type { WbProductScope } from "@/lib/wb/productScope";
import { allowsBrand, isScoped } from "@/lib/wb/productScope";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export interface SyncTarget {
  cabinetId: string | null; // null = ENV-кабинет (legacy-строки)
  name: string;
  statsToken: string; // Статистика + Аналитика (orders/sales/stocks/funnel)
  advertToken: string; // Продвижение (adverts/advert-stats)
  productScope: WbProductScope; // null allowlist = весь кабинет; массив = только выбранные nm_id
}

export async function getWbSyncTargets(): Promise<SyncTarget[]> {
  const cabs = await getActiveWbCabinets();
  if (cabs.length) {
    return cabs.map((c) => ({
      cabinetId: c.id,
      name: c.name,
      statsToken: c.token,
      advertToken: c.token_advert || c.token,
      productScope: cabinetProductScope(c),
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
      productScope: { brandFilters: [], allowedNmIds: null },
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

// Новые карточки нужного бренда автоматически попадают в allowlist после первого
// появления в orders/sales/stocks. Поэтому будущие NORVIA/RIOBOX не требуют
// ручного редактирования SQL, а чужие бренды по-прежнему отсекаются до upsert.
export async function rememberScopedProducts(
  target: SyncTarget,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (!target.cabinetId || !isScoped(target.productScope)) return;
  const candidates = [...new Map(
    rows
      .filter((row) => allowsBrand(target.productScope, row.brand ?? row.brandName))
      .map((row) => ({
        nm_id: Number(row.nmId ?? row.nm_id),
        article: String(row.supplierArticle ?? row.vendorCode ?? "").trim() || null,
        brand: String(row.brand ?? row.brandName ?? "").trim() || null,
      }))
      .filter((row) => Number.isInteger(row.nm_id) && row.nm_id > 0)
      .map((row) => [row.nm_id, row]),
  ).values()];
  if (!candidates.length) return;

  const db = getSupabaseAdmin();
  if (!db) return;
  const { error } = await db.from("wb_cabinet_product_scope").upsert(
    candidates.map((row) => ({ cabinet_id: target.cabinetId, ...row })),
    { onConflict: "cabinet_id,nm_id" },
  );
  if (error) throw new Error(`product scope: ${error.message}`);

  const current = target.productScope.allowedNmIds ?? [];
  target.productScope.allowedNmIds = [...new Set([...current, ...candidates.map((row) => row.nm_id)])];
}
