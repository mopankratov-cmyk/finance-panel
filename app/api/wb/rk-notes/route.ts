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
        .select("nm_id, advert_id, date, note, done, updated_at, source, suggested_note, suggested_reason")
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
    source: row.source === "auto" ? "auto" : "human",
    suggestedNote: row.suggested_note == null ? null : String(row.suggested_note),
    suggestedReason: row.suggested_reason == null ? null : String(row.suggested_reason),
  }));
  return NextResponse.json({ notes });
}

/**
 * Перенос задач с одного дня на другой.
 *
 * Менеджер ставит одни и те же задачи изо дня в день: «Откл до отгрузки» на
 * полутора сотнях артикулов. По одной клетке это полтораста кликов и полтораста
 * запросов — работа ради работы.
 *
 * Два правила, без которых перенос вредит:
 *   1. Никогда не затирать уже стоящую задачу. Перенос заполняет пустое, а не
 *      переписывает чужое решение — то же правило, по которому живёт советчик.
 *   2. Отметку «сделано» не переносим: вчера сделано, сегодня ещё нет.
 */
async function copyDay(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  cabinetId: string,
  from: string,
  to: string,
): Promise<{ ok: true; copied: number; skipped: number } | { ok: false; error: string }> {
  const source = await db.from("wb_rk_notes")
    .select("nm_id, advert_id, note")
    .eq("cabinet_id", cabinetId)
    .eq("date", from)
    .limit(5_000);
  if (source.error) return { ok: false, error: "Не удалось прочитать задачи исходного дня" };
  const rows = (source.data ?? []).filter((row) => String(row.note ?? "").trim());
  if (!rows.length) return { ok: true, copied: 0, skipped: 0 };

  const target = await db.from("wb_rk_notes")
    .select("nm_id, advert_id, note")
    .eq("cabinet_id", cabinetId)
    .eq("date", to)
    .limit(5_000);
  if (target.error) return { ok: false, error: "Не удалось прочитать задачи целевого дня" };
  const taken = new Set((target.data ?? [])
    .filter((row) => String(row.note ?? "").trim())
    .map((row) => `${row.nm_id}|${row.advert_id ?? "-"}`));

  const stamp = new Date().toISOString();
  const fresh = rows.filter((row) => !taken.has(`${row.nm_id}|${row.advert_id ?? "-"}`));
  const skipped = rows.length - fresh.length;
  if (!fresh.length) return { ok: true, copied: 0, skipped };

  for (let index = 0; index < fresh.length; index += 500) {
    const { error } = await db.from("wb_rk_notes").upsert(fresh.slice(index, index + 500).map((row) => ({
      cabinet_id: cabinetId,
      nm_id: row.nm_id,
      advert_id: row.advert_id,
      date: to,
      note: String(row.note).slice(0, 2000),
      // Вчера сделано — сегодня ещё нет.
      done: false,
      // Перенёс человек, а не алгоритм: это его решение, повторённое на день.
      source: "human",
      updated_at: stamp,
    })), { onConflict: "cabinet_id,nm_id,advert_id,date" });
    if (error) return { ok: false, error: "Не удалось перенести задачи" };
  }
  return { ok: true, copied: fresh.length, skipped };
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const body = await request.json().catch(() => null) as
    { cabinetId?: string; nmId?: unknown; advertId?: unknown; date?: unknown; note?: unknown; done?: unknown;
      copyFrom?: unknown; copyTo?: unknown } | null;
  const cabinetId = cabinetIdFromParam(body?.cabinetId);
  const copyFrom = String(body?.copyFrom ?? "").trim();
  const copyTo = String(body?.copyTo ?? "").trim();
  const nmId = Number(body?.nmId);
  const advertId = body?.advertId == null ? null : Number(body.advertId);
  const date = String(body?.date ?? "").trim();
  const note = String(body?.note ?? "").trim();
  const done = Boolean(body?.done);

  const isCopy = Boolean(copyFrom || copyTo);
  if (!cabinetId) {
    return NextResponse.json({ ok: false, error: "Нужен кабинет" }, { status: 400 });
  }
  if (isCopy) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(copyFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(copyTo) || copyFrom === copyTo) {
      return NextResponse.json({ ok: false, error: "Нужны разные даты «откуда» и «куда»" }, { status: 400 });
    }
  } else if (!Number.isSafeInteger(nmId) || nmId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
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

  if (isCopy) {
    const result = await copyDay(db, cabinetId, copyFrom, copyTo);
    return result.ok
      ? NextResponse.json(result)
      : NextResponse.json(result, { status: 502 });
  }

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
    // Человек написал или переписал — последнее слово за ним. Предложение
    // алгоритма (suggested_note) при этом НЕ трогаем: расхождение между
    // советом и правкой и есть материал, по которому правила потом чинятся.
    source: "human",
    updated_at: new Date().toISOString(),
  }, { onConflict: "cabinet_id,nm_id,advert_id,date" });
  if (error) return NextResponse.json({ ok: false, error: "Не удалось сохранить заметку" }, { status: 502 });
  return NextResponse.json({ ok: true, note: note.slice(0, 2000), done });
}
