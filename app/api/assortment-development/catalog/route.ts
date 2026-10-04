import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { parseCatalogQuery } from "@/lib/assortment/catalog";
import { countCatalog, loadCatalog } from "@/lib/assortment/catalogStore";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { isMissingAssortmentSchema, MIGRATION_HINT } from "@/lib/assortment/errors";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * «Каталоги брендов»: всё, что обходы собрали у брендов в разделе, порциями.
 * ?source=S131 — один бренд, ?q= — поиск по названию и бренду, ?fresh=1 —
 * новое за 7 дней, ?badge=1 — с меткой бренда, ?photo=all — и без фото,
 * ?offset=&limit= — «Показать ещё», ?count=1 — только число моделей (вкладка),
 * ?timings=1 — замер.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const mark = (name: string) => { timings[name] = Date.now() - startedAt; };
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const params = request.nextUrl.searchParams;
  const direction = parseDirection(params.get("direction"));
  if (!direction) return NextResponse.json({ error: "direction должен быть jackets или bags" }, { status: 400 });
  try {
    const query = parseCatalogQuery(params, direction);
    if (params.get("count") === "1") {
      return NextResponse.json({ total: await countCatalog(db, query, startedAt) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const page = await loadCatalog(db, query, startedAt, mark);
    mark("total");
    const body = params.get("timings") === "1" ? { ...page, timings } : page;
    // Каталог меняется кнопками («Отобрать», «Не интересно») — браузеру не кешировать.
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Каталог не загрузился" }, { status: 500 });
  }
}
