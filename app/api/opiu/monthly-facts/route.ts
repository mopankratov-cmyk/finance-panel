import { NextRequest, NextResponse } from "next/server";
import {
  aggregateDdsMonthlyFacts,
  aggregateLoanScheduleMonthlyFacts,
  aggregatePayrollMonthlyFacts,
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
    const paymentRows = await loadAllSupabasePages<Record<string, unknown>>((pageFrom, pageTo) => {
      let query = db
        .from("payments")
        .select("amount,category,comment,date,id,company_id,status,import_source")
        .eq("status", "done")
        .or("import_source.like.bank-review:%,import_source.like.dds-chain:%,import_source.like.manual-dds:%")
        .gte("date", from)
        .lte("date", to);
      return query
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(pageFrom, pageTo);
    }, { label: "ОПиУ: подтверждённые расходы ДДС", maxPages: 100 });
    payments = paymentRows.map((row) => ({
      amount: num(row.amount),
      category: row.category == null ? null : String(row.category),
      comment: row.comment == null ? null : String(row.comment),
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
        lines: Array.isArray(row.allocation_lines) ? row.allocation_lines as Array<{ amount?: number; taxAmount?: number; companyId?: string | null }> : null,
      }));
      const employeeIds = [...new Set(entries.map((entry) => entry.employeeId))];
      if (employeeIds.length) {
        const employeesRaw = await loadAllSupabasePages<Record<string, unknown>>((pageFrom, pageTo) => db
          .from("payroll_employees")
          .select("id,position")
          .in("id", employeeIds)
          .order("id", { ascending: true })
          .range(pageFrom, pageTo), { label: "ОПиУ: сотрудники зарплатной ведомости", maxPages: 10 });
        employees = employeesRaw.map((row) => ({ id: String(row.id), position: String(row.position ?? "") }));
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
      .select("amount_rub,kind,status,calendar_payment_id")
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
    loanRows = scheduleRaw.map((row) => ({
      amount: num(row.amount_rub),
      kind: String(row.kind) as LoanScheduleMonthlyFact["kind"],
      status: String(row.status) as LoanScheduleMonthlyFact["status"],
      companyId: companyByPayment.get(String(row.calendar_payment_id ?? "")) ?? null,
    }));
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
