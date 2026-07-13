import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { fetchCabinetPimRows } from "@/lib/wb/cards";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeProductNote, productReadiness } from "@/lib/wb/productReadiness";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");

export async function GET(req: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const p_cabinet = cabinetIdFromParam(new URL(req.url).searchParams.get("cabinet"));
  if (!(await hasCabinetAccess(p_cabinet))) {
    return NextResponse.json({ ok: false, error: "Нет доступа к кабинету" }, { status: 403 });
  }
  try {
    const rows = await fetchCabinetPimRows(p_cabinet);
    const db = getSupabaseAdmin();
    let notesReady = Boolean(db);
    const cabinetIds = [...new Set(rows.map((row) => row.cabinetId).filter((id): id is string => Boolean(id)))];
    const notes = new Map<string, Record<string, unknown>>();
    if (db && cabinetIds.length) {
      const { data, error } = await db.from("wb_product_notes").select("cabinet_id, nm_id, status, comment, drive_url, updated_by, updated_at").in("cabinet_id", cabinetIds).limit(10_000);
      if (error && missingMigration(error.code)) notesReady = false;
      else if (error) throw new Error(error.message);
      else for (const note of data ?? []) notes.set(`${note.cabinet_id}:${note.nm_id}`, note as Record<string, unknown>);
    }
    const enriched = rows.map((row) => {
      const note = notes.get(`${row.cabinetId}:${row.nmId}`);
      return {
        ...row,
        readinessStatus: String(note?.status ?? "pending"),
        comment: String(note?.comment ?? ""),
        driveUrl: note?.drive_url ? String(note.drive_url) : null,
        noteUpdatedBy: note?.updated_by ? String(note.updated_by) : null,
        noteUpdatedAt: note?.updated_at ? String(note.updated_at) : null,
      };
    });
    return NextResponse.json({ ok: true, rows: enriched, count: enriched.length, notesReady });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = await req.json().catch(() => null) as { cabinetId?: string; nmId?: unknown; article?: unknown; status?: unknown; comment?: unknown; driveUrl?: unknown } | null;
  const cabinetId = cabinetIdFromParam(body?.cabinetId);
  const nmId = Number(body?.nmId);
  if (!cabinetId || !Number.isSafeInteger(nmId) || nmId <= 0) return NextResponse.json({ ok: false, error: "Выберите один кабинет и товар" }, { status: 400 });
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ ok: false, error: "Нет доступа к кабинету" }, { status: 403 });
  const normalized = normalizeProductNote(body ?? {});
  if (!normalized.ok) return NextResponse.json({ ok: false, error: normalized.error }, { status: 422 });

  // Для scoped-кабинета (включая Optima) проверяем allowlist до Content API.
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  if (allowedNmIds !== null && !allowedNmIds.has(nmId)) return NextResponse.json({ ok: false, error: "Товар вне контура выбранного кабинета" }, { status: 403 });
  let card;
  try {
    card = (await fetchCabinetPimRows(cabinetId)).find((row) => row.nmId === nmId);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не удалось проверить карточку WB" }, { status: 502 });
  }
  if (!card) return NextResponse.json({ ok: false, error: "Товар не найден в выбранном WB-кабинете" }, { status: 404 });
  const readiness = productReadiness(card);
  if (normalized.value.status === "ready" && readiness.score !== 100) return NextResponse.json({ ok: false, error: `Нельзя отметить готовым: ${readiness.missing.join(", ")}`, missing: readiness.missing }, { status: 422 });

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
  const session = await getServerSession();
  const { data, error } = await db.rpc("save_wb_product_note", { p_note: {
    cabinetId,
    nmId,
    article: String(body?.article ?? card.article).normalize("NFKC").trim().slice(0, 255),
    brand: card.brand,
    status: normalized.value.status,
    comment: normalized.value.comment,
    driveUrl: normalized.value.driveUrl,
  }, p_actor: session?.email ?? null });
  if (error) {
    const forbidden = /outside cabinet scope/i.test(error.message);
    return NextResponse.json(
      { ok: false, error: missingMigration(error.code) ? "Примените миграцию 20260713_wb_product_notes.sql" : forbidden ? "Товар вне контура выбранного кабинета" : error.message },
      { status: missingMigration(error.code) ? 503 : forbidden ? 403 : 500 },
    );
  }
  const note = data as Record<string, unknown>;
  return NextResponse.json({ ok: true, note: {
    readinessStatus: String(note.status ?? "pending"),
    comment: String(note.comment ?? ""),
    driveUrl: note.drive_url ? String(note.drive_url) : null,
    noteUpdatedBy: note.updated_by ? String(note.updated_by) : null,
    noteUpdatedAt: note.updated_at ? String(note.updated_at) : null,
  }, readiness });
}
