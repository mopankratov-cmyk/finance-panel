import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";

export interface WarehouseRow {
  id: string;
  name: string;
  kind: "own" | "fulfillment";
  isActive: boolean;
  position: number;
  note: string | null;
}

interface DbRow {
  id: string;
  name: string;
  kind: "own" | "fulfillment";
  is_active: boolean;
  position: number;
  note: string | null;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608230003_stock_ledger.sql и 202608230004_legal_entities.sql";

const toRow = (r: DbRow): WarehouseRow => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  isActive: r.is_active,
  position: r.position,
  note: r.note,
});

// Склад — общее место хранения, а не собственность юрлица: на одном фулфилменте
// лежит товар нескольких ИП. Поэтому список складов не фильтруется по юрлицу.
export async function GET(_request: NextRequest) {
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
  return NextResponse.json({ data: (data ?? []).map((r) => toRow(r as DbRow)), error: null });
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
  const kind = body.kind === "fulfillment" ? "fulfillment" : "own";

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
