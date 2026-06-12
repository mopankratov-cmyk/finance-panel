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
    // Берём заказы с даты последней записи или за 30 дней
    const { data: lastRow } = await db
      .from("wb_orders")
      .select("date")
      .order("date", { ascending: false })
      .limit(1)
      .single();

    const dateFrom = lastRow?.date
      ? new Date(lastRow.date).toISOString().slice(0, 19)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);

    const url = new URL("https://statistics-api.wildberries.ru/api/v1/supplier/orders");
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("flag", "0");

    const res = await fetch(url.toString(), {
      headers: { Authorization: WB_STATS_TOKEN },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      await writeSyncLog("orders", "error", null, `WB ${res.status}: ${text.slice(0, 200)}`, startedAt);
      return NextResponse.json({ error: `WB API ${res.status}` }, { status: 502 });
    }

    const orders: Record<string, unknown>[] = await res.json();

    if (!orders.length) {
      await writeSyncLog("orders", "ok", 0, null, startedAt);
      return NextResponse.json({ ok: true, rows: 0 });
    }

    const rows = orders.map((o) => ({
      srid: o.srid as string,
      nm_id: o.nmId as number,
      supplier_article: o.supplierArticle as string | null,
      date: o.date as string,
      total_price: o.totalPrice as number | null,
      discount_percent: o.discountPercent as number | null,
      finished_price: o.finishedPrice as number | null,
      is_cancel: (o.isCancel as boolean) ?? false,
      warehouse: o.warehouseName as string | null,
      region: o.regionName as string | null,
      synced_at: new Date().toISOString(),
    })).filter((r) => r.srid);

    const upsertError = await chunkedUpsert("wb_orders", rows, "srid");
    if (upsertError) {
      await writeSyncLog("orders", "error", null, upsertError, startedAt);
      return NextResponse.json({ error: upsertError }, { status: 500 });
    }

    await writeSyncLog("orders", "ok", rows.length, null, startedAt);
    return NextResponse.json({ ok: true, rows: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("orders", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
