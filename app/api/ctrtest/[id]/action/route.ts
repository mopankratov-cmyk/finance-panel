import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { getCtrMetricSnapshot } from "@/lib/ctrtest/metrics";
import { ctrSnapshotDelta, type CtrMetricSnapshot } from "@/lib/ctrtest/model";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fail = (error: string, status: number, details?: unknown) => NextResponse.json({ data: details ? { details } : null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code ?? "");
const confirmations: Record<string, string> = {
  start: "CONTENT_IS_SET",
  advance: "CONTENT_IS_SET",
  finish: "FINISH_TEST",
  cancel: "CANCEL_TEST",
  winner: "SELECT_WINNER",
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return fail("Некорректный id теста", 400);
  const body = await request.json().catch(() => null) as { action?: string; variantId?: number; confirm?: string; explanation?: string } | null;
  const action = String(body?.action ?? "");
  if (!["start", "advance", "pause", "finish", "cancel", "winner"].includes(action)) return fail("Неизвестное действие", 400);
  if (confirmations[action] && body?.confirm !== confirmations[action]) return fail("Нужно явное подтверждение действия", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const { data: test, error } = await db.from("ctr_tests").select("id, cabinet_id, nm_id, status, test_type").eq("id", id).maybeSingle();
  if (error) return fail(missingMigration(error.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : error.message, missingMigration(error.code) ? 503 : 500);
  if (!test?.cabinet_id) return fail("Тест не найден", 404);
  const cabinetId = String(test.cabinet_id);
  const nmId = Number(test.nm_id);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  if (allowedNmIds !== null && !allowedNmIds.has(nmId)) return fail("SKU больше не входит в товарный контур кабинета", 403);

  let snapshot: CtrMetricSnapshot;
  try { snapshot = await getCtrMetricSnapshot(cabinetId, nmId); }
  catch (cause) { return fail(cause instanceof Error ? cause.message : "Не удалось снять метрики", 502); }

  let result: ReturnType<typeof ctrSnapshotDelta> | Record<string, never> = {};
  if (test.status === "running") {
    const { data: active, error: activeError } = await db.from("ctr_test_rounds").select("baseline").eq("test_id", id).eq("status", "active").maybeSingle();
    if (activeError) return fail(activeError.message, 500);
    if (!active) return fail("У работающего теста нет активного раунда", 409);
    result = ctrSnapshotDelta((active.baseline ?? {}) as Partial<CtrMetricSnapshot>, snapshot);
  }

  const session = await getServerSession();
  const { data, error: transitionError } = await db.rpc("transition_ctr_test", {
    p_input: {
      testId: id,
      action,
      variantId: body?.variantId ?? null,
      snapshot,
      result,
      explanation: String(body?.explanation ?? "").slice(0, 2_000),
    },
    p_actor: session?.email ?? null,
  });
  if (transitionError) return fail(missingMigration(transitionError.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : transitionError.message, missingMigration(transitionError.code) ? 503 : 409, { result });
  return NextResponse.json({ data: { test: data, result }, error: null });
}
