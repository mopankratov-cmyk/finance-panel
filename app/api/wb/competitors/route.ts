import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Мониторинг конкурентов: ручной список артикулов против каждого нашего
// товара и их цены.
//
// Отличие от «Полок»: там конкурентов находит сам сборщик в блоке «Смотрите
// также», здесь владелец выбирает, с кем сравниваться. Цены при этом берутся
// из того же источника — сборщик скребёт артикул и присылает снимок, где
// our_price это цена ЭТОГО артикула. Поэтому цена конкурента = наша цена в
// его собственном снимке.

interface WatchRow { our_nm_id: number; competitor_nm_id: number; label: string | null }
interface PriceRow { nm_id: number; our_price: number | string | null; our_brand: string | null; our_img: string | null; collected_at: string }
interface CardRow { nm_id: number; article: string | null; name: string | null; brand: string | null }

const num = (value: number | string | null | undefined) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return parsed != null && Number.isFinite(parsed) ? parsed : null;
};

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const cabinetParam = new URL(request.url).searchParams.get("cabinet");
  const cabinetId = cabinetParam && cabinetParam !== "all" && !cabinetParam.startsWith("group:") ? cabinetParam : null;
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db || !cabinetId) return NextResponse.json({ items: [] });

  // Окно свежести. Цена, снятая месяц назад, не «текущая»: считать её в
  // средней значит выдавать протухшее за факт. За пределами окна цена
  // показывается как не снятая.
  const daysRaw = Number(new URL(request.url).searchParams.get("days") ?? 14);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.round(daysRaw), 1), 90) : 14;
  const freshFrom = new Date(Date.now() - days * 86_400_000).toISOString();

  const notes: string[] = [];
  const watches = await loadAllSupabasePages<WatchRow>(
    (from, to) => db.from("wb_price_watch")
      .select("our_nm_id, competitor_nm_id, label")
      .eq("cabinet_id", cabinetId).eq("active", true)
      .order("our_nm_id", { ascending: true }).order("competitor_nm_id", { ascending: true })
      .range(from, to),
    { maxPages: 20, label: "Конкуренты: список" },
  ).catch((cause) => {
    notes.push(`список: ${cause instanceof Error ? cause.message : String(cause)}`);
    return [] as WatchRow[];
  });
  if (!watches.length) return NextResponse.json({ items: [], notes });

  const allNm = [...new Set([...watches.map((w) => w.our_nm_id), ...watches.map((w) => w.competitor_nm_id)])];

  // Последняя известная цена каждого артикула. Снимков много, берём свежие и
  // оставляем первый по каждому nm — порядок задан по времени убыванием.
  const prices = new Map<number, { price: number | null; brand: string | null; img: string | null; at: string }>();
  const pricesPromise = loadAllSupabasePages<PriceRow>(
    (from, to) => db.from("wb_shelf_snapshots")
      .select("nm_id, our_price, our_brand, our_img, collected_at")
      .in("nm_id", allNm)
      .gte("collected_at", freshFrom)
      .order("collected_at", { ascending: false }).order("nm_id", { ascending: true })
      .range(from, to),
    { maxPages: 10, label: "Конкуренты: цены", concurrency: 2 },
  ).catch((cause) => {
    notes.push(`цены: ${cause instanceof Error ? cause.message : String(cause)}`);
    return [] as PriceRow[];
  });

  const cards = new Map<number, CardRow>();
  const cardsPromise = loadAllSupabasePages<CardRow>(
    (from, to) => db.from("wb_cards")
      .select("nm_id, article, name, brand")
      .eq("cabinet_id", cabinetId).in("nm_id", allNm)
      .order("nm_id", { ascending: true }).range(from, to),
    { maxPages: 20, label: "Конкуренты: карточки" },
  ).catch(() => [] as CardRow[]);

  // Цены и карточки друг от друга не зависят: читаем разом. Последовательно
  // это складывалось в лишнюю секунду ожидания на каждом открытии экрана.
  const [priceRows, cardRows] = await Promise.all([pricesPromise, cardsPromise]);
  for (const row of priceRows) {
    if (!prices.has(row.nm_id)) {
      prices.set(row.nm_id, { price: num(row.our_price), brand: row.our_brand, img: row.our_img, at: row.collected_at });
    }
  }
  for (const row of cardRows) cards.set(row.nm_id, row);

  const byOur = new Map<number, WatchRow[]>();
  for (const watch of watches) {
    const list = byOur.get(watch.our_nm_id) ?? [];
    list.push(watch);
    byOur.set(watch.our_nm_id, list);
  }

  const items = [...byOur.entries()].map(([nm, list]) => {
    const card = cards.get(nm);
    const our = prices.get(nm) ?? null;
    const competitors = list.map((watch) => {
      const price = prices.get(watch.competitor_nm_id) ?? null;
      return {
        nmId: watch.competitor_nm_id,
        label: watch.label,
        brand: price?.brand ?? null,
        img: price?.img ?? null,
        price: price?.price ?? null,
        collectedAt: price?.at ?? null,
      };
    });
    // Средняя считается ТОЛЬКО по тем, чью цену действительно собрали. Нули
    // за неснятых конкурентов превратили бы среднюю в выдумку.
    const known = competitors.map((c) => c.price).filter((p): p is number => p != null && p > 0);
    const average = known.length ? Math.round((known.reduce((sum, p) => sum + p, 0) / known.length) * 100) / 100 : null;
    const ourPrice = our?.price ?? null;
    const diffPct = average != null && ourPrice != null && average > 0
      ? Math.round(((ourPrice - average) / average) * 1000) / 10
      : null;
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
      /** Насколько мы дороже средней по конкурентам, в процентах. */
      diffPct,
      /** Сколько конкурентов ещё ни разу не собрано — честность средней. */
      pending: competitors.length - known.length,
    };
  }).sort((left, right) => (left.article ?? "").localeCompare(right.article ?? "", "ru"));

  return NextResponse.json({ items, notes });
}
