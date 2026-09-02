"use client";

import { CalendarClock, ChevronDown, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { DdsCompany } from "@/components/payments/ddsCompanies";
import { formatDate, formatMoney } from "@/lib/format";
import type { Account } from "@/lib/types";
import type { OverdueLoanInstallment } from "./loanPaymentReschedule";

export function OverdueLoanQueue({
  installments,
  today,
  accounts,
  companies,
  companyByPayment,
  onReschedule,
}: {
  installments: OverdueLoanInstallment[];
  today: string;
  accounts: Account[];
  companies: DdsCompany[];
  companyByPayment: Map<string, string | null>;
  onReschedule: (installment: OverdueLoanInstallment, targetDate: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const companyNames = new Map(companies.map((company) => [company.id, company.name]));
  const total = installments.reduce((sum, installment) => sum + installment.total, 0);

  if (!installments.length) return null;

  return (
    <section aria-labelledby="overdue-loans-title" className="overflow-hidden rounded-2xl border border-rose-300 bg-white shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="overdue-loans-list"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-14 w-full items-center justify-between gap-4 bg-rose-50 px-4 py-3 text-left transition hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-rose-500"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700"><TriangleAlert className="h-5 w-5" /></span>
          <span className="min-w-0">
            <span id="overdue-loans-title" className="block font-bold text-rose-950">Просроченные кредиты требуют новой даты</span>
            <span className="mt-0.5 block text-sm text-rose-800">{installments.length} платежей · {formatMoney(total)}. Они исключены из календаря до ручного переноса.</span>
          </span>
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-rose-700 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div id="overdue-loans-list" className="space-y-3 p-4">
          <div role="alert" className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Выберите новую дату отдельно для каждого платежа. Только после нажатия «Перенести в календарь» он появится в плане и повлияет на остаток.</p>
          </div>
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
          <div className="space-y-3">
            {installments.map((installment) => {
              const first = installment.payments[0];
              const companyId = companyByPayment.get(first.id);
              const targetDate = dates[installment.key] ?? "";
              const busy = busyKey === installment.key;
              return (
                <article key={installment.key} className="rounded-xl border border-slate-200 p-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_180px_220px] lg:items-end">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="rounded-md bg-rose-100 px-2 py-1 text-xs font-bold text-rose-800">Просрочен с {formatDate(installment.dueDate)}</span>
                        <strong className="tabular-nums text-slate-950">{formatMoney(installment.total)}</strong>
                      </div>
                      <p className="mt-2 font-semibold text-slate-900">{first.counterparty || first.name || "Кредитор не указан"}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {companyId ? companyNames.get(companyId) ?? "Компания не найдена" : "Компания не назначена"}
                        {" · "}{accountNames.get(first.accountId) ?? "Счёт не найден"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {installment.payments.map((payment) => (
                          <span key={payment.id} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">{payment.category || payment.name}: {formatMoney(Math.abs(payment.amount))}</span>
                        ))}
                      </div>
                    </div>
                    <label className="text-xs font-semibold text-slate-700">Новая дата
                      <input
                        type="date"
                        min={today}
                        value={targetDate}
                        onChange={(event) => setDates((current) => ({ ...current, [installment.key]: event.target.value }))}
                        className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!targetDate || targetDate < today || busy}
                      onClick={async () => {
                        setBusyKey(installment.key);
                        setError(null);
                        try {
                          await onReschedule(installment, targetDate);
                          setDates((current) => {
                            const next = { ...current };
                            delete next[installment.key];
                            return next;
                          });
                        } catch (caught) {
                          setError(caught instanceof Error ? caught.message : "Не удалось перенести платёж. Попробуйте ещё раз.");
                        } finally {
                          setBusyKey(null);
                        }
                      }}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
                      {busy ? "Переношу…" : "Перенести в календарь"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
