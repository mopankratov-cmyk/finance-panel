import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { loadChinaView } from "@/lib/assortment/chinaStore";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * «Китай (1688)» раздела: топ ниш недели (без цен и продавцов), «новое в топе» и «поднялось» неделя к неделе, копии по номерам товаров
 * брендов, тренды ключей и «возможности». ?direction=jackets|bags. Без ключа, без миграции, с недействительным ключом и до первого
 * снимка — 200 { available: false, reason }: блок скрыт, причина одной строкой.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const direction = parseDirection(request.nextUrl.searchParams.get("direction"));
  if (!direction) return NextResponse.json({ error: "direction должен быть jackets или bags" }, { status: 400 });
  try {
    return NextResponse.json(await loadChinaView(db, { direction }), { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: `Блок «Китай (1688)» не загрузился: ${error instanceof Error ? error.message : "ошибка"}` }, { status: 500 });
  }
}
