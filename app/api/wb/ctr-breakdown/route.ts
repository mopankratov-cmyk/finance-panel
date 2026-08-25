import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { CTR_MIN_VIEWS, reliableCtr } from "@/lib/wb/ctrQuality";

// Из чего сложился CTR артикула за день: разбивка по кампаниям.
//
// В таблице воронки видна одна цифра на день, а собирается она из нескольких
// кампаний сразу — ЕРК и пара СРС на один артикул обычное дело. Когда CTR
// проседает, первый вопрос «какая именно кампания просела», и до сих пор
// ответить на него можно было только вручную в кабинете WB.
//
// Источник — wb_advert_nm_campaign_daily: сырой слой по кампаниям, из которого
// собирается и сама витрина воронки. Значит суммы сойдутся по построению.
export const dynamic = "force-dynamic";

export interface CtrCampaignRow {
  advertId: number;
  name: string;
  views: number;
  clicks: number;
  /** null — показов слишком мало, чтобы доля что-то значила. */
  ctr: number | null;
  spent: number;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const url = new URL(request.url);
  const cabinetId = cabinetIdFromParam(url.searchParams.get("cabinet"));
  const nmId = Number(url.searchParams.get("nm"));
  const date = String(url.searchParams.get("date") ?? "").trim();

  if (!Number.isSafeInteger(nmId) || nmId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Нужны артикул и дата" }, { status: 400 });
  }
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Нет доступа к базе" }, { status: 503 });

  let query = db
    .from("wb_advert_nm_campaign_daily")
    .select("advert_id, views, clicks, spent")
    .eq("nm_id", nmId)
    .eq("date", date);
  if (cabinetId) query = query.eq("cabinet_id", cabinetId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Не удалось прочитать разбивку" }, { status: 502 });

  const rows = data ?? [];
  const advertIds = [...new Set(rows.map((row) => Number(row.advert_id)).filter(Number.isFinite))];

  // Имена кампаний справочные: если их нет, показываем номер — он всё равно
  // опознаёт кампанию в кабинете WB.
  const names = new Map<number, string>();
  if (advertIds.length) {
    const { data: adverts } = await db.from("wb_adverts").select("advert_id, name").in("advert_id", advertIds);
    for (const advert of adverts ?? []) names.set(Number(advert.advert_id), String(advert.name ?? ""));
  }

  const campaigns: CtrCampaignRow[] = rows
    .map((row) => {
      const views = Number(row.views ?? 0);
      const clicks = Number(row.clicks ?? 0);
      const advertId = Number(row.advert_id);
      return {
        advertId,
        name: names.get(advertId) || `Кампания ${advertId}`,
        views,
        clicks,
        ctr: reliableCtr(views, clicks),
        spent: Number(row.spent ?? 0),
      };
    })
    .filter((row) => row.views > 0 || row.clicks > 0 || row.spent > 0)
    .sort((left, right) => right.views - left.views);

  const views = campaigns.reduce((sum, row) => sum + row.views, 0);
  const clicks = campaigns.reduce((sum, row) => sum + row.clicks, 0);

  return NextResponse.json({
    meta: { cabinetId, nmId, date, minViews: CTR_MIN_VIEWS },
    data: {
      campaigns,
      total: { views, clicks, ctr: reliableCtr(views, clicks) },
    },
  });
}
