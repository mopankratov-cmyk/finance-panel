import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";

const WB_STATS_TOKEN = process.env.WB_STATS_TOKEN;

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const db = getSupabaseAdmin();

  if (!db) {
    return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  }
  if (!WB_STATS_TOKEN) {
    return NextResponse.json({ error: "WB_STATS_TOKEN не настроен" }, { status: 500 });
  }

  try {
    // Остатки — всегда полный снимок, берём сегодня
    const dateFrom = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19);

    const url = new URL("https://statistics-api.wildberries.ru/api/v1/supplier/stocks");
    url.searchParams.set("dateFrom", dateFrom);

    const res = await fetch(url.toString(), {
      headers: { Authorization: WB_STATS_TOKEN },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      await writeSyncLog("stocks", "error", null, `WB ${res.status}: ${text.slice(0, 200)}`, startedAt);
      return NextResponse.json({ error: `WB API ${res.status}` }, { status: 502 });
    }

    const stocks: Record<string, unknown>[] = await res.json();

    if (!stocks.length) {
      await writeSyncLog("stocks", "ok", 0, null, startedAt);
      return NextResponse.json({ ok: true, rows: 0 });
    }

    const rows = stocks.map((s) => ({
      nm_id: s.nmId as number,
      warehouse: s.warehouseName as string,
      quantity: s.quantity as number | null,
      in_way_to_client: s.inWayToClient as number | null,
      in_way_from_client: s.inWayFromClient as number | null,
      synced_at: new Date().toISOString(),
    })).filter((r) => r.nm_id && r.warehouse);

    const upsertError = await chunkedUpsert("wb_stocks", rows, "nm_id,warehouse");
    if (upsertError) {
      await writeSyncLog("stocks", "error", null, upsertError, startedAt);
      return NextResponse.json({ error: upsertError }, { status: 500 });
    }

    await writeSyncLog("stocks", "ok", rows.length, null, startedAt);
    return NextResponse.json({ ok: true, rows: rows.length });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    const msg = (err instanceof Error ? err.message : "Unknown error") + cause;
    await writeSyncLog("stocks", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
