import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { xlsxGrid } from "@/lib/finance/xlsxGrid";
import { extractPdfText } from "@/lib/loans/pdfText";
import { recognizeLoanPdfSchedule, recognizeLoanSpreadsheet, type RecognizedScheduleRow } from "@/components/loans/loanRecognition";
import { derivedPaymentForRow, scheduleRowFromDb, type ScheduleRowKind, type ScheduleRowRecord } from "@/lib/loans/scheduleRows";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BUCKET = "finance-loan-documents";
// Только те виды, что есть в распознанной строке графика (RecognizedScheduleRow); «fee» в ней нет. Узкий тип нужен, чтобы row[kind] проходил tsc.
const KINDS = ["principal", "interest", "penalty", "fine"] as const satisfies readonly ScheduleRowKind[];

type StoredDocument = {
  loan_id: string;
  file_name: string;
  object_path: string;
  mime_type: string;
  document_kind: string;
  created_at: string;
};

type LoanRow = { id: string; creditor: string };
type PaymentLocation = { id: string; account_id: string; company_id: string | null };

function isSpreadsheet(document: StoredDocument) {
  return document.mime_type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || /\.xlsx$/i.test(document.file_name);
}

function isPdf(document: StoredDocument) {
  return document.mime_type === "application/pdf" || /\.pdf$/i.test(document.file_name);
}

function documentPriority(document: StoredDocument) {
  const name = document.file_name.toLowerCase();
  return (document.document_kind === "schedule" ? 4 : 0)
    + (/(?:график|schedule|payment)/i.test(name) ? 2 : 0)
    + (isSpreadsheet(document) ? 1 : 0);
}

function rowsFromSource(source: RecognizedScheduleRow[], loanId: string, currency: string): ScheduleRowRecord[] {
  return source.flatMap((row) => KINDS.flatMap((kind) => {
    const amount = Number(row[kind] ?? 0);
    if (!(amount > 0)) return [];
    return [{
      id: randomUUID(), loanId, dueDate: row.date, kind,
      amountRub: Math.round(amount * 100) / 100,
      amountOriginal: Math.round(amount * 100) / 100,
      currency, status: "planned" as const,
      paidByPaymentId: null, paidByMarketplaceSource: null, calendarPaymentId: randomUUID(), originalDueDate: null,
      balanceBefore: row.balanceBefore == null ? null : Math.round(Number(row.balanceBefore) * 100) / 100,
      balanceAfter: row.balanceAfter == null ? null : Math.round(Number(row.balanceAfter) * 100) / 100,
    } satisfies ScheduleRowRecord];
  }));
}

function sourceSchedule(document: StoredDocument, bytes: Buffer): RecognizedScheduleRow[] {
  if (isSpreadsheet(document)) return recognizeLoanSpreadsheet(xlsxGrid(bytes)).schedule ?? [];
  if (isPdf(document)) return recognizeLoanPdfSchedule(extractPdfText(bytes));
  return [];
}

export async function POST() {
  const denied = await requireApiSession(["director", "fin_director", "financier"]);
  if (denied) return denied;
  const client = getSupabaseAdmin();
  if (!client) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  try {
    const [documents, loans] = await Promise.all([
      loadAllSupabasePages<StoredDocument>((from, to) => client
        .from("finance_loan_documents")
        .select("loan_id,file_name,object_path,mime_type,document_kind,created_at")
        .order("created_at", { ascending: false })
        .range(from, to), { label: "Документы кредитов", maxPages: 20 }),
      loadAllSupabasePages<LoanRow>((from, to) => client
        .from("loans")
        .select("id,creditor")
        .order("created_at", { ascending: false })
        .range(from, to), { label: "Договоры", maxPages: 20 }),
    ]);
    const loanById = new Map(loans.map((loan) => [loan.id, loan]));
    const documentsByLoan = new Map<string, StoredDocument[]>();
    for (const document of documents) {
      const items = documentsByLoan.get(document.loan_id) ?? [];
      items.push(document);
      documentsByLoan.set(document.loan_id, items);
    }

    const repaired: string[] = [];
    const skipped: Array<{ loan: string; reason: string }> = [];
    for (const [loanId, candidates] of documentsByLoan) {
      const loan = loanById.get(loanId);
      if (!loan) continue;
      const ordered = [...candidates].sort((left, right) => documentPriority(right) - documentPriority(left) || right.created_at.localeCompare(left.created_at));
      let document: StoredDocument | null = null;
      let source: RecognizedScheduleRow[] = [];
      for (const candidate of ordered) {
        if (!isSpreadsheet(candidate) && !isPdf(candidate)) continue;
        const downloaded = await client.storage.from(BUCKET).download(candidate.object_path);
        if (downloaded.error || !downloaded.data) continue;
        try {
          const bytes = Buffer.from(await downloaded.data.arrayBuffer());
          const parsed = sourceSchedule(candidate, bytes);
          if (parsed.length) {
            document = candidate;
            source = parsed;
            break;
          }
        } catch {
          // Один повреждённый или неподходящий файл не должен останавливать
          // восстановление остальных договоров.
        }
      }
      if (!document || !source.length) {
        skipped.push({ loan: loan.creditor, reason: "нет читаемого Excel/PDF с графиком" });
        continue;
      }

      const existingResult = await client.from("loan_schedule_rows").select("*").eq("loan_id", loanId);
      if (existingResult.error) throw existingResult.error;
      const existing = (existingResult.data ?? []).map(scheduleRowFromDb);
      const planned = existing.filter((row) => row.status === "planned");
      const keep = existing.filter((row) => row.status !== "planned");
      if (!planned.length) {
        skipped.push({ loan: loan.creditor, reason: "нет плановых строк для безопасной замены" });
        continue;
      }
      const paymentIds = planned.map((row) => row.calendarPaymentId).filter((id): id is string => Boolean(id));
      const locationResult = paymentIds.length
        ? await client.from("payments").select("id,account_id,company_id").in("id", paymentIds).limit(1)
        : { data: [] as PaymentLocation[], error: null };
      if (locationResult.error) throw locationResult.error;
      const location = (locationResult.data ?? [])[0] as PaymentLocation | undefined;
      if (!location?.account_id) {
        skipped.push({ loan: loan.creditor, reason: "у старого плана нет счёта оплаты" });
        continue;
      }

      const currency = planned[0]?.currency || "RUB";
      const paidKeys = new Set(keep.map((row) => `${row.dueDate}|${row.kind}`));
      const incoming = rowsFromSource(source, loanId, currency).filter((row) => !paidKeys.has(`${row.dueDate}|${row.kind}`));
      if (!incoming.length) {
        skipped.push({ loan: loan.creditor, reason: "все строки из исходного графика уже закрыты фактами" });
        continue;
      }

      const removedRows = await client.from("loan_schedule_rows").delete().in("id", planned.map((row) => row.id));
      if (removedRows.error) throw removedRows.error;
      if (paymentIds.length) {
        const removedPayments = await client.from("payments").delete().in("id", paymentIds);
        if (removedPayments.error) throw removedPayments.error;
      }
      const payments = incoming.map((row) => derivedPaymentForRow(row, {
        loanId, creditorName: loan.creditor, accountId: location.account_id, currency, exchangeRate: 1, contractFileName: document.file_name,
      }));
      const savedPayments = await client.from("payments").upsert(payments.map((payment) => ({
        id: payment.id, name: payment.name, amount: payment.amount, type: "expense", category: payment.category, account_id: payment.accountId,
        company_id: location.company_id, date: payment.date, status: payment.status, counterparty: payment.counterparty, comment: payment.comment ?? null,
      })), { onConflict: "id" });
      if (savedPayments.error) throw savedPayments.error;
      const savedRows = await client.from("loan_schedule_rows").insert(incoming.map((row) => ({
        id: row.id, loan_id: row.loanId, due_date: row.dueDate, kind: row.kind, amount_rub: row.amountRub, amount_original: row.amountOriginal,
        currency: row.currency, status: row.status, paid_by_payment_id: null, paid_by_marketplace_source: null, calendar_payment_id: row.calendarPaymentId,
        original_due_date: null, balance_before: row.balanceBefore, balance_after: row.balanceAfter,
      })));
      if (savedRows.error) throw savedRows.error;
      repaired.push(loan.creditor);
    }
    return NextResponse.json({ ok: true, repaired, skipped });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось восстановить графики" }, { status: 500 });
  }
}
