import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { CollectionInputError, isReplaceReason, parseItemPatch } from "@/lib/assortment/collections";
import { collectionFailure, isUuid } from "@/lib/assortment/collectionsApi";
import { loadCollection, removeItem, updateItem } from "@/lib/assortment/collectionsStore";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/** Идея, детали, следующий шаг, поля задания; перенос в резерв и обратно. */
export async function PATCH(request: Request, ctx: Ctx) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { id, itemId } = await ctx.params;
  if (!isUuid(id) || !isUuid(itemId)) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const session = await getServerSession();
  try {
    const patch = parseItemPatch(body);
    const moveTo = body?.moveTo === "main" || body?.moveTo === "reserve" ? body.moveTo : undefined;
    await updateItem(db, id, itemId, { ...patch, moveTo });
    await audit(request, session, { action: "assortment.update", subject: `collection:${id}:${itemId}`, after: { ...patch, moveTo } });
    return NextResponse.json({ collection: await loadCollection(db, id) });
  } catch (error) {
    return collectionFailure(error);
  }
}

/** Убрать или заменить кандидата. ?reason= — причина замены (по ней учимся). */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { id, itemId } = await ctx.params;
  if (!isUuid(id) || !isUuid(itemId)) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const raw = request.nextUrl.searchParams.get("reason");
  const session = await getServerSession();
  try {
    if (raw && !isReplaceReason(raw)) throw new CollectionInputError("Неизвестная причина замены.");
    const reason = raw && isReplaceReason(raw) ? raw : null;
    await removeItem(db, id, itemId, reason, session?.email ?? session?.uid ?? "неизвестно");
    await audit(request, session, { action: "assortment.decision", subject: `collection:${id}:${itemId}`, after: { removed: true, reason } });
    return NextResponse.json({ collection: await loadCollection(db, id) });
  } catch (error) {
    return collectionFailure(error);
  }
}
