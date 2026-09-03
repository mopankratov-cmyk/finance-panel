import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Мониторинг конкурентов: ручной список артикулов против каждого товара.
//
// Отличие от «Полок»: там конкурентов находит сам сборщик в блоке «Смотрите
// также», здесь владелец выбирает, с кем сравниваться. Цены при этом берутся
// из одного источника — сборщик скребёт артикул и присылает снимок, где
// our_price это цена ЭТОГО артикула. Поэтому цена конкурента = его
// собственный снимок, и наша цена меряется ровно так же. Сравнивать
// скрейпленную цену конкурента со средним чеком из воронки нельзя: первое —
// цена на витрине, второе — выручка после скидок, делённая на заказы.
//
// Что где хранится:
//   wb_shelf_watch (purpose='price') — что обходить сборщику. Сюда попадают и
//     наши товары, и конкуренты: иначе цена не соберётся ни у тех, ни у других.
//   wb_price_watch — связи «наш товар → его конкурент».
// Наш товар от чужого отличается наличием в wb_cards кабинета.

interface WatchRow { our_nm_id: number; competitor_nm_id: number; label: string | null }
interface PriceRow { nm_id: number; our_price: number | string | null; our_brand: string | null; our_img: string | null; collected_at: string }
interface CardRow { nm_id: number; article: string | null; name: string | null; brand: string | null }

const num = (value: number | string | null | undefined) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return parsed != null && Number.isFinite(parsed) ? parsed : null;
};

const cabinetOf = (request: NextRequest) => {
  const raw = new URL(request.url).searchParams.get("cabinet");
  return raw && raw !== "all" && !raw.startsWith("group:") ? raw : null;
};

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const cabinetId = cabinetOf(request);
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db || !cabinetId) return NextResponse.json({ items: [] });

  // Окно свежести. Цена, снятая месяц назад, не «текущая»: считать её в
  // средней значит выдавать протухшее за факт.
  const daysRaw = Number(new URL(request.url).searchParams.get("days") ?? 14);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.round(daysRaw), 1), 90) : 14;
  const freshFrom = new Date(Date.now() - days * 86_400_000).toISOString();

  const notes: string[] = [];
  const fail = (label: string) => (cause: unknown) => {
    notes.push(`${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
    return [] as never[];
  };

  const [links, watched, cards] = await Promise.all([
    loadAllSupabasePages<WatchRow>(
      (from, to) => db.from("wb_price_watch")
        .select("our_nm_id, competitor_nm_id, label")
        .eq("cabinet_id", cabinetId).eq("active", true)
        .order("our_nm_id", { ascending: true }).order("competitor_nm_id", { ascending: true })
        .range(from, to),
      { maxPages: 20, label: "Конкуренты: связи" },
    ).catch(fail("связи")),
    loadAllSupabasePages<{ nm_id: number }>(
      (from, to) => db.from("wb_shelf_watch")
        .select("nm_id")
        .eq("cabinet_id", cabinetId).eq("active", true)
        .order("nm_id", { ascending: true }).range(from, to),
      { maxPages: 20, label: "Конкуренты: под наблюдением" },
    ).catch(fail("наблюдение")),
    loadAllSupabasePages<CardRow>(
      (from, to) => db.from("wb_cards")
        .select("nm_id, article, name, brand")
        .eq("cabinet_id", cabinetId)
        .order("nm_id", { ascending: true }).range(from, to),
      { maxPages: 40, label: "Конкуренты: карточки" },
    ).catch(fail("карточки")),
  ]);

  const cardByNm = new Map(cards.map((row) => [row.nm_id, row]));
  // Наши товары в мониторинге: те, что под наблюдением И есть в карточках
  // кабинета. Чужой артикул в wb_cards не попадёт никогда, поэтому признак
  // надёжен и не требует отдельного флага.
  const ourNmIds = [...new Set([
    ...watched.map((row) => row.nm_id).filter((nm) => cardByNm.has(nm)),
    ...links.map((row) => row.our_nm_id),
  ])];
  if (!ourNmIds.length) return NextResponse.json({ items: [], notes });

  const allNm = [...new Set([...ourNmIds, ...links.map((row) => row.competitor_nm_id)])];
  const priceRows = await loadAllSupabasePages<PriceRow>(
    (from, to) => db.from("wb_shelf_snapshots")
      .select("nm_id, our_price, our_brand, our_img, collected_at")
      .in("nm_id", allNm)
      .gte("collected_at", freshFrom)
      .order("collected_at", { ascending: false }).order("nm_id", { ascending: true })
      .range(from, to),
    { maxPages: 10, label: "Конкуренты: цены", concurrency: 2 },
  ).catch(fail("цены"));

  // Последняя цена и дневной ряд. День берём по МОСКВЕ: сборы идут в 10:00 /
  // 18:00 / 22:00 МСК, и по UTC вечерний снимок уехал бы в следующие сутки.
  const latest = new Map<number, { price: number | null; brand: string | null; img: string | null; at: string }>();
  const daily = new Map<number, Map<string, number>>();
  const moscowDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date(iso));
  for (const row of priceRows) {
    if (!latest.has(row.nm_id)) {
      latest.set(row.nm_id, { price: num(row.our_price), brand: row.our_brand, img: row.our_img, at: row.collected_at });
    }
    const price = num(row.our_price);
    if (price == null || price <= 0) continue;
    const byDay = daily.get(row.nm_id) ?? new Map<string, number>();
    // Строки идут от свежих к старым: первая за день и есть последняя цена дня.
    const day = moscowDay(row.collected_at);
    if (!byDay.has(day)) byDay.set(day, price);
    daily.set(row.nm_id, byDay);
  }

  const linksByOur = new Map<number, WatchRow[]>();
  for (const link of links) {
    const list = linksByOur.get(link.our_nm_id) ?? [];
    list.push(link);
    linksByOur.set(link.our_nm_id, list);
  }

  const dayKeys = [...new Set([...daily.values()].flatMap((byDay) => [...byDay.keys()]))].sort();

  const items = ourNmIds.map((nm) => {
    const card = cardByNm.get(nm);
    const our = latest.get(nm) ?? null;
    const list = linksByOur.get(nm) ?? [];
    const competitors = list.map((link) => {
      const price = latest.get(link.competitor_nm_id) ?? null;
      return {
        nmId: link.competitor_nm_id,
        label: link.label,
        brand: price?.brand ?? null,
        img: price?.img ?? null,
        price: price?.price ?? null,
        collectedAt: price?.at ?? null,
      };
    });
    // Средняя считается ТОЛЬКО по собранным ценам: ноль за неснятого
    // конкурента превратил бы её в выдумку.
    const known = competitors.map((c) => c.price).filter((p): p is number => p != null && p > 0);
    const average = known.length ? Math.round((known.reduce((sum, p) => sum + p, 0) / known.length) * 100) / 100 : null;
    const ourPrice = our?.price ?? null;
    const diffPct = average != null && ourPrice != null && average > 0
      ? Math.round(((ourPrice - average) / average) * 1000) / 10
      : null;

    // Ряд по дням: наша цена и средняя по конкурентам того же дня. День без
    // сбора остаётся дырой, а не тянется линией — иначе график покажет
    // стабильность там, где её просто не мерили.
    const history = dayKeys.map((day) => {
      const mine = daily.get(nm)?.get(day) ?? null;
      const theirs = list
        .map((link) => daily.get(link.competitor_nm_id)?.get(day))
        .filter((price): price is number => price != null && price > 0);
      return {
        date: day,
        our: mine,
        average: theirs.length ? Math.round((theirs.reduce((sum, p) => sum + p, 0) / theirs.length) * 100) / 100 : null,
      };
    }).filter((point) => point.our != null || point.average != null);

    return {
      nmId: nm,
      article: card?.article ?? null,
      name: card?.name ?? null,
      brand: card?.brand ?? our?.brand ?? null,
      img: our?.img ?? null,
      ourPrice,
      ourCollectedAt: our?.at ?? null,
      competitors,
      average,
      diffPct,
      pending: competitors.length - known.length,
      history,
    };
  }).sort((left, right) => (left.article ?? "").localeCompare(right.article ?? "", "ru"));

  return NextResponse.json({ items, notes });
}

/** Добавить свой товар в мониторинг или конкурента к нему. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession(["director", "finance", "manager", "seller"]);
  if (gate) return gate;
  const cabinetId = cabinetOf(request);
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db || !cabinetId) return NextResponse.json({ error: "Выберите один кабинет" }, { status: 400 });

  const body = await request.json().catch(() => ({})) as { nmId?: number; ourNmId?: number; label?: string };
  const nmId = Number(body.nmId);
  if (!Number.isInteger(nmId) || nmId <= 0) return NextResponse.json({ error: "Укажите номер артикула WB" }, { status: 400 });

  // Сборщик обходит только то, что лежит в его списке: и наш товар, и
  // конкурента надо туда положить, иначе цена не соберётся.
  const watch = await db.from("wb_shelf_watch")
    .upsert({ cabinet_id: cabinetId, nm_id: nmId, active: true, purpose: "price" }, { onConflict: "cabinet_id,nm_id" });
  if (watch.error) return NextResponse.json({ error: watch.error.message }, { status: 502 });

  const ourNmId = Number(body.ourNmId);
  if (Number.isInteger(ourNmId) && ourNmId > 0) {
    if (ourNmId === nmId) return NextResponse.json({ error: "Товар не может быть конкурентом самому себе" }, { status: 400 });
    const link = await db.from("wb_price_watch").upsert({
      cabinet_id: cabinetId, our_nm_id: ourNmId, competitor_nm_id: nmId,
      label: (body.label ?? "").trim() || null, active: true, updated_at: new Date().toISOString(),
    }, { onConflict: "cabinet_id,our_nm_id,competitor_nm_id" });
    if (link.error) return NextResponse.json({ error: link.error.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

/** Убрать конкурента у товара или сам товар из мониторинга. */
export async function DELETE(request: NextRequest) {
  const gate = await requireApiSession(["director", "finance", "manager", "seller"]);
  if (gate) return gate;
  const cabinetId = cabinetOf(request);
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db || !cabinetId) return NextResponse.json({ error: "Выберите один кабинет" }, { status: 400 });

  const url = new URL(request.url);
  const nmId = Number(url.searchParams.get("nmId"));
  const ourNmId = Number(url.searchParams.get("ourNmId"));
  if (!Number.isInteger(nmId) || nmId <= 0) return NextResponse.json({ error: "Укажите артикул" }, { status: 400 });

  if (Number.isInteger(ourNmId) && ourNmId > 0) {
    // Убираем связь, а не сам артикул: тот же конкурент может сравниваться с
    // другим нашим товаром, и его цена всё ещё нужна.
    const removed = await db.from("wb_price_watch").delete()
      .eq("cabinet_id", cabinetId).eq("our_nm_id", ourNmId).eq("competitor_nm_id", nmId);
    if (removed.error) return NextResponse.json({ error: removed.error.message }, { status: 502 });
    return NextResponse.json({ ok: true });
  }

  const links = await db.from("wb_price_watch").delete().eq("cabinet_id", cabinetId).eq("our_nm_id", nmId);
  if (links.error) return NextResponse.json({ error: links.error.message }, { status: 502 });
  // Наблюдение снимаем только у «ценовых» строк: полку выключать нельзя, её
  // ведёт другой раздел.
  const watch = await db.from("wb_shelf_watch").update({ active: false })
    .eq("cabinet_id", cabinetId).eq("nm_id", nmId).eq("purpose", "price");
  if (watch.error) return NextResponse.json({ error: watch.error.message }, { status: 502 });
  return NextResponse.json({ ok: true });
}
