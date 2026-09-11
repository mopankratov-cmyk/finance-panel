import { NextRequest, NextResponse } from "next/server";
import {
  aggregateDdsMonthlyFacts,
  aggregatePayrollMonthlyFacts,
  mergeMonthlySharedFacts,
  type DdsFactRow,
  type MonthlySharedFact,
  type PayrollEmployeeFact,
  type PayrollEntryFact,
  type PayrollPeriodFact,
} from "@/lib/opiu/monthlyFacts";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const warnings: string[] = [];
  let ddsFacts: Record<string, MonthlySharedFact> = {};
  let payrollFacts: Record<string, MonthlySharedFact> = {};

  try {
    const payments = await loadAllSupabasePages<DdsFactRow>((pageFrom, pageTo) => db
      .from("payments")
      .select("amount,category,comment,date,id")
      .eq("status", "done")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(pageFrom, pageTo), { label: "ОПиУ: подтверждённые расходы ДДС", maxPages: 100 });
    ddsFacts = aggregateDdsMonthlyFacts(payments);
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
    const periods: PayrollPeriodFact[] = periodsRaw.map((row) => ({
      id: String(row.id),
      periodStart: String(row.period_start).slice(0, 10),
      periodEnd: String(row.period_end).slice(0, 10),
    }));
    const periodIds = periods.map((period) => period.id);
    let entries: PayrollEntryFact[] = [];
    let employees: PayrollEmployeeFact[] = [];
    if (periodIds.length) {
      const entriesRaw = await loadAllSupabasePages<Record<string, unknown>>((pageFrom, pageTo) => db
        .from("payroll_entries")
        .select("id,period_id,employee_id,official_amount,unofficial_amount,contractor_amount,tax_amount,allocation_lines")
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
        lines: Array.isArray(row.allocation_lines) ? row.allocation_lines as Array<{ amount?: number }> : null,
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
    payrollFacts = aggregatePayrollMonthlyFacts({ periods, entries, employees, from, to });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить зарплатную ведомость";
    console.error("[monthly opiu] payroll facts:", message);
    warnings.push(`ФОТ: ${message}`);
  }

  return NextResponse.json({
    period: { from, to, month },
    shared: mergeMonthlySharedFacts(ddsFacts, payrollFacts),
    warnings,
  });
}
