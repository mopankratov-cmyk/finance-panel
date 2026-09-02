import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AccountRow = { id: string; name: string; type: string; currency: string; balance: number };
type PaymentRow = { id: string; name: string; amount: number; type: "income" | "expense"; category: string; account_id: string; date: string; status: string; counterparty: string; comment: string | null; company_id: string | null; import_source: string | null };
type CompanyUpdate = { paymentId: string; companyId: string };
type ImportPlanBody = {
  accountRows?: AccountRow[];
  newPaymentRows?: PaymentRow[];
  suspectedRows?: Array<{ row: PaymentRow }>;
  companyUpdates?: CompanyUpdate[];
  duplicatePayments?: number;
};

const DEMO_ACCOUNT_NAMES = ["WB Счёт 1", "WB Счёт 2", "Ozon", "Банковский счёт", "Наличные"];

async function authorize() {
  return requireApiSession(["director", "finance"]);
}

function validUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

async function insertChunked(table: "accounts" | "payments", rows: object[], size: number) {
  const db = getSupabaseAdmin()!;
  let inserted = 0;
  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size);
    const result = table === "payments"
      ? await db.from(table).upsert(chunk, { onConflict: "import_source", ignoreDuplicates: true }).select("id")
      : await db.from(table).insert(chunk).select("id");
    if (result.error) throw new Error(`Ошибка «${table}», строки ${index + 1}–${index + chunk.length}: ${result.error.message}`);
    inserted += result.data?.length ?? 0;
  }
  return inserted;
}

export async function GET() {
  const gate = await authorize();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  try {
    const [accounts, payments] = await Promise.all([
      db.from("accounts").select("id,name").order("name"),
      loadAllSupabasePages<{ id: string; name: string; amount: number; category: string; account_id: string; date: string; company_id: string | null }>((from, to) => db
        .from("payments")
        .select("id,name,amount,category,account_id,date,company_id")
        .order("id", { ascending: true })
        .range(from, to), { label: "Платежи для проверки импорта" }),
    ]);
    if (accounts.error) throw new Error(accounts.error.message);
    return NextResponse.json({ accounts: accounts.data ?? [], payments });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось проверить импорт" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await authorize();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = await request.json().catch(() => ({})) as { plan?: ImportPlanBody; accepted_suspected_ids?: string[] };
  const plan = body.plan ?? {};
  const accountRows = Array.isArray(plan.accountRows) ? plan.accountRows : [];
  const newPaymentRows = Array.isArray(plan.newPaymentRows) ? plan.newPaymentRows : [];
  const suspectedRows = Array.isArray(plan.suspectedRows) ? plan.suspectedRows : [];
  const companyUpdates = Array.isArray(plan.companyUpdates) ? plan.companyUpdates : [];
  if (accountRows.length > 5_000 || newPaymentRows.length + suspectedRows.length > 100_000 || companyUpdates.length > 100_000) {
    return NextResponse.json({ error: "Импорт превышает безопасный размер" }, { status: 413 });
  }
  if (accountRows.some((row) => !validUuid(row.id)) || newPaymentRows.some((row) => !validUuid(row.id))) {
    return NextResponse.json({ error: "В импорте есть некорректные идентификаторы" }, { status: 400 });
  }
  const accepted = new Set((body.accepted_suspected_ids ?? []).filter(validUuid));
  const acceptedRows = suspectedRows.filter((entry) => validUuid(entry?.row?.id) && accepted.has(entry.row.id)).map((entry) => entry.row);
  try {
    const accountsCreated = await insertChunked("accounts", accountRows, 100);
    for (let index = 0; index < companyUpdates.length; index += 100) {
      const byCompany = new Map<string, string[]>();
      for (const update of companyUpdates.slice(index, index + 100)) {
        if (!validUuid(update.paymentId) || !validUuid(update.companyId)) continue;
        byCompany.set(update.companyId, [...(byCompany.get(update.companyId) ?? []), update.paymentId]);
      }
      for (const [companyId, ids] of byCompany) {
        const result = await db.from("payments").update({ company_id: companyId }).in("id", ids);
        if (result.error) throw new Error(`Не удалось назначить компанию платежам: ${result.error.message}`);
      }
    }
    const paymentsCreated = await insertChunked("payments", [...newPaymentRows, ...acceptedRows], 500);
    return NextResponse.json({
      accountsCreated,
      paymentsCreated,
      companiesAssigned: companyUpdates.length,
      duplicatesSkipped: Number(plan.duplicatePayments ?? 0),
      suspectedSkipped: suspectedRows.length - acceptedRows.length,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось выполнить импорт" }, { status: 500 });
  }
}

export async function DELETE() {
  const gate = await authorize();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const accounts = await db.from("accounts").select("id").in("name", DEMO_ACCOUNT_NAMES);
  if (accounts.error) return NextResponse.json({ error: accounts.error.message }, { status: 500 });
  const ids = (accounts.data ?? []).map((row) => String(row.id));
  if (!ids.length) return NextResponse.json({ accountsDeleted: 0, paymentsDeleted: 0, accountsKept: 0 });
  // Импорт переиспользует счета по имени, поэтому на «Наличных» или «Банковском
  // счёте» могут лежать боевые платежи. Демо — только то, что не пришло из файла
  // или выписки и не привязано к компании; раньше удалялось всё на этих счетах.
  const demoPayments = await db.from("payments").select("id").in("account_id", ids).is("import_source", null).is("company_id", null);
  if (demoPayments.error) return NextResponse.json({ error: demoPayments.error.message }, { status: 500 });
  const demoIds = (demoPayments.data ?? []).map((row) => String(row.id));
  if (demoIds.length) {
    const paymentsDelete = await db.from("payments").delete().in("id", demoIds);
    if (paymentsDelete.error) return NextResponse.json({ error: paymentsDelete.error.message }, { status: 500 });
  }
  // Счёт удаляем, только если на нём не осталось ни одного платежа.
  const deletable: string[] = [];
  for (const id of ids) {
    const rest = await db.from("payments").select("id").eq("account_id", id).limit(1);
    if (rest.error) return NextResponse.json({ error: rest.error.message }, { status: 500 });
    if (!(rest.data ?? []).length) deletable.push(id);
  }
  if (deletable.length) {
    const accountsDelete = await db.from("accounts").delete().in("id", deletable);
    if (accountsDelete.error) return NextResponse.json({ error: accountsDelete.error.message }, { status: 500 });
  }
  return NextResponse.json({ accountsDeleted: deletable.length, paymentsDeleted: demoIds.length, accountsKept: ids.length - deletable.length });
}
