"use client";

import { ChevronLeft, ChevronRight, Loader2, ScrollText, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Журнал действий (ТЗ §17).
 *
 * Экран отвечает на три вопроса, и все три — вопросы «кто это сделал»:
 * что произошло, кто это сделал и что было до. Поэтому старое и новое
 * значения показаны рядом, а не по клику: разница между ними и есть событие,
 * и прятать её за раскрытие значит прятать сам смысл записи.
 */

interface AuditRow {
  id: number;
  created_at: string;
  actor_email: string | null;
  actor_roles: string[] | null;
  action: string;
  subject: string | null;
  before_data: unknown;
  after_data: unknown;
  ip: string | null;
}

/** Подписи событий. Метка машинная, человеку нужна фраза. */
const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Вход в систему",
  "auth.logout": "Выход",
  "auth.login.failed": "Неудачный вход",
  "user.create": "Заведён сотрудник",
  "user.update": "Изменён сотрудник",
  "user.block": "Блокировка или удаление",
  "user.role.assign": "Назначена роль",
  "user.scope.assign": "Выдана область доступа",
  "payroll.change": "Зарплата",
  "cost.change": "Себестоимость",
  "price.change": "Цены и скидки",
  "ads.budget.change": "Рекламный бюджет",
  "supply.change": "Поставка",
  "mp_report.sync": "Загрузка отчёта",
  "mp_report.reclassify": "Классификация операции",
  "payment.create": "Платёж создан",
  "payment.update": "Платёж изменён",
  "payment.approve": "Платёж утверждён",
  "warehouse.receipt": "Складская приёмка",
  "warehouse.move": "Перемещение",
  "warehouse.writeoff": "Списание",
  "warehouse.discrepancy": "Расхождение",
  "data.export": "Выгрузка данных",
};

/** Тон записи: отказ входа и списание должны читаться иначе, чем просмотр. */
const ACTION_TONE = (action: string) => {
  if (action === "auth.login.failed") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (action.startsWith("user.") || action.startsWith("payroll")) return "bg-violet-50 text-violet-700 ring-violet-200";
  if (action.startsWith("warehouse.") || action === "cost.change") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (action.startsWith("payment.")) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
};

const time = (iso: string) => new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });

/** Значение показывается компактно: журнал читают глазами, а не парсером. */
function Value({ data }: { data: unknown }) {
  if (data == null) return <span className="text-slate-300">—</span>;
  const entries = typeof data === "object" && !Array.isArray(data) ? Object.entries(data as Record<string, unknown>) : null;
  if (!entries) return <span className="break-all font-mono text-[10px] text-slate-600">{String(data)}</span>;
  if (!entries.length) return <span className="text-slate-300">—</span>;
  return (
    <ul className="space-y-0.5">
      {entries.slice(0, 6).map(([key, value]) => (
        <li key={key} className="break-all font-mono text-[10px] leading-4 text-slate-600">
          <span className="text-slate-400">{key}:</span> {value == null ? "—" : String(typeof value === "object" ? JSON.stringify(value) : value).slice(0, 80)}
        </li>
      ))}
      {entries.length > 6 ? <li className="text-[10px] text-slate-400">…ещё {entries.length - 6}</li> : null}
    </ul>
  );
}

export function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [subject, setSubject] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (action) params.set("action", action);
    if (actor) params.set("actor", actor);
    if (subject) params.set("subject", subject);
    try {
      const res = await fetch(`/api/audit?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Не удалось загрузить журнал");
      setRows(body.rows ?? []);
      setTotal(body.total ?? 0);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить журнал");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, action, actor, subject]);

  useEffect(() => { void load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / 100));
  const actions = useMemo(() => Object.keys(ACTION_LABEL).sort((a, b) => (ACTION_LABEL[a] > ACTION_LABEL[b] ? 1 : -1)), []);

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 sm:px-5">
      <header className="flex flex-wrap items-center gap-3">
        <ScrollText className="h-5 w-5 text-slate-400" />
        <div>
          <h1 className="text-lg font-bold text-slate-900">Журнал действий</h1>
          <p className="text-[11px] text-slate-400">
            Кто, что и когда изменил. Записи не удаляются и не правятся — этих прав нет даже у панели.
          </p>
        </div>
        <span className="ml-auto text-xs text-slate-500">{total.toLocaleString("ru-RU")} записей</span>
      </header>

      <div className="flex flex-wrap gap-2">
        <select
          value={action}
          onChange={(event) => { setPage(0); setAction(event.target.value); }}
          className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 sm:h-9"
          aria-label="Событие"
        >
          <option value="">Все события</option>
          {actions.map((key) => <option key={key} value={key}>{ACTION_LABEL[key]}</option>)}
        </select>
        <label className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={actor}
            onChange={(event) => { setPage(0); setActor(event.target.value); }}
            type="search" enterKeyHint="search" placeholder="Кто (почта)"
            className="h-11 w-48 rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-violet-400 sm:h-9"
          />
        </label>
        <label className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={subject}
            onChange={(event) => { setPage(0); setSubject(event.target.value); }}
            type="search" enterKeyHint="search" placeholder="Над чем (артикул, почта)"
            className="h-11 w-56 rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-violet-400 sm:h-9"
          />
        </label>
      </div>

      {error ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">{error}</p>
      ) : null}

      <div className="scroll-x rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[980px] text-[11px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Когда</th>
              <th className="px-3 py-2 text-left">Кто</th>
              <th className="px-3 py-2 text-left">Событие</th>
              <th className="px-3 py-2 text-left">Над чем</th>
              <th className="px-3 py-2 text-left">Было</th>
              <th className="px-3 py-2 text-left">Стало</th>
              <th className="px-3 py-2 text-left">Адрес</th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400"><Loader2 className="mx-auto h-4 w-4 animate-spin motion-reduce:animate-none" /></td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-[11px] text-slate-400">
                {error ? "Журнал недоступен" : "Записей нет — под выбранный фильтр ничего не попало"}
              </td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 align-top">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500">{time(row.created_at)}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-700">{row.actor_email ?? <span className="text-slate-400">без сессии</span>}</div>
                  {row.actor_roles?.length ? <div className="text-[10px] text-slate-400">{row.actor_roles.join(", ")}</div> : null}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${ACTION_TONE(row.action)}`}>
                    {ACTION_LABEL[row.action] ?? row.action}
                  </span>
                </td>
                <td className="break-all px-3 py-2 text-slate-600">{row.subject ?? <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-2"><Value data={row.before_data} /></td>
                <td className="px-3 py-2"><Value data={row.after_data} /></td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-slate-400">{row.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Страница {page + 1} из {pages}</span>
        <div className="flex gap-2">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 font-semibold disabled:opacity-40 sm:min-h-9">
            <ChevronLeft className="h-3.5 w-3.5" />Назад
          </button>
          <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 font-semibold disabled:opacity-40 sm:min-h-9">
            Вперёд<ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
