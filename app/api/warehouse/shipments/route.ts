import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";

export interface ShipmentLineInput {
  nmId: number;
  article: string;
  cabinetId: string;
  qty: number;
}

export interface ShipmentResult {
  shipmentId: string;
  lines: number;
  qty: number;
  amount: number;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграцию 202608230005_shipments.sql";

/** Отгрузка со склада на кабинеты: одна операция, строка на пару «SKU + кабинет». */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; warehouseId?: string; note?: string; lines?: ShipmentLineInput[] }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);
  if (!body.warehouseId) return fail("Выберите склад, с которого отгружаем", 400);

  const lines = (body.lines ?? []).filter((line) => Number(line.qty) > 0);
  if (lines.length === 0) return fail("Укажите хотя бы одну позицию с количеством", 400);

  // Кабинет отгрузки должен быть связан с юрлицом: свой или агентский. Иначе товар
  // ушёл бы туда, где юрлицо не торгует, и это почти наверняка опечатка в выборе.
  const allowedCabinets = new Set(scope.entity.cabinets.map((link) => link.cabinetId));
  for (const line of lines) {
    if (!line.cabinetId) return fail("У каждой строки должен быть кабинет", 400);
    if (!allowedCabinets.has(line.cabinetId)) {
      return fail(`Кабинет не связан с юрлицом «${scope.entity.name}»`, 400);
    }
    if (!Number.isFinite(line.nmId) || line.nmId <= 0) return fail("Некорректный nmID в строке", 400);
  }

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  const { data, error } = await db.rpc("post_shipment", {
    p_legal_entity_id: scope.entity.id,
    p_warehouse_id: body.warehouseId,
    p_lines: lines.map((line) => ({
      nmId: line.nmId,
      article: line.article ?? "",
      cabinetId: line.cabinetId,
      qty: Math.round(line.qty),
    })),
    p_note: body.note?.trim() || null,
    p_actor: session?.email ?? null,
  });

  if (error) {
    const shortage = error.message.match(/not enough stock for nm (\d+) : have (-?\d+), need (\d+)/);
    if (shortage) {
      return fail(`На складе не хватает ${shortage[1]}: есть ${shortage[2]}, нужно ${shortage[3]}`, 409);
    }
    if (error.message.includes("warehouse not found")) return fail("Склад не найден", 404);
    if (error.message.includes("warehouse is archived")) return fail("Склад в архиве", 400);
    if (error.message.includes("shipment has no lines")) return fail("Укажите хотя бы одну позицию", 400);
    if (error.message.includes("quantity must be positive")) return fail("Количество должно быть больше нуля", 400);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }

  return NextResponse.json({ data: data as ShipmentResult, error: null }, { status: 201 });
}
