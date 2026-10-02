import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { aiAttributesConfigured, AiAttributesUnavailableError, estimateAttributes } from "@/lib/assortment/aiAttributesStore";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { isModelId, loadModel } from "@/lib/assortment/model";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** «Определить признаки по фото» для одной модели — по кнопке в карточке. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  if (!aiAttributesConfigured()) return NextResponse.json({ error: "ИИ не подключён: нет ключей Anthropic и Polza" }, { status: 503 });
  const { id } = await ctx.params;
  if (!isModelId(id)) return NextResponse.json({ error: "Модель не найдена" }, { status: 404 });
  const session = await getServerSession();
  try {
    const result = await estimateAttributes(db, id);
    if (!result) return NextResponse.json({ error: "Нет фото или карточку только что изменили — обновите и повторите" }, { status: 409 });
    await audit(request, session, { action: "assortment.update", subject: `${id}:ai-attributes`, after: result });
    return NextResponse.json({ ...result, model: await loadModel(db, id) });
  } catch (error) {
    const status = error instanceof AiAttributesUnavailableError ? 503 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "ИИ не ответил" }, { status });
  }
}
