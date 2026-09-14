import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { rolesCan } from "@/lib/auth/permissions";
import { sessionRoles } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграцию 202609150001_legal_entities_period_close.sql";

/**
 * Закрытие периода (§5.2) читается и правится отдельным, изолированным
 * роутом — не через listAccessibleEntities(). Та функция читают ВСЕ роуты
 * склада до своей собственной работы; добавь period_closed_through в её
 * select, и весь склад встал бы в 503 «примените миграцию» до того, как
 * владелец успел бы её применить. Эта колонка стоит в стороне ровно затем,
 * чтобы её отсутствие ломало только этот один экран, а не всё остальное.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const { id } = await context.params;
  // resolveEntity не трогает period_closed_through вовсе (та же
  // listAccessibleEntities, что и всегда) — доступ к юрлицу проверяем им
  // безопасно, независимо от того, применена ли новая миграция.
  const scope = await resolveEntity(id);
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const { data, error } = await db.from("legal_entities").select("id, period_closed_through").eq("id", id).maybeSingle();
  if (error) return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  if (!data) return fail("Юрлицо не найдено", 404);

  return NextResponse.json({ data: { periodClosedThrough: data.period_closed_through as string | null }, error: null });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const session = await getServerSession();
  // Закрытие периода — решение финансового контура, не складского: та же
  // граница, что уже названа в правах (finance.period.close), просто до сих
  // пор ничего её не спрашивало.
  if (!rolesCan(sessionRoles(session), "finance.period.close")) {
    return fail("Закрытие периода доступно директору и финдиректору", 403);
  }

  const { id } = await context.params;
  const scope = await resolveEntity(id);
  if (!scope.ok) return fail(scope.error, scope.status);

  const body = (await request.json().catch(() => null)) as { periodClosedThrough?: string | null } | null;
  if (!body || !("periodClosedThrough" in body)) return fail("Некорректное тело запроса", 400);

  const value = body.periodClosedThrough;
  if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return fail("Некорректная дата", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const { data, error } = await db
    .from("legal_entities")
    .update({ period_closed_through: value, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, period_closed_through")
    .maybeSingle();
  if (error) return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  if (!data) return fail("Юрлицо не найдено", 404);

  return NextResponse.json({ data: { periodClosedThrough: data.period_closed_through as string | null }, error: null });
}
