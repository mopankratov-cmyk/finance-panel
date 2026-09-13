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

async function authorize() {
  return requireApiSession(["director", "fin_director", "financier"]);
}

function validUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

// Функции ещё нет (миграция 202609130007 не накатана) — прежний
// нетранзакционный путь как безопасный фолбэк. Тот же список кодов, что
// missingMigration(...) в app/api/warehouse/transfers/route.ts.
const MISSING_COMMIT_RPC = new Set(["42883", "42P01", "PGRST202", "PGRST204", "PGRST205"]);

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
  const validCompanyUpdates = companyUpdates.filter((update) => validUuid(update.paymentId) && validUuid(update.companyId));
  const paymentRows = [...newPaymentRows, ...acceptedRows];
  try {
    let accountsCreated: number;
    let paymentsCreated: number;
    // Один RPC — одна транзакция Postgres: счета, привязка к юрлицу и сами
    // платежи или проходят все вместе, или откатываются все вместе (аудит
    // P2 — раньше это были три отдельных, ничем не связанных шага, и обрыв
    // посередине оставлял импорт в частично применённом состоянии).
    const rpc = await db.rpc("commit_finance_import", {
      p_accounts: accountRows,
      p_payments: paymentRows,
      p_company_updates: validCompanyUpdates,
    });
    if (!rpc.error) {
      const counts = (rpc.data ?? {}) as { accountsCreated?: number; paymentsCreated?: number };
      accountsCreated = Number(counts.accountsCreated ?? 0);
      paymentsCreated = Number(counts.paymentsCreated ?? 0);
    } else if (MISSING_COMMIT_RPC.has(rpc.error.code ?? "")) {
      accountsCreated = await insertChunked("accounts", accountRows, 100);
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
      paymentsCreated = await insertChunked("payments", paymentRows, 500);
    } else {
      throw new Error(rpc.error.message);
    }
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
  // Демо — строго то, что помечено is_demo при посеве (lib/finance/dbServer.ts
  // seed()), а не то, что «похоже на демо» по имени счёта или по отсутствию
  // import_source/company_id: такое совпадение по форме бывает у боевых
  // платежей ровно на этих же именах счетов ("Наличные", "Банковский счёт" —
  // это естественные названия, которые заводит и живой пользователь), и раньше
  // это стирало их безвозвратно.
  const demoPayments = await db.from("payments").select("id").eq("is_demo", true);
  if (demoPayments.error) {
    if (demoPayments.error.code === "42703") {
      // Миграция 202609130004 (колонка is_demo) ещё не накатана — безопасный
      // no-op вместо отката на прежний угадывающий heuristic.
      return NextResponse.json({ accountsDeleted: 0, paymentsDeleted: 0, accountsKept: 0 });
    }
    return NextResponse.json({ error: demoPayments.error.message }, { status: 500 });
  }
  const demoIds = (demoPayments.data ?? []).map((row) => String(row.id));
  if (demoIds.length) {
    const paymentsDelete = await db.from("payments").delete().in("id", demoIds);
    if (paymentsDelete.error) return NextResponse.json({ error: paymentsDelete.error.message }, { status: 500 });
  }
  const demoAccounts = await db.from("accounts").select("id").eq("is_demo", true);
  if (demoAccounts.error) {
    if (demoAccounts.error.code === "42703") {
      return NextResponse.json({ accountsDeleted: 0, paymentsDeleted: demoIds.length, accountsKept: 0 });
    }
    return NextResponse.json({ error: demoAccounts.error.message }, { status: 500 });
  }
  const ids = (demoAccounts.data ?? []).map((row) => String(row.id));
  if (!ids.length) return NextResponse.json({ accountsDeleted: 0, paymentsDeleted: demoIds.length, accountsKept: 0 });
  // Счёт удаляем, только если на нём не осталось ни одного платежа (в том
  // числе боевого, добавленного на демо-счёт уже после посева).
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
