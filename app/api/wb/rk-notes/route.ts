import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { cabinetRights } from "@/lib/auth/cabinetLevel";
import type { RkNote } from "@/lib/wb/rkNotes";

// Заметки менеджеру в журнале РК: чтение окном, запись по одной клетке.
//
// Уровня два: заметка про товар за день (advertId не передан) и про
// конкретную кампанию (advertId передан). Разделять их обязательно —
// «поднять ставку» относится к кампании, «ждём новый контент» к товару.
export const dynamic = "force-dynamic";

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
  // `limit(10_000)` упирался в тысячу строк, а любая ошибка базы выглядела как
  // «задач нет». Пустой ответ оставляем только для отсутствующей таблицы —
  // остальное говорим вслух, иначе экран молча теряет чужую работу.
  let data: Array<Record<string, unknown>>;
  try {
    data = await loadAllSupabasePages<Record<string, unknown>>((rangeFrom, rangeTo) => {
      let query = db.from("wb_rk_notes")
        .select("nm_id, advert_id, date, note, done, updated_at")
        .eq("cabinet_id", cabinetId)
        .order("date", { ascending: true })
        .order("nm_id", { ascending: true })
        .range(rangeFrom, rangeTo);
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("date", from);
      if (/^\d{4}-\d{2}-\d{2}$/.test(till)) query = query.lte("date", till);
      return query;
    }, { label: "Журнал РК: задачи", maxPages: 20 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Не удалось прочитать задачи";
    // Таблицы ещё нет — журнал работает как раньше, без заметок.
    if (/42P01|PGRST205|does not exist/i.test(message)) return NextResponse.json({ notes: [] });
    return NextResponse.json({ notes: [], error: message }, { status: 502 });
  }

  const notes: RkNote[] = data.map((row) => ({
    nmId: Number(row.nm_id),
    advertId: row.advert_id == null ? null : Number(row.advert_id),
    date: String(row.date),
    note: String(row.note ?? ""),
    done: Boolean(row.done),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  }));
  return NextResponse.json({ notes });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const body = await request.json().catch(() => null) as
    { cabinetId?: string; nmId?: unknown; advertId?: unknown; date?: unknown; note?: unknown; done?: unknown } | null;
  const cabinetId = cabinetIdFromParam(body?.cabinetId);
  const nmId = Number(body?.nmId);
  const advertId = body?.advertId == null ? null : Number(body.advertId);
  const date = String(body?.date ?? "").trim();
  const note = String(body?.note ?? "").trim();
  const done = Boolean(body?.done);

  if (!cabinetId || !Number.isSafeInteger(nmId) || nmId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "Нужны кабинет, артикул и дата" }, { status: 400 });
  }
  if (advertId !== null && !Number.isSafeInteger(advertId)) {
    return NextResponse.json({ ok: false, error: "Неверный номер кампании" }, { status: 400 });
  }
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ ok: false, error: "Нет доступа к кабинету" }, { status: 403 });
  }
  // Право писать проверяем на сервере. В интерфейсе кнопка скрыта, но скрытая
  // кнопка это не защита: запрос можно отправить и мимо неё.
  const rights = await cabinetRights(cabinetId);
  if (!rights.canAnnotate) {
    return NextResponse.json({ ok: false, error: "Нет прав оставить задачу в этом кабинете" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Нет доступа к базе" }, { status: 503 });

  // Пустой текст — это удаление заметки. Хранить пустую строку значило бы
  // рисовать значок над пустотой.
  if (!note) {
    let del = db.from("wb_rk_notes").delete().eq("cabinet_id", cabinetId).eq("nm_id", nmId).eq("date", date);
    del = advertId === null ? del.is("advert_id", null) : del.eq("advert_id", advertId);
    const { error } = await del;
    if (error) return NextResponse.json({ ok: false, error: "Не удалось удалить заметку" }, { status: 502 });
    return NextResponse.json({ ok: true, note: "", done: false });
  }

  const { error } = await db.from("wb_rk_notes").upsert({
    cabinet_id: cabinetId,
    nm_id: nmId,
    advert_id: advertId,
    date,
    note: note.slice(0, 2000),
    done,
    updated_at: new Date().toISOString(),
  }, { onConflict: "cabinet_id,nm_id,advert_id,date" });
  if (error) return NextResponse.json({ ok: false, error: "Не удалось сохранить заметку" }, { status: 502 });
  return NextResponse.json({ ok: true, note: note.slice(0, 2000), done });
}
