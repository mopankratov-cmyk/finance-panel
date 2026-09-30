import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { contractNumberFromComment, wbLoanFactFromRow } from "@/lib/loans/marketplaceFacts";
import { scheduleRowFromDb, type ScheduleRowRecord } from "@/lib/loans/scheduleRows";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const isoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const daysBetween = (left: string, right: string) => Math.abs(new Date(`${left}T12:00:00`).getTime() - new Date(`${right}T12:00:00`).getTime()) / 86_400_000;
const normalizedContractNumber = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");

type LoanRow = { id: string; creditor: string; start_date: string };
type PaymentRow = { comment: string | null };
type ContractLinkRow = { marketplace: string; contract_number: string; loan_id: string };
type CabinetRow = { id: string; name: string | null };
type MarketplaceAllocationRow = { schedule_row_id: string; marketplace_source: string; amount_rub: number };

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export async function GET() {
  const denied = await requireApiSession(["director", "fin_director", "financier"]);
  if (denied) return denied;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  try {
    const [loansResult, paymentRows, reportRows, linksResult, cabinetsResult, allocationRows] = await Promise.all([
      db.from("loans").select("id,creditor,start_date").eq("status", "active"),
      loadAllSupabasePages<PaymentRow>((from, to) => db.from("payments").select("comment").not("comment", "is", null).like("comment", "%[loan:%").order("id").range(from, to), { label: "Метки договоров", maxPages: 50 }),
      loadAllSupabasePages<Record<string, unknown>>((from, to) => db.from("wb_report_rows")
        .select("cabinet_id,rrd_id,rr_dt,deduction,bonus_type_name,supplier_oper_name")
        .eq("supplier_oper_name", "Удержание")
        .ilike("bonus_type_name", "Перевод на баланс заёмщика%")
        .order("rrd_id", { ascending: true }).range(from, to), { label: "Удержания WB по кредитам", maxPages: 50 }),
      db.from("loan_marketplace_contract_links").select("marketplace,contract_number,loan_id").eq("marketplace", "wb"),
      // В удержании хранится технический cabinet_id. Превращаем его в имя
      // кабинета на сервере, чтобы в очереди сверки было ясно, откуда деньги.
      db.from("wb_cabinets").select("id,name").eq("marketplace", "wb"),
      loadAllSupabasePages<MarketplaceAllocationRow>((from, to) => db.from("loan_schedule_marketplace_allocations")
        .select("schedule_row_id,marketplace_source,amount_rub").order("id").range(from, to), { label: "Распределения удержаний WB", maxPages: 50 }),
    ]);
    if (loansResult.error) throw loansResult.error;
    if (linksResult.error && !/does not exist|schema cache/i.test(linksResult.error.message)) throw linksResult.error;
    if (cabinetsResult.error) throw cabinetsResult.error;
    const loans = (loansResult.data ?? []) as LoanRow[];
    const cabinetNames = new Map(((cabinetsResult.data ?? []) as CabinetRow[]).map((cabinet) => [cabinet.id, cabinet.name?.trim() || null]));
    const byContract = new Map<string, LoanRow>();
    for (const payment of paymentRows) {
      const contract = contractNumberFromComment(payment.comment);
      const loanId = payment.comment?.match(/\[loan:([0-9a-f-]{36})/i)?.[1];
      const loan = loans.find((item) => item.id === loanId);
      if (contract && loan) {
        byContract.set(contract, loan);
        const normalized = normalizedContractNumber(contract);
        if (normalized) byContract.set(normalized, loan);
      }
    }
    // Проверенная связь из WB имеет приоритет над старой меткой в платежах.
    // Иначе пользователь мог выбрать нужный договор, но следующий GET молча
    // возвращал его к дубликату, который встретился в истории платежей позже.
    for (const link of (linksResult.data ?? []) as ContractLinkRow[]) {
      const loan = loans.find((item) => item.id === link.loan_id);
      const number = normalizedContractNumber(link.contract_number);
      if (loan && number) byContract.set(number, loan);
    }
    const schedules = loans.length ? await loadAllSupabasePages<Record<string, unknown>>((from, to) => db.from("loan_schedule_rows").select("*").in("loan_id", loans.map((loan) => loan.id)).order("due_date").range(from, to), { label: "Графики кредитов", maxPages: 50 }) : [];
    const scheduleRows = schedules.map(scheduleRowFromDb);
    const allocatedBySource = new Map<string, number>();
    const allocationSources = new Set<string>();
    for (const allocation of allocationRows) {
      allocatedBySource.set(allocation.marketplace_source, roundMoney((allocatedBySource.get(allocation.marketplace_source) ?? 0) + Number(allocation.amount_rub)));
      allocationSources.add(allocation.marketplace_source);
    }
    const facts = reportRows.flatMap((row) => {
      const fact = wbLoanFactFromRow(row);
      if (!fact) return [];
      // У действительно старых удержаний номер иногда отсутствует. Тогда WB
      // добавляет дату выдачи в назначение, и её можно использовать лишь как
      // кандидата. Если номер есть, но для него пока нет связи, нельзя
      // подменять его договором с той же датой выдачи: у одного кредитора
      // бывают несколько договоров одного дня, и очередь начинала предлагать
      // чужой график для ручного зачёта.
      const issueDate = fact.reason.match(/от\s+(\d{4}-\d{2}-\d{2})/)?.[1];
      const loan = fact.contractNumber
        ? byContract.get(fact.contractNumber) ?? byContract.get(normalizedContractNumber(fact.contractNumber))
        : loans.find((item) => item.creditor.toLowerCase().includes("вб финанс") && item.start_date === issueDate);
      const candidates = loan && fact.kind !== "unknown"
        ? scheduleRows.filter((row) => row.loanId === loan.id && row.status === "planned" && row.kind === fact.kind
          // Отчёт WB фиксирует дату удержания, а не дату графика. В соседние
          // месяцы она регулярно сдвигается на 2–3 недели; точная сумма и вид
          // платежа по конкретному договору остаются обязательными.
          && Math.abs(row.amountRub - fact.amountRub) <= 0.01 && daysBetween(row.dueDate, fact.date) <= 31)
        : [];
      const allocatedAmountRub = allocatedBySource.get(fact.source) ?? 0;
      const recorded = scheduleRows.some((row) => row.paidByMarketplaceSource === fact.source) && !allocationSources.has(fact.source);
      const remainingAmountRub = roundMoney(Math.max(0, fact.amountRub - allocatedAmountRub));
      return [{ ...fact, cabinetName: cabinetNames.get(fact.cabinetId) ?? null, loanId: loan?.id ?? null, loanName: loan?.creditor ?? null, scheduleRowId: candidates.length === 1 ? candidates[0].id : null,
        allocatedAmountRub, remainingAmountRub,
        state: recorded || remainingAmountRub <= 0.01 ? "recorded" : candidates.length === 1 ? "ready" : loan ? "review" : "unassigned" }];
    });
    return NextResponse.json({ facts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось прочитать удержания WB";
    if (/does not exist|schema cache/i.test(message)) return NextResponse.json({ facts: [], missingTable: true });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Запоминает один раз, какой договор панели соответствует номеру из отчёта WB. */
export async function PUT(request: Request) {
  const denied = await requireApiSession(["director", "fin_director", "financier"]);
  if (denied) return denied;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = await request.json().catch(() => null) as { contractNumber?: unknown; loanId?: unknown } | null;
  const contractNumber = normalizedContractNumber(typeof body?.contractNumber === "string" ? body.contractNumber : "");
  const loanId = typeof body?.loanId === "string" ? body.loanId.trim() : "";
  if (contractNumber.length < 6 || !loanId) return NextResponse.json({ error: "Нужны номер договора WB и договор панели" }, { status: 400 });
  try {
    const loan = await db.from("loans").select("id").eq("id", loanId).maybeSingle();
    if (loan.error) throw loan.error;
    if (!loan.data) return NextResponse.json({ error: "Договор панели не найден" }, { status: 404 });
    const saved = await db.from("loan_marketplace_contract_links")
      .upsert({ marketplace: "wb", contract_number: contractNumber, loan_id: loanId, updated_at: new Date().toISOString() }, { onConflict: "marketplace,contract_number" })
      .select("marketplace,contract_number,loan_id").single();
    if (saved.error) throw saved.error;
    return NextResponse.json({ link: saved.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить связь договора WB";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Разносит только один явно названный договор WB. Агрегированное удержание
 * закрывает последовательно самые ранние строки того же вида, только когда
 * хватает суммы на строку целиком. Остаток не списывается «на глаз».
 */
export async function POST(request: Request) {
  const denied = await requireApiSession(["director", "fin_director", "financier"]);
  if (denied) return denied;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = await request.json().catch(() => null) as { action?: unknown; contractNumber?: unknown } | null;
  const contractNumber = normalizedContractNumber(typeof body?.contractNumber === "string" ? body.contractNumber : "");
  if (body?.action !== "allocate-contract" || contractNumber.length < 6) return NextResponse.json({ error: "Укажите номер договора WB" }, { status: 400 });
  try {
    const linkResult = await db.from("loan_marketplace_contract_links").select("loan_id").eq("marketplace", "wb").eq("contract_number", contractNumber).maybeSingle();
    if (linkResult.error) throw linkResult.error;
    if (!linkResult.data) return NextResponse.json({ error: "Сначала свяжите номер WB с договором панели" }, { status: 409 });
    const loanId = String(linkResult.data.loan_id);
    const [reportRows, scheduleDbRows, allocationRows] = await Promise.all([
      loadAllSupabasePages<Record<string, unknown>>((from, to) => db.from("wb_report_rows")
        .select("cabinet_id,rrd_id,rr_dt,deduction,bonus_type_name,supplier_oper_name")
        .eq("supplier_oper_name", "Удержание").ilike("bonus_type_name", "Перевод на баланс заёмщика%")
        .order("rrd_id", { ascending: true }).range(from, to), { label: "Удержания WB по договору", maxPages: 50 }),
      loadAllSupabasePages<Record<string, unknown>>((from, to) => db.from("loan_schedule_rows").select("*").eq("loan_id", loanId).order("due_date").range(from, to), { label: "График договора", maxPages: 50 }),
      loadAllSupabasePages<MarketplaceAllocationRow>((from, to) => db.from("loan_schedule_marketplace_allocations")
        .select("schedule_row_id,marketplace_source,amount_rub").order("id").range(from, to), { label: "Распределения WB", maxPages: 50 }),
    ]);
    const rows = scheduleDbRows.map(scheduleRowFromDb);
    const allocatedBySource = new Map<string, number>();
    const allocatedRowIds = new Set<string>();
    for (const allocation of allocationRows) {
      allocatedBySource.set(allocation.marketplace_source, roundMoney((allocatedBySource.get(allocation.marketplace_source) ?? 0) + Number(allocation.amount_rub)));
      allocatedRowIds.add(allocation.schedule_row_id);
    }
    // До этой миграции точное удержание хранилось прямо в строке графика.
    // Считаем такие старые записи уже полностью учтёнными, чтобы новый
    // распределитель не попытался использовать тот же rrd_id повторно.
    for (const row of rows) {
      if (!row.paidByMarketplaceSource || allocatedBySource.has(row.paidByMarketplaceSource)) continue;
      allocatedBySource.set(row.paidByMarketplaceSource, row.amountRub);
      allocatedRowIds.add(row.id);
    }
    let allocatedRows = 0;
    let allocatedAmountRub = 0;
    let unresolvedFacts = 0;
    const facts = reportRows.flatMap(wbLoanFactFromRow)
      .filter((fact) => normalizedContractNumber(fact.contractNumber) === contractNumber && fact.kind !== "unknown")
      .sort((a, b) => a.date.localeCompare(b.date) || a.rrdId.localeCompare(b.rrdId));
    for (const fact of facts) {
      let remaining = roundMoney(Math.max(0, fact.amountRub - (allocatedBySource.get(fact.source) ?? 0)));
      if (remaining <= 0.01) continue;
      const candidates = rows.filter((row) => row.status === "planned" && row.kind === fact.kind && row.dueDate <= fact.date && !allocatedRowIds.has(row.id));
      for (const row of candidates) {
        if (row.amountRub > remaining + 0.01) break;
        const inserted = await db.from("loan_schedule_marketplace_allocations").insert({ schedule_row_id: row.id, marketplace_source: fact.source, amount_rub: row.amountRub });
        if (inserted.error) throw inserted.error;
        const now = new Date().toISOString();
        const updated = await db.from("loan_schedule_rows").update({ status: "paid", paid_by_marketplace_source: fact.source, updated_at: now }).eq("id", row.id).eq("status", "planned").select("id");
        if (updated.error || (updated.data ?? []).length !== 1) throw new Error(updated.error?.message ?? "Строка графика уже закрыта");
        if (row.calendarPaymentId) {
          const planned = await db.from("payments").select("comment").eq("id", row.calendarPaymentId).maybeSingle();
          const comment = `${String(planned.data?.comment ?? "").replace(/\s*\[paid-by-marketplace:[^\]]+\]/g, "").trim()} [paid-by-marketplace:${fact.source}]`.trim();
          const payment = await db.from("payments").update({ status: "cancelled", comment }).eq("id", row.calendarPaymentId);
          if (payment.error) throw payment.error;
        }
        row.status = "paid";
        row.paidByMarketplaceSource = fact.source;
        allocatedRowIds.add(row.id);
        remaining = roundMoney(remaining - row.amountRub);
        allocatedRows++;
        allocatedAmountRub = roundMoney(allocatedAmountRub + row.amountRub);
      }
      if (remaining > 0.01) unresolvedFacts++;
    }
    return NextResponse.json({ allocatedRows, allocatedAmountRub, unresolvedFacts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось распределить удержания WB";
    if (/does not exist|schema cache/i.test(message)) return NextResponse.json({ error: "Для распределения сначала примените миграцию 202609300002_wb_schedule_partial_allocations.sql" }, { status: 503 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
