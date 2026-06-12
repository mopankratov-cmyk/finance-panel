import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";

const WB_ADV_TOKEN = process.env.WB_TOKEN_ADVERT;
// Информация о кампаниях: отдаёт все кампании продавца разом
const ADVERTS_URL = "https://advert-api.wildberries.ru/api/advert/v2/adverts";

interface NmSetting {
  nm_id?: number;
  bids_kopecks?: { recommendations?: number; search?: number };
}

interface AdvertInfo {
  id?: number;
  status?: number;
  bid_type?: string;
  nm_settings?: NmSetting[];
  settings?: { name?: string };
}

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const db = getSupabaseAdmin();

  if (!db) {
    return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  }
  if (!WB_ADV_TOKEN) {
    return NextResponse.json({ error: "WB_TOKEN_ADVERT не настроен" }, { status: 500 });
  }

  try {
    const res = await fetch(ADVERTS_URL, {
      headers: { Authorization: WB_ADV_TOKEN },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      await writeSyncLog("adverts", "error", null, `WB ${res.status}: ${text.slice(0, 200)}`, startedAt);
      return NextResponse.json({ error: `WB API ${res.status}` }, { status: 502 });
    }

    const json = (await res.json()) as { adverts?: AdvertInfo[] };
    const adverts = json.adverts ?? [];

    const rows = adverts
      .filter((a) => a.id)
      .map((a) => {
        const nmIds = [
          ...new Set(
            (a.nm_settings ?? [])
              .map((n) => n.nm_id)
              .filter((n): n is number => typeof n === "number"),
          ),
        ];
        // дневной бюджет API больше не отдаёт в этом методе — оставляем ставку CPM как ориентир
        const bid = a.nm_settings?.[0]?.bids_kopecks?.search;
        return {
          advert_id: a.id as number,
          name: a.settings?.name ?? null,
          type: null as number | null,
          status: a.status ?? null,
          daily_budget: bid != null ? bid / 100 : null,
          nm_ids: nmIds.length ? nmIds : null,
          synced_at: new Date().toISOString(),
        };
      });

    if (!rows.length) {
      await writeSyncLog("adverts", "ok", 0, null, startedAt);
      return NextResponse.json({ ok: true, rows: 0 });
    }

    const upsertError = await chunkedUpsert("wb_adverts", rows, "advert_id");
    if (upsertError) {
      await writeSyncLog("adverts", "error", null, upsertError, startedAt);
      return NextResponse.json({ error: upsertError }, { status: 500 });
    }

    await writeSyncLog("adverts", "ok", rows.length, null, startedAt);
    return NextResponse.json({ ok: true, rows: rows.length });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    const msg = (err instanceof Error ? err.message : "Unknown error") + cause;
    await writeSyncLog("adverts", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
