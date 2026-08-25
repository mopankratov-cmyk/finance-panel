import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { loadCardsFromDb } from "@/lib/wb/cards";

// Справочник «номер WB → артикул и название» для подписей в таблицах.
//
// Экраны брали его из /api/pim: тот обходит Content API и держит результат в
// часовом кэше сборки. Кэш не общий между роутами и умирает при каждом
// деплое (та же история, что с карточками и с заданиями сверки), поэтому
// названия то появлялись, то пропадали — а на Полках их не было почти всегда.
//
// Здесь только чтение таблицы wb_cards, которую наполняет обход: справочные
// данные, устаревание не страшно, зато они есть всегда и приходят мгновенно.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const cabinetId = cabinetIdFromParam(new URL(request.url).searchParams.get("cabinet"));
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  const cards = await loadCardsFromDb(cabinetId);
  return NextResponse.json({
    rows: cards.map((card) => ({ nmId: card.nmId, article: card.article, name: card.name })),
  });
}
