import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { cashoutKind, isCashoutCompanyName, type CashoutKind } from "@/lib/finance/cashout";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

type CompanyRow = { id: string; name: string };
type PaymentRow = {
  id: string;
  date: string;
  name: string;
  amount: number | string;
  company_id: string | null;
  counterparty: string | null;
  comment: string | null;
  import_source: string | null;
};
type CashoutReviewRow = {
  id: string;
  date: string;
  amount: number | string;
  company_id: string | null;
  counterparty: string | null;
  purpose: string | null;
  reasons: unknown;
  status: string;
};

type Operation = {
  id: string;
  date: string;
  purpose: string;
  counterparty: string;
  amount: number;
  kind: CashoutKind;
};

const round = (value: number) => Math.round(value * 100) / 100;

export async function GET(request: NextRequest) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to) || from > to || from.slice(0, 4) !== to.slice(0, 4)) {
    return NextResponse.json({ error: "Для раздела «Движение наличных» укажите корректный период в пределах одного года" }, { status: 400 });
  }

  try {
    const companyResult = await db.from("companies").select("id,name").order("name");
    if (companyResult.error) throw new Error(companyResult.error.message);
    const companies = ((companyResult.data ?? []) as CompanyRow[]).filter((company) => isCashoutCompanyName(company.name));
    const companyIds = companies.map((company) => company.id);
    if (!companyIds.length) return NextResponse.json({ from, to, companies: [] });

    const [rows, reviewRows] = await Promise.all([
      loadAllSupabasePages<PaymentRow>((pageFrom, pageTo) => db
        .from("payments")
        .select("id,date,name,amount,company_id,counterparty,comment,import_source")
        .in("company_id", companyIds)
        .eq("status", "done")
        .neq("amount", 0)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(pageFrom, pageTo), { label: "Операции раздела Обнал", maxPages: 60 }),
      loadAllSupabasePages<CashoutReviewRow>((pageFrom, pageTo) => db
        .from("bank_review_items")
        .select("id,date,amount,company_id,counterparty,purpose,reasons,status")
        .in("company_id", companyIds)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(pageFrom, pageTo), { label: "Операции Обнала из выписок", maxPages: 60 }),
    ]);

    const byCompany = new Map<string, Operation[]>();
    for (const row of rows) {
      if (!row.company_id) continue;
      const candidate = {
        amount: Number(row.amount),
        name: row.name ?? "",
        counterparty: row.counterparty ?? "",
        comment: row.comment ?? "",
        importSource: row.import_source,
      };
      const kind = cashoutKind(candidate);
      if (!kind) continue;
      const operation: Operation = {
        id: row.id,
        date: row.date,
        purpose: row.name || "Операция по выписке",
        counterparty: row.counterparty ?? "",
        amount: round(Math.abs(Number(row.amount))),
        kind,
      };
      byCompany.set(row.company_id, [...(byCompany.get(row.company_id) ?? []), operation]);
    }
    for (const row of reviewRows) {
      // Маркер импорта важнее статуса очереди: подтверждённые строки
      // банковской выписки не должны исчезать из «Обнала». Отклонённые
      // строки по-прежнему не показываем.
      if (row.status === "rejected" || !row.company_id || !Array.isArray(row.reasons) || !row.reasons.map(String).includes("__cashout_import")) continue;
      const candidate = { amount: Number(row.amount), name: row.purpose ?? "", counterparty: row.counterparty ?? "", comment: "", importSource: "bank-review:cashout" };
      const kind = cashoutKind(candidate);
      if (!kind) continue;
      const operation: Operation = { id: row.id, date: row.date, purpose: row.purpose || "Операция по выписке", counterparty: row.counterparty ?? "", amount: round(Math.abs(Number(row.amount))), kind };
      byCompany.set(row.company_id, [...(byCompany.get(row.company_id) ?? []), operation]);
    }

    return NextResponse.json({
      from,
      to,
      companies: companies.map((company) => {
        const operations = byCompany.get(company.id) ?? [];
        const grouped = new Map<string, Operation[]>();
        for (const operation of operations) {
          const month = operation.date.slice(0, 7);
          grouped.set(month, [...(grouped.get(month) ?? []), operation]);
        }
        const months = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, monthOperations]) => ({
          month,
          withdrawn: round(monthOperations.filter((operation) => operation.kind !== "atm_deposit").reduce((sum, operation) => sum + operation.amount, 0)),
          deposited: round(monthOperations.filter((operation) => operation.kind === "atm_deposit").reduce((sum, operation) => sum + operation.amount, 0)),
          total: round(monthOperations.reduce((sum, operation) => sum + (operation.kind === "atm_deposit" ? -operation.amount : operation.amount), 0)),
          count: monthOperations.length,
          byKind: {
            atm: round(monthOperations.filter((operation) => operation.kind === "atm").reduce((sum, operation) => sum + operation.amount, 0)),
            individual: round(monthOperations.filter((operation) => operation.kind === "individual").reduce((sum, operation) => sum + operation.amount, 0)),
            sbp: round(monthOperations.filter((operation) => operation.kind === "sbp").reduce((sum, operation) => sum + operation.amount, 0)),
            atm_deposit: round(monthOperations.filter((operation) => operation.kind === "atm_deposit").reduce((sum, operation) => sum + operation.amount, 0)),
          },
          operations: monthOperations.sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id)),
        }));
        return {
          id: company.id,
          name: company.name,
          withdrawn: round(months.reduce((sum, month) => sum + month.withdrawn, 0)),
          deposited: round(months.reduce((sum, month) => sum + month.deposited, 0)),
          total: round(months.reduce((sum, month) => sum + month.total, 0)),
          months,
        };
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось собрать операции" }, { status: 500 });
  }
}
