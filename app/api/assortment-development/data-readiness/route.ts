import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { loadReadiness } from "@/lib/assortment/dataReadinessStore";
import { loadPhotoTraitsCached } from "@/lib/assortment/photoTraitsCached";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * «На чём стоят цифры»: сколько разобрано по фото и сколько это стоит, свежесть среза спроса WB, глубина истории
 * каталогов и даты, с которых функции станут честными. Только чтение базы: MPSTATS и ИИ не вызываются. «Разобрано N из M» —
 * из того же кэшированного отчёта, что блок «Признаки по фото» (числа на одном экране не расходятся).
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const direction = parseDirection(request.nextUrl.searchParams.get("direction"));
  if (!direction) return NextResponse.json({ error: "direction должен быть jackets или bags" }, { status: 400 });
  try {
    return NextResponse.json({ report: await loadReadiness(db, direction, new Date(), { traits: loadPhotoTraitsCached }) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Состояние данных не посчиталось" }, { status: 500 });
  }
}
