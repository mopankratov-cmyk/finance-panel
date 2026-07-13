import { normalizeCtrSnapshot, type CtrMetricSnapshot } from "@/lib/ctrtest/model";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

interface AdvertMetricRow { views: number | null; clicks: number | null; spent: number | null }
interface FunnelMetricRow { open_card: number | null; add_to_cart: number | null; orders: number | null }

export async function getCtrMetricSnapshot(cabinetId: string, nmId: number): Promise<CtrMetricSnapshot> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const [advert, funnel] = await Promise.all([
    db.from("wb_advert_nm_daily").select("views, clicks, spent").eq("cabinet_id", cabinetId).eq("nm_id", nmId).order("date", { ascending: true }).limit(10_000),
    db.from("wb_funnel_daily").select("open_card, add_to_cart, orders").eq("cabinet_id", cabinetId).eq("nm_id", nmId).order("date", { ascending: true }).limit(10_000),
  ]);
  if (advert.error) throw new Error(advert.error.message);
  if (funnel.error) throw new Error(funnel.error.message);
  const adRows = (advert.data ?? []) as AdvertMetricRow[];
  const funnelRows = (funnel.data ?? []) as FunnelMetricRow[];
  return normalizeCtrSnapshot({
    impressions: adRows.reduce((sum, row) => sum + Number(row.views ?? 0), 0),
    clicks: adRows.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0),
    spend: adRows.reduce((sum, row) => sum + Number(row.spent ?? 0), 0),
    opens: funnelRows.reduce((sum, row) => sum + Number(row.open_card ?? 0), 0),
    carts: funnelRows.reduce((sum, row) => sum + Number(row.add_to_cart ?? 0), 0),
    orders: funnelRows.reduce((sum, row) => sum + Number(row.orders ?? 0), 0),
    capturedAt: new Date().toISOString(),
  });
}

export async function ctrProductBelongsToCabinet(cabinetId: string, nmId: number): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const [stock, advert, funnel] = await Promise.all([
    db.from("wb_stocks").select("id").eq("cabinet_id", cabinetId).eq("nm_id", nmId).limit(1),
    db.from("wb_advert_nm_daily").select("id").eq("cabinet_id", cabinetId).eq("nm_id", nmId).limit(1),
    db.from("wb_funnel_daily").select("id").eq("cabinet_id", cabinetId).eq("nm_id", nmId).limit(1),
  ]);
  if (stock.error || advert.error || funnel.error) return false;
  return Boolean(stock.data?.length || advert.data?.length || funnel.data?.length);
}
