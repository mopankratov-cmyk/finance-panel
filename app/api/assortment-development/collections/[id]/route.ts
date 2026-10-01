import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { cleanResponsible, cleanTitle } from "@/lib/assortment/collections";
import { collectionFailure, isUuid } from "@/lib/assortment/collectionsApi";
import { addItem, loadCollection, updateCollectionMeta } from "@/lib/assortment/collectionsStore";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Подборка не найдена" }, { status: 404 });
  try {
    return NextResponse.json({ collection: await loadCollection(db, id) });
  } catch (error) {
    return collectionFailure(error);
  }
}

/** Название, ответственный, архив/возврат. */
export async function PATCH(request: Request, ctx: Ctx) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Подборка не найдена" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const session = await getServerSession();
  try {
    const patch: { title?: string; responsible?: string | null; status?: "draft" | "archived" } = {};
    if (body && "title" in body) patch.title = cleanTitle(body.title);
    if (body && "responsible" in body) patch.responsible = cleanResponsible(body.responsible);
    if (body?.archive === true) patch.status = "archived";
    if (body?.archive === false) patch.status = "draft";
    await updateCollectionMeta(db, id, patch);
    await audit(request, session, { action: "assortment.update", subject: `collection:${id}`, after: patch });
    return NextResponse.json({ collection: await loadCollection(db, id) });
  } catch (error) {
    return collectionFailure(error);
  }
}

/** Добавить модель: в свободный слот, либо в резерв. */
export async function POST(request: Request, ctx: Ctx) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Подборка не найдена" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isUuid(body?.referenceId)) return NextResponse.json({ error: "Не указана модель" }, { status: 400 });
  const session = await getServerSession();
  try {
    const slot = Number(body?.slot);
    await addItem(db, id, body.referenceId, body?.asReserve === true, session?.email ?? session?.uid ?? "неизвестно", Number.isInteger(slot) && slot > 0 ? slot : null);
    await audit(request, session, { action: "assortment.decision", subject: `collection:${id}`, after: { add: body.referenceId, asReserve: body?.asReserve === true } });
    return NextResponse.json({ collection: await loadCollection(db, id) });
  } catch (error) {
    return collectionFailure(error);
  }
}
