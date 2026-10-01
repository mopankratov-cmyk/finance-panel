import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { isMissingAssortmentSchema, MIGRATION_HINT } from "@/lib/assortment/errors";
import { addModelPhotos, isModelId, loadModel, ModelNotFoundError } from "@/lib/assortment/model";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Добавить фото или скриншоты к найденной модели (пути из upload-ticket). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { id } = await ctx.params;
  if (!isModelId(id)) return NextResponse.json({ error: "Модель не найдена" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { uploads?: unknown } | null;
  const uploads = Array.isArray(body?.uploads) ? body.uploads : [];
  if (uploads.length === 0) return NextResponse.json({ error: "Приложите хотя бы одно фото" }, { status: 400 });
  const session = await getServerSession();
  try {
    const result = await addModelPhotos(db, id, uploads);
    await audit(request, session, { action: "assortment.update", subject: `${id}:media`, after: result });
    return NextResponse.json({ ...result, model: await loadModel(db, id) });
  } catch (error) {
    if (error instanceof ModelNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Фото не сохранились" }, { status: 500 });
  }
}
