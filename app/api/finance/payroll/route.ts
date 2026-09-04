import { NextRequest, NextResponse } from "next/server";
import { payrollLineTaxIsPayable, payrollPeriodForDate, payrollSalaryAmount, payrollTaxAmount, type PayrollAccrualLine, type PayrollDraftEntry, type PayrollEmployee, type PayrollEmploymentStatus, type PayrollEmploymentType, type PayrollLineKind, type PayrollPaymentMethod } from "@/components/payments/payroll";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { PAYROLL_CATEGORIES } from "@/lib/finance/categories";
import { consumedFactIds, preservedLoanMarkers } from "@/lib/finance/factLinks";
import { loadFinanceStateServer, persistFinanceActionServer } from "@/lib/finance/dbServer";
import { appendPayrollFactMarker, canAllocateFactToPayroll, payrollCategoryForEmployee } from "@/lib/payroll/model";
import { financeReducer } from "@/lib/reducer";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { FinanceAction, FinanceState, Payment } from "@/lib/types";
import { PAYROLL_PREVIEW_EMPLOYEES } from "@/components/payments/payrollPreview";
import { xlsxGrid } from "@/lib/finance/xlsxGrid";
import { publicStaffFields, staffFromGrid } from "@/lib/payroll/staffSheet";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

const EMPLOYMENT_TYPES = new Set<PayrollEmploymentType>(["official", "unofficial", "partial", "individual_entrepreneur", "self_employed"]);
const EMPLOYMENT_STATUSES = new Set<PayrollEmploymentStatus>(["active", "terminated"]);
const PAYMENT_METHODS = new Set<PayrollPaymentMethod>(["card", "bank_account", "cash"]);
const LINE_KINDS = new Set<PayrollLineKind>(["official", "unofficial", "contractor"]);

const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const text = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const nullableId = (value: unknown) => {
  const result = text(value, 80);
  return result || null;
};

async function authorize() {
  return requireApiSession(["director", "finance"]);
}

function dbOrError() {
  const db = getSupabaseAdmin();
  return db ?? null;
}

async function persistFinanceActions(actions: FinanceAction[]): Promise<FinanceState> {
  let state = await loadFinanceStateServer();
  for (const action of actions) {
    const nextState = financeReducer(state, action);
    await persistFinanceActionServer(action, state, nextState);
    state = nextState;
  }
  return state;
}

export async function GET() {
  const gate = await authorize();
  if (gate) return gate;
  const db = dbOrError();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  try {
    const [employees, periods, entries, debts, allocations] = await Promise.all([
      loadAllSupabasePages<Record<string, unknown>>((from, to) => db.from("payroll_employees").select("id,full_name,employment_status,employment_type,employment_details,hire_date,termination_date,employer_name,company_ids,company_id,position,project,city,monthly_salary,tax_rate,default_payment_method,notes,created_at,updated_at").order("full_name").range(from, to), { label: "Сотрудники зарплатной ведомости" }),
      loadAllSupabasePages<Record<string, unknown>>((from, to) => db.from("payroll_periods").select("*").order("pay_date", { ascending: false }).range(from, to), { label: "Периоды зарплатной ведомости" }),
      loadAllSupabasePages<Record<string, unknown>>((from, to) => db.from("payroll_entries").select("*").order("created_at").range(from, to), { label: "Начисления зарплатной ведомости" }),
      loadAllSupabasePages<Record<string, unknown>>((from, to) => db.from("payroll_debt_openings").select("*").order("debt_year", { ascending: false }).range(from, to), { label: "Начальные долги по зарплате" }),
      loadAllSupabasePages<Record<string, unknown>>((from, to) => db.from("payroll_payment_allocations").select("*").order("confirmed_at", { ascending: false }).range(from, to), { label: "Распределения зарплатных оплат" }),
    ]);
    return NextResponse.json({ employees, periods, entries, debts, allocations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить зарплатную ведомость";
    const missing = /does not exist|schema cache/i.test(message);
    if (missing) return NextResponse.json({ employees: PAYROLL_PREVIEW_EMPLOYEES.map((employee) => ({
      id: employee.id,
      full_name: employee.fullName,
      employment_status: employee.employmentStatus,
      employment_type: employee.employmentType,
      employment_details: employee.employmentDetails,
      hire_date: employee.hireDate,
      termination_date: employee.terminationDate,
      employer_name: employee.employerName,
      company_ids: employee.companyIds,
      company_id: employee.companyId,
      position: employee.position,
      project: employee.project,
      city: employee.city,
      monthly_salary: employee.monthlySalary,
      tax_rate: employee.taxRate,
      default_payment_method: employee.defaultPaymentMethod,
      notes: employee.notes,
    })), periods: [], entries: [], debts: [], allocations: [], preview: true });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await authorize();
  if (gate) return gate;
  const db = dbOrError();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  try {
  // Штатный Excel разбирается на сервере (файл multipart), а не в браузере:
  // у любого сотрудника по одному файлу получается один и тот же справочник.
  // Здесь — только публичные поля; реквизиты и контакты грузит /api/payroll/private.
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData();
    if (text(form.get("action"), 40) !== "import_staff") return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Выберите файл «Сотрудники.xlsx»" }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Файл больше 10 МБ" }, { status: 413 });
    const preview = text(form.get("preview"), 5) === "1";
    const companies = await db.from("companies").select("id,name").eq("is_active", true);
    if (companies.error) return NextResponse.json({ error: companies.error.message }, { status: 500 });
    const parsed = staffFromGrid(xlsxGrid(Buffer.from(await file.arrayBuffer())), (companies.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name) })));
    if (!parsed.length) return NextResponse.json({ error: "В файле не найдено ни одного сотрудника (ФИО во второй колонке, две строки шапки)" }, { status: 400 });
    if (parsed.length > 500) return NextResponse.json({ error: "Слишком много строк" }, { status: 413 });
    const publicEmployees = parsed.map(publicStaffFields);
    if (preview) return NextResponse.json({ preview: true, employees: publicEmployees, created: 0, updated: 0 });
    const known = await db.from("payroll_employees").select("id,full_name").in("full_name", parsed.map((employee) => employee.fullName));
    if (known.error) return NextResponse.json({ error: known.error.message }, { status: 500 });
    const idByName = new Map((known.data ?? []).map((row) => [String(row.full_name), String(row.id)]));
    const now = new Date().toISOString();
    const rows = parsed.map((employee) => ({
      id: idByName.get(employee.fullName) ?? randomUUID(),
      full_name: employee.fullName,
      employment_status: employee.employmentStatus,
      employment_type: employee.employmentType,
      employment_details: employee.employmentDetails || null,
      hire_date: employee.hireDate,
      termination_date: employee.terminationDate,
      employer_name: employee.employerName || null,
      company_ids: employee.companyIds,
      company_id: employee.companyId,
      position: employee.position || null,
      project: employee.project || null,
      city: employee.city || null,
      monthly_salary: Math.max(0, money(employee.monthlySalary)),
      default_payment_method: employee.defaultPaymentMethod,
      notes: employee.notes || null,
      updated_at: now,
    }));
    const result = await db.from("payroll_employees").upsert(rows, { onConflict: "id" });
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    const created = rows.filter((row) => !idByName.has(row.full_name)).length;
    return NextResponse.json({ preview: false, employees: publicEmployees, created, updated: rows.length - created });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  const action = text(body.action, 40);

  if (action === "save_employee") {
    const source = body.employee && typeof body.employee === "object" ? body.employee as Record<string, unknown> : null;
    if (!source) return NextResponse.json({ error: "Не переданы данные сотрудника" }, { status: 400 });
    const fullName = text(source.fullName, 200);
    const employmentType = text(source.employmentType, 40) as PayrollEmploymentType;
    const employmentStatus = text(source.employmentStatus, 40) as PayrollEmploymentStatus;
    const paymentMethod = text(source.defaultPaymentMethod, 40) as PayrollPaymentMethod;
    const monthlySalary = money(source.monthlySalary);
    const taxRate = source.taxRate === null || source.taxRate === "" ? null : money(source.taxRate);
    if (!fullName || !EMPLOYMENT_TYPES.has(employmentType) || !EMPLOYMENT_STATUSES.has(employmentStatus) || !PAYMENT_METHODS.has(paymentMethod)) {
      return NextResponse.json({ error: "Проверьте ФИО, оформление и способ выплаты" }, { status: 400 });
    }
    if (monthlySalary < 0 || (taxRate !== null && (taxRate < 0 || taxRate > 100))) {
      return NextResponse.json({ error: "Сумма или ставка налога указана неверно" }, { status: 400 });
    }
    const selectedCompanyIds = Array.isArray(source.companyIds) ? [...new Set(source.companyIds.map((value) => nullableId(value)).filter((value): value is string => Boolean(value)))] : [];
    const companyId = selectedCompanyIds[0] ?? nullableId(source.companyId);
    const companyIds = selectedCompanyIds.length ? selectedCompanyIds : (companyId ? [companyId] : []);
    const row = {
      full_name: fullName,
      employment_status: employmentStatus,
      employment_type: employmentType,
      employment_details: text(source.employmentDetails, 500) || null,
      hire_date: nullableId(source.hireDate),
      termination_date: nullableId(source.terminationDate),
      employer_name: text(source.employerName, 200) || null,
      company_ids: companyIds,
      company_id: companyId,
      position: text(source.position, 200) || null,
      project: text(source.project, 200) || null,
      city: text(source.city, 120) || null,
      monthly_salary: monthlySalary,
      tax_rate: taxRate,
      default_payment_method: paymentMethod,
      notes: text(source.notes, 1000) || null,
      updated_at: new Date().toISOString(),
    };
    const id = nullableId(source.id);
    const result = id
      ? await db.from("payroll_employees").update(row).eq("id", id).select("*").single()
      : await db.from("payroll_employees").insert(row).select("*").single();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ employee: result.data });
  }

  if (action === "delete_employee") {
    const employeeId = nullableId(body.employeeId);
    if (!employeeId) return NextResponse.json({ error: "Не выбран сотрудник" }, { status: 400 });
    const [entries, debts, allocations] = await Promise.all([
      db.from("payroll_entries").select("id", { count: "exact", head: true }).eq("employee_id", employeeId),
      db.from("payroll_debt_openings").select("id", { count: "exact", head: true }).eq("employee_id", employeeId),
      db.from("payroll_payment_allocations").select("id", { count: "exact", head: true }).eq("employee_id", employeeId),
    ]);
    const historyError = entries.error ?? debts.error ?? allocations.error;
    if (historyError) return NextResponse.json({ error: historyError.message }, { status: 500 });
    if ((entries.count ?? 0) + (debts.count ?? 0) + (allocations.count ?? 0) > 0) {
      return NextResponse.json({ error: "Сотрудника нельзя удалить: по нему уже есть начисления, долги или оплаты. Поставьте статус «Уволен», чтобы сохранить финансовую историю." }, { status: 409 });
    }
    const result = await db.from("payroll_employees").delete().eq("id", employeeId).select("id").maybeSingle();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    if (!result.data) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (action === "import_employees") {
    const records = Array.isArray(body.records) ? body.records as Array<Record<string, unknown>> : [];
    if (!records.length || records.length > 500) return NextResponse.json({ error: "Файл не содержит сотрудников" }, { status: 400 });
    const names = records.map((record) => text(record.fullName, 200)).filter(Boolean);
    const known = await db.from("payroll_employees").select("id,full_name").in("full_name", names);
    if (known.error) return NextResponse.json({ error: known.error.message }, { status: 500 });
    const idByName = new Map((known.data ?? []).map((employee) => [String(employee.full_name), String(employee.id)]));
    const rows = records.flatMap((source) => {
      const id = idByName.get(text(source.fullName, 200));
      if (!id) return [];
      const employmentType = text(source.employmentType, 40) as PayrollEmploymentType;
      const paymentMethod = text(source.defaultPaymentMethod, 40) as PayrollPaymentMethod;
      if (!EMPLOYMENT_TYPES.has(employmentType) || !PAYMENT_METHODS.has(paymentMethod)) return [];
      const selectedCompanyIds = Array.isArray(source.companyIds) ? [...new Set(source.companyIds.map((value) => nullableId(value)).filter((value): value is string => Boolean(value)))] : [];
      const companyId = selectedCompanyIds[0] ?? nullableId(source.companyId);
      const companyIds = selectedCompanyIds.length ? selectedCompanyIds : (companyId ? [companyId] : []);
      return [{
        id,
        employment_type: employmentType,
        employment_details: text(source.employmentDetails, 500) || null,
        hire_date: nullableId(source.hireDate),
        termination_date: nullableId(source.terminationDate),
        employer_name: text(source.employerName, 200) || null,
        company_ids: companyIds,
        company_id: companyId,
        position: text(source.position, 200) || null,
        project: text(source.project, 200) || null,
        city: text(source.city, 120) || null,
        monthly_salary: Math.max(0, money(source.monthlySalary)),
        default_payment_method: paymentMethod,
        updated_at: new Date().toISOString(),
      }];
    });
    if (rows.length) {
      const result = await db.from("payroll_employees").upsert(rows, { onConflict: "id" });
      if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    return NextResponse.json({ updated: rows.length, skipped: records.length - rows.length });
  }

  if (action === "save_debt") {
    const employeeId = nullableId(body.employeeId);
    const debtYear = Number(body.debtYear);
    const amount = money(body.amount);
    if (!employeeId || !Number.isInteger(debtYear) || debtYear < 2000 || debtYear > 2100 || amount < 0) {
      return NextResponse.json({ error: "Проверьте сотрудника, год и сумму долга" }, { status: 400 });
    }
    const result = await db.from("payroll_debt_openings").upsert({
      employee_id: employeeId,
      debt_year: debtYear,
      amount,
      comment: text(body.comment, 1000) || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "employee_id,debt_year" }).select("*").single();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ debt: result.data });
  }

  if (action === "allocate_payment") {
    const paymentId = nullableId(body.paymentId);
    const employeeId = nullableId(body.employeeId);
    const entryId = nullableId(body.entryId);
    const payrollLineId = nullableId(body.payrollLineId);
    const debtOpeningId = nullableId(body.debtOpeningId);
    const allocationKind = text(body.allocationKind, 40);
    if (!paymentId || !employeeId || (payrollLineId && !entryId) || Number(Boolean(entryId)) + Number(Boolean(debtOpeningId)) !== 1
      || !["current_salary", "current_year_debt", "prior_year_debt"].includes(allocationKind)) {
      return NextResponse.json({ error: "Выберите сотрудника и одно начисление, которое закрывает платёж" }, { status: 400 });
    }
    const paymentResult = await db.from("payments").select("id,amount,status").eq("id", paymentId).single();
    if (paymentResult.error || paymentResult.data.status !== "done" || Number(paymentResult.data.amount) >= 0) {
      return NextResponse.json({ error: "Для распределения нужна проведённая расходная операция ДДС" }, { status: 400 });
    }
    const paymentAmount = Math.abs(money(paymentResult.data.amount));
    const amount = money(body.amount);
    if (amount <= 0 || amount > paymentAmount) {
      return NextResponse.json({ error: "Сумма распределения должна быть больше нуля и не превышать платёж ДДС" }, { status: 400 });
    }
    const targetResult = entryId
      ? await db.from("payroll_entries").select("id,employee_id,official_amount,unofficial_amount,contractor_amount,tax_amount,allocation_lines").eq("id", entryId).eq("employee_id", employeeId).single()
      : await db.from("payroll_debt_openings").select("id,employee_id,amount").eq("id", debtOpeningId!).eq("employee_id", employeeId).single();
    if (targetResult.error) return NextResponse.json({ error: "Выбранное начисление сотрудника не найдено" }, { status: 400 });
    const [paymentAllocations, targetAllocations] = await Promise.all([
      db.from("payroll_payment_allocations").select("amount").eq("payment_id", paymentId),
      entryId
        ? payrollLineId
          ? db.from("payroll_payment_allocations").select("amount").eq("entry_id", entryId).eq("payroll_line_id", payrollLineId)
          : db.from("payroll_payment_allocations").select("amount").eq("entry_id", entryId).is("payroll_line_id", null)
        : db.from("payroll_payment_allocations").select("amount").eq("debt_opening_id", debtOpeningId!),
    ]);
    if (paymentAllocations.error || targetAllocations.error) return NextResponse.json({ error: (paymentAllocations.error ?? targetAllocations.error)!.message }, { status: 500 });
    const paymentAllocated = money((paymentAllocations.data ?? []).reduce((sum, row) => sum + Number(row.amount), 0));
    const linkedPayments = await loadAllSupabasePages<{ id: string; comment: string | null }>(
      (from, to) => db.from("payments").select("id,comment").order("id").range(from, to),
      { label: "Проверка занятых фактов ДДС" },
    );
    if (!canAllocateFactToPayroll(paymentId, consumedFactIds(linkedPayments), paymentAllocated)) {
      return NextResponse.json({ error: "Этот факт ДДС уже закрывает другое обязательство в календаре или кредитах" }, { status: 409 });
    }
    if (paymentAllocated + amount > paymentAmount) {
      return NextResponse.json({ error: `По этому платежу можно распределить не больше ${money(paymentAmount - paymentAllocated)} ₽` }, { status: 400 });
    }
    const target = targetResult.data as Record<string, unknown>;
    const targetLines = Array.isArray(target.allocation_lines) ? target.allocation_lines as Array<Record<string, unknown>> : [];
    const targetLine = payrollLineId ? targetLines.find((line) => text(line.id, 80) === payrollLineId) : null;
    if (entryId && payrollLineId && !targetLine) {
      return NextResponse.json({ error: "Выбранная часть начисления не найдена" }, { status: 400 });
    }
    const targetTotal = entryId
      ? targetLine
        ? money(Number(targetLine.amount ?? 0) + Number(targetLine.taxAmount ?? 0))
        : money(Number(target.official_amount ?? 0) + Number(target.unofficial_amount ?? 0) + Number(target.contractor_amount ?? 0) + Number(target.tax_amount ?? 0))
      : money(target.amount);
    const targetAllocated = money((targetAllocations.data ?? []).reduce((sum, row) => sum + Number(row.amount), 0));
    if (targetAllocated + amount > targetTotal) {
      return NextResponse.json({ error: `По выбранному начислению осталось распределить ${money(targetTotal - targetAllocated)} ₽` }, { status: 400 });
    }
    const session = await getServerSession();
    const result = await db.from("payroll_payment_allocations").insert({
      payment_id: paymentId,
      employee_id: employeeId,
      entry_id: entryId,
      payroll_line_id: payrollLineId,
      debt_opening_id: debtOpeningId,
      amount,
      allocation_kind: allocationKind,
      comment: text(body.comment, 1000) || null,
      confirmed_by: session?.email ?? null,
      confirmed_at: new Date().toISOString(),
    }).select("*").single();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    try {
      const financeState = await loadFinanceStateServer();
      const fact = financeState.payments.find((payment) => payment.id === paymentId);
      if (!fact) throw new Error("Факт ДДС не найден в основном реестре");
      const action: FinanceAction = { type: "UPDATE_PAYMENT", payload: { ...fact, comment: appendPayrollFactMarker(fact.comment, paymentId) } };
      await persistFinanceActionServer(action, financeState, financeReducer(financeState, action));
    } catch (error) {
      await db.from("payroll_payment_allocations").delete().eq("id", result.data.id);
      throw error;
    }
    return NextResponse.json({ allocation: result.data });
  }

  if (action !== "save_period") return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  const payDate = text(body.payDate, 10);
  const range = payrollPeriodForDate(payDate);
  const inputEntries = Array.isArray(body.entries) ? body.entries as Array<Record<string, unknown>> : [];
  if (!range) return NextResponse.json({ error: "Дата выплаты должна быть 5-м или 20-м числом" }, { status: 400 });
  if (!inputEntries.length || inputEntries.length > 500) return NextResponse.json({ error: "Добавьте начисления сотрудников" }, { status: 400 });

  const employeeIds = [...new Set(inputEntries.map((entry) => text(entry.employeeId, 80)).filter(Boolean))];
  const employeeResult = await db.from("payroll_employees").select("*").in("id", employeeIds);
  if (employeeResult.error) return NextResponse.json({ error: employeeResult.error.message }, { status: 500 });
  const employees = new Map((employeeResult.data ?? []).map((row) => [String(row.id), row]));
  if (employees.size !== employeeIds.length) return NextResponse.json({ error: "Один из сотрудников не найден" }, { status: 400 });

  const periodResult = await db.from("payroll_periods").upsert({
    pay_date: payDate,
    period_start: range.periodStart,
    period_end: range.periodEnd,
    status: "planned",
    updated_at: new Date().toISOString(),
  }, { onConflict: "pay_date" }).select("*").single();
  if (periodResult.error) return NextResponse.json({ error: periodResult.error.message }, { status: 500 });
  const periodId = String(periodResult.data.id);
  const existingResult = await db.from("payroll_entries").select("*").eq("period_id", periodId);
  if (existingResult.error) return NextResponse.json({ error: existingResult.error.message }, { status: 500 });
  const existingByEmployee = new Map((existingResult.data ?? []).map((row) => [String(row.employee_id), row]));

  const now = new Date().toISOString();
  const entryRows = inputEntries.map((input) => {
    const employeeId = text(input.employeeId, 80);
    const employeeRow = employees.get(employeeId)!;
    const employee: PayrollEmployee = {
      id: employeeId,
      fullName: String(employeeRow.full_name),
      employmentStatus: employeeRow.employment_status === "terminated" ? "terminated" : "active",
      employmentType: employeeRow.employment_type as PayrollEmploymentType,
      employmentDetails: String(employeeRow.employment_details ?? ""),
      hireDate: employeeRow.hire_date,
      terminationDate: employeeRow.termination_date,
      employerName: String(employeeRow.employer_name ?? ""),
      companyIds: Array.isArray(employeeRow.company_ids) ? employeeRow.company_ids.map(String) : (employeeRow.company_id ? [String(employeeRow.company_id)] : []),
      companyId: employeeRow.company_id,
      position: String(employeeRow.position ?? ""),
      project: String(employeeRow.project ?? ""),
      city: String(employeeRow.city ?? ""),
      workEmail: "",
      birthDate: null,
      monthlySalary: Number(employeeRow.monthly_salary),
      taxRate: employeeRow.tax_rate == null ? null : Number(employeeRow.tax_rate),
      defaultPaymentMethod: employeeRow.default_payment_method as PayrollPaymentMethod,
      bankName: "",
      phone: "",
      settlementAccountDetails: "",
      cardTransferDetails: "",
      paymentDetails: "",
      paymentDetailsMasked: "",
      notes: String(employeeRow.notes ?? ""),
    };
    const paymentMethod = text(input.paymentMethod, 40) as PayrollPaymentMethod;
    if (!PAYMENT_METHODS.has(paymentMethod)) throw new Error("Некорректный способ выплаты");
    const existing = existingByEmployee.get(employeeId);
    const oldLines = Array.isArray(existing?.allocation_lines) ? existing.allocation_lines as Array<Record<string, unknown>> : [];
    const oldLineById = new Map(oldLines.map((line) => [text(line.id, 80), line]));
    const inputLines = Array.isArray(input.lines) ? input.lines as Array<Record<string, unknown>> : [];
    const normalizedLines: PayrollAccrualLine[] = inputLines.map((line) => {
      const id = nullableId(line.id) ?? crypto.randomUUID();
      const kind = text(line.kind, 24) as PayrollLineKind;
      const method = text(line.paymentMethod, 40) as PayrollPaymentMethod;
      const amount = money(line.amount);
      const requestedTax = money(line.taxAmount);
      if (!LINE_KINDS.has(kind) || !PAYMENT_METHODS.has(method) || amount < 0 || requestedTax < 0) throw new Error(`Проверьте строки начисления сотрудника ${employee.fullName}`);
      const accountId = nullableId(line.accountId);
      const companyId = nullableId(line.companyId);
      if (amount + requestedTax > 0 && (!companyId || !accountId)) throw new Error(`Выберите компанию и кошелёк для строки сотрудника ${employee.fullName}`);
      const taxAmount = payrollLineTaxIsPayable(employee, { kind, paymentMethod: method }) ? requestedTax : 0;
      const previous = oldLineById.get(id);
      return {
        id,
        kind,
        amount,
        taxAmount,
        companyId,
        accountId,
        paymentMethod: method,
        salaryPaymentId: amount > 0 ? nullableId(previous?.salaryPaymentId) ?? crypto.randomUUID() : null,
        taxPaymentId: taxAmount > 0 ? nullableId(previous?.taxPaymentId) ?? crypto.randomUUID() : null,
        comment: text(line.comment, 500),
      };
    });
    const draft: PayrollDraftEntry = {
      employeeId,
      officialAmount: money(normalizedLines.filter((line) => line.kind === "official").reduce((sum, line) => sum + line.amount, 0)),
      unofficialAmount: money(normalizedLines.filter((line) => line.kind === "unofficial").reduce((sum, line) => sum + line.amount, 0)),
      contractorAmount: money(normalizedLines.filter((line) => line.kind === "contractor").reduce((sum, line) => sum + line.amount, 0)),
      taxAmount: money(normalizedLines.reduce((sum, line) => sum + line.taxAmount, 0)),
      paymentMethod,
      companyId: nullableId(input.companyId),
      accountId: nullableId(input.accountId),
      comment: text(input.comment, 1000),
      lines: normalizedLines,
    };
    if ([draft.officialAmount, draft.unofficialAmount, draft.contractorAmount, draft.taxAmount].some((amount) => amount < 0)) {
      throw new Error("Начисления не могут быть отрицательными");
    }
    const salaryAmount = payrollSalaryAmount(draft);
    const taxAmount = payrollTaxAmount(employee, draft);
    const firstLine = normalizedLines.find((line) => line.amount + line.taxAmount > 0) ?? normalizedLines[0];
    return {
      id: existing?.id ?? crypto.randomUUID(),
      period_id: periodId,
      employee_id: employeeId,
      official_amount: draft.officialAmount,
      unofficial_amount: draft.unofficialAmount,
      contractor_amount: draft.contractorAmount,
      tax_amount: taxAmount,
      payment_method: firstLine?.paymentMethod ?? paymentMethod,
      company_id: firstLine?.companyId ?? draft.companyId,
      account_id: firstLine?.accountId ?? draft.accountId,
      salary_payment_id: firstLine?.salaryPaymentId ?? null,
      tax_payment_id: firstLine?.taxPaymentId ?? null,
      allocation_lines: normalizedLines,
      comment: draft.comment || null,
      updated_at: now,
      employee,
      salaryAmount,
      effectiveTaxAmount: taxAmount,
    };
  });

  const savedEntries = await db.from("payroll_entries").upsert(entryRows.map(({ employee: _employee, salaryAmount: _salary, effectiveTaxAmount: _tax, ...row }) => row), { onConflict: "period_id,employee_id" });
  if (savedEntries.error) return NextResponse.json({ error: savedEntries.error.message }, { status: 500 });

  const paymentIds = entryRows.flatMap((entry) => entry.allocation_lines.flatMap((line) => [line.salaryPaymentId, line.taxPaymentId])).filter((id): id is string => Boolean(id));
  const financeState = await loadFinanceStateServer();
  const existingPaymentById = new Map(financeState.payments.map((payment) => [payment.id, payment]));
  const calendarStatus = (paymentId: string) => {
    const existing = existingPaymentById.get(paymentId);
    return existing?.status === "done" || (existing?.status === "cancelled" && String(existing.comment ?? "").includes("[calendar-fact:")) ? existing.status : "planned";
  };
  const paymentRows: Payment[] = entryRows.flatMap((entry) => {
    return entry.allocation_lines.flatMap((line) => {
      const kindLabel = line.kind === "official" ? "официальная часть" : line.kind === "unofficial" ? "неофициальная часть" : "выплата по договору";
      const common = { accountId: line.accountId!, companyId: line.companyId, date: payDate };
      const salaryCategory = PAYROLL_CATEGORIES[payrollCategoryForEmployee(entry.employee.position)];
      const commentWithMarkers = (paymentId: string, generated: string) => {
        const markers = preservedLoanMarkers(existingPaymentById.get(paymentId)?.comment);
        return `${generated} ${markers}`.trim();
      };
      const salary = line.amount > 0 && line.salaryPaymentId ? [{
        id: line.salaryPaymentId,
        name: `Зарплата — ${entry.employee.fullName}`,
        amount: -line.amount,
        category: salaryCategory,
        counterparty: entry.employee.fullName,
        comment: commentWithMarkers(line.salaryPaymentId, `[payroll:${entry.id}] [payroll-line:${line.id}] [payroll-period:${periodId}] ${range.periodStart}—${range.periodEnd}; ${kindLabel}${line.comment ? `; ${line.comment}` : ""}`),
        status: calendarStatus(line.salaryPaymentId!),
        ...common,
      } satisfies Payment] : [];
      const tax = line.taxAmount > 0 && line.taxPaymentId ? [{
        id: line.taxPaymentId,
        name: `Налог с выплаты — ${entry.employee.fullName}`,
        amount: -line.taxAmount,
        category: PAYROLL_CATEGORIES.tax,
        counterparty: "ФНС",
        comment: commentWithMarkers(line.taxPaymentId, `[payroll:${entry.id}] [payroll-line:${line.id}] [payroll-period:${periodId}] Налог по выплате ${entry.employee.fullName}; ${range.periodStart}—${range.periodEnd}; ${kindLabel}`),
        status: calendarStatus(line.taxPaymentId!),
        ...common,
      } satisfies Payment] : [];
      return [...salary, ...tax];
    });
  });
  const activePaymentIds = new Set(paymentIds);
  const obsoletePaymentIds = (existingResult.data ?? []).flatMap((entry) => {
    const lines = Array.isArray(entry.allocation_lines) ? entry.allocation_lines as Array<Record<string, unknown>> : [];
    return lines.flatMap((line) => [nullableId(line.salaryPaymentId), nullableId(line.taxPaymentId)]);
  }).filter((id): id is string => id !== null && !activePaymentIds.has(id));
  const actions: FinanceAction[] = paymentRows.map((payment) => existingPaymentById.has(payment.id)
    ? { type: "UPDATE_PAYMENT", payload: payment }
    : { type: "ADD_PAYMENT", payload: payment });
  for (const paymentId of obsoletePaymentIds) {
    const existing = existingPaymentById.get(paymentId);
    if (existing?.status === "planned") actions.push({ type: "UPDATE_PAYMENT", payload: { ...existing, status: "cancelled" } });
  }
  await persistFinanceActions(actions);
  return NextResponse.json({ ok: true, periodId, calendarPayments: paymentRows.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить зарплатную ведомость" }, { status: 400 });
  }
}
