import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionOrMachine } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import {
  buildShelfExclusionSet,
  computeShelfSlices,
  markShelfRows,
  type ShelfMarkedRow,
  type ShelfRow,
  type ShelfSliceResult,
} from "@/lib/shelf/slices";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Селлер читает «Полки» своего кабинета (см. комментарий в watch/route.ts).
const READ_ROLES = ["director", "finance", "manager", "seller"] as const;
const HISTORY_DAYS_DEFAULT = 14;
const HISTORY_DAYS_MAX = 90;

interface WatchRow {
  id: string;
  cabinet_id: string;
  nm_id: number;
  supplier_article: string | null;
  our_brand: string | null;
  our_link: string | null;
  our_img: string | null;
  extra_excluded_brands: string[] | null;
  active: boolean;
}

interface SnapshotRow {
  id: string;
  watch_id: string;
  collected_at: string;
  our_price: number | null;
  our_brand: string | null;
  our_img: string | null;
  competitor_count: number;
}

interface DbRow {
  snapshot_id: string;
  position: number;
  nm_id: number | null;
  brand: string | null;
  price: number | null;
  img: string | null;
}

interface HistoryPoint {
  snapshotId: string;
  collectedAt: string;
  ourPrice: number | null;
  slices: ShelfSliceResult[];
}

// Данные экрана «Полки»: по каждому отслеживаемому артикулу — последний снимок
// с разметкой исключений и срезами Топ-3/6/12/30 плюс история срезов за окно.
// Исключения применяются ТЕКУЩИЕ (свой бренд + ручные + глобальные кабинета):
// правка списка честно пересчитывает и исторические точки.
export async function GET(request: NextRequest) {
  const gate = await requireApiSessionOrMachine(request, [...READ_ROLES]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });

  // Правка с параллельными чанками эффекта не дала: 4.5 с против 4.3 до неё.
  // Значит узкое место не там, где я предположил, — меряем по этапам.
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const mark = (name: string) => { timings[name] = Date.now() - startedAt; };

  const searchParams = new URL(request.url).searchParams;
  const cabinetParam = searchParams.get("cabinet");
  const cabinetId = cabinetParam && cabinetParam !== "all" ? cabinetParam : null;
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const daysRaw = Number(searchParams.get("days") ?? HISTORY_DAYS_DEFAULT);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.round(daysRaw), 1), HISTORY_DAYS_MAX) : HISTORY_DAYS_DEFAULT;

  // Список отслеживаемых и глобальные исключения друг от друга не зависят —
  // замер показал по 0.5 и 0.7 секунды подряд, хотя запросы независимы.
  const [watchesRes, settingsRes] = await Promise.all([
    (() => {
      // Только НАШИ товары. Артикулы конкурентов лежат в той же таблице с
      // purpose='price' — они нужны сборщику ради цены и на экране «Полок»
      // им делать нечего: без фильтра 96 чужих карточек засоряли список.
      let watchQ = db
        .from("wb_shelf_watch")
        .select("id, cabinet_id, nm_id, supplier_article, our_brand, our_link, our_img, extra_excluded_brands, active")
        .order("created_at", { ascending: true });
      watchQ = watchQ.eq("purpose", "shelf");
      if (cabinetId) watchQ = watchQ.eq("cabinet_id", cabinetId);
      return watchQ;
    })(),
    (() => {
      let settingsQ = db.from("wb_shelf_cabinet_settings").select("cabinet_id, global_excluded_brands");
      if (cabinetId) settingsQ = settingsQ.eq("cabinet_id", cabinetId);
      return settingsQ;
    })(),
  ]);
  if (watchesRes.error) return NextResponse.json({ error: watchesRes.error.message }, { status: 502 });
  if (settingsRes.error) return NextResponse.json({ error: settingsRes.error.message }, { status: 502 });
  mark("watches");
  const watches = (watchesRes.data ?? []) as WatchRow[];
  if (!watches.length) return NextResponse.json({ items: [], days });

  const globalByCabinet = new Map<string, string[]>();
  for (const row of settingsRes.data ?? []) {
    globalByCabinet.set(String(row.cabinet_id), (row.global_excluded_brands ?? []) as string[]);
  }

  mark("settings");
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const watchIds = watches.map((watch) => watch.id);
  // PostgREST молча обрезает ответ (по умолчанию 1000 строк) — большие выборки
  // в этом репо всегда листаются страницами, иначе теряются строки без ошибки.
  let snapshots: SnapshotRow[];
  try {
    snapshots = await loadAllSupabasePages<SnapshotRow>((from, to) => db
      .from("wb_shelf_snapshots")
      .select("id, watch_id, collected_at, our_price, our_brand, our_img, competitor_count")
      .in("watch_id", watchIds)
      .gte("collected_at", sinceIso)
      .order("collected_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to), { maxPages: 30, concurrency: 4, label: "Снимки «Полок»" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Снимки не загрузились" }, { status: 502 });
  }

  // Последний снимок может быть старше окна истории — дотягиваем отдельно,
  // чтобы артикул с давним последним сбором не выглядел «пустым».
  const latestByWatch = new Map<string, SnapshotRow>();
  for (const snapshot of snapshots) latestByWatch.set(snapshot.watch_id, snapshot);
  const missingLatest = watchIds.filter((id) => !latestByWatch.has(id));
  if (missingLatest.length) {
    for (const watchId of missingLatest) {
      const latest = await db
        .from("wb_shelf_snapshots")
        .select("id, watch_id, collected_at, our_price, our_brand, our_img, competitor_count")
        .eq("watch_id", watchId)
        .order("collected_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest.error) return NextResponse.json({ error: latest.error.message }, { status: 502 });
      if (latest.data) latestByWatch.set(watchId, latest.data as SnapshotRow);
    }
  }

  const neededSnapshotIds = new Set<string>(snapshots.map((snapshot) => snapshot.id));
  for (const snapshot of latestByWatch.values()) neededSnapshotIds.add(snapshot.id);

  mark("snapshots");
  const rowsBySnapshot = new Map<string, ShelfRow[]>();
  {
    const ids = [...neededSnapshotIds];
    const chunkSize = 20; // ≤40 строк на снимок → страница выборки заведомо меньше лимита PostgREST
    const chunks: string[][] = [];
    for (let offset = 0; offset < ids.length; offset += chunkSize) chunks.push(ids.slice(offset, offset + chunkSize));

    // Чанки шли строго по очереди: две недели истории — это два десятка
    // обращений подряд, а round-trip до базы стоит около 240 мс. Пятёрками
    // экран собирается за то же число запросов, но впятеро быстрее.
    const CHUNK_CONCURRENCY = 5;
    let loaded: DbRow[][];
    try {
      loaded = [];
      for (let offset = 0; offset < chunks.length; offset += CHUNK_CONCURRENCY) {
        const batch = await Promise.all(chunks.slice(offset, offset + CHUNK_CONCURRENCY).map((chunk) =>
          loadAllSupabasePages<DbRow>((from, to) => db
            .from("wb_shelf_snapshot_rows")
            .select("snapshot_id, position, nm_id, brand, price, img")
            .in("snapshot_id", chunk)
            .order("id", { ascending: true })
            .range(from, to), { maxPages: 5, label: "Строки снимков «Полок»" })));
        loaded.push(...batch);
      }
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Строки снимков не загрузились" }, { status: 502 });
    }

    for (const raw of loaded.flat()) {
      const list = rowsBySnapshot.get(raw.snapshot_id) ?? [];
      list.push({
        position: Number(raw.position),
        nmId: raw.nm_id == null ? null : Number(raw.nm_id),
        brand: raw.brand,
        price: raw.price == null ? null : Number(raw.price),
        img: raw.img,
      });
      rowsBySnapshot.set(raw.snapshot_id, list);
    }
  }

  mark("snapshot_rows");
  const items = watches.map((watch) => {
    const exclusionSet = buildShelfExclusionSet(
      watch.our_brand,
      watch.extra_excluded_brands ?? [],
      globalByCabinet.get(String(watch.cabinet_id)) ?? [],
    );

    const latest = latestByWatch.get(watch.id) ?? null;
    let latestView: {
      snapshotId: string;
      collectedAt: string;
      ourPrice: number | null;
      competitorCount: number;
      rows: (ShelfMarkedRow & { isNew: boolean })[];
      slices: ShelfSliceResult[];
    } | null = null;
    if (latest) {
      const rawRows = rowsBySnapshot.get(latest.id) ?? [];
      const marked = markShelfRows(rawRows, exclusionSet);
      // «Новый конкурент» = не встречался в предыдущем снимке этого артикула
      // (идея recurrence-подсветки автора наработок).
      const watchHistory = snapshots.filter((snapshot) => snapshot.watch_id === watch.id);
      const previous = watchHistory.length >= 2 ? watchHistory[watchHistory.length - 2] : null;
      const previousIds = new Set(
        (previous ? rowsBySnapshot.get(previous.id) ?? [] : [])
          .map((row) => row.nmId)
          .filter((nm): nm is number => nm != null),
      );
      latestView = {
        snapshotId: latest.id,
        collectedAt: latest.collected_at,
        ourPrice: latest.our_price == null ? null : Number(latest.our_price),
        competitorCount: Number(latest.competitor_count ?? rawRows.length),
        rows: marked.map((row) => ({
          ...row,
          isNew: previous != null && row.nmId != null && !previousIds.has(row.nmId),
        })),
        slices: computeShelfSlices(rawRows, latest.our_price == null ? null : Number(latest.our_price), exclusionSet),
      };
    }

    const history: HistoryPoint[] = snapshots
      .filter((snapshot) => snapshot.watch_id === watch.id)
      .map((snapshot) => ({
        snapshotId: snapshot.id,
        collectedAt: snapshot.collected_at,
        ourPrice: snapshot.our_price == null ? null : Number(snapshot.our_price),
        slices: computeShelfSlices(
          rowsBySnapshot.get(snapshot.id) ?? [],
          snapshot.our_price == null ? null : Number(snapshot.our_price),
          exclusionSet,
        ),
      }));

    return {
      watch: {
        id: watch.id,
        cabinetId: watch.cabinet_id,
        nmId: watch.nm_id,
        supplierArticle: watch.supplier_article,
        ourBrand: watch.our_brand,
        ourLink: watch.our_link,
        ourImg: watch.our_img,
        extraExcludedBrands: watch.extra_excluded_brands ?? [],
        active: watch.active,
      },
      latest: latestView,
      history,
    };
  });

  mark("total");
  return NextResponse.json(searchParams.get("timings") === "1" ? { items, days, timings } : { items, days });
}
