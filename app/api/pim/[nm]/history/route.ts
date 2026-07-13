import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");

function snapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return {
    readinessStatus: String(row.status ?? "pending"),
    comment: String(row.comment ?? ""),
    driveUrl: row.drive_url ? String(row.drive_url) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ nm: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const cabinetId = cabinetIdFromParam(new URL(request.url).searchParams.get("cabinet"));
  const nmId = Number((await context.params).nm);
  if (!cabinetId || !Number.isSafeInteger(nmId) || nmId <= 0) return fail("Выберите один кабинет и товар", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  if (allowedNmIds !== null && !allowedNmIds.has(nmId)) return fail("Товар не найден", 404);
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const { data: note, error: noteError } = await db.from("wb_product_notes").select("id").eq("cabinet_id", cabinetId).eq("nm_id", nmId).maybeSingle();
  if (noteError) return fail(missingMigration(noteError.code) ? "Примените миграцию 20260713_wb_product_notes.sql" : noteError.message, missingMigration(noteError.code) ? 503 : 500);
  if (!note) return NextResponse.json({ data: { history: [] }, error: null });
  const { data, error } = await db.from("operation_audit_log").select("id, action, actor, before_data, after_data, created_at").eq("entity_type", "wb_product_note").eq("entity_id", note.id).order("created_at", { ascending: false }).limit(50);
  if (error) return fail(error.message, 500);
  return NextResponse.json({ data: { history: (data ?? []).map((entry) => ({
    id: entry.id,
    action: String(entry.action),
    actor: entry.actor ? String(entry.actor) : null,
    before: snapshot(entry.before_data),
    after: snapshot(entry.after_data),
    createdAt: String(entry.created_at),
  })) }, error: null });
}
