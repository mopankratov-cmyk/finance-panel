import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import {
  buildWithdrawalPlan,
  parseReturnedKiz,
  parseSoldKiz,
  type SoldKizLine,
} from "@/lib/wb/kizWithdrawal";
import { readXlsxRows } from "@/lib/xlsx/read";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILE_BYTES = 16 * 1024 * 1024;

export interface KizWithdrawalSummary {
  /** Ждут отправки на вывод. */
  pending: number;
  pendingAmount: number;
  /** Отправлено на вывод. */
  sent: number;
  /** Вернулись в оборот WB — выводить нельзя. */
  returned: number;
  /** Вернулись после того, как уже уехали на вывод. Требует человека. */
  returnedAfterSent: number;
  /** Без цены реализации: файл получателю такие строки не примет корректно. */
  withoutPrice: number;
  firstSoldAt: string | null;
  lastSoldAt: string | null;
}

export interface KizUploadResult {
  added: number;
  updatedByReturn: number;
  alreadyKnown: number;
  duplicatesInFile: number;
  returnedAfterSent: string[];
  returnsWithoutSale: number;
  issues: { line: number; reason: string }[];
  soldColumns: Record<string, string>;
  returnColumns: Record<string, string>;
  withoutPrice: number;
  summary: KizWithdrawalSummary;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграцию 202608240023_kiz_withdrawal.sql";

async function summarize(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<KizWithdrawalSummary> {
  const rows = await db.from("kiz_withdrawals").select("status, price, sold_at");
  const data = rows.data ?? [];
  const pending = data.filter((row) => row.status === "sold");
  const sortedDates = data.map((row) => row.sold_at).filter(Boolean).map(String).sort();
  return {
    pending: pending.length,
    pendingAmount: pending.reduce((sum, row) => sum + Number(row.price ?? 0), 0),
    sent: data.filter((row) => row.status === "sent").length,
    returned: data.filter((row) => row.status === "returned").length,
    returnedAfterSent: data.filter((row) => row.status === "returned_after_sent").length,
    withoutPrice: pending.filter((row) => row.price === null || row.price === undefined).length,
    firstSoldAt: sortedDates[0] ?? null,
    lastSoldAt: sortedDates[sortedDates.length - 1] ?? null,
  };
}

/** Состояние реестра. */
export async function GET() {
  const gate = await requireApiSession();
  if (gate) return gate;
  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  try {
    return NextResponse.json({ data: await summarize(db), error: null });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    return fail(missingMigration(code) ? migrationHint : String(error), missingMigration(code) ? 503 : 500);
  }
}

function takeFile(form: FormData, field: string, label: string): { file: File | null; error: string | null } {
  const value = form.get(field);
  if (value === null || value === "") return { file: null, error: null };
  if (!(value instanceof File)) return { file: null, error: `Поле «${label}» пришло не файлом` };
  if (!/\.xlsx$/i.test(value.name)) return { file: null, error: `«${label}»: поддерживается только .xlsx` };
  if (value.size <= 0 || value.size > MAX_FILE_BYTES) {
    return { file: null, error: `«${label}»: размер файла должен быть от 1 байта до 16 МБ` };
  }
  return { file: value, error: null };
}

/**
 * Загрузить пару выгрузок за период и пополнить реестр.
 *
 * Файл проданного обязателен, файл возвратов — нет: если за период возвратов не
 * было, отчёт пустой, и требовать его значило бы мешать работать. Но отсутствие
 * файла и отсутствие возвратов — разные вещи, и это видно в ответе.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const form = await request.formData().catch(() => null);
  if (!form) return fail("Ожидается форма с файлами", 400);

  const sold = takeFile(form, "sold", "Завершённые заказы");
  if (sold.error) return fail(sold.error, 400);
  if (!sold.file) return fail("Нужна выгрузка завершённых заказов ФБС с фильтром «товар выкуплен»", 400);
  const returns = takeFile(form, "returns", "Отчёт по возвратам");
  if (returns.error) return fail(returns.error, 400);

  const cabinetId = String(form.get("cabinetId") ?? "").trim() || null;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();

  let soldParsed, returnsParsed;
  try {
    soldParsed = parseSoldKiz(await readXlsxRows(Buffer.from(await sold.file.arrayBuffer())));
    returnsParsed = returns.file
      ? parseReturnedKiz(await readXlsxRows(Buffer.from(await returns.file.arrayBuffer())))
      : { lines: [], issues: [], columns: {} };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Не удалось разобрать файл", 400);
  }

  // Что уже знает реестр: отправленное второй раз не отправляем, возвращённое
  // не выводим вовсе.
  const knownResult = await db.from("kiz_withdrawals").select("code, status");
  if (knownResult.error) {
    const code = knownResult.error.code;
    return fail(missingMigration(code) ? migrationHint : knownResult.error.message, missingMigration(code) ? 503 : 500);
  }
  const alreadySent = new Set<string>();
  const alreadyReturned = new Set<string>();
  const known = new Set<string>();
  for (const row of knownResult.data ?? []) {
    const code = String(row.code);
    known.add(code);
    if (row.status === "sent" || row.status === "returned_after_sent") alreadySent.add(code);
    if (row.status === "returned" || row.status === "returned_after_sent") alreadyReturned.add(code);
  }

  const plan = buildWithdrawalPlan({
    sold: soldParsed.lines,
    returned: returnsParsed.lines,
    alreadySent,
    alreadyReturned,
  });

  const stamp = new Date().toISOString();
  const source = `${sold.file.name}${returns.file ? ` + ${returns.file.name}` : ""}`;
  const row = (line: SoldKizLine, status: string) => ({
    code: line.code.code,
    raw_code: line.rawCode,
    gtin: line.code.gtin,
    serial: line.code.serial,
    cabinet_id: cabinetId,
    task_id: line.taskId || null,
    nm_id: line.nmId,
    article: line.article || null,
    barcode: line.barcode || null,
    price: line.price,
    sold_at: line.soldAt,
    status,
    source,
    updated_at: stamp,
  });

  // Проданное пишем пачками: выгрузка за три дня — это тысячи строк.
  const fresh = [
    ...plan.toWithdraw.map((line) => row(line, "sold")),
    ...plan.excludedByReturn.map((line) => ({ ...row(line, "returned"), returned_at: null })),
  ].filter((item) => !known.has(String(item.code)));

  let added = 0;
  for (let offset = 0; offset < fresh.length; offset += 500) {
    const { error } = await db.from("kiz_withdrawals").insert(fresh.slice(offset, offset + 500));
    if (!error) added += Math.min(500, fresh.length - offset);
  }

  // Возвраты по кодам, которые уже лежат в реестре как проданные: переводим в
  // «вернулось». Отправленные ранее — в отдельный статус, это сигнал человеку.
  let updatedByReturn = 0;
  const returnedCodes = returnsParsed.lines.map((line) => line.code.code!).filter(Boolean);
  for (let offset = 0; offset < returnedCodes.length; offset += 300) {
    const chunk = returnedCodes.slice(offset, offset + 300);
    const { data } = await db
      .from("kiz_withdrawals")
      .update({ status: "returned", updated_at: stamp })
      .in("code", chunk)
      .eq("status", "sold")
      .select("code");
    updatedByReturn += (data ?? []).length;
    await db
      .from("kiz_withdrawals")
      .update({ status: "returned_after_sent", updated_at: stamp })
      .in("code", chunk)
      .eq("status", "sent");
  }

  const result: KizUploadResult = {
    added,
    updatedByReturn,
    alreadyKnown: plan.alreadySent.length,
    duplicatesInFile: plan.duplicates,
    returnedAfterSent: plan.returnedAfterSent.map((line) => line.code.code!).slice(0, 50),
    returnsWithoutSale: plan.returnsWithoutSale,
    issues: [...soldParsed.issues, ...returnsParsed.issues].slice(0, 50),
    soldColumns: soldParsed.columns,
    returnColumns: returnsParsed.columns,
    withoutPrice: soldParsed.withoutPrice,
    summary: await summarize(db),
  };
  void session;
  return NextResponse.json({ data: result, error: null }, { status: 201 });
}
