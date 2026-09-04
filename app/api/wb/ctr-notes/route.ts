import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cabinetRights } from "@/lib/auth/cabinetLevel";
import { ctrNoteColor, type CtrNoteColor } from "@/lib/wb/ctrNoteColors";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

// Пометки к CTR за день: чтение окном и запись по одной клетке.
//
// Зачем: через неделю никто не помнит, почему 18-го просело. Пометка живёт
// рядом с цифрой, к которой относится. Пометка — это текст, цвет или и то и
// другое: цвет виден сразу всей сеткой, текст объясняет подробности.
export const dynamic = "force-dynamic";

const KEY = "cabinet_id,nm_id,date";
const LEGACY_COLUMNS = "nm_id, date, note, updated_at";
const COLUMNS = "nm_id, date, note, color, updated_at";

export interface CtrNote {
  nmId: number;
  date: string;
  note: string;
  color: CtrNoteColor | null;
  updatedAt: string | null;
}

interface NoteRow { nm_id: number; date: string; note: string | null; color?: string | null; updated_at: string | null }

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

  // Листаем постранично. `.limit(5000)` не работал: PostgREST режет ответ своим
  // max-rows (в проекте это тысяча строк), и у кабинета с длинной историей
  // часть пометок просто не доезжала — клетки выглядели чистыми.
  const page = (columns: string) => (start: number, end: number) => {
    let query = db.from("wb_funnel_ctr_notes").select(columns).eq("cabinet_id", cabinetId);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("date", from);
    if (/^\d{4}-\d{2}-\d{2}$/.test(till)) query = query.lte("date", till);
    return query
      .order("date", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(start, end) as unknown as PromiseLike<{ data: NoteRow[] | null; error: { message: string } | null }>;
  };

  let rows: NoteRow[];
  try {
    rows = await loadAllSupabasePages<NoteRow>(page(COLUMNS), { label: "Пометки CTR", maxPages: 50 });
  } catch {
    // Колонки color ещё нет (миграция не применена) — читаем по-старому.
    // Экран работает как раньше, просто без цветов.
    try {
      rows = await loadAllSupabasePages<NoteRow>(page(LEGACY_COLUMNS), { label: "Пометки CTR", maxPages: 50 });
    } catch {
      // Таблицы ещё нет — экран живёт без значков, а не падает.
      return NextResponse.json({ notes: [] });
    }
  }

  const notes: CtrNote[] = rows.map((row) => ({
    nmId: Number(row.nm_id),
    date: String(row.date),
    note: String(row.note ?? ""),
    color: ctrNoteColor(row.color),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  }));
  return NextResponse.json({ notes });
}

/** POST {cabinetId, nmId, date, note, color} — сохранить или стереть пометку. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const body = await request.json().catch(() => null) as
    { cabinetId?: string; nmId?: unknown; date?: unknown; note?: unknown; color?: unknown } | null;
  const cabinetId = cabinetIdFromParam(body?.cabinetId);
  const nmId = Number(body?.nmId);
  const date = String(body?.date ?? "").trim();
  const note = String(body?.note ?? "").trim();
  const color = ctrNoteColor(body?.color);

  if (!cabinetId || !Number.isSafeInteger(nmId) || nmId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "Нужны кабинет, артикул и дата" }, { status: 400 });
  }
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ ok: false, error: "Нет доступа к кабинету" }, { status: 403 });
  }
  // Право писать проверяем на сервере. В интерфейсе кнопка скрыта, но скрытая
  // кнопка это не защита: запрос можно отправить и мимо неё.
  const rights = await cabinetRights(cabinetId);
  if (!rights.canAnnotate) {
    return NextResponse.json({ ok: false, error: "Нет прав оставить заметку в этом кабинете" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Нет доступа к базе" }, { status: 503 });

  // Пустую пометку не храним, но пустая — это когда нет НИ текста, НИ цвета.
  // Проверять один текст нельзя: цвет без слов это полноценная пометка, и
  // стирание текста в ней не должно уносить и цвет.
  if (!note && !color) {
    const { error } = await db.from("wb_funnel_ctr_notes").delete()
      .eq("cabinet_id", cabinetId).eq("nm_id", nmId).eq("date", date);
    if (error) return NextResponse.json({ ok: false, error: "Не удалось удалить пометку" }, { status: 502 });
    return NextResponse.json({ ok: true, note: "", color: null });
  }

  const saved = note.slice(0, 2000);
  const row = {
    cabinet_id: cabinetId,
    nm_id: nmId,
    date,
    note: saved,
    color,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("wb_funnel_ctr_notes").upsert(row, { onConflict: KEY });
  if (error) {
    // Колонки color ещё нет — сохраняем хотя бы текст, а про цвет говорим прямо.
    // Молча вернуть «ok» и потерять цвет было бы хуже отказа: человек увидел бы
    // закрашенную клетку, которая после перезагрузки станет белой.
    if (!saved) return NextResponse.json({ ok: false, error: "Цвета пометок ещё не включены в базе" }, { status: 503 });
    const { color: _color, ...withoutColor } = row;
    const retry = await db.from("wb_funnel_ctr_notes").upsert(withoutColor, { onConflict: KEY });
    if (retry.error) return NextResponse.json({ ok: false, error: "Не удалось сохранить пометку" }, { status: 502 });
    return NextResponse.json({ ok: true, note: saved, color: null, colorSkipped: true });
  }
  return NextResponse.json({ ok: true, note: saved, color });
}
