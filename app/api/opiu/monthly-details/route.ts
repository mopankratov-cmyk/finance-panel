import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadDdsExpenseCategories } from "@/lib/finance/expenseCategoriesServer";
import { readCompaniesCompat } from "@/lib/finance/companySchema";
import { buildOpiuCompanyScopes } from "@/lib/opiu/companyScope";
import {
  ddsOpiuArticleId,
  loanCompanyByReceiptPayments,
  payrollMonthlyContributions,
  type DdsFactRow,
  type PayrollEmployeeFact,
  type PayrollEntryFact,
} from "@/lib/opiu/monthlyFacts";
import {
  LOAN_DETAIL_ARTICLES,
  PAYROLL_DETAIL_ARTICLES,
  type MonthlyOpiuDetailItem,
  type MonthlyOpiuDetailsResponse,
} from "@/lib/opiu/monthlyDetails";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const num = (value: unknown) => Number(value ?? 0) || 0;

function monthRange(requestedMonth: string | null) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth ?? "")) return null;
  const month = requestedMonth!;
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function response(articleId: string, source: MonthlyOpiuDetailsResponse["source"], items: MonthlyOpiuDetailItem[], note?: string) {
  return NextResponse.json({
    articleId,
    source,
    items,
    total: Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100,
    ...(note ? { note } : {}),
  } satisfies MonthlyOpiuDetailsResponse);
}

async function companyIdsForFilter(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, requestedCompanyId: string | null) {
  if (!requestedCompanyId) return [];
  const loaded = await readCompaniesCompat((columns) => db.from("companies").select(columns).order("group_name").order("name"));
  if (loaded.result.error) throw loaded.result.error;
  const scopes = buildOpiuCompanyScopes((loaded.result.data ?? []).map((raw) => {
    const row = raw as unknown as Record<string, unknown>;
    return {
      id: String(row.id),
      name: String(row.name),
      groupName: String(row.group_name ?? ""),
      isActive: Boolean(row.is_active),
    };
  }));
  const scope = scopes.find((company) => company.companyIds.includes(requestedCompanyId));
  if (!scope) throw new Error("Компания не найдена");
  return scope.companyIds;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;

  const range = monthRange(request.nextUrl.searchParams.get("month"));
  const articleId = request.nextUrl.searchParams.get("article")?.trim() ?? "";
  const requestedCompanyId = request.nextUrl.searchParams.get("company")?.trim() || null;
  if (!range || !articleId) return NextResponse.json({ error: "Неверные параметры детализации" }, { status: 400 });

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  try {
    const companyIds = await companyIdsForFilter(db, requestedCompanyId);
    const companySelected = companyIds.length > 0;

    if (PAYROLL_DETAIL_ARTICLES.has(articleId)) {
      const periods = await loadAllSupabasePages<Record<string, unknown>>((from, to) => db
        .from("payroll_periods")
        .select("id,period_start,period_end,pay_date")
        .lte("period_start", range.to)
        .gte("period_end", range.from)
        .order("period_start").order("id").range(from, to), { label: "Детализация ОПиУ: периоды ФОТ", maxPages: 10 });
      const periodIds = periods.map((period) => String(period.id));
      if (!periodIds.length) return response(articleId, "payroll", [], "За месяц нет строк зарплатной ведомости");

      const entriesRaw = await loadAllSupabasePages<Record<string, unknown>>((from, to) => db
        .from("payroll_entries")
        .select("id,period_id,employee_id,official_amount,unofficial_amount,contractor_amount,tax_amount,company_id,allocation_lines")
        .in("period_id", periodIds)
        .order("period_id").order("id").range(from, to), { label: "Детализация ОПиУ: начисления ФОТ", maxPages: 20 });
      const employeeIds = [...new Set(entriesRaw.map((entry) => String(entry.employee_id)))];
      const employeesRaw = employeeIds.length ? await loadAllSupabasePages<Record<string, unknown>>((from, to) => db
        .from("payroll_employees")
        .select("id,full_name,position,employment_type")
        .in("id", employeeIds)
        .order("id").range(from, to), { label: "Детализация ОПиУ: сотрудники ФОТ", maxPages: 10 }) : [];
      const employeeById = new Map(employeesRaw.map((row) => [String(row.id), {
        id: String(row.id),
        fullName: String(row.full_name ?? "Сотрудник"),
        position: String(row.position ?? ""),
        employmentType: row.employment_type as PayrollEmployeeFact["employmentType"],
      }]));
      const periodById = new Map(periods.map((period) => [String(period.id), period]));
      const items: MonthlyOpiuDetailItem[] = [];
      for (const row of entriesRaw) {
        const employee = employeeById.get(String(row.employee_id));
        if (!employee) continue;
        const entry: PayrollEntryFact = {
          id: String(row.id),
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
        };
        const contribution = payrollMonthlyContributions(entry, employee, companyIds).find((item) => item.articleId === articleId);
        if (!contribution || contribution.amount === 0) continue;
        const period = periodById.get(entry.periodId);
        items.push({
          id: `payroll:${entry.id}`,
          source: "payroll",
          date: String(period?.pay_date ?? period?.period_end ?? "").slice(0, 10) || null,
          title: employee.fullName ?? "Сотрудник",
          subtitle: [employee.position, `${String(period?.period_start ?? "").slice(0, 10)} — ${String(period?.period_end ?? "").slice(0, 10)}`].filter(Boolean).join(" · "),
          amount: contribution.amount,
          href: "/payroll",
        });
      }
      return response(articleId, "payroll", items);
    }

    if (LOAN_DETAIL_ARTICLES.has(articleId)) {
      const schedule = await loadAllSupabasePages<Record<string, unknown>>((from, to) => db
        .from("loan_schedule_rows")
        .select("id,loan_id,due_date,amount_rub,kind,status,calendar_payment_id")
        .gte("due_date", range.from).lte("due_date", range.to)
        .eq("kind", "interest").neq("status", "cancelled")
        .order("due_date").order("id").range(from, to), { label: "Детализация ОПиУ: проценты", maxPages: 20 });
      const paymentIds = [...new Set(schedule.map((row) => String(row.calendar_payment_id ?? "")).filter(Boolean))];
      const linkedPayments = paymentIds.length ? await loadAllSupabasePages<Record<string, unknown>>((from, to) => db
        .from("payments").select("id,company_id,name,comment").in("id", paymentIds)
        .order("id").range(from, to), { label: "Детализация ОПиУ: платежи кредитов", maxPages: 20 }) : [];
      const paymentById = new Map(linkedPayments.map((row) => [String(row.id), row]));
      const receiptPayments = await loadAllSupabasePages<Record<string, unknown>>((from, to) => db
        .from("payments").select("company_id,comment").not("company_id", "is", null).like("comment", "%:receipt]%")
        .order("id").range(from, to), { label: "Детализация ОПиУ: компании договоров", maxPages: 20 });
      const companyByLoan = loanCompanyByReceiptPayments(receiptPayments.map((row) => ({ companyId: row.company_id ? String(row.company_id) : null, comment: row.comment ? String(row.comment) : null })));
      const items = schedule.flatMap<MonthlyOpiuDetailItem>((row) => {
        const payment = paymentById.get(String(row.calendar_payment_id ?? ""));
        const companyId = (payment?.company_id ? String(payment.company_id) : null) ?? companyByLoan.get(String(row.loan_id ?? "").toLowerCase()) ?? null;
        if (companySelected && (!companyId || !companyIds.includes(companyId))) return [];
        return [{
          id: `loan:${String(row.id)}`,
          source: "loan",
          date: String(row.due_date).slice(0, 10),
          title: String(payment?.name ?? "Проценты по договору"),
          subtitle: `График кредита · ${String(row.status) === "paid" ? "оплачено" : "начислено"}`,
          amount: Math.abs(num(row.amount_rub)),
          href: "/loans",
        }];
      });
      return response(articleId, "loan", items);
    }

    const rows = await loadAllSupabasePages<Record<string, unknown>>((from, to) => db
      .from("payments")
      .select("id,date,name,counterparty,amount,category,comment,company_id,status,import_source")
      .eq("status", "done")
      .or("import_source.like.bank-review:%,import_source.like.dds-chain:%,import_source.like.manual-dds:%")
      .gte("date", range.from).lte("date", range.to)
      .order("date").order("id").range(from, to), { label: "Детализация ОПиУ: ДДС", maxPages: 100 });
    const { categories } = await loadDdsExpenseCategories();
    const items = rows.flatMap<MonthlyOpiuDetailItem>((row) => {
      const fact: DdsFactRow = {
        id: String(row.id),
        date: String(row.date).slice(0, 10),
        name: row.name ? String(row.name) : null,
        counterparty: row.counterparty ? String(row.counterparty) : null,
        amount: num(row.amount),
        category: row.category ? String(row.category) : null,
        comment: row.comment ? String(row.comment) : null,
        companyId: row.company_id ? String(row.company_id) : null,
        status: String(row.status) as DdsFactRow["status"],
        importSource: row.import_source ? String(row.import_source) : null,
      };
      if ((companySelected && (!fact.companyId || !companyIds.includes(fact.companyId))) || ddsOpiuArticleId(fact, categories) !== articleId) return [];
      return [{
        id: `dds:${fact.id}`,
        source: "dds",
        date: fact.date,
        title: fact.counterparty || fact.name || "Платёж ДДС",
        subtitle: [fact.category, fact.comment].filter(Boolean).join(" · "),
        amount: Math.abs(fact.amount),
        href: `/payments?payment=${encodeURIComponent(fact.id ?? "")}`,
      }];
    });
    return response(articleId, "dds", items);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить детализацию";
    return NextResponse.json({ error: message }, { status: /Компания не найдена/.test(message) ? 400 : 502 });
  }
}
