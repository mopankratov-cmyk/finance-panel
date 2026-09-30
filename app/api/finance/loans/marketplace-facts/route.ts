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

export async function GET() {
  const denied = await requireApiSession(["director", "fin_director", "financier"]);
  if (denied) return denied;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  try {
    const [loansResult, paymentRows, reportRows, linksResult, cabinetsResult] = await Promise.all([
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
    const facts = reportRows.flatMap((row) => {
      const fact = wbLoanFactFromRow(row);
      if (!fact) return [];
      // У старых договоров номер ещё мог не попасть в метку. WB добавляет
      // дату выдачи в назначение — используем её только для того, чтобы
      // показать кандидата; автозачёт всё равно потребует точного совпадения.
      const issueDate = fact.reason.match(/от\s+(\d{4}-\d{2}-\d{2})/)?.[1];
      const loan = (fact.contractNumber ? byContract.get(fact.contractNumber) ?? byContract.get(normalizedContractNumber(fact.contractNumber)) : undefined)
        ?? loans.find((item) => item.creditor.toLowerCase().includes("вб финанс") && item.start_date === issueDate);
      const candidates = loan && fact.kind !== "unknown"
        ? scheduleRows.filter((row) => row.loanId === loan.id && row.status === "planned" && row.kind === fact.kind
          // Отчёт WB фиксирует дату удержания, а не дату графика. В соседние
          // месяцы она регулярно сдвигается на 2–3 недели; точная сумма и вид
          // платежа по конкретному договору остаются обязательными.
          && Math.abs(row.amountRub - fact.amountRub) <= 0.01 && daysBetween(row.dueDate, fact.date) <= 31)
        : [];
      const recorded = scheduleRows.some((row) => row.paidByMarketplaceSource === fact.source);
      return [{ ...fact, cabinetName: cabinetNames.get(fact.cabinetId) ?? null, loanId: loan?.id ?? null, loanName: loan?.creditor ?? null, scheduleRowId: candidates.length === 1 ? candidates[0].id : null,
        state: recorded ? "recorded" : candidates.length === 1 ? "ready" : loan ? "review" : "unassigned" }];
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
