import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { collectionFailure, isUuid } from "@/lib/assortment/collectionsApi";
import { loadCollection, saveVersion } from "@/lib/assortment/collectionsStore";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** Сохранить версию подборки — из неё собирается задание на образец. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Подборка не найдена" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { version?: unknown } | null;
  const expected = Number(body?.version);
  if (!Number.isInteger(expected) || expected < 1) return NextResponse.json({ error: "Нет версии подборки — обновите страницу" }, { status: 400 });
  const session = await getServerSession();
  try {
    const version = await saveVersion(db, id, expected, session?.email ?? session?.uid ?? "неизвестно");
    await audit(request, session, { action: "assortment.decision", subject: `collection:${id}`, after: { saved: version } });
    return NextResponse.json({ version, collection: await loadCollection(db, id) });
  } catch (error) {
    return collectionFailure(error);
  }
}
