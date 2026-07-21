import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { analyzeFinances, type FinancialAlert } from "@/lib/opiu/financialIntelligence";
import type { Account, Payment } from "@/lib/types";

const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

export async function sendTelegramMessage(text: string, chatId = process.env.FINANCE_TELEGRAM_CHAT_ID) {
  const token = process.env.FINANCE_TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) throw new Error("Не настроены FINANCE_TELEGRAM_BOT_TOKEN и FINANCE_TELEGRAM_CHAT_ID");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!response.ok) throw new Error(`Telegram вернул ${response.status}`);
}

export function formatAlert(alert: FinancialAlert) {
  const icon = alert.severity === "critical" ? "🚨" : alert.severity === "warning" ? "⚠️" : "ℹ️";
  return `${icon} <b>${alert.title}</b>\n${alert.message}\nЧто сделать: ${alert.action}`;
}

export async function loadServerFinanceSnapshot() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("SUPABASE_SERVICE_ROLE_KEY не настроен");
  const [{ data: accountRows, error: accountError }, { data: paymentRows, error: paymentError }] = await Promise.all([
    db.from("finance_accounts").select("id,name,type,currency,balance"),
    db.from("finance_payments").select("id,date,name,amount,category,account_id,status,counterparty,comment"),
  ]);
  if (accountError) throw new Error(accountError.message);
  if (paymentError) throw new Error(paymentError.message);
  const accounts = (accountRows ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    type: row.type as Account["type"],
    currency: row.currency as Account["currency"],
    balance: Number(row.balance),
  }));
  const payments = (paymentRows ?? []).map((row) => ({
    id: String(row.id),
    date: String(row.date),
    name: String(row.name),
    amount: Number(row.amount),
    category: String(row.category),
    accountId: String(row.account_id),
    status: row.status as Payment["status"],
    counterparty: String(row.counterparty ?? ""),
    comment: row.comment ? String(row.comment) : undefined,
  }));
  return { db, accounts, payments };
}

export async function runServerFinancialAnalysis({ notify = false }: { notify?: boolean } = {}) {
  const { db, accounts, payments } = await loadServerFinanceSnapshot();
  const result = analyzeFinances({ accounts, payments });
  for (const alert of result.alerts) {
    const { data: existing } = await db
      .from("finance_alerts")
      .select("id,severity")
      .eq("alert_key", alert.key)
      .maybeSingle();
    await db.from("finance_alerts").upsert({
      alert_key: alert.key,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      action: alert.action,
      amount: alert.amount ?? null,
      alert_date: alert.date ?? null,
      status: "open",
      last_seen_at: result.generatedAt,
    }, { onConflict: "alert_key" });
    if (notify && !existing && alert.severity === "critical") await sendTelegramMessage(formatAlert(alert));
  }
  return result;
}

export function formatStatus(result: Awaited<ReturnType<typeof runServerFinancialAnalysis>>) {
  const rate = Math.round(result.planFact.matchRate * 100);
  const lines = [
    "📊 <b>Финансовый статус</b>",
    `План–факт: ${result.planFact.matched} из ${result.planFact.due} (${rate}%)`,
    `Минимальный прогнозный остаток: ${money(result.forecast.lowestBalance)}`,
    `Критичных будущих платежей: ${result.forecast.criticalPayments}`,
    `Открытых отклонений: ${result.alerts.length}`,
  ];
  if (result.forecast.lowestBalanceDate) lines.push(`Риск на дату: ${result.forecast.lowestBalanceDate}`);
  return lines.join("\n");
}
