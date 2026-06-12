import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const WB_ADV_TOKEN = process.env.WB_TOKEN_ADVERT;
const RECO_URL = "https://advert-api.wildberries.ru/api/advert/v0/bids/recommendations";

interface WbReco {
  base?: { competitiveBid?: { bidKopecks: number }; leadersBid?: { bidKopecks: number } };
  normQueries?: { normQuery: string; reachMedium?: { bidKopecks: number } }[];
}

// Реальные рекомендованные ставки WB по живой кампании этого nm (если есть).
async function wbRecommendation(db: ReturnType<typeof getSupabaseAdmin>, nmId: number) {
  if (!WB_ADV_TOKEN || !db) return null;
  const { data } = await db
    .from("wb_adverts")
    .select("advert_id")
    .contains("nm_ids", [nmId])
    .in("status", [9, 11])
    .limit(1);
  const advertId = data?.[0]?.advert_id;
  if (!advertId) return null;
  try {
    const res = await fetch(`${RECO_URL}?advertId=${advertId}&nmId=${nmId}`, {
      headers: { Authorization: WB_ADV_TOKEN },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const r = (await res.json()) as WbReco;
    return {
      advertId,
      competitiveCpm: r.base?.competitiveBid ? Math.round(r.base.competitiveBid.bidKopecks / 100) : null,
      leadersCpm: r.base?.leadersBid ? Math.round(r.base.leadersBid.bidKopecks / 100) : null,
      keywords: (r.normQueries ?? [])
        .slice(0, 8)
        .map((q) => ({ query: q.normQuery, cpm: q.reachMedium ? Math.round(q.reachMedium.bidKopecks / 100) : null })),
    };
  } catch {
    return null;
  }
}

// Анализ CTR по SKU + рекомендация CPM (за 14 дней).
export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });
  const nmId = Number(new URL(request.url).searchParams.get("nmId"));
  if (!nmId) return NextResponse.json({ data: null, error: "Нужен nmId" }, { status: 400 });

  const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const [funnelRes, adRes] = await Promise.all([
    db.from("wb_funnel_daily").select("open_card, add_to_cart").eq("nm_id", nmId).gte("date", since),
    db.from("wb_advert_nm_daily").select("views, clicks, spent").eq("nm_id", nmId).gte("date", since),
  ]);

  const sum = (arr: Record<string, number>[] | null, k: string) =>
    (arr ?? []).reduce((s, r) => s + Number(r[k] ?? 0), 0);

  const openCard = sum(funnelRes.data, "open_card");
  const cart = sum(funnelRes.data, "add_to_cart");
  const adViews = sum(adRes.data, "views");
  const adClicks = sum(adRes.data, "clicks");
  const adSpent = sum(adRes.data, "spent");

  const cartRate = openCard > 0 ? (cart / openCard) * 100 : null; // CV карточки
  const adCtr = adViews > 0 ? (adClicks / adViews) * 100 : null;
  const adCpc = adClicks > 0 ? adSpent / adClicks : null;
  const adCpm = adViews > 0 ? (adSpent / adViews) * 1000 : null;

  // Реальные рекомендованные ставки WB по живой кампании (если есть).
  const wbReco = await wbRecommendation(db, nmId);

  // Рекомендация: приоритет — реальные ставки WB; иначе эвристика по CTR.
  let recommendation: string;
  let recommendedCpm: number | null = null;
  if (wbReco?.competitiveCpm) {
    recommendedCpm = wbReco.competitiveCpm;
    recommendation = `WB: для удержания позиций ~${wbReco.competitiveCpm}₽ CPM, для лидерства ~${wbReco.leadersCpm ?? "?"}₽.${
      adCtr !== null ? ` Текущий CTR ${adCtr.toFixed(1)}%${adCtr < 2 ? " — низкий, сначала улучшите обложку." : "."}` : ""
    }`;
  } else if (adCtr !== null && adCpm !== null) {
    if (adCtr >= 4) {
      recommendedCpm = Math.round(adCpm * 0.9);
      recommendation = `CTR ${adCtr.toFixed(1)}% — отличный. Можно снизить CPM до ~${recommendedCpm}₽ (эвристика — нет живой кампании).`;
    } else if (adCtr < 2) {
      recommendedCpm = Math.round(adCpm);
      recommendation = `CTR ${adCtr.toFixed(1)}% — низкий. Поднимать ставку нерационально — тестируйте новую обложку.`;
    } else {
      recommendedCpm = Math.round(adCpm * 1.1);
      recommendation = `CTR ${adCtr.toFixed(1)}% — средний. Можно поднять CPM до ~${recommendedCpm}₽ (эвристика).`;
    }
  } else {
    recommendation = "Недостаточно данных по рекламе.";
  }

  return NextResponse.json({
    data: {
      openCard,
      cart,
      cartRate: cartRate !== null ? Math.round(cartRate * 10) / 10 : null,
      adViews,
      adClicks,
      adCtr: adCtr !== null ? Math.round(adCtr * 10) / 10 : null,
      adCpc: adCpc !== null ? Math.round(adCpc) : null,
      adCpm: adCpm !== null ? Math.round(adCpm) : null,
      recommendedCpm,
      recommendation,
      wbSource: !!wbReco?.competitiveCpm,
      keywords: wbReco?.keywords ?? [],
    },
    error: null,
  });
}
