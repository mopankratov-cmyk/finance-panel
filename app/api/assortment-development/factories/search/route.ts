import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { sessionRoles } from "@/lib/auth/session";
import { CHINA_STOP_WORDS, chinaKeyConfigured } from "@/lib/assortment/china1688";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { parseClusterKey } from "@/lib/assortment/factoryGuide";
import { runFactorySearch, translateFactoryQuery } from "@/lib/assortment/factorySearch";
import { canEditFactories, FACTORY_ONLY_BAGS_WORDS } from "@/lib/assortment/factoryShortlist";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
/** Поиск поставщиков 1688 отвечает потоком до минуты; перевод запроса — отдельным шагом. */
export const maxDuration = 90;

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * «Фабрики сумок (1688)» — поиск. Только «Сумки», только закупщик и директор (wb_manager шорт-лист только смотрит).
 * - { direction: "bags", mode: "translate", queryRu } → { queryZh, reason }: перевод запроса на китайский (Polza, статья cn_translate,
 *   общий потолок движка); китайский текст человек видит и правит. Без Polza — reason: «напишите запрос по-китайски».
 * - { direction: "bags", queryZh, queryRu?, cluster? } → выдача: «Фабрики (поиск поставщиков)» и «Продавцы из выдачи товаров», состояние
 *   источников словами, searchId для «В шорт-лист». Повтор за 7 дней — из кэша. Не больше двух запросов к 1688 на поиск и
 *   FACTORY_DAILY_CALLS в сутки. Без ключа 1688 — ни одного запроса (refused: no_key).
 */
export async function POST(request: Request) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const session = await getServerSession();
  if (!canEditFactories(sessionRoles(session))) return NextResponse.json({ error: "Искать фабрики может закупщик или директор" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { direction?: unknown; mode?: unknown; queryRu?: unknown; queryZh?: unknown; cluster?: unknown } | null;
  if (parseDirection(typeof body?.direction === "string" ? body.direction : null) !== "bags") return NextResponse.json({ error: FACTORY_ONLY_BAGS_WORDS }, { status: 400 });
  const who = session?.email ?? session?.uid ?? "неизвестно";
  try {
    if (body?.mode === "translate") {
      if (typeof body.queryRu !== "string") return NextResponse.json({ error: "Нет запроса по-русски" }, { status: 400 });
      if (!chinaKeyConfigured()) return NextResponse.json({ queryZh: null, reason: CHINA_STOP_WORDS.no_key }, { headers: NO_STORE });
      return NextResponse.json(await translateFactoryQuery(db, body.queryRu), { headers: NO_STORE });
    }
    if (body?.cluster != null && !parseClusterKey(body.cluster)) return NextResponse.json({ error: "Неизвестный кластер" }, { status: 400 });
    const result = await runFactorySearch(db, {
      queryZh: typeof body?.queryZh === "string" ? body.queryZh : "",
      queryRu: typeof body?.queryRu === "string" ? body.queryRu : null,
      cluster: parseClusterKey(body?.cluster),
      who,
    });
    return NextResponse.json(result, { status: result.refused === "bad_query" ? 400 : 200, headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: `Поиск фабрик не удался: ${error instanceof Error ? error.message : "ошибка"}` }, { status: 500 });
  }
}
