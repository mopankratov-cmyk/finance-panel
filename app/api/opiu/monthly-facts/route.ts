import { NextRequest, NextResponse } from "next/server";
import {
  aggregateDdsMonthlyFacts,
  aggregateLoanScheduleMonthlyFacts,
  aggregatePayrollMonthlyFacts,
  loanCompanyByReceiptPayments,
  mergeMonthlySharedFacts,
  type DdsFactRow,
  type LoanScheduleMonthlyFact,
  type MonthlySharedFact,
  type PayrollEmployeeFact,
  type PayrollEntryFact,
  type PayrollPeriodFact,
} from "@/lib/opiu/monthlyFacts";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildOpiuCompanyScopes, type OpiuCompanyOption } from "@/lib/opiu/companyScope";
import { loadDdsExpenseCategories } from "@/lib/finance/expenseCategoriesServer";
import { readCompaniesCompat } from "@/lib/finance/companySchema";
import { parseCompanyTaxRate, parseCompanyTaxSystem, parseCompanyVatMode } from "@/lib/finance/companyTax";
import { loadMonthlyDdsRows } from "@/lib/opiu/ddsFactsServer";

export const dynamic = "force-dynamic";

const num = (value: unknown) => Number(value ?? 0) || 0;

function monthRange(requestedMonth: string | null) {
  const now = new Date();
  const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth ?? "") ? requestedMonth! : fallback;
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { month, from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

export async function GET(request: NextRequest) {
  const { month, from, to } = monthRange(request.nextUrl.searchParams.get("month"));
  const requestedCompanyId = request.nextUrl.searchParams.get("company")?.trim() || null;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const loadedCompanies = await readCompaniesCompat((columns) => db.from("companies").select(columns).order("group_name").order("name"));
  const companiesResult = loadedCompanies.result;
  if (companiesResult.error) return NextResponse.json({ error: companiesResult.error.message }, { status: 502 });
  const companyScopes = buildOpiuCompanyScopes((companiesResult.data ?? []).map((raw) => {
    const row = raw as unknown as Record<string, unknown>;
    return {
      id: String(row.id),
      name: String(row.name),
      groupName: String(row.group_name ?? ""),
      isActive: Boolean(row.is_active),
      ...(loadedCompanies.taxSettingsAvailable ? {
        taxSystem: parseCompanyTaxSystem(row.tax_system) ?? null,
        vatMode: parseCompanyVatMode(row.vat_mode) ?? null,
      } : {}),
      ...(loadedCompanies.taxRatesAvailable ? {
        taxRate: parseCompanyTaxRate(row.tax_rate) ?? null,
        taxAdditionalRate: parseCompanyTaxRate(row.tax_additional_rate) ?? null,
      } : {}),
    };
  }));
  const companies: OpiuCompanyOption[] = companyScopes.map(({ id, name, groupName, taxSystem, vatMode, taxRate, taxAdditionalRate }) => ({
    id, name, groupName, taxSystem, vatMode, taxRate, taxAdditionalRate,
  }));
  const requestedCompany = requestedCompanyId
    ? companyScopes.find((company) => company.companyIds.includes(requestedCompanyId))
    : null;
  if (requestedCompanyId && !requestedCompany) {
    return NextResponse.json({ error: "Компания не найдена" }, { status: 400 });
  }
  const requestedCompanyIds = requestedCompany?.companyIds ?? [];

  const warnings: string[] = [];
  let ddsFacts: Record<string, MonthlySharedFact> = {};
  let payrollFacts: Record<string, MonthlySharedFact> = {};
  let loanFacts: Record<string, MonthlySharedFact> = {};
  let payments: DdsFactRow[] = [];
  let customCategories: Awaited<ReturnType<typeof loadDdsExpenseCategories>>["categories"] = [];
  let periods: PayrollPeriodFact[] = [];
  let entries: PayrollEntryFact[] = [];
  let employees: PayrollEmployeeFact[] = [];
  let loanRows: LoanScheduleMonthlyFact[] = [];

  try {
    const loadedDds = await loadMonthlyDdsRows(db, from, to, "ОПиУ: подтверждённые расходы ДДС");
    const paymentRows = loadedDds.rows;
    if (!loadedDds.periodAllocationAvailable) warnings.push("ОПиУ: распределение платежей по месяцам станет доступно после миграции 202609240004");
    payments = paymentRows.map((row) => ({
      id: row.id == null ? undefined : String(row.id),
      date: row.date == null ? undefined : String(row.date).slice(0, 10),
      amount: num(row.amount),
      category: row.category == null ? null : String(row.category),
      comment: row.comment == null ? null : String(row.comment),
      counterparty: row.counterparty == null ? null : String(row.counterparty),
      name: row.name == null ? null : String(row.name),
      companyId: row.company_id == null ? null : String(row.company_id),
      status: String(row.status) as DdsFactRow["status"],
      importSource: row.import_source == null ? null : String(row.import_source),
    }));
    ({ categories: customCategories } = await loadDdsExpenseCategories());
    ddsFacts = aggregateDdsMonthlyFacts(
      requestedCompanyIds.length ? payments.filter((payment) => payment.companyId && requestedCompanyIds.includes(payment.companyId)) : payments,
      customCategories,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить ДДС";
    console.error("[monthly opiu] dds facts:", message);
    warnings.push(`ДДС: ${message}`);
  }

  try {
    const periodsRaw = await loadAllSupabasePages<Record<string, unknown>>((pageFrom, pageTo) => db
      .from("payroll_periods")
      .select("id,period_start,period_end")
      .lte("period_start", to)
      .gte("period_end", from)
      .order("period_start", { ascending: true })
      .order("id", { ascending: true })
      .range(pageFrom, pageTo), { label: "ОПиУ: периоды зарплатной ведомости", maxPages: 10 });
    periods = periodsRaw.map((row) => ({
      id: String(row.id),
      periodStart: String(row.period_start).slice(0, 10),
      periodEnd: String(row.period_end).slice(0, 10),
    }));
    const periodIds = periods.map((period) => period.id);
    if (periodIds.length) {
      const entriesRaw = await loadAllSupabasePages<Record<string, unknown>>((pageFrom, pageTo) => db
        .from("payroll_entries")
        .select("id,period_id,employee_id,official_amount,unofficial_amount,contractor_amount,tax_amount,company_id,allocation_lines")
        .in("period_id", periodIds)
        .order("period_id", { ascending: true })
        .order("id", { ascending: true })
        .range(pageFrom, pageTo), { label: "ОПиУ: начисления зарплатной ведомости", maxPages: 20 });
      entries = entriesRaw.map((row) => ({
        periodId: String(row.period_id),
        employeeId: String(row.employee_id),
        officialAmount: num(row.official_amount),
        unofficialAmount: num(row.unofficial_amount),
        contractorAmount: num(row.contractor_amount),
        taxAmount: num(row.tax_amount),
        companyId: row.company_id ? String(row.company_id) : null,
        lines: Array.isArray(row.allocation_lines) ? (row.allocation_lines as Array<Record<string, unknown>>).map((line) => ({
          kind: line.kind === "official" || line.kind === "unofficial" || line.kind === "contractor" ? line.kind : undefined,
          amount: num(line.amount),
          taxAmount: num(line.taxAmount),
          companyId: line.companyId ? String(line.companyId) : null,
        })) : null,
      }));
      const employeeIds = [...new Set(entries.map((entry) => entry.employeeId))];
      if (employeeIds.length) {
        const employeesRaw = await loadAllSupabasePages<Record<string, unknown>>((pageFrom, pageTo) => db
          .from("payroll_employees")
          .select("id,position,employment_type")
          .in("id", employeeIds)
          .order("id", { ascending: true })
          .range(pageFrom, pageTo), { label: "ОПиУ: сотрудники зарплатной ведомости", maxPages: 10 });
        employees = employeesRaw.map((row) => ({
          id: String(row.id),
          position: String(row.position ?? ""),
          employmentType: row.employment_type === "official"
            || row.employment_type === "unofficial"
            || row.employment_type === "partial"
            || row.employment_type === "individual_entrepreneur"
            || row.employment_type === "self_employed"
            ? row.employment_type
            : undefined,
        }));
      }
    }
    payrollFacts = aggregatePayrollMonthlyFacts({ periods, entries, employees, from, to, companyIds: requestedCompanyIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить зарплатную ведомость";
    console.error("[monthly opiu] payroll facts:", message);
    warnings.push(`ФОТ: ${message}`);
  }

  try {
    const scheduleRaw = await loadAllSupabasePages<Record<string, unknown>>((pageFrom, pageTo) => db
      .from("loan_schedule_rows")
      .select("loan_id,amount_rub,kind,status,calendar_payment_id")
      .gte("due_date", from)
      .lte("due_date", to)
      .eq("kind", "interest")
      .neq("status", "cancelled")
      .order("due_date", { ascending: true })
      .range(pageFrom, pageTo), { label: "ОПиУ: графики кредитов", maxPages: 20 });
    const paymentIds = [...new Set(scheduleRaw.map((row) => String(row.calendar_payment_id ?? "")).filter(Boolean))];
    const companyByPayment = new Map<string, string>();
    if (paymentIds.length) {
      const linkedPayments = await loadAllSupabasePages<Record<string, unknown>>((pageFrom, pageTo) => db
        .from("payments")
        .select("id,company_id")
        .in("id", paymentIds)
        .order("id", { ascending: true })
        .range(pageFrom, pageTo), { label: "ОПиУ: компании кредитов", maxPages: 20 });
      for (const payment of linkedPayments) {
        if (payment.company_id) companyByPayment.set(String(payment.id), String(payment.company_id));
      }
    }
    const rowsWithoutPaymentCompany = scheduleRaw.filter((row) =>
      !companyByPayment.has(String(row.calendar_payment_id ?? "")),
    );
    let companyByLoan = new Map<string, string>();
    if (rowsWithoutPaymentCompany.length) {
      const receiptPayments = await loadAllSupabasePages<Record<string, unknown>>((pageFrom, pageTo) => db
        .from("payments")
        .select("company_id,comment")
        .not("company_id", "is", null)
        .like("comment", "%:receipt]%")
        .order("id", { ascending: true })
        .range(pageFrom, pageTo), { label: "ОПиУ: компании кредитных договоров", maxPages: 20 });
      companyByLoan = loanCompanyByReceiptPayments(receiptPayments.map((row) => ({
        companyId: row.company_id == null ? null : String(row.company_id),
        comment: row.comment == null ? null : String(row.comment),
      })));
    }
    loanRows = scheduleRaw.map((row) => ({
      amount: num(row.amount_rub),
      kind: String(row.kind) as LoanScheduleMonthlyFact["kind"],
      status: String(row.status) as LoanScheduleMonthlyFact["status"],
      companyId: companyByPayment.get(String(row.calendar_payment_id ?? ""))
        ?? companyByLoan.get(String(row.loan_id ?? "").toLowerCase())
        ?? null,
    }));
    const unassignedInterest = loanRows.filter((row) => !row.companyId);
    if (unassignedInterest.length) {
      const total = unassignedInterest.reduce((sum, row) => sum + Math.abs(row.amount), 0);
      warnings.push(`Кредиты: ${unassignedInterest.length} строк графика на ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(total)} ₽ без компании не вошли в разрез юрлиц`);
    }
    loanFacts = aggregateLoanScheduleMonthlyFacts(loanRows, requestedCompanyIds);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить графики кредитов";
    if (!/does not exist|schema cache/i.test(message)) warnings.push(`Кредиты: ${message}`);
  }

  const byCompany = Object.fromEntries(companyScopes.map((scope) => {
    const companyDds = aggregateDdsMonthlyFacts(
      payments.filter((payment) => payment.companyId && scope.companyIds.includes(payment.companyId)),
      customCategories,
    );
    const companyLoans = aggregateLoanScheduleMonthlyFacts(loanRows, scope.companyIds);
    return [scope.id, mergeMonthlySharedFacts(
      companyDds,
      aggregatePayrollMonthlyFacts({ periods, entries, employees, from, to, companyIds: scope.companyIds }),
      companyLoans,
    )];
  }));

  return NextResponse.json({
    period: { from, to, month },
    companies,
    shared: mergeMonthlySharedFacts(ddsFacts, payrollFacts, loanFacts),
    byCompany,
    warnings,
  });
}
