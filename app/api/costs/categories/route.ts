import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerSession } from "@/lib/auth/server";
import { isCabinetScopedRole } from "@/lib/auth/roles";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import {
  resolveProductCategories,
  type CategoryCardRow,
  type CategoryCostRow,
} from "@/lib/catalog/productCategories";

export const dynamic = "force-dynamic";

// Список категорий товара + карта ключ→категория — общий источник для фильтра
// «Все / Куртки / Сумки / …» на всех WB-таблицах (см. components/ui/CategoryFilter.tsx).
//
// Раньше роут был зеркалом одной колонки product_costs.category, заполненной у
// 0 строк из 215, — то есть фильтр не существовал ни на одном экране. Теперь
// это резолвер: рука бьёт предмет WB, правила приоритета живут в
// lib/catalog/productCategories.ts.
export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ categories: [], byArticle: {} });

  // Раньше отдавать чужое было нечего — карта была пуста. С приходом карточек
  // роут начинает возвращать номенклатуру кабинетов, и tenant-границу надо
  // держать здесь же: у селлера пустой список кабинетов значит «ни одного», а
  // не «все», иначе он увидел бы каталог соседа по названиям артикулов.
  const scopedCabinets =
    session.role === "seller" || (isCabinetScopedRole(session.role) && session.cabinet_ids.length > 0)
      ? session.cabinet_ids
      : null;
  if (scopedCabinets && scopedCabinets.length === 0) {
    return NextResponse.json({ categories: [], byArticle: {} });
  }

  const [cards, costs] = await Promise.all([
    loadAllSupabasePages<CategoryCardRow>(
      (from, to) => {
        const query = db.from("wb_cards").select("article, nm_id, subject").order("nm_id").range(from, to);
        return scopedCabinets ? query.in("cabinet_id", scopedCabinets) : query;
      },
      { label: "Категории: карточки WB" },
    ).catch(() => [] as CategoryCardRow[]),
    loadAllSupabasePages<CategoryCostRow>(
      (from, to) => db.from("product_costs").select("article, category").order("article").range(from, to),
      { label: "Категории: себестоимость" },
    ).catch(() => [] as CategoryCostRow[]),
  ]);

  // Карточки могут не прочитаться (нет таблицы, упал запрос) — тогда работаем
  // на одной ручной колонке, как работали раньше. Молчаливый пустой ответ здесь
  // безобиднее ошибки: фильтр просто спрячется, как прятался до сих пор.
  return NextResponse.json(resolveProductCategories(cards, costs));
}
