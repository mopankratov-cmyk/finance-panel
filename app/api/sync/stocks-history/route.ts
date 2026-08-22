import { NextRequest, NextResponse } from "next/server";

import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 60;

const PAGE_SIZE = 1_000;
const INSERT_SIZE = 500;

interface StockRow {
  nm_id: number;
  warehouse: string;
  cabinet_id: string | null;
  quantity: number | null;
  in_way_to_client: number | null;
  in_way_from_client: number | null;
}

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const snapshotAt = startedAt.toISOString();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  let inserted = 0;

  try {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await db
        .from("wb_stocks")
        .select("nm_id, warehouse, cabinet_id, quantity, in_way_to_client, in_way_from_client")
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(`Чтение wb_stocks: ${error.message}`);

      const stocks = (data ?? []) as StockRow[];
      for (let offset = 0; offset < stocks.length; offset += INSERT_SIZE) {
        const rows = stocks.slice(offset, offset + INSERT_SIZE).map((stock) => ({
          ...stock,
          snapshot_at: snapshotAt,
        }));
        const { error: insertError } = await db.from("wb_stocks_history").insert(rows);
        if (insertError) throw new Error(`Запись wb_stocks_history: ${insertError.message}`);
        inserted += rows.length;
      }

      if (stocks.length < PAGE_SIZE) break;
    }

    await writeSyncLog("stocks-history", "ok", inserted, null, startedAt);
    return NextResponse.json({ ok: true, inserted, snapshotAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    await writeSyncLog("stocks-history", "error", inserted, message, startedAt);
    return NextResponse.json({ ok: false, inserted, error: message }, { status: 502 });
  }
}
