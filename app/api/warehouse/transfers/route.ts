import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграцию 202608230016_transfers_returns.sql";

/** Перемещение между складами: Уссурийск → «В пути» → Москва. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; fromWarehouseId?: string; toWarehouseId?: string; note?: string;
        lines?: { variantId: string; qty: number }[] }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  if (!body.fromWarehouseId || !body.toWarehouseId) return fail("Выберите склады отправления и назначения", 400);
  if (body.fromWarehouseId === body.toWarehouseId) return fail("Склады совпадают — перемещать некуда", 400);

  const lines = (body.lines ?? []).filter((line) => line.variantId && Number(line.qty) > 0);
  if (lines.length === 0) return fail("Добавьте хотя бы одну позицию", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  const { data, error } = await db.rpc("post_transfer", {
    p_legal_entity_id: scope.entity.id,
    p_from_warehouse: body.fromWarehouseId,
    p_to_warehouse: body.toWarehouseId,
    p_lines: lines.map((line) => ({ variantId: line.variantId, qty: Math.round(line.qty) })),
    p_note: body.note?.trim() || null,
    p_actor: session?.email ?? null,
  });

  if (error) {
    const shortage = error.message.match(/not enough stock for (.+?) : have (-?\d+), need (\d+)/);
    if (shortage) return fail(`На складе не хватает «${shortage[1]}»: есть ${shortage[2]}, нужно ${shortage[3]}`, 409);
    if (error.message.includes("same warehouse")) return fail("Склады совпадают", 400);
    if (error.message.includes("source warehouse not found")) return fail("Склад отправления не найден", 404);
    if (error.message.includes("target warehouse not found")) return fail("Склад назначения не найден", 404);
    if (error.message.includes("target warehouse is archived")) return fail("Склад назначения в архиве", 400);
    if (error.message.includes("variant not found")) return fail("Размер не найден", 404);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }

  return NextResponse.json({ data, error: null }, { status: 201 });
}
