import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { accountBalance } from "@/lib/finance/balance";
import { bankOpeningAtDate, cashDifference, dayBefore, type BankTransactionForOpening } from "@/lib/finance/cashSnapshot";
import { isDdsActualPayment } from "@/lib/finance/bankDdsPayment";
import { loadFinanceStateServer } from "@/lib/finance/dbServer";
import { loadBalanceCompanyScopes, selectBalanceCompanyScope } from "@/lib/finance/balanceScopes";
import { requiresScopedWbCash } from "@/lib/finance/balanceWbCash";
import { isLateDirectWbSnapshot, marketplaceCashAmount } from "@/lib/finance/balanceMarketplaceCash";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { getWbSyncTargets, groupWbStatisticsTargets } from "@/lib/sync/cabinets";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const monthValue = (value: string | null) => /^\d{4}-\d{2}$/.test(value ?? "") ? `${value}-01` : null;
const normalizeAccount = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const sourceKey = (marketplace: "wb" | "ozon", identity: string) =>
  `${marketplace}:${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
const scopedWbCashSourceKey = (sellerIdentity: string, cabinetId: string) =>
  sourceKey("wb", `${sellerIdentity}:brand-report-allocation:${cabinetId}`);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

type StatementRow = {
  id: string; bank_name: string; bank_account_number: string; date_from: string | null;
  date_to: string | null; opening_balance: number | null; registered_at: string | null;
};
type StatementLinkRow = {
  statement_id: string;
  finance_bank_transactions: { operation_date: string; amount: number } | Array<{ operation_date: string; amount: number }> | null;
};

export async function GET(request: NextRequest) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  const month = monthValue(request.nextUrl.searchParams.get("month"));
  if (!month) return NextResponse.json({ error: "Укажите месяц в формате ГГГГ-ММ" }, { status: 400 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  try {
    const scopes = await loadBalanceCompanyScopes();
    const scope = selectBalanceCompanyScope(scopes, request.nextUrl.searchParams.get("company"));
    if (!scope) return NextResponse.json({ error: "Выберите юрлицо для Баланса" }, { status: 400 });
    const [finance, mappingsResult, statementsResult, snapshotsResult, wbTargets, ozonScope] = await Promise.all([
      loadFinanceStateServer(),
      db.from("bank_account_mappings").select("bank_account_number,account_id,company_id"),
      db.from("finance_bank_statements")
        .select("id,bank_name,bank_account_number,date_from,date_to,opening_balance,registered_at")
        .not("registered_at", "is", null).lte("date_from", month).gte("date_to", month)
        .order("date_from", { ascending: false }).order("registered_at", { ascending: false }),
      db.from("balance_marketplace_cash_snapshots")
        .select("source_key,marketplace,cabinet_id,cabinet_name,amount,available_amount,currency,status,error,captured_at,calculation_method,calculation_details")
        .eq("snapshot_month", month),
      getWbSyncTargets(),
      getOzonCabinetScope("all"),
    ]);
    const baseError = mappingsResult.error ?? statementsResult.error ?? snapshotsResult.error;
    if (baseError) {
      const missing = /balance_marketplace_cash_snapshots.*(?:does not exist|schema cache)|could not find.*balance_marketplace_cash_snapshots|calculation_(?:method|details).*(?:does not exist|schema cache|could not find)/i.test(baseError.message);
      return NextResponse.json({ error: missing ? "Примените миграции 202609240001_balance_cash_snapshots.sql и 202609270001_balance_scoped_marketplace_cash.sql" : baseError.message }, { status: missing ? 503 : 500 });
    }

    const statements = (statementsResult.data ?? []) as StatementRow[];
    const statementIds = statements.map((row) => row.id);
    const linksResult = statementIds.length
      ? await db.from("finance_bank_statement_rows")
        .select("statement_id,finance_bank_transactions!inner(operation_date,amount)")
        .in("statement_id", statementIds)
      : { data: [] as StatementLinkRow[], error: null };
    if (linksResult.error) throw new Error(linksResult.error.message);
    const transactions: BankTransactionForOpening[] = ((linksResult.data ?? []) as unknown as StatementLinkRow[]).flatMap((row) => {
      const linked = Array.isArray(row.finance_bank_transactions) ? row.finance_bank_transactions : row.finance_bank_transactions ? [row.finance_bank_transactions] : [];
      return linked.map((transaction) => ({ statementId: String(row.statement_id), date: String(transaction.operation_date), amount: Number(transaction.amount) }));
    });

    const statementByAccount = new Map<string, StatementRow>();
    for (const statement of statements) {
      const key = normalizeAccount(statement.bank_account_number);
      if (key && !statementByAccount.has(key)) statementByAccount.set(key, statement);
    }
    const companyMappings = (mappingsResult.data ?? []).filter((row) => scope.companyIds.includes(String(row.company_id ?? "")));
    const bankAccountNumberById = new Map(companyMappings.map((row) => [String(row.account_id), normalizeAccount(row.bank_account_number)]));
    const mappedAccountIds = new Set(companyMappings.map((row) => String(row.account_id)));
    const actualPayments = finance.payments.filter(isDdsActualPayment);
    const bankAccounts = finance.accounts.filter((account) => account.type === "bank" && account.currency === "RUB" && mappedAccountIds.has(account.id)).map((account) => {
      const accountNumber = bankAccountNumberById.get(account.id) ?? "";
      const statement = statementByAccount.get(accountNumber);
      const statementAmount = statement ? bankOpeningAtDate({
        id: statement.id,
        dateFrom: statement.date_from,
        dateTo: statement.date_to,
        openingBalance: statement.opening_balance == null ? null : Number(statement.opening_balance),
      }, transactions, month) : null;
      const ddsAmount = accountBalance(account, actualPayments, dayBefore(month));
      const difference = statementAmount === null ? null : cashDifference(statementAmount, ddsAmount);
      return {
        id: account.id,
        name: account.name,
        bank: statement?.bank_name ?? null,
        accountNumber: accountNumber ? `•••• ${accountNumber.slice(-4)}` : null,
        statementAmount,
        ddsAmount: round2(ddsAmount),
        difference,
        matchesDds: difference !== null && Math.abs(difference) <= 0.01,
        statementId: statement?.id ?? null,
        error: !accountNumber ? "Счёт не сопоставлен с выпиской" : !statement ? "Нет выписки, охватывающей первое число" : statementAmount === null ? "В выписке нет входящего остатка" : difference !== null && Math.abs(difference) > 0.01 ? `Расхождение с ДДС: ${difference.toLocaleString("ru-RU")} ₽` : null,
      };
    });
    const bankAmountReady = bankAccounts.length > 0 && bankAccounts.every((row) => row.statementAmount !== null);
    const bankAmount = bankAmountReady ? round2(bankAccounts.reduce((sum, row) => sum + (row.statementAmount ?? 0), 0)) : null;
    const bankComplete = bankAmountReady && bankAccounts.every((row) => row.matchesDds);

    const expected = new Map<string, { marketplace: "wb" | "ozon"; label: string }>();
    for (const sellerGroup of groupWbStatisticsTargets(wbTargets)) {
      const included = sellerGroup.filter((target) => target.cabinetId && scope.cabinetIds.includes(target.cabinetId));
      if (!included.length) continue;
      const excluded = sellerGroup.filter((target) => target.cabinetId && !scope.cabinetIds.includes(target.cabinetId));
      const sellerIdentity = sellerGroup[0].statisticsSourceKey || sellerGroup[0].statsToken;
      const sharedSeller = excluded.length > 0 || sellerGroup.some((item) => requiresScopedWbCash(item.name));
      if (sharedSeller) {
        for (const target of included) {
          if (!target.cabinetId) continue;
          expected.set(scopedWbCashSourceKey(sellerIdentity, target.cabinetId), { marketplace: "wb", label: target.name });
        }
      } else {
        expected.set(sourceKey("wb", sellerIdentity), {
          marketplace: "wb",
          label: included.map((item) => item.name).join(" / "),
        });
      }
    }
    if (ozonScope.ok) {
      for (const cabinet of ozonScope.scope.cabinets.filter((item) => scope.cabinetIds.includes(item.id))) {
        expected.set(sourceKey("ozon", cabinet.id), { marketplace: "ozon", label: cabinet.name });
      }
    }
    const snapshotRows = (snapshotsResult.data ?? []).filter((row) => {
      const configured = expected.get(String(row.source_key));
      return configured?.marketplace === row.marketplace;
    }).map((row) => {
      const marketplace = row.marketplace as "wb" | "ozon";
      const calculationMethod = String(row.calculation_method ?? "provider_balance");
      const storedAmount = row.amount == null ? null : Number(row.amount);
      const availableAmount = row.available_amount == null ? null : Number(row.available_amount);
      const capturedAt = String(row.captured_at);
      const provisional = isLateDirectWbSnapshot({ marketplace, calculationMethod, snapshotMonth: month, capturedAt });
      return {
        sourceKey: String(row.source_key), marketplace,
        label: String(row.cabinet_name ?? expected.get(String(row.source_key))?.label ?? row.marketplace),
        amount: marketplaceCashAmount({ marketplace, amount: storedAmount, availableAmount, calculationMethod }),
        availableAmount,
        currency: String(row.currency ?? "RUB"), status: String(row.status),
        error: row.error ? String(row.error) : provisional ? "Поздний восстановительный снимок WB: сумма предварительная и не подтверждает состояние на 00:01" : null,
        capturedAt,
        provisional,
        calculationMethod,
        calculationDetails: row.calculation_details && typeof row.calculation_details === "object" ? row.calculation_details : null,
      };
    });
    const byMarketplace = (["wb", "ozon"] as const).map((marketplace) => {
      const rows = snapshotRows.filter((row) => row.marketplace === marketplace);
      const missing = [...expected].filter(([, item]) => item.marketplace === marketplace).filter(([key]) => !rows.some((row) => row.sourceKey === key)).map(([, item]) => item);
      const amountReady = missing.length === 0 && rows.length > 0 && rows.every((row) => row.status === "ok" && row.amount !== null && row.currency === "RUB");
      const complete = amountReady && rows.every((row) => !row.provisional);
      return {
        marketplace,
        complete,
        amount: amountReady ? round2(rows.reduce((sum, row) => sum + (row.amount ?? 0), 0)) : null,
        rows,
        errors: [...rows.map((row) => row.error).filter(Boolean), ...missing.map((item) => `Нет снимка: ${item.label}`)],
      };
    });
    const wb = byMarketplace[0];
    const ozon = byMarketplace[1];
    const amountReady = bankAmount !== null && wb.amount !== null && ozon.amount !== null;
    return NextResponse.json({
      month,
      company: { id: scope.id, name: scope.name },
      amount: amountReady ? round2(bankAmount! + wb.amount! + ozon.amount!) : null,
      complete: bankComplete && wb.complete && ozon.complete,
      bank: { amount: bankAmount, complete: bankComplete, accounts: bankAccounts },
      marketplaces: { wb, ozon },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось собрать денежные остатки" }, { status: 500 });
  }
}
