import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Заметки к CTR за день: чтение окном и запись по одной клетке.
//
// Зачем: через неделю никто не помнит, почему 18-го просело. Заметка живёт
// рядом с цифрой, к которой относится.
export const dynamic = "force-dynamic";

const KEY = "cabinet_id,nm_id,date";

export interface CtrNote {
  nmId: number;
  date: string;
  note: string;
  updatedAt: string | null;
}

/** GET ?cabinet&from&till — все заметки окна: экран рисует значки сразу. */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const url = new URL(request.url);
  const cabinetId = cabinetIdFromParam(url.searchParams.get("cabinet"));
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db || !cabinetId) return NextResponse.json({ notes: [] });

  const from = String(url.searchParams.get("from") ?? "").trim();
  const till = String(url.searchParams.get("till") ?? "").trim();
  let query = db.from("wb_funnel_ctr_notes").select("nm_id, date, note, updated_at").eq("cabinet_id", cabinetId);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("date", from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(till)) query = query.lte("date", till);

  const { data, error } = await query.limit(5000);
  // Таблицы ещё нет — экран живёт без значков, а не падает.
  if (error) return NextResponse.json({ notes: [] });

  const notes: CtrNote[] = (data ?? []).map((row) => ({
    nmId: Number(row.nm_id),
    date: String(row.date),
    note: String(row.note ?? ""),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  }));
  return NextResponse.json({ notes });
}

/** POST {cabinetId, nmId, date, note} — сохранить или стереть заметку. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const body = await request.json().catch(() => null) as
    { cabinetId?: string; nmId?: unknown; date?: unknown; note?: unknown } | null;
  const cabinetId = cabinetIdFromParam(body?.cabinetId);
  const nmId = Number(body?.nmId);
  const date = String(body?.date ?? "").trim();
  const note = String(body?.note ?? "").trim();

  if (!cabinetId || !Number.isSafeInteger(nmId) || nmId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "Нужны кабинет, артикул и дата" }, { status: 400 });
  }
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ ok: false, error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Нет доступа к базе" }, { status: 503 });

  // Пустую заметку не храним: стёртый текст означает «объяснения больше нет»,
  // а строка с пустым note выглядела бы как заметка и рисовала бы значок.
  if (!note) {
    const { error } = await db.from("wb_funnel_ctr_notes").delete()
      .eq("cabinet_id", cabinetId).eq("nm_id", nmId).eq("date", date);
    if (error) return NextResponse.json({ ok: false, error: "Не удалось удалить заметку" }, { status: 502 });
    return NextResponse.json({ ok: true, note: "" });
  }

  const { error } = await db.from("wb_funnel_ctr_notes").upsert({
    cabinet_id: cabinetId,
    nm_id: nmId,
    date,
    note: note.slice(0, 2000),
    updated_at: new Date().toISOString(),
  }, { onConflict: KEY });
  if (error) return NextResponse.json({ ok: false, error: "Не удалось сохранить заметку" }, { status: 502 });
  return NextResponse.json({ ok: true, note: note.slice(0, 2000) });
}
