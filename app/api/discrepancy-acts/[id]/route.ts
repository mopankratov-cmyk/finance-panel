import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { DISCREPANCY_ACT_STATUSES, DISCREPANCY_RESOLUTIONS, type DiscrepancyActStatus, type DiscrepancyResolution } from "@/lib/purchases/discrepancyActs";
import { DISCREPANCY_ACT_SELECT, discrepancyActFromDb } from "@/lib/purchases/discrepancyActsDb";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ data: null, error: message }, { status });
}

function databaseError(error: { code?: string; message: string }) {
  if (["42P01", "42883", "PGRST200", "PGRST202", "PGRST205"].includes(error.code ?? "")) {
    return errorResponse("Акты расхождений ещё не развёрнуты: примените миграцию 202609140008_discrepancy_acts.sql", 503);
  }
  return errorResponse(error.message, error.code === "23505" ? 409 : 500);
}

/**
 * PATCH принимает частичный патч (только реально меняющиеся поля), а не
 * полный триплет resolution/status/note — иначе клиент со слегка устаревшим
 * снимком акта (вкладка не перечитала после чужого PATCH) при простом «сохранить
 * комментарий» переслал бы и старый status, и сервер трактовал бы это как
 * решение переоткрыть уже решённый акт, стирая resolved_by/resolved_at.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return errorResponse("Supabase не настроен", 500);

  const { id } = await context.params;
  const { data: existing, error: findError } = await db.from("discrepancy_acts").select(DISCREPANCY_ACT_SELECT).eq("id", id).maybeSingle();
  if (findError) return databaseError(findError);
  if (!existing) return errorResponse("Акт не найден", 404);

  const { data: order, error: orderError } = await db.from("purchase_orders").select("cabinet_id").eq("id", existing.purchase_order_id).maybeSingle();
  if (orderError) return errorResponse(orderError.message, 500);
  if (!order) return errorResponse("Заказ не найден", 404);
  if (!(await hasCabinetAccess(String(order.cabinet_id)))) return errorResponse("Нет доступа к кабинету", 403);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return errorResponse("Некорректное тело запроса", 400);

  const patch: { resolution?: DiscrepancyResolution; status?: DiscrepancyActStatus; note?: string } = {};
  if ("resolution" in body) {
    const resolution = typeof body.resolution === "string" ? body.resolution : "";
    if (!DISCREPANCY_RESOLUTIONS.includes(resolution as DiscrepancyResolution)) return errorResponse("Некорректное решение по расхождению", 400);
    patch.resolution = resolution as DiscrepancyResolution;
  }
  if ("status" in body) {
    const status = typeof body.status === "string" ? body.status : "";
    if (!DISCREPANCY_ACT_STATUSES.includes(status as DiscrepancyActStatus)) return errorResponse("Некорректный статус акта", 400);
    patch.status = status as DiscrepancyActStatus;
  }
  if ("note" in body) patch.note = typeof body.note === "string" ? body.note.trim().slice(0, 2_000) : "";
  if (Object.keys(patch).length === 0) return errorResponse("Нечего обновлять", 400);

  const currentStatus = existing.status as DiscrepancyActStatus;
  const nextStatus = patch.status ?? currentStatus;
  const becomesResolved = nextStatus === "resolved" && currentStatus !== "resolved";
  const becomesReopened = nextStatus === "open" && currentStatus === "resolved";

  const session = await getServerSession();
  // .eq("status", currentStatus) — оптимистическая блокировка: если статус
  // между чтением и записью успел смениться другим запросом, апдейт не
  // заденет ни одной строки вместо того, чтобы тихо перезаписать чужой
  // resolved_by/resolved_at.
  const { data: row, error } = await db
    .from("discrepancy_acts")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      ...(becomesResolved ? { resolved_by: session?.email ?? null, resolved_at: new Date().toISOString() } : {}),
      ...(becomesReopened ? { resolved_by: null, resolved_at: null } : {}),
    })
    .eq("id", id)
    .eq("status", currentStatus)
    .select(DISCREPANCY_ACT_SELECT)
    .maybeSingle();
  if (error) return databaseError(error);
  if (!row) return errorResponse("Акт изменили в другом месте — обновите страницу и повторите", 409);

  await db.from("operation_audit_log").insert({
    cabinet_id: order.cabinet_id,
    entity_type: "discrepancy_act",
    entity_id: id,
    action: "updated",
    actor: session?.email ?? null,
    before_data: existing,
    after_data: row,
  });

  return NextResponse.json({ data: { act: discrepancyActFromDb(row as Record<string, unknown>) }, error: null });
}
