import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { AttributeInputError, parseAttributeEdit } from "@/lib/assortment/attributes";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { DecisionInputError, decisionReason, isActionId } from "@/lib/assortment/decisions";
import { isMissingAssortmentSchema, MIGRATION_HINT } from "@/lib/assortment/errors";
import { applyAttribute, applyDecision, isModelId, loadModel, ModelNotFoundError, VersionConflictError } from "@/lib/assortment/model";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function failure(error: unknown) {
  if (error instanceof ModelNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof VersionConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof AttributeInputError || error instanceof DecisionInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (isMissingAssortmentSchema(error)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
  return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка карточки модели" }, { status: 500 });
}

/** Карточка модели: фото, доказательства, признаки, история решений. */
export async function GET(_request: Request, ctx: Ctx) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { id } = await ctx.params;
  if (!isModelId(id)) return NextResponse.json({ error: "Модель не найдена" }, { status: 404 });
  try {
    return NextResponse.json({ model: await loadModel(db, id) });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Решение по модели ({ action, version, reason?, comment? }) или правка
 * признака ({ attribute, edit, version }). Версия обязательна: два человека
 * не перетирают решения друг друга молча.
 */
export async function PATCH(request: Request, ctx: Ctx) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { id } = await ctx.params;
  if (!isModelId(id)) return NextResponse.json({ error: "Модель не найдена" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const expectedVersion = Number(body?.version);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return NextResponse.json({ error: "Нет версии карточки — обновите страницу" }, { status: 400 });
  }
  const session = await getServerSession();
  const who = session?.email ?? session?.uid ?? "неизвестно";

  try {
    if (isActionId(body?.action)) {
      const reason = decisionReason(body.action, body?.reason, body?.comment);
      const result = await applyDecision(db, id, { action: body.action, expectedVersion, reason, author: who });
      await audit(request, session, { action: "assortment.decision", subject: id, after: { action: body.action, reason, status: result.status, version: result.version } });
      return NextResponse.json({ model: await loadModel(db, id) });
    }
    if (typeof body?.attribute === "string") {
      const edit = parseAttributeEdit(body.edit);
      const result = await applyAttribute(db, id, { key: body.attribute, edit, expectedVersion, reviewer: who });
      await audit(request, session, { action: "assortment.update", subject: `${id}:${body.attribute}`, before: { value: result.before }, after: { value: result.after } });
      return NextResponse.json({ model: await loadModel(db, id) });
    }
    return NextResponse.json({ error: "Нужно действие или признак" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
