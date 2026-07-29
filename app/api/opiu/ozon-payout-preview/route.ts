import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { ozonTransactionTotals } from "@/lib/ozon/api";
import {
  OZON_PAYOUT_MAPPINGS,
  buildOzonPayoutPreview,
  classifyOzonReceipts,
  stableOzonReportKey,
  type ReceiptForPreview,
} from "@/lib/opiu/ozonPayoutPreview";

export const maxDuration = 60;

const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

interface OzonReport {
  key: string;
  reportId: string;
  periodFrom: string;
  periodTo: string;
  amount: number;
  estimatedReceiptDate: string;
}

async function loadReports(
  creds: { clientId: string; apiKey: string },
  cabinetId: string,
  from: Date,
  to: Date,
): Promise<{ reports: OzonReport[]; warnings: string[] }> {
  const details: unknown[] = [];
  const warnings: string[] = [];
  let page = 1;
  let pageCount = 1;
  do {
    const response = await fetch("https://api-seller.ozon.ru/v1/finance/cash-flow-statement/list", {
      method: "POST",
      headers: {
        "Client-Id": creds.clientId.trim(),
        "Api-Key": creds.apiKey.trim(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        page,
        page_size: 100,
        date: { from: from.toISOString(), to: to.toISOString() },
        with_details: true,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Ozon вернул ${response.status} на странице ${page}`);
    const payload = await response.json() as { result?: { details?: unknown; page_count?: number; pageCount?: number } };
    const raw = payload.result?.details;
    details.push(...(Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : []));
    pageCount = Math.max(1, num(payload.result?.page_count ?? payload.result?.pageCount));
    page += 1;
  } while (page <= pageCount);

  const byId = new Map<string, OzonReport>();
  for (const value of details) {
    if (!value || typeof value !== "object") continue;
    const row = value as { payments?: { payment?: number | string }; period?: { id?: number | string; begin?: string; end?: string } };
    const reportId = String(row.period?.id ?? "").trim();
    const periodFrom = String(row.period?.begin ?? "").slice(0, 10);
    const periodTo = String(row.period?.end ?? "").slice(0, 10);
    const amount = num(row.payments?.payment);
    if (!reportId) {
      if (amount > 0) warnings.push(`Отчёт ${periodFrom || "без периода"} пропущен: Ozon не вернул стабильный reportId`);
      continue;
    }
    if (!periodFrom || !periodTo || amount <= 0) continue;
    byId.set(reportId, {
      key: stableOzonReportKey(cabinetId, reportId),
      reportId,
      periodFrom,
      periodTo,
      amount,
      estimatedReceiptDate: iso(addDays(new Date(`${periodTo}T12:00:00Z`), 24)),
    });
  }
  return { reports: [...byId.values()].sort((a, b) => a.periodFrom.localeCompare(b.periodFrom)), warnings };
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const year = Number(request.nextUrl.searchParams.get("year"));
  const month = Number(request.nextUrl.searchParams.get("month"));
  const cabinetId = request.nextUrl.searchParams.get("cabinet") ?? "";
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
  }
  const mapping = OZON_PAYOUT_MAPPINGS.find((item) => item.cabinetId === cabinetId);
  if (!mapping) {
    return NextResponse.json({ error: "Для этого кабинета не подтверждено соответствие компании и банковского счёта" }, { status: 400 });
  }
  const scope = await getOzonCabinetScope(cabinetId);
  if (!scope.ok || scope.scope.mode !== "single" || scope.scope.cabinets.length !== 1) {
    return NextResponse.json({ error: scope.ok ? "Выберите один кабинет Ozon" : scope.error }, { status: 404 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "База данных не настроена" }, { status: 500 });

  const [{ data: company, error: companyError }, { data: account, error: accountError }] = await Promise.all([
    db.from("companies").select("id,name,is_active").eq("id", mapping.companyId).maybeSingle(),
    db.from("accounts").select("id,name").eq("id", mapping.accountId).maybeSingle(),
  ]);
  if (companyError || accountError) {
    return NextResponse.json({ error: companyError?.message ?? accountError?.message }, { status: 503 });
  }
  if (!company?.is_active || !account) {
    return NextResponse.json({ error: "Подтверждённая компания или банковский счёт больше не активны" }, { status: 409 });
  }

  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const queryFrom = iso(addDays(start, -45));
  const queryTo = iso(addDays(end, 45));
  const { data: paymentRows, error: paymentError } = await db
    .from("payments")
    .select("id,date,amount,status,category,account_id,name,counterparty,comment")
    .eq("company_id", mapping.companyId)
    .gte("date", queryFrom)
    .lte("date", queryTo)
    .order("date", { ascending: true });
  if (paymentError) return NextResponse.json({ error: `Не удалось прочитать ДДС: ${paymentError.message}` }, { status: 503 });

  const receipts: ReceiptForPreview[] = (paymentRows ?? []).map((row) => ({
    id: String(row.id),
    date: String(row.date),
    amount: num(row.amount),
    status: String(row.status ?? ""),
    category: String(row.category ?? ""),
    accountId: String(row.account_id ?? ""),
    name: String(row.name ?? ""),
    counterparty: String(row.counterparty ?? ""),
    comment: String(row.comment ?? ""),
  }));
  const classified = classifyOzonReceipts(receipts, mapping);

  const cabinet = scope.scope.cabinets[0];
  const reportResult = await loadReports(cabinet.creds, cabinet.id, addDays(start, -31), addDays(end, 31));
  const reports = reportResult.reports.filter((row) => row.periodFrom <= iso(end) && row.periodTo >= iso(start));
  const totals = await ozonTransactionTotals(cabinet.creds, start.toISOString(), end.toISOString());
  const hasUnresolved = classified.unresolved.length > 0;
  const preview = buildOzonPayoutPreview({
    reports,
    confirmedReceipts: classified.confirmed,
    unresolvedReceipts: classified.unresolved,
    schedule: reports,
  });

  return NextResponse.json({
    readOnly: true,
    mapping: {
      cabinetId: mapping.cabinetId,
      cabinetName: mapping.cabinetName,
      companyId: mapping.companyId,
      companyName: mapping.companyName,
      accountId: mapping.accountId,
      accountName: mapping.accountName,
      accountIsOzonExclusive: mapping.accountIsOzonExclusive,
    },
    period: { from: iso(start), to: iso(end) },
    accrual: totals.ok ? totals.totals.money_transfer : null,
    reportTotal: preview.reportTotal,
    bankReceived: preview.bankReceived,
    remaining: preview.remaining,
    schedule: preview.schedule,
    confirmedReceipts: classified.confirmed,
    unresolvedReceipts: classified.unresolved,
    warnings: [
      ...reportResult.warnings,
      ...(!totals.ok ? [`Начисления Ozon недоступны: ${totals.error}`] : []),
      ...(hasUnresolved ? ["Есть поступления маркетплейса без надёжной Ozon-идентификации. Итоги и график скрыты до ручной проверки."] : []),
      "Даты отчётов являются расчётными и не считаются подтверждённой датой выплаты.",
    ],
  });
}
