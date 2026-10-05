import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { VERDICTS, type Verdict } from "@/lib/assortment/attributeVerdicts";
import { saveVerdict, VerdictInputError, VerdictTableMissingError } from "@/lib/assortment/attributeVerdictsStore";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Отметка точности разбора по фото: { direction, sourceId, modelKey, field, verdict } — верно / неверно / не понять;
 * verdict: null снимает отметку. Версию вопроса и модель сервер берёт из строки разбора, а не от клиента.
 */
export async function POST(request: Request) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { direction?: unknown; sourceId?: unknown; modelKey?: unknown; field?: unknown; verdict?: unknown } | null;
  const direction = parseDirection(typeof body?.direction === "string" ? body.direction : null);
  const sourceId = typeof body?.sourceId === "string" && /^S\d{3,4}$/.test(body.sourceId) ? body.sourceId : null;
  const modelKey = typeof body?.modelKey === "string" && body.modelKey.length > 0 && body.modelKey.length <= 300 ? body.modelKey : null;
  const field = typeof body?.field === "string" && /^[a-z_]{2,30}$/.test(body.field) ? body.field : null;
  const verdict = body?.verdict === null ? null : typeof body?.verdict === "string" && (VERDICTS as readonly string[]).includes(body.verdict) ? (body.verdict as Verdict) : undefined;
  if (!direction || !sourceId || !modelKey || !field || verdict === undefined) return NextResponse.json({ error: "Неверная отметка" }, { status: 400 });
  const session = await getServerSession();
  const who = session?.email ?? session?.uid ?? "неизвестно";
  try {
    await saveVerdict(db, { direction, sourceId, modelKey, field, verdict }, who);
    await audit(request, session, { action: "assortment.update", subject: `attribute-verdict:${sourceId}:${modelKey}:${field}`, after: { verdict } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof VerdictInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof VerdictTableMissingError) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Отметка не сохранилась" }, { status: 500 });
  }
}
