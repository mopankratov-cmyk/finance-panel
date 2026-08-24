import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import { parseWarehouseKind, type WarehouseKind } from "@/lib/warehouse/warehouseKind";

export const dynamic = "force-dynamic";

export interface WarehouseRow {
  id: string;
  name: string;
  kind: WarehouseKind;
  isActive: boolean;
  position: number;
  note: string | null;
  /** С какой даты продажи FBS списывают этот склад у выбранного юрлица.
   *  null — списание выключено: пока остатку склада нельзя верить, вычитание
   *  продаж увело бы его в минус на всю историю торговли. */
  fbsSalesSince: string | null;
  fbsSyncedAt: string | null;
}

interface DbRow {
  id: string;
  name: string;
  kind: WarehouseKind;
  is_active: boolean;
  position: number;
  note: string | null;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608230003_stock_ledger.sql и 202608230004_legal_entities.sql";

const toRow = (r: DbRow, settings?: Map<string, { since: string | null; syncedAt: string | null }>): WarehouseRow => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  isActive: r.is_active,
  position: r.position,
  note: r.note,
  fbsSalesSince: settings?.get(String(r.id))?.since ?? null,
  fbsSyncedAt: settings?.get(String(r.id))?.syncedAt ?? null,
});

// Склад — общее место хранения, а не собственность юрлица: на одном фулфилменте
// лежит товар нескольких ИП. Поэтому список складов не фильтруется по юрлицу.
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);
  if (list.rows.length === 0) return fail("Нет доступных юрлиц", 403);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const { data, error } = await db
    .from("warehouses")
    .select("id, name, kind, is_active, position, note")
    .order("position", { ascending: true })
    .order("name", { ascending: true });

  if (error) return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);

  // Настройки пары «юрлицо + склад» — своя дата доверия у каждого юрлица на
  // общем складе. Без выбранного юрлица настроек нет, и это не ошибка.
  const entityId = new URL(request.url).searchParams.get("entity");
  const settings = new Map<string, { since: string | null; syncedAt: string | null }>();
  if (entityId && list.rows.some((row) => row.id === entityId)) {
    const result = await db
      .from("legal_entity_warehouses")
      .select("warehouse_id, fbs_sales_since, fbs_synced_at")
      .eq("legal_entity_id", entityId);
    for (const row of result.data ?? []) {
      settings.set(String(row.warehouse_id), {
        since: row.fbs_sales_since ? String(row.fbs_sales_since) : null,
        syncedAt: row.fbs_synced_at ? String(row.fbs_synced_at) : null,
      });
    }
  }

  return NextResponse.json({ data: (data ?? []).map((r) => toRow(r as DbRow, settings)), error: null });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { name?: string; kind?: string; note?: string }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);
  if (list.rows.length === 0) return fail("Нет доступных юрлиц", 403);

  const name = String(body.name ?? "").trim();
  if (!name) return fail("Укажите название склада", 400);
  const kind = parseWarehouseKind(body.kind);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  const { data, error } = await db
    .from("warehouses")
    .insert({
      name,
      kind,
      note: body.note?.trim() || null,
      created_by: session?.email ?? null,
    })
    .select("id, name, kind, is_active, position, note")
    .single();

  if (error) {
    if (error.code === "23505") return fail("Склад с таким названием уже есть", 409);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }
  return NextResponse.json({ data: toRow(data as DbRow), error: null }, { status: 201 });
}
