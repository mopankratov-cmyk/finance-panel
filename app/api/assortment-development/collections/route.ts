import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { cleanResponsible, isCollectionKind } from "@/lib/assortment/collections";
import { collectionFailure } from "@/lib/assortment/collectionsApi";
import { createCollection, listCollections } from "@/lib/assortment/collectionsStore";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** Подборки обоих разделов: план сумок на месяц, доска курток на сезон, свои. */
export async function GET() {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  try {
    return NextResponse.json({ collections: await listCollections(db) });
  } catch (error) {
    return collectionFailure(error);
  }
}

export async function POST(request: Request) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const direction = parseDirection(typeof body?.direction === "string" ? body.direction : null);
  if (!direction) return NextResponse.json({ error: "Укажите раздел: куртки или сумки" }, { status: 400 });
  const kind = isCollectionKind(body?.kind) ? body.kind : null;
  if (!kind) return NextResponse.json({ error: "Укажите вид подборки" }, { status: 400 });
  const session = await getServerSession();
  try {
    const result = await createCollection(db, {
      direction,
      kind,
      period: typeof body?.period === "string" ? body.period : "",
      title: typeof body?.title === "string" ? body.title.slice(0, 120) : null,
      responsible: cleanResponsible(body?.responsible),
    }, session?.email ?? session?.uid ?? "неизвестно");
    if (result.created) await audit(request, session, { action: "assortment.update", subject: `collection:${result.id}`, after: { direction, kind, period: body?.period } });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return collectionFailure(error);
  }
}
