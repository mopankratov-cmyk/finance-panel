"use client";

import { Loader2, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useFinance } from "@/components/providers/FinanceProvider";
import { loadFinanceState } from "@/lib/db";
import { loadDdsCompanies, type DdsCompany } from "./ddsCompanies";
import { PayrollRegister } from "./PayrollRegister";

export function PayrollPage() {
  const { state, dispatch } = useFinance();
  const [companies, setCompanies] = useState<DdsCompany[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [companyError, setCompanyError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadDdsCompanies()
      .then((loaded) => {
        if (cancelled) return;
        setCompanies(loaded);
        setCompanyError("");
      })
      .catch((error) => {
        if (!cancelled) setCompanyError(error instanceof Error ? error.message : "Не удалось загрузить компании");
      })
      .finally(() => {
        if (!cancelled) setLoadingCompanies(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
          <UsersRound className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Зарплатная ведомость</h1>
          <p className="mt-1 text-sm text-slate-500">Сотрудники, начисления, налоги, выплаты и задолженность.</p>
        </div>
      </header>

      {loadingCompanies ? (
        <div role="status" className="flex min-h-28 items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Загружаю компании…
        </div>
      ) : (
        <>
          {companyError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{companyError}. Сотрудников можно просматривать, но перед сохранением ведомости нужно обновить страницу.</div>}
          <PayrollRegister
            accounts={state.accounts}
            companies={companies}
            payments={state.payments}
            onCalendarUpdated={async () => dispatch({ type: "LOAD", payload: await loadFinanceState() })}
          />
        </>
      )}
    </div>
  );
}
