import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { importReference, ImportInputError } from "@/lib/assortment/importer";
import { isMissingAssortmentSchema, MIGRATION_HINT } from "@/lib/assortment/errors";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Добавить находку: ссылка на товар, публикацию или пин и/или фото. */
export async function POST(request: Request) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const direction = parseDirection(typeof body?.direction === "string" ? body.direction : null);
  if (!direction) return NextResponse.json({ error: "Укажите раздел: куртки или сумки" }, { status: 400 });

  const session = await getServerSession();
  try {
    const result = await importReference(db, {
      direction,
      url: typeof body?.url === "string" ? body.url : null,
      title: typeof body?.title === "string" ? body.title.slice(0, 200) : null,
      note: typeof body?.note === "string" ? body.note : null,
      uploads: Array.isArray(body?.uploads) ? body.uploads.filter((p): p is string => typeof p === "string") : [],
    }, session?.uid ?? null);
    await audit(request, session, {
      action: "assortment.import",
      subject: result.title,
      after: { referenceId: result.referenceId, created: result.created, sourceId: result.sourceId, images: result.images },
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ImportInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Находка не сохранилась" }, { status: 500 });
  }
}
