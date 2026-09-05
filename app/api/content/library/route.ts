import { NextRequest, NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { isCabinetScopedRole } from "@/lib/auth/roles";
import {
  buildProductContent,
  type LibraryAssetRow,
  type LibraryCardRow,
} from "@/lib/content/productLibrary";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Библиотека контента по товарам кабинета.
 *
 * Два источника, которые до сих пор не встречались: галерея карточки WB
 * (её приносит обход Content API и с миграции 202609050001 наконец кладёт в
 * базу) и каталог съёмок `content_assets` — 9 069 файлов, которые в этой
 * панели не читал никто с тех пор, как контент-завод уехал в свой репозиторий.
 *
 * Тяжёлых агрегатов здесь нет намеренно: обе выборки — прямые, по индексам.
 * Экран открывается ради выбора картинки, и заставлять его ждать РНП-агрегат
 * было бы ровно той ошибкой, которую пришлось разбирать в кандидатах CTR.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const { cabinetId } = await resolveShopCabinet(new URL(request.url).searchParams.get("cabinet") ?? undefined);
  if (!cabinetId) return NextResponse.json({ error: "Выберите один реальный WB-кабинет" }, { status: 400 });
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  if (allowedNmIds && allowedNmIds.size === 0) {
    return NextResponse.json({ products: [], orphanAssets: null, totalAssets: null });
  }

  /**
   * Колонок галереи может ещё не быть: миграция 202609050001 применяется
   * владельцем вручную, как всякая миграция в этом проекте.
   *
   * Проглотить эту ошибку через `.catch(() => [])` было бы худшим из возможных:
   * экран показал бы «товаров нет» — то есть соврал бы про товары, хотя не
   * хватает всего лишь двух колонок. Поэтому пробуем с галереей, а на
   * отсутствующей колонке (42703) перечитываем без неё и говорим об этом
   * прямо: у товаров будет `galleryUnknown`, а экран — плашку с именем
   * миграции.
   */
  const selectCards = (columns: string) => loadAllSupabasePages<LibraryCardRow>((from, to) => {
    const query = db
      .from("wb_cards")
      .select(columns)
      .eq("cabinet_id", cabinetId)
      .order("nm_id", { ascending: true })
      .range(from, to);
    return (allowedNmIds ? query.in("nm_id", [...allowedNmIds]) : query) as never;
  }, { label: "Библиотека контента: карточки" });

  let cards: LibraryCardRow[] = [];
  let galleryColumnsMissing = false;
  try {
    cards = await selectCards("nm_id, article, name, subject, photos, photos_big, photos_count");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/photos|42703|column/i.test(message)) throw error;
    galleryColumnsMissing = true;
    cards = await selectCards("nm_id, article, name, subject").catch(() => [] as LibraryCardRow[]);
  }

  const visible = cards.filter((card) => requestAllowsNm(allowedNmIds, Number(card.nm_id)));
  const articles = [...new Set(visible.map((card) => String(card.article ?? "").trim()).filter(Boolean))];

  // Каталог съёмок общий на всю базу — у него нет кабинета. Границу держим
  // здесь: берём только файлы тех артикулов, которые человек и так видит.
  // Иначе селлер получил бы номенклатуру соседа по одним названиям файлов.
  const assets = articles.length
    ? await loadAllSupabasePages<LibraryAssetRow>((from, to) => db
      .from("content_assets")
      .select("id, article, kind, url, name, disk, niche")
      .in("article", articles)
      .order("id", { ascending: true })
      .range(from, to), { label: "Библиотека контента: съёмки" }).catch(() => [] as LibraryAssetRow[])
    : [];

  const products = buildProductContent(visible, assets);

  // Сколько файлов каталога не досталось ни одному товару — вопрос владельца,
  // а не селлера: у второго «остальные» это чужое добро. Считаем только тому,
  // кто видит кабинет целиком.
  const session = await getServerSession();
  const scoped = session ? session.role === "seller" || isCabinetScopedRole(session.role) : true;
  let totalAssets: number | null = null;
  if (!scoped) {
    const { count } = await db.from("content_assets").select("id", { count: "exact", head: true });
    totalAssets = typeof count === "number" ? count : null;
  }

  return NextResponse.json({
    products,
    // Экран обязан отличать «галереи нет» от «мы её не спрашивали».
    galleryColumnsMissing,
    migrationHint: galleryColumnsMissing
      ? "Фото карточек появятся после миграции 202609050001_wb_card_photos.sql и ближайшего обхода карточек"
      : null,
    attachedAssets: assets.length,
    totalAssets,
    orphanAssets: totalAssets == null ? null : Math.max(0, totalAssets - assets.length),
  });
}
