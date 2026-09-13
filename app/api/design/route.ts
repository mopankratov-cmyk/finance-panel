import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";

export const dynamic = "force-dynamic";

export interface CardChange {
  id: number;
  nm_id: number;
  article: string | null;
  change_type: string;
  note: string | null;
  old_value: string | null;
  new_value: string | null;
  date: string;
  // эффект: ср. заказы/день за 7 дней до и после изменения
  ordersBefore: number | null;
  ordersAfter: number | null;
  effectPct: number | null;
}

const WINDOW = 7;

export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });

  const { data: changes, error } = await db
    .from("card_changes")
    .select("id, nm_id, article, change_type, note, old_value, new_value, date")
    .order("date", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 });

  const rawRows = changes ?? [];

  // card_changes не хранит cabinet_id — tenant определяется через nm_id по
  // wb_cards. Раньше эта выборка отдавала правки по ЛЮБОМУ кабинету/организации
  // любой сессии с analytics.view (включая seller_owner с единственной ролью):
  // права проверял только прокси по пути, а до кабинета дело не доходило.
  const rawNmIds = [...new Set(rawRows.map((r) => r.nm_id))];
  const cabinetByNm = new Map<number, string | null>();
  if (rawNmIds.length) {
    const { data: cards } = await db.from("wb_cards").select("nm_id, cabinet_id").in("nm_id", rawNmIds);
    for (const c of cards ?? []) cabinetByNm.set(Number(c.nm_id), c.cabinet_id ? String(c.cabinet_id) : null);
  }
  // Карточка без записи в wb_cards (ещё не синхронизирована) считается null —
  // hasCabinetAccess по null пропускает только сессии без ограничения по кабинетам.
  const distinctCabinetIds = [...new Set(rawRows.map((r) => cabinetByNm.get(r.nm_id) ?? null))];
  const accessByCabinet = new Map(
    await Promise.all(distinctCabinetIds.map(async (cid) => [cid, await hasCabinetAccess(cid)] as const)),
  );
  const rows = rawRows.filter((r) => accessByCabinet.get(cabinetByNm.get(r.nm_id) ?? null));

  const nmIds = [...new Set(rows.map((r) => r.nm_id))];

  // воронка по этим nm для расчёта эффекта — nmIds уже отфильтрован по
  // доступным кабинетам выше, поэтому wb_funnel_daily наследует ту же границу.
  //
  // Раньше запрос шёл по nm_id вовсе без .gte/.lte по дате: на кабинете или
  // товаре с длинной историей воронки (или когда среди последних 200 правок
  // много разных nm_id) выборка могла молча упереться в лимит строк и
  // обрезаться, из-за чего реальный эффект правки карточки превращался в 0.
  // avgAround ниже читает не больше WINDOW дней до и после даты правки —
  // этого же отступа достаточно и для границ запроса.
  const byNmDate = new Map<string, number>();
  if (nmIds.length) {
    const shiftDate = (iso: string, days: number) => {
      const d = new Date(iso);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const dates = rows.map((r) => String(r.date).slice(0, 10));
    const minDate = shiftDate(dates.reduce((a, b) => (a < b ? a : b)), -WINDOW);
    const maxDate = shiftDate(dates.reduce((a, b) => (a > b ? a : b)), WINDOW);

    const { data: funnel } = await db
      .from("wb_funnel_daily")
      .select("nm_id, date, orders")
      .in("nm_id", nmIds)
      .gte("date", minDate)
      .lte("date", maxDate)
      .order("date");
    for (const f of funnel ?? []) {
      byNmDate.set(`${f.nm_id}|${String(f.date).slice(0, 10)}`, Number(f.orders ?? 0));
    }
  }

  const avgAround = (nm: number, fromDate: Date): number | null => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < WINDOW; i++) {
      const d = new Date(fromDate);
      d.setDate(d.getDate() + i);
      const key = `${nm}|${d.toISOString().slice(0, 10)}`;
      if (byNmDate.has(key)) {
        sum += byNmDate.get(key)!;
        n++;
      }
    }
    return n > 0 ? sum / n : null;
  };

  const data: CardChange[] = rows.map((r) => {
    const dt = new Date(r.date);
    const beforeStart = new Date(dt);
    beforeStart.setDate(beforeStart.getDate() - WINDOW);
    const ordersBefore = avgAround(r.nm_id, beforeStart);
    const ordersAfter = avgAround(r.nm_id, dt);
    const effectPct =
      ordersBefore != null && ordersAfter != null && ordersBefore > 0
        ? ((ordersAfter - ordersBefore) / ordersBefore) * 100
        : null;
    return {
      id: r.id,
      nm_id: r.nm_id,
      article: r.article,
      change_type: r.change_type,
      note: r.note,
      old_value: r.old_value,
      new_value: r.new_value,
      date: String(r.date).slice(0, 10),
      ordersBefore: ordersBefore != null ? Math.round(ordersBefore * 10) / 10 : null,
      ordersAfter: ordersAfter != null ? Math.round(ordersAfter * 10) / 10 : null,
      effectPct: effectPct != null ? Math.round(effectPct * 10) / 10 : null,
    };
  });

  return NextResponse.json({ data, error: null });
}

export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = await request.json().catch(() => ({}));
  if (!b.nm_id || !b.change_type) {
    return NextResponse.json({ error: "Нужны nm_id и тип изменения" }, { status: 400 });
  }
  // Право catalog.edit проверяет только прокси — что nm_id принадлежит
  // ДОСТУПНОМУ кабинету сессии, здесь не проверялось вовсе.
  const { data: card } = await db.from("wb_cards").select("cabinet_id").eq("nm_id", Number(b.nm_id)).maybeSingle();
  const cabinetId = card?.cabinet_id ? String(card.cabinet_id) : null;
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const { error } = await db.from("card_changes").insert({
    nm_id: b.nm_id,
    article: b.article ?? null,
    change_type: b.change_type,
    note: b.note ?? null,
    old_value: b.old_value ?? null,
    new_value: b.new_value ?? null,
    date: b.date ?? new Date().toISOString().slice(0, 10),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });
  // Классический IDOR: id клиент присылает произвольный, без этой проверки
  // можно было удалить чужую запись card_changes по угаданному/перебранному id.
  const { data: row, error: fetchError } = await db
    .from("card_changes")
    .select("id, nm_id")
    .eq("id", Number(id))
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  const { data: card } = await db.from("wb_cards").select("cabinet_id").eq("nm_id", row.nm_id).maybeSingle();
  const cabinetId = card?.cabinet_id ? String(card.cabinet_id) : null;
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const { error } = await db.from("card_changes").delete().eq("id", Number(id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
