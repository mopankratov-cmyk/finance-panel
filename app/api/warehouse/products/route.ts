import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import { PRODUCT_COLUMNS, toProductRow, type DbProduct, type ProductRow } from "@/lib/warehouse/productRow";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608230006_products.sql и 202608230007_stock_functions_products.sql";

const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};


export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entity");
  const query = (url.searchParams.get("q") ?? "").trim();

  const names = new Map(list.rows.map((row) => [row.id, row.name]));

  let rows: DbProduct[];
  try {
    rows = await loadAllSupabasePages<DbProduct>((from, to) => {
      let request = db.from("products_view").select(PRODUCT_COLUMNS).order("article").range(from, to);
      if (entityId) request = request.eq("legal_entity_id", entityId);
      if (query) request = request.or(`article.ilike.%${query}%,name.ilike.%${query}%,barcode.ilike.%${query}%`);
      return request;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить товары";
    return fail(message.includes("does not exist") ? `${message} · ${migrationHint}` : message, 500);
  }

  return NextResponse.json({ data: rows.map((row) => toProductRow(row, names)), error: null });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const article = String(body.article ?? "").trim();
  if (!article) return fail("Укажите артикул", 400);

  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);
  const entityId = body.legalEntityId ? String(body.legalEntityId) : null;
  if (entityId && !list.rows.some((row) => row.id === entityId)) return fail("Нет доступа к юрлицу", 403);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  const { data, error } = await db
    .from("products")
    .insert({
      legal_entity_id: entityId,
      article,
      name: String(body.name ?? "").trim() || article,
      barcode: String(body.barcode ?? "").trim() || null,
      category: String(body.category ?? "").trim() || null,
      brand: String(body.brand ?? "").trim() || null,
      nm_id: number(body.nmId),
      factory_price: number(body.factoryPrice),
      factory_currency: ["CNY", "RUB", "USD"].includes(String(body.factoryCurrency)) ? String(body.factoryCurrency) : "RUB",
      weight_kg: number(body.weightKg),
      length_cm: number(body.lengthCm),
      width_cm: number(body.widthCm),
      height_cm: number(body.heightCm),
      min_stock: number(body.minStock),
      season: body.season === "summer" || body.season === "winter" ? body.season : null,
      note: String(body.note ?? "").trim() || null,
      created_by: session?.email ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return fail("Товар с таким артикулом уже есть", 409);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }

  const created = await db.from("products_view").select(PRODUCT_COLUMNS).eq("id", data.id).single();
  const names = new Map(list.rows.map((row) => [row.id, row.name]));
  return NextResponse.json({ data: toProductRow(created.data as DbProduct, names), error: null }, { status: 201 });
}
