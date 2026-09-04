"use client";

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { useFinance } from "@/components/providers/FinanceProvider";
import {
  getNegativeBalanceDays,
  getPaymentsForWeek,
  getRecentTransactions,
  getTotalBalance,
  getTotalBalanceByCurrency,
} from "@/lib/calculations";
import { PAYMENT_STATUS_LABELS } from "@/lib/constants";
import { formatDateShort, formatMoney, todayISO } from "@/lib/format";

export function DashboardPage() {
  const { state } = useFinance();
  const totalBalance = getTotalBalance(state.accounts, state.payments);
  const balancesByCurrency = getTotalBalanceByCurrency(state.accounts, state.payments);
  const upcomingPayments = getPaymentsForWeek(state.payments, todayISO());
  const recentTransactions = getRecentTransactions(state.payments, 8);

  const now = new Date();
  const alerts = getNegativeBalanceDays(
    now.getFullYear(),
    now.getMonth(),
    state.accounts,
    state.payments,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Дашборд</h1>
        <p className="text-sm text-slate-400 mt-1">
          Обзор финансового состояния
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="sm:col-span-2 lg:col-span-1">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
                <TrendingUp className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Общий баланс</p>
                <p className="text-2xl font-bold text-slate-900">
                  {formatMoney(totalBalance)}
                </p>
              </div>
            </div>
            {Object.entries(balancesByCurrency).length > 1 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(balancesByCurrency).map(([cur, amt]) => (
                  <span
                    key={cur}
                    className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600"
                  >
                    {formatMoney(amt, cur as "RUB" | "USD")}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-slate-500">Платежи на этой неделе</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">
              {upcomingPayments.length}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {upcomingPayments.length > 0
                ? `Сумма: ${formatMoney(upcomingPayments.reduce((s, p) => s + p.amount, 0))}`
                : "Нет запланированных платежей"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-slate-500">Предупреждения</p>
            <p
              className={`text-2xl font-bold mt-1 ${alerts.length > 0 ? "text-red-600" : "text-emerald-600"}`}
            >
              {alerts.length}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {alerts.length > 0
                ? "Дни с отрицательным балансом"
                : "Баланс в норме"}
            </p>
          </CardContent>
        </Card>
      </div>

      {alerts.length > 0 && (
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader>
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              <h2 className="font-semibold">Предупреждения о кассовом разрыве</h2>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              {alerts.map((day) => (
                <span
                  key={day.date}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-100 px-3 py-1.5 text-sm text-red-700"
                >
                  {formatDateShort(day.date)}: {formatMoney(day.balance)}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-slate-900">
              Платежи на этой неделе
            </h2>
          </CardHeader>
          <CardContent className="pt-0">
            {upcomingPayments.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                Нет платежей на ближайшую неделю
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {upcomingPayments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                          p.amount >= 0 ? "bg-emerald-100" : "bg-red-100"
                        }`}
                      >
                        {p.amount >= 0 ? (
                          <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4 text-red-600" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {p.name}
                        </p>
                        <p className="text-xs text-slate-400">
                          {formatDateShort(p.date)} · {p.category}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-sm font-semibold shrink-0 ml-2 ${
                        p.amount >= 0 ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {formatMoney(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-slate-900">
              Последние операции
            </h2>
          </CardHeader>
          <CardContent className="pt-0">
            {recentTransactions.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                Нет операций
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentTransactions.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {p.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatDateShort(p.date)} ·{" "}
                        {PAYMENT_STATUS_LABELS[p.status]}
                      </p>
                    </div>
                    <span
                      className={`text-sm font-semibold shrink-0 ml-2 ${
                        p.amount >= 0 ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {formatMoney(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
