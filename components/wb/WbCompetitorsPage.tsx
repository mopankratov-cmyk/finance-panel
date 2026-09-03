"use client";

import { useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface Competitor {
  nmId: number;
  label: string | null;
  price: number | null;
  collectedAt: string | null;
}

interface Item {
  nmId: number;
  article: string | null;
  name: string | null;
  ourPrice: number | null;
  ourCollectedAt: string | null;
  competitors: Competitor[];
  average: number | null;
  diffPct: number | null;
  pending: number;
}

const money = (value: number | null) => value == null ? "—" : `${Math.round(value).toLocaleString("ru-RU")} ₽`;
const ago = (iso: string | null) => {
  if (!iso) return "не собрано";
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "только что";
  if (hours < 24) return `${Math.round(hours)} ч назад`;
  return `${Math.round(hours / 24)} дн назад`;
};

export function WbCompetitorsPage() {
  const { cabinetId, hasExactCabinet, ready } = useWbCabinet();
  const [items, setItems] = useState<Item[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!ready) return;
    if (!hasExactCabinet) { setItems([]); setLoading(false); return; }
    setLoading(true); setError(null);
    fetch(`/api/wb/competitors?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        setItems(body.items ?? []);
        setNotes(Array.isArray(body.notes) ? body.notes : []);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить"))
      .finally(() => setLoading(false));
  }, [cabinetId, hasExactCabinet, ready]);

  const toggle = (nm: number) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(nm)) next.delete(nm); else next.add(nm);
    return next;
  });

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <WbModuleHeader
        icon={Users}
        title="Мониторинг конкурентов"
        description="Свой список артикулов против каждого товара — и разница в цене"
      />

      {notes.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Часть данных не прочиталась: {notes.join(" · ")}
        </div>
      ) : null}

      {error ? <WbErrorState message={error} /> : null}
      {loading ? (
        <div className="py-12 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : !hasExactCabinet ? (
        <WbEmptyState>Выберите кабинет — список конкурентов ведётся по одному.</WbEmptyState>
      ) : !items.length ? (
        <WbEmptyState>Список пуст: добавьте артикулы конкурентов к своим товарам.</WbEmptyState>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Товар</th>
                <th className="w-[120px] px-3 py-3 text-right">Наша цена</th>
                <th className="w-[130px] px-3 py-3 text-right">Средняя у них</th>
                <th className="w-[110px] px-3 py-3 text-right">Разница</th>
                <th className="w-[130px] px-3 py-3 text-center">Конкурентов</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.nmId} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3" colSpan={5}>
                    <button type="button" onClick={() => toggle(item.nmId)} className="flex w-full items-center gap-4 text-left">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-800">{item.article ?? item.nmId}</span>
                        <span className="block truncate text-xs text-slate-500">{item.name ?? `WB ${item.nmId}`}</span>
                        <span className="block text-[11px] text-slate-400">наша цена снята {ago(item.ourCollectedAt)}</span>
                      </span>
                      <span className="w-[120px] shrink-0 text-right font-semibold tabular-nums text-slate-900">{money(item.ourPrice)}</span>
                      <span className="w-[130px] shrink-0 text-right tabular-nums text-slate-700">{money(item.average)}</span>
                      <span className={`w-[110px] shrink-0 text-right font-semibold tabular-nums ${
                        item.diffPct == null ? "text-slate-400" : item.diffPct > 0 ? "text-rose-600" : "text-emerald-600"
                      }`}>
                        {item.diffPct == null ? "—" : `${item.diffPct > 0 ? "+" : ""}${item.diffPct}%`}
                      </span>
                      <span className="w-[130px] shrink-0 text-center text-xs text-slate-500">
                        {item.competitors.length}
                        {/* Неснятых называем вслух: без этого средняя выглядит
                            полной, хотя посчитана по части списка. */}
                        {item.pending ? <span className="text-amber-600"> · {item.pending} без цены</span> : null}
                      </span>
                    </button>

                    {open.has(item.nmId) ? (
                      <div className="mt-3 overflow-hidden rounded-xl border border-slate-100">
                        <table className="w-full text-xs">
                          <tbody>
                            {item.competitors.map((competitor) => (
                              <tr key={competitor.nmId} className="border-b border-slate-50 last:border-0">
                                <td className="px-3 py-2 text-slate-600">
                                  <a href={`https://www.wildberries.ru/catalog/${competitor.nmId}/detail.aspx`} target="_blank" rel="noreferrer" className="hover:text-violet-600">
                                    WB {competitor.nmId}
                                  </a>
                                  {competitor.label ? <span className="ml-2 text-slate-400">{competitor.label}</span> : null}
                                </td>
                                <td className="w-[110px] px-3 py-2 text-right tabular-nums text-slate-800">{money(competitor.price)}</td>
                                <td className="w-[130px] px-3 py-2 text-right text-slate-400">{ago(competitor.collectedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
