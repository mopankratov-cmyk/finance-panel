import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { sessionHasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { loadProfiles } from "@/lib/assortment/brandProfilesStore";
import { ownModelsFor, type OwnCard } from "@/lib/assortment/ownModels";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * «У нас N»: собственные модели брендов раздела на WB по формам (по названию карточки). Отдаются только числа — ни артикулов,
 * ни номеров WB. Карточки берутся из тех кабинетов, к которым у сессии есть доступ (ограниченный менеджер видит свои кабинеты).
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const direction = parseDirection(request.nextUrl.searchParams.get("direction"));
  if (!direction) return NextResponse.json({ error: "direction должен быть jackets или bags" }, { status: 400 });
  try {
    const { profiles } = await loadProfiles(db);
    const mine = profiles.filter((p) => p.direction === direction);
    const names = [...new Set(mine.flatMap((p) => p.wbBrandNames))];
    if (names.length === 0) return NextResponse.json({ own: [] }, { headers: { "Cache-Control": "private, no-store" } });
    // ilike без подстановочных знаков — сравнение без учёта регистра; названия брендов — из кода профилей, не от клиента.
    const filter = names.map((n) => `brand.ilike.${n.replace(/[,()%_\\]/g, "")}`).join(",");
    const rows = await loadAllSupabasePages<OwnCard>((from, to) => db.from("wb_cards")
      .select("cabinet_id,nm_id,imt_id,name,brand")
      .or(filter)
      .order("nm_id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: OwnCard[] | null; error: { message: string } | null }>, { label: "Свои карточки WB", pageSize: 1000 });
    const session = await getServerSession();
    const allowed = rows.filter((row) => sessionHasCabinetAccess(session, row.cabinet_id));
    return NextResponse.json({ own: mine.map((p) => ownModelsFor(p, allowed)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Свои модели не посчитались" }, { status: 500 });
  }
}
