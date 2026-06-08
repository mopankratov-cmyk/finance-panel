"use client";

import { Sidebar } from "./Sidebar";
import { useFinance } from "./providers/FinanceProvider";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { hydrated, loadError } = useFinance();

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="max-w-md rounded-xl border border-red-800/60 bg-slate-900 p-6 text-center">
          <p className="text-lg font-semibold text-red-400">
            Ошибка загрузки данных
          </p>
          <p className="mt-2 text-sm text-slate-400">{loadError}</p>
          <p className="mt-4 text-xs text-slate-500">
            Убедитесь, что таблицы созданы в Supabase (см. supabase/schema.sql)
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-950">
      <Sidebar />
      <main className="flex-1 lg:ml-64">
        <div className="px-4 py-6 pt-16 lg:px-8 lg:py-8 lg:pt-8">
          {children}
        </div>
      </main>
    </div>
  );
}
