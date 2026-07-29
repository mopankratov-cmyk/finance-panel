import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";

const MISSING_MIGRATION_CODES = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);
const TAG_COLORS = new Set(["#7c3aed", "#2563eb", "#0891b2", "#059669", "#d97706", "#e11d48", "#64748b"]);
const JOURNAL_TYPES = new Set([
  "note",
  "price_up",
  "price_down",
  "discount_up",
  "discount_down",
  "promotion_in",
  "promotion_out",
  "ad_budget_up",
  "ad_budget_down",
  "ad_on",
  "ad_off",
  "ab_start",
  "ab_finish",
  "photo",
  "seo",
  "supply",
  "reviews",
]);

function migrationUnavailable(code?: string) {
  return MISSING_MIGRATION_CODES.has(code ?? "");
}

function migrationMessage() {
  return "Примените миграцию 20260726_wb_rnp_operations.sql";
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function normalizeNmIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(Number)
    .filter((nm) => Number.isSafeInteger(nm) && nm > 0))]
    .slice(0, 500);
}

async function scopedCabinet(shop: string) {
  const { cabinetId } = await resolveShopCabinet(shop);
  if (!cabinetId) {
    return { response: NextResponse.json({ error: "Для тегов и журнала выберите один WB-кабинет" }, { status: 400 }) };
  }
  if (!(await hasCabinetAccess(cabinetId))) {
    return { response: NextResponse.json({ error: "Нет доступа к выбранному WB-кабинету" }, { status: 403 }) };
  }
  return { cabinetId };
}

async function allowedProducts(cabinetId: string, nmIds: number[]) {
  const allowed = await requestAllowedNmIds(cabinetId);
  return allowed === null || nmIds.every((nm) => allowed.has(nm));
}

async function loadTagAssignments(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, cabinetId: string) {
  const pageSize = 1_000;
  const assignments: Array<{ nm_id: number; tag_id: string }> = [];
  for (let page = 0; page < 100; page++) {
    const from = page * pageSize;
    const result = await db.from("wb_rnp_sku_tags")
      .select("nm_id, tag_id")
      .eq("cabinet_id", cabinetId)
      .range(from, from + pageSize - 1);
    if (result.error) return { data: assignments, error: result.error };
    const rows = (result.data ?? []) as Array<{ nm_id: number; tag_id: string }>;
    assignments.push(...rows);
    if (rows.length < pageSize) return { data: assignments, error: null };
  }
  return {
    data: assignments,
    error: { code: "RNP_TAG_ASSIGNMENTS_LIMIT", message: "Превышен безопасный лимит 100 000 назначений тегов" },
  };
}

async function loadJournalEntries(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, cabinetId: string) {
  const pageSize = 1_000;
  const journal: Array<{
    id: string;
    nm_id: number;
    event_date: string;
    event_type: string;
    comment: string;
    created_by: string | null;
    created_at: string;
  }> = [];
  for (let page = 0; page < 100; page++) {
    const from = page * pageSize;
    const result = await db.from("wb_rnp_journal")
      .select("id, nm_id, event_date, event_type, comment, created_by, created_at")
      .eq("cabinet_id", cabinetId)
      .order("event_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (result.error) return { data: journal, error: result.error };
    const rows = (result.data ?? []) as typeof journal;
    journal.push(...rows);
    if (rows.length < pageSize) return { data: journal, error: null };
  }
  return {
    data: journal,
    error: { code: "RNP_JOURNAL_LIMIT", message: "Превышен безопасный лимит 100 000 записей журнала" },
  };
}

export async function GET(_request: NextRequest, context: { params: Promise<{ shop: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const { shop } = await context.params;
  const scoped = await scopedCabinet(shop);
  if ("response" in scoped) return scoped.response;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const [tagsResult, assignmentsResult, journalResult] = await Promise.all([
    db.from("wb_rnp_tags")
      .select("id, name, color, created_by, created_at")
      .eq("cabinet_id", scoped.cabinetId)
      .order("name", { ascending: true }),
    loadTagAssignments(db, scoped.cabinetId),
    loadJournalEntries(db, scoped.cabinetId),
  ]);

  const error = tagsResult.error ?? assignmentsResult.error ?? journalResult.error;
  if (error) {
    if (migrationUnavailable(error.code)) {
      return NextResponse.json({ available: false, tags: [], assignments: [], journal: [], message: migrationMessage() });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    available: true,
    tags: tagsResult.data ?? [],
    assignments: assignmentsResult.data ?? [],
    journal: journalResult.data ?? [],
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ shop: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const { shop } = await context.params;
  const scoped = await scopedCabinet(shop);
  if ("response" in scoped) return scoped.response;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const session = await getServerSession();
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "");

  if (action === "create_tag") {
    const name = String(body.name ?? "").normalize("NFKC").trim().slice(0, 40);
    const color = TAG_COLORS.has(String(body.color)) ? String(body.color) : "#7c3aed";
    if (!name) return NextResponse.json({ error: "Введите название тега" }, { status: 422 });
    const { data, error } = await db.from("wb_rnp_tags")
      .insert({ cabinet_id: scoped.cabinetId, name, color, created_by: session?.email ?? null })
      .select("id, name, color, created_by, created_at")
      .single();
    if (error) {
      if (migrationUnavailable(error.code)) return NextResponse.json({ error: migrationMessage() }, { status: 503 });
      if (error.code === "23505") return NextResponse.json({ error: "Такой тег уже есть" }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, tag: data });
  }

  if (action === "set_tag") {
    const nmIds = normalizeNmIds(body.nmIds);
    const tagId = String(body.tagId ?? "");
    const assigned = body.assigned !== false;
    if (!nmIds.length || !tagId) return NextResponse.json({ error: "Выберите товары и тег" }, { status: 422 });
    if (!(await allowedProducts(scoped.cabinetId, nmIds))) {
      return NextResponse.json({ error: "Один из товаров вне контура выбранного кабинета" }, { status: 403 });
    }
    const { data: tag, error: tagError } = await db.from("wb_rnp_tags")
      .select("id")
      .eq("id", tagId)
      .eq("cabinet_id", scoped.cabinetId)
      .maybeSingle();
    if (tagError) {
      if (migrationUnavailable(tagError.code)) return NextResponse.json({ error: migrationMessage() }, { status: 503 });
      return NextResponse.json({ error: tagError.message }, { status: 500 });
    }
    if (!tag) return NextResponse.json({ error: "Тег не найден" }, { status: 404 });
    const result = assigned
      ? await db.from("wb_rnp_sku_tags").upsert(
        nmIds.map((nm) => ({
          cabinet_id: scoped.cabinetId,
          nm_id: nm,
          tag_id: tagId,
          assigned_by: session?.email ?? null,
        })),
        { onConflict: "cabinet_id,nm_id,tag_id" },
      )
      : await db.from("wb_rnp_sku_tags")
        .delete()
        .eq("cabinet_id", scoped.cabinetId)
        .eq("tag_id", tagId)
        .in("nm_id", nmIds);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "add_journal") {
    const nmId = Number(body.nmId);
    const eventType = String(body.eventType ?? "note");
    const eventDate = validDate(body.eventDate);
    const comment = String(body.comment ?? "").normalize("NFKC").trim().slice(0, 2000);
    if (!Number.isSafeInteger(nmId) || nmId <= 0 || !eventDate || !JOURNAL_TYPES.has(eventType)) {
      return NextResponse.json({ error: "Проверьте товар, дату и тип события" }, { status: 422 });
    }
    if (!(await allowedProducts(scoped.cabinetId, [nmId]))) {
      return NextResponse.json({ error: "Товар вне контура выбранного кабинета" }, { status: 403 });
    }
    const { data, error } = await db.from("wb_rnp_journal")
      .insert({
        cabinet_id: scoped.cabinetId,
        nm_id: nmId,
        event_date: eventDate,
        event_type: eventType,
        comment,
        created_by: session?.email ?? null,
      })
      .select("id, nm_id, event_date, event_type, comment, created_by, created_at")
      .single();
    if (error) {
      if (migrationUnavailable(error.code)) return NextResponse.json({ error: migrationMessage() }, { status: 503 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, entry: data });
  }

  return NextResponse.json({ error: "Неизвестная операция РНП" }, { status: 400 });
}
