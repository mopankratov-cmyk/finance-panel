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
    const { data: lastRow } = await db
      .from("wb_sales")
      .select("date")
      .order("date", { ascending: false })
      .limit(1)
      .single();

    // ?from=YYYY-MM-DD — принудительный ре-синк с даты (бэкфилл price_with_disc)
    const forceFrom = new URL(request.url).searchParams.get("from");
    const dateFrom = forceFrom
      ? new Date(forceFrom).toISOString().slice(0, 19)
      : lastRow?.date
        ? new Date(lastRow.date).toISOString().slice(0, 19)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);

    const url = new URL("https://statistics-api.wildberries.ru/api/v1/supplier/sales");
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("flag", "0");

    const res = await fetch(url.toString(), {
      headers: { Authorization: WB_STATS_TOKEN },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      await writeSyncLog("sales", "error", null, `WB ${res.status}: ${text.slice(0, 200)}`, startedAt);
      return NextResponse.json({ error: `WB API ${res.status}` }, { status: 502 });
    }

    const sales: Record<string, unknown>[] = await res.json();

    if (!sales.length) {
      await writeSyncLog("sales", "ok", 0, null, startedAt);
      return NextResponse.json({ ok: true, rows: 0 });
    }

    const rows = sales.map((s) => ({
      sale_id: s.saleID as string,
      nm_id: s.nmId as number,
      date: s.date as string,
      for_pay: s.forPay as number | null,
      finished_price: s.finishedPrice as number | null,
      // цена до СПП: priceWithDisc, иначе totalPrice×(1−disc%)
      price_with_disc: (s.priceWithDisc as number | null) ?? (s.totalPrice != null ? Number(s.totalPrice) * (1 - Number(s.discountPercent ?? 0) / 100) : null),
      synced_at: new Date().toISOString(),
    })).filter((r) => r.sale_id);

    const upsertError = await chunkedUpsert("wb_sales", rows, "sale_id");
    if (upsertError) {
      await writeSyncLog("sales", "error", null, upsertError, startedAt);
      return NextResponse.json({ error: upsertError }, { status: 500 });
    }

    await writeSyncLog("sales", "ok", rows.length, null, startedAt);
    return NextResponse.json({ ok: true, rows: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("sales", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
