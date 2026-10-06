import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { parseFeedPeriod } from "@/lib/assortment/socialFeed";
import { countSocialFeed, loadSocialFeed, setReelHidden, SOCIAL_UNAVAILABLE } from "@/lib/assortment/socialFeedStore";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * «Залетает в соцсетях» — лента раздела: рилсы Instagram про Zara и Uniqlo (только женское), где вещь набрала намного больше обычного
 * у автора. ?direction=jackets|bags, ?days=7|14|30 (по умолчанию 14), ?strong=1 — только «сильный залёт», ?count=1 — только число для
 * вкладки и признак, что сбор уже идёт. Без миграции — 200 { available: false, reason }: вкладки нет, причина одной строкой.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const params = request.nextUrl.searchParams;
  const direction = parseDirection(params.get("direction"));
  if (!direction) return NextResponse.json({ error: "direction должен быть jackets или bags" }, { status: 400 });
  const nowMs = Date.now();
  try {
    if (params.get("count") === "1") return NextResponse.json(await countSocialFeed(db, direction, nowMs), { headers: NO_STORE });
    const feed = await loadSocialFeed(db, { direction, days: parseFeedPeriod(params.get("days")), onlyStrong: params.get("strong") === "1", nowMs });
    return NextResponse.json(feed, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: `Лента «Залетает» не загрузилась: ${error instanceof Error ? error.message : "ошибка"}` }, { status: 500 });
  }
}

/** «Не интересно» для рилса { code, hidden }: рилс уходит из ленты для всех (модель в каталоге этим не скрывается). */
export async function PATCH(request: Request) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { code?: unknown; hidden?: unknown } | null;
  const code = typeof body?.code === "string" && /^[A-Za-z0-9_-]{4,40}$/.test(body.code) ? body.code : null;
  if (!code) return NextResponse.json({ error: "Неверный рилс" }, { status: 400 });
  const hidden = body?.hidden !== false;
  const session = await getServerSession();
  const who = session?.email ?? session?.uid ?? "неизвестно";
  try {
    const result = await setReelHidden(db, code, hidden, who);
    if (result === "migration_missing") return NextResponse.json({ error: SOCIAL_UNAVAILABLE }, { status: 503 });
    if (result === "not_found") return NextResponse.json({ error: "Рилс не найден" }, { status: 404 });
    await audit(request, session, { action: "assortment.update", subject: `social-reel:${code}`, after: { hidden } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не получилось" }, { status: 500 });
  }
}
