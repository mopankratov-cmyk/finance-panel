import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { parseDdsCsv, parseDdsRows } from "@/components/payments/ddsCsv";
import { xlsxGrid } from "@/lib/finance/xlsxGrid";

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

const MAX_DDS_FILE_BYTES = 20 * 1024 * 1024;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** Серверный разбор исходного файла ДДС. PUT отделён от POST, который применяет уже проверенный план. */
export async function PUT(request: NextRequest) {
  const gate = await authorize();
  if (gate) return gate;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Выберите файл ДДС в формате XLSX или CSV" }, { status: 400 });
    }
    if (file.size > MAX_DDS_FILE_BYTES) {
      return NextResponse.json({ error: "Файл ДДС больше 20 МБ" }, { status: 413 });
    }
    const lower = file.name.toLowerCase();
    const bytes = Buffer.from(await file.arrayBuffer());
    const parsed = lower.endsWith(".xlsx")
      ? (() => {
          if (!ZIP_MAGIC.every((byte, index) => bytes[index] === byte)) {
            throw new Error("Файл не похож на XLSX — содержимое не совпадает с расширением");
          }
          return parseDdsRows(xlsxGrid(bytes));
        })()
      : lower.endsWith(".csv")
        ? parseDdsCsv(bytes.toString("utf8"))
        : null;
    if (!parsed) return NextResponse.json({ error: "Поддерживаются файлы ДДС XLSX и CSV" }, { status: 415 });
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const result = {
      ...parsed,
      drafts: parsed.drafts.map((draft, index) => ({
        ...draft,
        // Повтор ровно того же файла безопасен даже при двух одновременно
        // открытых вкладках. Пересекающиеся другие файлы дополнительно
        // проверяются по счёту, дате, сумме, назначению и контрагенту.
        importSource: `dds-file:${fileHash}:${index + 1}`,
      })),
    };
    if (!result.drafts.length) {
      return NextResponse.json({ error: result.warnings[0] || "В файле не найдены операции ДДС", result }, { status: 422 });
    }
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось прочитать файл ДДС" }, { status: 400 });
  }
}

function validUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

// Строки в БД собираются из явного списка полей, а не из сырого тела запроса:
// плановые accountRows/newPaymentRows/acceptedRows проверяются на валидный id
// и на размер массива, но остальные поля до этой функции ничем не ограничены —
// вызывающий мог прислать значения в любых других колонках (аудит P3). Здесь
// же тип полей ровно тот, что объявлен в AccountRow/PaymentRow, ничего лишнего
// не проходит — тот же приём, что и в app/api/finance/companies/route.ts.
function sanitizeAccountRow(row: AccountRow) {
  return {
    id: String(row.id),
    name: String(row.name ?? "").slice(0, 200),
    type: String(row.type ?? ""),
    currency: String(row.currency ?? ""),
    balance: Number.isFinite(Number(row.balance)) ? Number(row.balance) : 0,
  };
}

function sanitizePaymentRow(row: PaymentRow) {
  const amount = Number.isFinite(Number(row.amount)) ? Number(row.amount) : 0;
  return {
    id: String(row.id),
    name: String(row.name ?? "").slice(0, 500),
    amount,
    type: amount >= 0 ? "income" : "expense",
    category: String(row.category ?? ""),
    account_id: String(row.account_id ?? ""),
    date: String(row.date ?? ""),
    status: String(row.status ?? "planned"),
    counterparty: String(row.counterparty ?? ""),
    comment: row.comment == null ? null : String(row.comment),
    company_id: row.company_id == null ? null : String(row.company_id),
    import_source: row.import_source == null ? null : String(row.import_source),
  };
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
      loadAllSupabasePages<{ id: string; name: string; amount: number; category: string; account_id: string; date: string; company_id: string | null; counterparty: string | null }>((from, to) => db
        .from("payments")
        .select("id,name,amount,category,account_id,date,company_id,counterparty")
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
  // Вставляем не сырые объекты из тела запроса, а их пересборку по белому
  // списку полей (аудит P3): id уже проверен как uuid выше, но остальные поля
  // — company_id, import_source, status, balance и так далее — до этой точки
  // ничем не ограничены и пишутся в insert/upsert как есть.
  const sanitizedAccountRows = accountRows.map(sanitizeAccountRow);
  const sanitizedPaymentRows = paymentRows.map(sanitizePaymentRow);
  try {
    let accountsCreated: number;
    let paymentsCreated: number;
    // Один RPC — одна транзакция Postgres: счета, привязка к юрлицу и сами
    // платежи или проходят все вместе, или откатываются все вместе (аудит
    // P2 — раньше это были три отдельных, ничем не связанных шага, и обрыв
    // посередине оставлял импорт в частично применённом состоянии).
    const rpc = await db.rpc("commit_finance_import", {
      p_accounts: sanitizedAccountRows,
      p_payments: sanitizedPaymentRows,
      p_company_updates: validCompanyUpdates,
    });
    if (!rpc.error) {
      const counts = (rpc.data ?? {}) as { accountsCreated?: number; paymentsCreated?: number };
      accountsCreated = Number(counts.accountsCreated ?? 0);
      paymentsCreated = Number(counts.paymentsCreated ?? 0);
    } else if (MISSING_COMMIT_RPC.has(rpc.error.code ?? "")) {
      accountsCreated = await insertChunked("accounts", sanitizedAccountRows, 100);
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
      paymentsCreated = await insertChunked("payments", sanitizedPaymentRows, 500);
    } else {
      throw new Error(rpc.error.message);
    }
    await audit(request, await getServerSession(), {
      action: "finance_import.commit",
      subject: `счета: ${accountsCreated}, платежи: ${paymentsCreated}, компании: ${companyUpdates.length}`,
      after: {
        accountsCreated,
        paymentsCreated,
        companiesAssigned: companyUpdates.length,
        duplicatesSkipped: Number(plan.duplicatePayments ?? 0),
        suspectedSkipped: suspectedRows.length - acceptedRows.length,
      },
    });
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

export async function DELETE(request: NextRequest) {
  const gate = await authorize();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  // Удаление финансовых данных без следа в журнале (аудит P3) — записываем
  // событие с итоговыми счётчиками перед каждым завершением, где что-то
  // реально было стёрто.
  const logClear = async (accountsDeleted: number, accountsKept: number) => {
    if (!accountsDeleted && !demoIds.length) return;
    await audit(request, await getServerSession(), {
      action: "finance_import.clear",
      subject: `демо-счета: ${accountsDeleted}, демо-платежи: ${demoIds.length}`,
      before: { accountsDeleted, paymentsDeleted: demoIds.length, accountsKept },
    });
  };
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
      await logClear(0, 0);
      return NextResponse.json({ accountsDeleted: 0, paymentsDeleted: demoIds.length, accountsKept: 0 });
    }
    return NextResponse.json({ error: demoAccounts.error.message }, { status: 500 });
  }
  const ids = (demoAccounts.data ?? []).map((row) => String(row.id));
  if (!ids.length) {
    await logClear(0, 0);
    return NextResponse.json({ accountsDeleted: 0, paymentsDeleted: demoIds.length, accountsKept: 0 });
  }
  // Счёт удаляем, только если на нём не осталось ни одного платежа (в том
  // числе боевого, добавленного на демо-счёт уже после посева).
  const deletable: string[] = [];
  for (const id of ids) {
    const rest = await db.from("payments").select("id").eq("account_id", id).limit(1);
    if (rest.error) return NextResponse.json({ error: rest.error.message }, { status: 500 });
    if (!(rest.data ?? []).length) deletable.push(id);
  }
  // Пишем журнал ДО удаления счетов: если сам запрос оборвётся сетью
  // посередине, запись о том, что и в каком объёме собирались снести, всё
  // равно останется (платежи к этому моменту уже удалены выше).
  await logClear(deletable.length, ids.length - deletable.length);
  if (deletable.length) {
    const accountsDelete = await db.from("accounts").delete().in("id", deletable);
    if (accountsDelete.error) return NextResponse.json({ error: accountsDelete.error.message }, { status: 500 });
  }
  return NextResponse.json({ accountsDeleted: deletable.length, paymentsDeleted: demoIds.length, accountsKept: ids.length - deletable.length });
}
