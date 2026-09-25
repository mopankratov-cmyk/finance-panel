import { NextRequest, NextResponse } from "next/server";
import { readCompaniesCompat } from "@/lib/finance/companySchema";
import { buildOpiuCompanyScopes } from "@/lib/opiu/companyScope";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  downloadWbDocument,
  isTaxDocumentCategory,
  listWbDocuments,
  parseWbTaxDocumentFile,
  stableTaxDocumentId,
  type WbDocumentListItem,
} from "@/lib/wb/taxDocuments";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB = "wb_tax_documents";
const PAGE_SIZE = 50;
const MAX_DOWNLOADS_PER_CABINET = 5;

interface CursorState extends Record<string, unknown> {
  month: string;
  offset: number;
  backfillComplete: boolean;
}

type Cabinet = { id: string; name: string; inn: string | null; token: string };
type SourceRow = { external_id: string; status: string };

function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit" }).format(new Date());
}

function previousMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthRange(month: string): { from: string; to: string } {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { from: `${month}-01`, to: month === today.slice(0, 7) ? today : `${month}-${String(last).padStart(2, "0")}` };
}

function cursorState(value: Partial<CursorState> | undefined): CursorState {
  const now = currentMonth();
  const validMonth = /^\d{4}-\d{2}$/.test(String(value?.month ?? "")) ? String(value!.month) : now;
  return {
    month: validMonth,
    offset: Math.max(0, Number(value?.offset) || 0),
    backfillComplete: Boolean(value?.backfillComplete),
  };
}

function nextCursor(state: CursorState, rowCount: number): CursorState {
  if (rowCount >= PAGE_SIZE) return { ...state, offset: state.offset + PAGE_SIZE };
  if (state.backfillComplete) return { month: currentMonth(), offset: 0, backfillComplete: true };
  const previous = previousMonth(state.month);
  if (previous < `${currentMonth().slice(0, 4)}-01`) return { month: currentMonth(), offset: 0, backfillComplete: true };
  return { month: previous, offset: 0, backfillComplete: false };
}

async function companyByCabinet() {
  const db = getSupabaseAdmin()!;
  const [loaded, entities, links] = await Promise.all([
    readCompaniesCompat((columns) => db.from("companies").select(columns).order("name")),
    db.from("legal_entities").select("id,name"),
    db.from("legal_entity_cabinets").select("legal_entity_id,cabinet_id"),
  ]);
  const error = loaded.result.error ?? entities.error ?? links.error;
  if (error) throw new Error(error.message);
  const scopes = buildOpiuCompanyScopes((loaded.result.data ?? []).map((raw) => {
    const row = raw as unknown as Record<string, unknown>;
    return { id: String(row.id), name: String(row.name), groupName: String(row.group_name ?? ""), isActive: Boolean(row.is_active) };
  }), (entities.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name) })), (links.data ?? []).map((row) => ({
    legalEntityId: String(row.legal_entity_id), cabinetId: String(row.cabinet_id),
  })));
  return new Map(scopes.flatMap((scope) => scope.cabinetIds.map((cabinetId) => [cabinetId, scope.id] as const)));
}

function normalizeItem(item: WbDocumentListItem): WbDocumentListItem | null {
  const serviceName = String(item.serviceName ?? "").trim();
  if (!serviceName) return null;
  return {
    serviceName,
    name: String(item.name ?? ""),
    category: String(item.category ?? ""),
    extensions: Array.isArray(item.extensions) ? item.extensions.map(String) : [],
    creationTime: String(item.creationTime ?? ""),
  };
}

async function updateSource(id: string, values: Record<string, unknown>) {
  const db = getSupabaseAdmin()!;
  const result = await db.from("marketplace_tax_document_sources").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id);
  if (result.error) throw new Error(result.error.message);
}

async function syncCabinet(cabinet: Cabinet, companyId: string | undefined) {
  const db = getSupabaseAdmin()!;
  const claimed = await claimWbSyncJob(db, cabinet.id, JOB, 600);
  if (!claimed) return { cabinet: cabinet.name, status: "busy", discovered: 0, imported: 0, review: 0, skipped: 0, errors: 0 };
  const previous = await readWbSyncState<CursorState>(db, cabinet.id, JOB);
  const state = cursorState(previous?.state);
  const range = monthRange(state.month);

  try {
    const listed = (await listWbDocuments(cabinet.token, range.from, range.to, state.offset)).map(normalizeItem).filter((item): item is WbDocumentListItem => Boolean(item));
    const sourceRows = listed.map((item) => ({
      id: stableTaxDocumentId(cabinet.id, item.serviceName, "source"),
      cabinet_id: cabinet.id,
      company_id: companyId ?? null,
      marketplace: "wb",
      external_id: item.serviceName,
      category_code: item.name,
      category_title: item.category,
      extension: item.extensions.includes("zip") ? "zip" : item.extensions.includes("xml") ? "xml" : item.extensions[0] ?? "",
      source_created_at: item.creationTime || null,
      status: "discovered",
    }));
    if (sourceRows.length) {
      const inserted = await db.from("marketplace_tax_document_sources").upsert(sourceRows, { onConflict: "cabinet_id,external_id", ignoreDuplicates: true });
      if (inserted.error) throw new Error(inserted.error.message);
    }

    const externalIds = listed.map((item) => item.serviceName);
    const existing = externalIds.length
      ? await db.from("marketplace_tax_document_sources").select("external_id,status").eq("cabinet_id", cabinet.id).in("external_id", externalIds)
      : { data: [] as SourceRow[], error: null };
    if (existing.error) throw new Error(existing.error.message);
    const statusByExternal = new Map((existing.data ?? []).map((row) => [String(row.external_id), String(row.status)]));
    const pending = listed.filter(isTaxDocumentCategory).filter((item) => !["imported", "skipped", "needs_review"].includes(statusByExternal.get(item.serviceName) ?? ""));
    let imported = 0; let review = 0; let skipped = 0; let errors = 0;

    for (const item of pending.slice(0, MAX_DOWNLOADS_PER_CABINET)) {
      const sourceId = stableTaxDocumentId(cabinet.id, item.serviceName, "source");
      const extension = item.extensions.includes("zip") ? "zip" : item.extensions.includes("xml") ? "xml" : "";
      if (!companyId) {
        skipped++;
        await updateSource(sourceId, { status: "skipped", last_error: "Кабинет не привязан к налогоплательщику панели", last_attempt_at: new Date().toISOString() });
        continue;
      }
      if (!extension) {
        review++;
        await updateSource(sourceId, { status: "needs_review", last_error: "WB не предоставил XML/ZIP для автоматического разбора", last_attempt_at: new Date().toISOString() });
        continue;
      }
      try {
        const file = await downloadWbDocument(cabinet.token, item.serviceName, extension);
        const parsed = parseWbTaxDocumentFile(file, extension, cabinet.inn);
        if (!parsed) {
          review++;
          await updateSource(sourceId, { status: "needs_review", last_error: "Не найден входящий формализованный УПД с совпадающим ИНН покупателя", last_attempt_at: new Date().toISOString() });
          continue;
        }
        if (parsed.vatAmount <= 0) {
          skipped++;
          await updateSource(sourceId, { status: "skipped", document_date: parsed.documentDate, document_number: parsed.documentNumber, gross_amount: parsed.grossAmount, vat_amount: parsed.vatAmount, seller_inn: parsed.sellerInn, buyer_inn: parsed.buyerInn, last_error: "В документе нет входящего НДС", last_attempt_at: new Date().toISOString() });
          continue;
        }
        const taxDocumentId = stableTaxDocumentId(cabinet.id, item.serviceName);
        const saved = await db.from("marketplace_tax_documents").upsert({
          id: taxDocumentId,
          company_id: companyId,
          marketplace: "wb",
          document_date: parsed.documentDate,
          document_number: parsed.documentNumber,
          gross_expense_amount: parsed.grossAmount,
          vat_rate: parsed.vatRate,
          vat_amount: parsed.vatAmount,
          vat_document_status: "received",
          vat_deduction_status: "pending",
          usn_expense_status: "pending",
          note: `Получено автоматически из WB · ${item.category} · ${item.serviceName}. Вычет подтверждает бухгалтер.`,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id", ignoreDuplicates: true });
        if (saved.error) throw new Error(saved.error.message);
        await updateSource(sourceId, {
          status: "imported", document_date: parsed.documentDate, document_number: parsed.documentNumber,
          gross_amount: parsed.grossAmount, vat_rate: parsed.vatRate, vat_amount: parsed.vatAmount,
          seller_inn: parsed.sellerInn, buyer_inn: parsed.buyerInn, tax_document_id: taxDocumentId,
          last_error: null, last_attempt_at: new Date().toISOString(),
        });
        imported++;
      } catch (cause) {
        errors++;
        await updateSource(sourceId, { status: "error", last_error: (cause instanceof Error ? cause.message : String(cause)).slice(0, 1_000), last_attempt_at: new Date().toISOString() });
      }
    }

    const next = nextCursor(state, listed.length);
    await writeWbSyncState(db, cabinet.id, JOB, {
      cursor: `${state.month}:${state.offset}`,
      status: errors ? "partial" : "ok",
      attempts: errors ? (previous?.attempts ?? 0) + 1 : 0,
      lastError: errors ? `${errors} документов не обработано` : null,
      state: next,
    });
    return { cabinet: cabinet.name, status: errors ? "partial" : "ok", month: state.month, offset: state.offset, discovered: listed.length, imported, review, skipped, errors };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await writeWbSyncState(db, cabinet.id, JOB, { cursor: previous?.cursor ?? null, status: "error", attempts: (previous?.attempts ?? 0) + 1, lastError: message.slice(0, 1_000), state });
    return { cabinet: cabinet.name, status: "error", month: state.month, offset: state.offset, discovered: 0, imported: 0, review: 0, skipped: 0, errors: 1, error: message };
  }
}

export async function GET(request: NextRequest) {
  const gate = await checkCronAuth(request);
  if (gate) return gate;
  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const tableCheck = await db.from("marketplace_tax_document_sources").select("id").limit(1);
  if (tableCheck.error) return NextResponse.json({ error: "Примените миграцию 202609250002_wb_tax_document_sync.sql" }, { status: 409 });
  const { data, error } = await db.from("wb_cabinets").select("id,name,inn,token").eq("marketplace", "wb").eq("is_active", true).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  const companies = await companyByCabinet();
  const results = await Promise.all(((data ?? []) as Cabinet[]).map((cabinet) => syncCabinet(cabinet, companies.get(cabinet.id))));
  const totals = results.reduce((sum, result) => ({
    discovered: sum.discovered + result.discovered, imported: sum.imported + result.imported,
    review: sum.review + result.review, skipped: sum.skipped + result.skipped, errors: sum.errors + result.errors,
  }), { discovered: 0, imported: 0, review: 0, skipped: 0, errors: 0 });
  await writeSyncLog(JOB, totals.errors ? "partial" : "ok", totals.imported, totals.errors ? `${totals.errors} ошибок` : null, startedAt);
  return NextResponse.json({ ok: totals.errors === 0, totals, cabinets: results });
}
