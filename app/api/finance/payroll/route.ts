import { NextRequest, NextResponse } from "next/server";
import { payrollPeriodForDate, payrollSalaryAmount, payrollTaxAmount, type PayrollDraftEntry, type PayrollEmployee, type PayrollEmploymentStatus, type PayrollEmploymentType, type PayrollPaymentMethod } from "@/components/payments/payroll";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { PAYROLL_PREVIEW_EMPLOYEES } from "@/components/payments/payrollPreview";

export const dynamic = "force-dynamic";

const EMPLOYMENT_TYPES = new Set<PayrollEmploymentType>(["official", "unofficial", "partial", "individual_entrepreneur", "self_employed"]);
const EMPLOYMENT_STATUSES = new Set<PayrollEmploymentStatus>(["active", "terminated"]);
const PAYMENT_METHODS = new Set<PayrollPaymentMethod>(["card", "bank_account", "cash"]);

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

export async function GET() {
  const gate = await authorize();
  if (gate) return gate;
  const db = dbOrError();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const [employees, periods, entries, debts, allocations] = await Promise.all([
    db.from("payroll_employees").select("*").order("full_name"),
    db.from("payroll_periods").select("*").order("pay_date", { ascending: false }),
    db.from("payroll_entries").select("*").order("created_at"),
    db.from("payroll_debt_openings").select("*").order("debt_year", { ascending: false }),
    db.from("payroll_payment_allocations").select("*").order("confirmed_at", { ascending: false }),
  ]);
  const firstError = employees.error ?? periods.error ?? entries.error ?? debts.error ?? allocations.error;
  if (firstError) {
    const missing = /does not exist|schema cache/i.test(firstError.message);
    if (missing) return NextResponse.json({ employees: PAYROLL_PREVIEW_EMPLOYEES.map((employee) => ({
      id: employee.id,
      full_name: employee.fullName,
      employment_status: employee.employmentStatus,
      employment_type: employee.employmentType,
      hire_date: employee.hireDate,
      termination_date: employee.terminationDate,
      employer_name: employee.employerName,
      company_id: employee.companyId,
      position: employee.position,
      project: employee.project,
      city: employee.city,
      monthly_salary: employee.monthlySalary,
      tax_rate: employee.taxRate,
      default_payment_method: employee.defaultPaymentMethod,
      bank_name: employee.bankName,
      phone: employee.phone,
      payment_details: employee.paymentDetails,
      payment_details_masked: employee.paymentDetailsMasked,
      notes: employee.notes,
    })), periods: [], entries: [], debts: [], allocations: [], preview: true });
    return NextResponse.json({ error: missing ? "Таблицы зарплатной ведомости ещё не созданы" : firstError.message }, { status: missing ? 503 : 500 });
  }
  return NextResponse.json({ employees: employees.data ?? [], periods: periods.data ?? [], entries: entries.data ?? [], debts: debts.data ?? [], allocations: allocations.data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await authorize();
  if (gate) return gate;
  const db = dbOrError();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  try {
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
    const row = {
      full_name: fullName,
      employment_status: employmentStatus,
      employment_type: employmentType,
      hire_date: nullableId(source.hireDate),
      termination_date: nullableId(source.terminationDate),
      employer_name: text(source.employerName, 200) || null,
      company_id: nullableId(source.companyId),
      position: text(source.position, 200) || null,
      project: text(source.project, 200) || null,
      city: text(source.city, 120) || null,
      monthly_salary: monthlySalary,
      tax_rate: taxRate,
      default_payment_method: paymentMethod,
      bank_name: text(source.bankName, 120) || null,
      phone: text(source.phone, 120) || null,
      payment_details: text(source.paymentDetails, 1000) || null,
      payment_details_masked: text(source.paymentDetailsMasked, 200) || null,
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

  if (action === "import_requisites") {
    const records = Array.isArray(body.records) ? body.records as Array<Record<string, unknown>> : [];
    if (!records.length || records.length > 500) return NextResponse.json({ error: "Файл не содержит реквизитов сотрудников" }, { status: 400 });
    let updated = 0;
    for (const source of records) {
      const fullName = text(source.fullName, 200);
      if (!fullName) continue;
      const result = await db.from("payroll_employees").update({
        bank_name: text(source.bankName, 120) || null,
        phone: text(source.phone, 120) || null,
        payment_details: text(source.paymentDetails, 1000) || null,
        updated_at: new Date().toISOString(),
      }).eq("full_name", fullName).select("id");
      if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
      updated += result.data?.length ?? 0;
    }
    return NextResponse.json({ updated });
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
    const debtOpeningId = nullableId(body.debtOpeningId);
    const allocationKind = text(body.allocationKind, 40);
    if (!paymentId || !employeeId || Number(Boolean(entryId)) + Number(Boolean(debtOpeningId)) !== 1
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
      ? await db.from("payroll_entries").select("id,employee_id,official_amount,unofficial_amount,contractor_amount,tax_amount").eq("id", entryId).eq("employee_id", employeeId).single()
      : await db.from("payroll_debt_openings").select("id,employee_id,amount").eq("id", debtOpeningId!).eq("employee_id", employeeId).single();
    if (targetResult.error) return NextResponse.json({ error: "Выбранное начисление сотрудника не найдено" }, { status: 400 });
    const [paymentAllocations, targetAllocations] = await Promise.all([
      db.from("payroll_payment_allocations").select("amount").eq("payment_id", paymentId),
      entryId
        ? db.from("payroll_payment_allocations").select("amount").eq("entry_id", entryId)
        : db.from("payroll_payment_allocations").select("amount").eq("debt_opening_id", debtOpeningId!),
    ]);
    if (paymentAllocations.error || targetAllocations.error) return NextResponse.json({ error: (paymentAllocations.error ?? targetAllocations.error)!.message }, { status: 500 });
    const paymentAllocated = money((paymentAllocations.data ?? []).reduce((sum, row) => sum + Number(row.amount), 0));
    if (paymentAllocated + amount > paymentAmount) {
      return NextResponse.json({ error: `По этому платежу можно распределить не больше ${money(paymentAmount - paymentAllocated)} ₽` }, { status: 400 });
    }
    const target = targetResult.data as Record<string, unknown>;
    const targetTotal = entryId
      ? money(Number(target.official_amount ?? 0) + Number(target.unofficial_amount ?? 0) + Number(target.contractor_amount ?? 0) + Number(target.tax_amount ?? 0))
      : money(target.amount);
    const targetAllocated = money((targetAllocations.data ?? []).reduce((sum, row) => sum + Number(row.amount), 0));
    if (targetAllocated + amount > targetTotal) {
      return NextResponse.json({ error: `По выбранному начислению осталось распределить ${money(targetTotal - targetAllocated)} ₽` }, { status: 400 });
    }
    const result = await db.from("payroll_payment_allocations").insert({
      payment_id: paymentId,
      employee_id: employeeId,
      entry_id: entryId,
      debt_opening_id: debtOpeningId,
      amount,
      allocation_kind: allocationKind,
      comment: text(body.comment, 1000) || null,
      confirmed_at: new Date().toISOString(),
    }).select("*").single();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
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
      hireDate: employeeRow.hire_date,
      terminationDate: employeeRow.termination_date,
      employerName: String(employeeRow.employer_name ?? ""),
      companyId: employeeRow.company_id,
      position: String(employeeRow.position ?? ""),
      project: String(employeeRow.project ?? ""),
      city: String(employeeRow.city ?? ""),
      monthlySalary: Number(employeeRow.monthly_salary),
      taxRate: employeeRow.tax_rate == null ? null : Number(employeeRow.tax_rate),
      defaultPaymentMethod: employeeRow.default_payment_method as PayrollPaymentMethod,
      bankName: String(employeeRow.bank_name ?? ""),
      phone: String(employeeRow.phone ?? ""),
      paymentDetails: String(employeeRow.payment_details ?? ""),
      paymentDetailsMasked: String(employeeRow.payment_details_masked ?? ""),
      notes: String(employeeRow.notes ?? ""),
    };
    const paymentMethod = text(input.paymentMethod, 40) as PayrollPaymentMethod;
    if (!PAYMENT_METHODS.has(paymentMethod)) throw new Error("Некорректный способ выплаты");
    const draft: PayrollDraftEntry = {
      employeeId,
      officialAmount: money(input.officialAmount),
      unofficialAmount: money(input.unofficialAmount),
      contractorAmount: money(input.contractorAmount),
      taxAmount: money(input.taxAmount),
      paymentMethod,
      companyId: nullableId(input.companyId),
      accountId: nullableId(input.accountId),
      comment: text(input.comment, 1000),
    };
    if ([draft.officialAmount, draft.unofficialAmount, draft.contractorAmount, draft.taxAmount].some((amount) => amount < 0)) {
      throw new Error("Начисления не могут быть отрицательными");
    }
    const salaryAmount = payrollSalaryAmount(draft);
    const taxAmount = payrollTaxAmount(employee, draft);
    if (salaryAmount + taxAmount > 0 && !draft.accountId) throw new Error(`Выберите кошелёк для сотрудника ${employee.fullName}`);
    const existing = existingByEmployee.get(employeeId);
    return {
      id: existing?.id ?? crypto.randomUUID(),
      period_id: periodId,
      employee_id: employeeId,
      official_amount: draft.officialAmount,
      unofficial_amount: draft.unofficialAmount,
      contractor_amount: draft.contractorAmount,
      tax_amount: taxAmount,
      payment_method: paymentMethod,
      company_id: draft.companyId,
      account_id: draft.accountId,
      salary_payment_id: existing?.salary_payment_id ?? (salaryAmount > 0 ? crypto.randomUUID() : null),
      tax_payment_id: existing?.tax_payment_id ?? (taxAmount > 0 ? crypto.randomUUID() : null),
      comment: draft.comment || null,
      updated_at: now,
      employee,
      salaryAmount,
      effectiveTaxAmount: taxAmount,
    };
  });

  const savedEntries = await db.from("payroll_entries").upsert(entryRows.map(({ employee: _employee, salaryAmount: _salary, effectiveTaxAmount: _tax, ...row }) => row), { onConflict: "period_id,employee_id" });
  if (savedEntries.error) return NextResponse.json({ error: savedEntries.error.message }, { status: 500 });

  const paymentIds = entryRows.flatMap((entry) => [entry.salary_payment_id, entry.tax_payment_id]).filter((id): id is string => Boolean(id));
  const existingPaymentsResult = paymentIds.length
    ? await db.from("payments").select("id,status,comment").in("id", paymentIds)
    : { data: [], error: null };
  if (existingPaymentsResult.error) return NextResponse.json({ error: existingPaymentsResult.error.message }, { status: 500 });
  const existingPaymentStatus = new Map((existingPaymentsResult.data ?? []).map((row) => [String(row.id), {
    status: String(row.status),
    linkedToFact: String(row.comment ?? "").includes("[calendar-fact:"),
  }]));
  const calendarStatus = (paymentId: string) => {
    const existing = existingPaymentStatus.get(paymentId);
    return existing?.status === "done" || (existing?.status === "cancelled" && existing.linkedToFact) ? existing.status : "planned";
  };
  const paymentRows = entryRows.flatMap((entry) => {
    const common = {
      account_id: entry.account_id,
      date: payDate,
      company_id: entry.company_id,
    };
    const breakdown = `официальная ${entry.official_amount}; неофициальная ${entry.unofficial_amount}; по договору ${entry.contractor_amount}`;
    const salary = entry.salaryAmount > 0 && entry.salary_payment_id ? [{
      id: entry.salary_payment_id,
      name: `Зарплата — ${entry.employee.fullName}`,
      amount: -entry.salaryAmount,
      type: "expense",
      category: "Зарплата",
      counterparty: entry.employee.fullName,
      comment: `[payroll-entry:${entry.id}] [payroll-period:${periodId}] ${range.periodStart}—${range.periodEnd}; ${breakdown}${entry.comment ? `; ${entry.comment}` : ""}`,
      status: calendarStatus(entry.salary_payment_id),
      ...common,
    }] : [];
    const tax = entry.effectiveTaxAmount > 0 && entry.tax_payment_id ? [{
      id: entry.tax_payment_id,
      name: `Налог с выплаты — ${entry.employee.fullName}`,
      amount: -entry.effectiveTaxAmount,
      type: "expense",
      category: "Налоги",
      counterparty: "ФНС",
      comment: `[payroll-entry:${entry.id}] [payroll-period:${periodId}] Налог по выплате ${entry.employee.fullName}; ${range.periodStart}—${range.periodEnd}`,
      status: calendarStatus(entry.tax_payment_id),
      ...common,
    }] : [];
    return [...salary, ...tax];
  });
  if (paymentRows.length) {
    const paymentsResult = await db.from("payments").upsert(paymentRows, { onConflict: "id" });
    if (paymentsResult.error) return NextResponse.json({ error: paymentsResult.error.message }, { status: 500 });
  }
  const obsoletePaymentIds = entryRows.flatMap((entry) => [
    entry.salaryAmount === 0 ? entry.salary_payment_id : null,
    entry.effectiveTaxAmount === 0 ? entry.tax_payment_id : null,
  ]).filter((id): id is string => Boolean(id));
  if (obsoletePaymentIds.length) {
    const cancelled = await db.from("payments").update({ status: "cancelled" }).in("id", obsoletePaymentIds).eq("status", "planned");
    if (cancelled.error) return NextResponse.json({ error: cancelled.error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, periodId, calendarPayments: paymentRows.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить зарплатную ведомость" }, { status: 400 });
  }
}
