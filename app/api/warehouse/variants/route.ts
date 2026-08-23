import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";

export interface VariantRow {
  id: string;
  productId: string;
  sizeLabel: string;
  barcode: string | null;
  chrtId: number | null;
  isDefault: boolean;
  isActive: boolean;
  position: number;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608230014 и 202608230015";

const toRow = (row: Record<string, unknown>): VariantRow => ({
  id: String(row.id),
  productId: String(row.product_id),
  sizeLabel: String(row.size_label ?? ""),
  barcode: (row.barcode as string | null) ?? null,
  chrtId: row.chrt_id === null || row.chrt_id === undefined ? null : Number(row.chrt_id),
  isDefault: Boolean(row.is_default),
  isActive: Boolean(row.is_active),
  position: Number(row.position ?? 0),
});

const COLUMNS = "id, product_id, size_label, barcode, chrt_id, is_default, is_active, position";

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const productId = new URL(request.url).searchParams.get("product");
  if (!productId) return fail("Не указан товар", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const { data, error } = await db
    .from("product_variants")
    .select(COLUMNS)
    .eq("product_id", productId)
    .order("is_default", { ascending: false })
    .order("position")
    .order("size_label");
  if (error) return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);

  return NextResponse.json({ data: (data ?? []).map((row) => toRow(row as Record<string, unknown>)), error: null });
}

/** Добавить размер. Первый размер у модели превращает её из безразмерной
 *  в размерную: базовый вариант остаётся ради истории, но уходит из выбора. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { productId?: string; sizeLabel?: string; barcode?: string; chrtId?: number }
    | null;
  if (!body?.productId) return fail("Не указан товар", 400);

  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const sizeLabel = String(body.sizeLabel ?? "").trim();
  if (!sizeLabel) return fail("Укажите размер", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const { data, error } = await db
    .from("product_variants")
    .insert({
      product_id: body.productId,
      size_label: sizeLabel,
      barcode: String(body.barcode ?? "").trim() || null,
      chrt_id: Number.isFinite(body.chrtId) ? body.chrtId : null,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") return fail("Такой размер или баркод уже заведён", 409);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }
  return NextResponse.json({ data: toRow(data as Record<string, unknown>), error: null }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { id?: string; sizeLabel?: string; barcode?: string; chrtId?: number | null; isActive?: boolean }
    | null;
  if (!body?.id) return fail("Не указан размер", 400);

  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("sizeLabel" in body) {
    const sizeLabel = String(body.sizeLabel ?? "").trim();
    if (!sizeLabel) return fail("Размер не может быть пустым", 400);
    patch.size_label = sizeLabel;
  }
  if ("barcode" in body) patch.barcode = String(body.barcode ?? "").trim() || null;
  if ("chrtId" in body) patch.chrt_id = Number.isFinite(body.chrtId) ? body.chrtId : null;
  if ("isActive" in body) patch.is_active = Boolean(body.isActive);

  const { data, error } = await db.from("product_variants").update(patch).eq("id", body.id).select(COLUMNS).maybeSingle();
  if (error) {
    if (error.code === "23505") return fail("Такой размер или баркод уже заведён", 409);
    return fail(error.message, 500);
  }
  if (!data) return fail("Размер не найден", 404);
  return NextResponse.json({ data: toRow(data as Record<string, unknown>), error: null });
}
