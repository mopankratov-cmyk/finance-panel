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
    // Экран раньше на ЛЮБУЮ ошибку советовал проверить таблицы в Supabase.
    // Чаще всего сюда попадают не разработчики, а человек с телефона или
    // планшета, у которого просто нет сессии: ему предлагали чинить базу
    // вместо кнопки «Войти». Причина у ошибки бывает трёх сортов, и говорить
    // о них надо разное.
    const unauthorized = /не авторизован|требуется вход|недостаточно прав|\b401\b|\b403\b/i.test(loadError);
    const schemaMissing = /PGRST2\d\d|does not exist|relation|schema cache|supabase/i.test(loadError);
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F5F5] px-4">
        <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-semibold text-red-600">
            {unauthorized ? "Нужно войти" : "Ошибка загрузки данных"}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {unauthorized
              ? "Сессия закончилась или на этом устройстве вход ещё не выполнен."
              : loadError}
          </p>
          {unauthorized ? (
            <a
              href="/login"
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-violet-700"
            >
              Войти
            </a>
          ) : (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Повторить
            </button>
          )}
          {!unauthorized && schemaMissing ? (
            <p className="mt-4 text-xs text-slate-400">
              Похоже, в базе нет нужной таблицы — см. supabase/schema.sql
            </p>
          ) : null}
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
