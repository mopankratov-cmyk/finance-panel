import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildXlsx } from "@/lib/xlsx/write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DecRow {
  article: string | null; nm_id: number; old_price: number | null;
  new_price: number | null; strategy_name: string | null; note: string | null;
}

// GET /api/repricer/export?date=&cabinet= — XLSX «Новые цены» из предложенных решений.
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const url = new URL(request.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const cabinet = url.searchParams.get("cabinet");

  let q = db
    .from("repricer_decisions")
    .select("article, nm_id, old_price, new_price, strategy_name, note")
    .eq("run_date", date)
    .eq("status", "proposed");
  if (cabinet != null) q = q.eq("cabinet", cabinet);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows: (string | number | null | undefined)[][] = [
    ["Артикул", "nmID", "Старая цена", "Новая цена", "Стратегия", "Примечание"],
  ];
  for (const r of (data ?? []) as DecRow[]) {
    rows.push([r.article, r.nm_id, r.old_price, r.new_price, r.strategy_name, r.note]);
  }
  const buf = buildXlsx("Репрайсер", rows);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="repricer_${cabinet || "all"}_${date}.xlsx"`,
    },
  });
}
