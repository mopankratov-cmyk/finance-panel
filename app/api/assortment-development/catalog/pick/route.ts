import { after, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { CatalogPickError, pickCatalogItem, storePickPhotos } from "@/lib/assortment/catalogPick";
import { ASSORTMENT_BASE_PATH, ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { STATUS_LABEL } from "@/lib/assortment/decisions";
import { isMissingAssortmentSchema, MIGRATION_HINT } from "@/lib/assortment/errors";
import { VersionConflictError } from "@/lib/assortment/model";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * «Отобрать» из каталога бренда { sourceId, itemId }: модель становится
 * находкой со статусом «Отобрана». Фото облачных сайтов — после ответа (не
 * держим человека), сайтов через mini — приносит mini с ближайшим обходом.
 */
export async function POST(request: Request) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { sourceId?: unknown; itemId?: unknown } | null;
  const sourceId = typeof body?.sourceId === "string" && /^S\d{3,4}$/.test(body.sourceId) ? body.sourceId : null;
  const itemId = typeof body?.itemId === "string" && body.itemId.length > 0 && body.itemId.length <= 300 ? body.itemId : null;
  if (!sourceId || !itemId) return NextResponse.json({ error: "Неверная модель" }, { status: 400 });
  const session = await getServerSession();
  const who = session?.email ?? session?.uid ?? "неизвестно";
  try {
    const picked = await pickCatalogItem(db, { sourceId, itemId }, who);
    if (picked.photoUrls.length) after(() => storePickPhotos(db, picked.referenceId, picked.photoUrls).then(() => undefined).catch(() => undefined));
    // Журнал — честно: «отобрано» только если решение применено, иначе — связали с уже существующей находкой.
    await audit(request, session, picked.decided
      ? { action: "assortment.decision", subject: picked.referenceId, after: { action: "selected", via: "catalog", sourceId, itemId, created: picked.created } }
      : { action: "assortment.update", subject: picked.referenceId, after: { linked: true, via: "catalog", sourceId, itemId, status: picked.status } });
    return NextResponse.json({
      referenceId: picked.referenceId,
      href: `${ASSORTMENT_BASE_PATH}/${picked.direction}/${picked.referenceId}`,
      decided: picked.decided,
      status: picked.status,
      statusLabel: STATUS_LABEL[picked.status],
    });
  } catch (error) {
    if (error instanceof CatalogPickError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof VersionConflictError) return NextResponse.json({ error: "Модель уже изменили — обновите страницу" }, { status: 409 });
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не получилось отобрать" }, { status: 500 });
  }
}
