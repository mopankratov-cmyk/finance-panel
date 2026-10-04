import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { hideCatalogItem } from "@/lib/assortment/catalogPick";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** «Не интересно» в каталоге { sourceId, itemId, hidden }: модель уходит из выдачи, база сравнения не меняется. */
export async function PATCH(request: Request) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { sourceId?: unknown; itemId?: unknown; hidden?: unknown } | null;
  const sourceId = typeof body?.sourceId === "string" && /^S\d{3,4}$/.test(body.sourceId) ? body.sourceId : null;
  const itemId = typeof body?.itemId === "string" && body.itemId.length > 0 && body.itemId.length <= 300 ? body.itemId : null;
  if (!sourceId || !itemId) return NextResponse.json({ error: "Неверная модель" }, { status: 400 });
  const hidden = body?.hidden !== false;
  try {
    const result = await hideCatalogItem(db, { sourceId, itemId, hidden });
    if (result === "migration_missing") return NextResponse.json({ error: "Скрывать из каталога можно после обновления базы (миграция 202610040001)" }, { status: 409 });
    if (result === "not_found") return NextResponse.json({ error: "Модель не найдена в каталоге" }, { status: 404 });
    const session = await getServerSession();
    await audit(request, session, { action: "assortment.update", subject: `catalog:${sourceId}:${itemId}`, after: { hidden } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не получилось" }, { status: 500 });
  }
}
