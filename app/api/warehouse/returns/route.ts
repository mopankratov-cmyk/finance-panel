import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { BUSY_MESSAGE, claimDocKey, releaseDocKey, settleDocKey } from "@/lib/warehouse/idempotency";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграцию 202608230016_transfers_returns.sql";

/** Возврат с маркетплейса: то, что приехало с ПВЗ обратно на склад. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; docKey?: string; warehouseId?: string; cabinetId?: string; note?: string;
        lines?: { variantId: string; qty: number; defectQty?: number }[] }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  if (!body.warehouseId) return fail("Выберите склад, куда приехал возврат", 400);

  // Кабинет возврата обязателен: без него неизвестно, откуда товар вернулся,
  // и сверка с возвратами маркетплейса становится невозможной.
  const allowed = new Set(scope.entity.cabinets.map((link) => link.cabinetId));
  if (!body.cabinetId) return fail("Укажите кабинет, из которого вернулся товар", 400);
  if (!allowed.has(body.cabinetId)) return fail(`Кабинет не связан с юрлицом «${scope.entity.name}»`, 400);

  const lines = (body.lines ?? []).filter((line) => line.variantId && Number(line.qty) > 0);
  if (lines.length === 0) return fail("Добавьте хотя бы одну позицию", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  // Ключ идемпотентности: второй клик по кнопке не должен давать второй документ.
  const docKey = typeof body.docKey === "string" ? body.docKey.trim() || null : null;
  const claim = await claimDocKey(db, docKey, "return", scope.entity.id, session?.email ?? null);
  if (claim.state === "done") return NextResponse.json({ data: claim.result, error: null }, { status: 200 });
  if (claim.state === "busy") return fail(BUSY_MESSAGE, 409);

  const { data, error } = await db.rpc("post_return", {
    p_legal_entity_id: scope.entity.id,
    p_warehouse_id: body.warehouseId,
    p_cabinet_id: body.cabinetId,
    p_lines: lines.map((line) => ({
      variantId: line.variantId,
      qty: Math.round(line.qty),
      defectQty: Math.max(0, Math.round(line.defectQty ?? 0)),
    })),
    p_note: body.note?.trim() || null,
    p_actor: session?.email ?? null,
  });

  if (error) await releaseDocKey(db, docKey);
  if (error) {
    if (error.message.includes("defect exceeds returned")) return fail("Брака больше, чем вернулось", 400);
    if (error.message.includes("warehouse not found")) return fail("Склад не найден", 404);
    if (error.message.includes("warehouse is archived")) return fail("Склад в архиве", 400);
    if (error.message.includes("variant not found")) return fail("Размер не найден", 404);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }

  await settleDocKey(db, docKey, data);
  return NextResponse.json({ data, error: null }, { status: 201 });
}
