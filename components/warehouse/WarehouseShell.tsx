"use client";

import { Grid3x3, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";


const ROLE_TITLE: Record<string, string> = {
  director: "Директор",
  finance: "Финансы",
  manager: "Менеджер",
  warehouse: "Оператор склада",
  seller: "Селлер",
};

export interface ShellTab<T extends string> {
  key: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Заголовок раздела в сайдбаре. Десять равнозначных пунктов подряд читаются
   *  как список настроек, а не как рабочее место. */
  group?: string;
}

/** Оболочка модуля: слева его собственные разделы, а не навигация всей панели.
 *  Выход в общее меню и аккаунт — внизу, чтобы не мешались среди рабочих вкладок. */
export function WarehouseShell<T extends string>({
  title,
  subtitle,
  tabs,
  active,
  onSelect,
  toolbar,
  me,
  children,
}: {
  title: string;
  subtitle: string;
  tabs: ShellTab<T>[];
  active: T;
  onSelect: (tab: T) => void;
  toolbar?: React.ReactNode;
  /** Кто вошёл. Приходит от страницы: она же решает по роли, какие вкладки
   *  показывать, и второй запрос за тем же ответом здесь не нужен. */
  me: { email: string; role: string } | null;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen bg-[#F5F5F5]">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-100 px-5 py-5">
          <p className="text-base font-bold text-slate-900">{title}</p>
          <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {tabs.map(({ key, label, icon: Icon, group }, index) => (
            <div key={key}>
              {group && group !== tabs[index - 1]?.group && (
                <p className={`px-3 pb-1 text-[11px] uppercase tracking-wide text-slate-400 ${index === 0 ? "" : "pt-3"}`}>
                  {group}
                </p>
              )}
              <button
                onClick={() => onSelect(key)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active === key
                    ? "bg-violet-50 font-medium text-violet-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            </div>
          ))}
        </nav>

        <div className="space-y-1 border-t border-slate-100 p-3">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <Grid3x3 className="h-4 w-4 shrink-0" />
            Все модули
          </Link>
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-slate-600">{me?.email ?? "…"}</p>
              <p className="text-[11px] text-slate-400">{ROLE_TITLE[me?.role ?? ""] ?? me?.role ?? ""}</p>
            </div>
            <button onClick={() => void logout()} title="Выйти" className="text-slate-400 hover:text-slate-700">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 lg:ml-60">
        {/* На узком экране разделы модуля едут в горизонтальную ленту — сайдбар там не помещается. */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${
                active === key ? "bg-violet-50 font-medium text-violet-700" : "text-slate-500"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="px-4 py-6 lg:px-8 lg:py-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div className="lg:hidden">
              <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
              <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
            </div>
            {toolbar}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
