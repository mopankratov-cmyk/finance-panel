"use client";

import { usePathname } from "next/navigation";
import { needsFinanceHydration } from "@/lib/navigation/financeHydration";
import { Sidebar } from "./Sidebar";
import { useFinance } from "./providers/FinanceProvider";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { hydrated, loadError } = useFinance();
  const pathname = usePathname();
  // Страница входа и публичная политика конфиденциальности — без сайдбара и без гейта загрузки финансов
  if (pathname === "/login" || pathname === "/privacy") return <>{children}</>;
  // Кокпиты WB, Ozon и «Склад» имеют собственные shell и кабинетные контексты и не
  // должны ждать гидрацию финансового провайдера. Общий сайдбар им тоже не нужен:
  // модуль показывает слева свои разделы, а не навигацию всей панели.
  if (pathname.startsWith("/wb") || pathname.startsWith("/ozon") || pathname.startsWith("/warehouse")) {
    return <div className="min-h-screen bg-gray-50">{children}</div>;
  }
  // Главная — полноэкранная, без финансового сайдбара.
  const isLauncher = pathname === "/";
  const isFullscreen = isLauncher;
  const requiresFinanceHydration = needsFinanceHydration(pathname);

  if (requiresFinanceHydration && !hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F5F5]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
          <p className="text-sm text-slate-500">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (requiresFinanceHydration && loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F5F5] px-4">
        <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-semibold text-red-600">
            Ошибка загрузки данных
          </p>
          <p className="mt-2 text-sm text-slate-500">{loadError}</p>
          <p className="mt-4 text-xs text-slate-400">
            Убедитесь, что таблицы созданы в Supabase (см. supabase/schema.sql)
          </p>
        </div>
      </div>
    );
  }

  if (isFullscreen) {
    return <div className="min-h-screen bg-gray-50">{children}</div>;
  }

  return (
    <div className="flex min-h-screen bg-[#F5F5F5]">
      <Sidebar />
      <main className="min-w-0 flex-1 lg:ml-64">
        <div className="px-4 py-6 pt-16 lg:px-8 lg:py-8 lg:pt-8">
          {children}
        </div>
      </main>
    </div>
  );
}
