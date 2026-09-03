"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { WbErrorState } from "./WbModuleHeader";
import { WbProductImage } from "./WbProductImage";

interface Competitor {
  nmId: number;
  label: string | null;
  brand: string | null;
  img: string | null;
  price: number | null;
  collectedAt: string | null;
}

export interface CompetitorItem {
  nmId: number;
  article: string | null;
  name: string | null;
  brand: string | null;
  img: string | null;
  ourPrice: number | null;
  ourCollectedAt: string | null;
  competitors: Competitor[];
  average: number | null;
  diffPct: number | null;
  pending: number;
}

const money = (value: number | null) => value == null ? "—" : `${Math.round(value).toLocaleString("ru-RU")} ₽`;

/** Возраст снимка словами. «не собрано» — честнее, чем прочерк без пояснения. */
function age(iso: string | null): string {
  if (!iso) return "не собрано";
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "только что";
  if (hours < 24) return `${Math.round(hours)} ч назад`;
  return `${Math.round(hours / 24)} дн назад`;
}

/**
 * Мониторинг конкурентов — вид внутри раздела «Полки».
 *
 * Вёрстка намеренно повторяет полки: та же карточка-строка с фото, тем же
 * блоком опознания в три строки и раскрытием по клику. Это один раздел про
 * цены, и два разных языка в нём заставляли бы переучиваться при каждом
 * переключении.
 *
 * Отличие по сути: на полках конкурентов находит WB в блоке «Смотрите также»,
 * здесь список ведёт владелец сам.
 */
export function WbCompetitorsView({ cabinetId, hasExactCabinet, ready, days }: {
  cabinetId: string;
  hasExactCabinet: boolean;
  ready: boolean;
  /** Окно свежести: цена старше него не считается текущей. */
  days: number;
}) {
  const [items, setItems] = useState<CompetitorItem[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!hasExactCabinet) { setItems([]); setLoading(false); return; }
    setLoading(true); setError(null);
    fetch(`/api/wb/competitors?cabinet=${encodeURIComponent(cabinetId)}&days=${days}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        setItems(body.items ?? []);
        setNotes(Array.isArray(body.notes) ? body.notes : []);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить"))
      .finally(() => setLoading(false));
  }, [cabinetId, days, hasExactCabinet, ready]);

  if (loading) {
    return <div className="py-16 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin motion-reduce:animate-none" /></div>;
  }
  if (error) return <WbErrorState message={error} />;
  if (!hasExactCabinet) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-500">Выберите один кабинет — список конкурентов ведётся по нему.</div>;
  }
  if (!items.length) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-500">Список пуст: добавьте артикулы конкурентов к своим товарам.</div>;
  }

  // Сводка над списком — как на полках: четыре плитки одного вида. Без них
  // под шапкой оставалась пустая полоса, и раздел выглядел недоделанным.
  const withDiff = items.filter((item) => item.diffPct != null);
  const cheaper = withDiff.filter((item) => item.diffPct! < 0).length;
  const dearer = withDiff.filter((item) => item.diffPct! > 0).length;
  const links = items.reduce((sum, item) => sum + item.competitors.length, 0);
  const lastAt = items
    .flatMap((item) => item.competitors.map((competitor) => competitor.collectedAt))
    .filter((at): at is string => Boolean(at))
    .sort()
    .at(-1) ?? null;
  const tiles = [
    { label: "В реестре", value: String(items.length), hint: `${links} связей с конкурентами` },
    { label: "Мы дешевле рынка", value: cheaper ? String(cheaper) : "—", hint: `по ценам за ${days} дней`, tone: cheaper ? "text-emerald-600" : undefined },
    { label: "Мы дороже рынка", value: dearer ? String(dearer) : "—", hint: withDiff.length ? `по ценам за ${days} дней` : "нет данных", tone: dearer ? "text-rose-600" : undefined },
    { label: "Последний сбор", value: lastAt ? new Date(lastAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—", hint: lastAt ? age(lastAt) : "сборов ещё не было" },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{tile.label}</div>
            <div className={`mt-1.5 whitespace-nowrap text-[26px] font-bold leading-7 tracking-[-0.02em] tabular-nums ${tile.tone ?? "text-slate-800"}`}>{tile.value}</div>
            <div className="text-[9px] text-slate-400">{tile.hint}</div>
          </div>
        ))}
      </div>

      {notes.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Часть данных не прочиталась: {notes.join(" · ")}
        </div>
      ) : null}

      {/* Шапка колонок — как на полках: подписи один раз над списком. */}
      <div className="sticky top-[54px] z-20 -mx-2 hidden border-b border-slate-200 bg-[#f6f7f9]/95 px-5 py-2 backdrop-blur-sm sm:-mx-6 sm:flex sm:items-end sm:px-10">
        <div className="min-w-0 flex-1" />
        <div className="flex items-center gap-3">
          <div className="grid grid-cols-[110px_130px_90px_120px] gap-3">
            <div className="text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">наша</div>
            <div className="text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">средняя у них</div>
            <div className="text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">разница</div>
            <div className="text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">конкурентов</div>
          </div>
          <span className="h-4 w-4 shrink-0" aria-hidden="true" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] [&>section+section]:border-t [&>section+section]:border-slate-100">
        {items.map((item) => {
          const open = expanded === item.nmId;
          return (
            <section key={item.nmId} className="group bg-white transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-violet-50/25">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : item.nmId)}
                aria-expanded={open}
                className="flex w-full flex-wrap items-center gap-4 px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                <WbProductImage
                  nm={item.nmId}
                  src={item.img}
                  label={item.article ?? String(item.nmId)}
                  className="h-16 w-[52px] shrink-0 rounded-lg bg-slate-100 object-cover ring-1 ring-slate-200/60"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-[17px] font-bold tracking-[-0.01em] text-slate-800">{item.article ?? `WB ${item.nmId}`}</span>
                    {item.brand ? <span className="hidden shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:inline">{item.brand}</span> : null}
                  </div>
                  <div className="truncate text-[11px] font-normal tabular-nums text-slate-400">WB {item.nmId}</div>
                  {item.name ? <div className="truncate text-[11px] font-normal text-slate-500">{item.name}</div> : null}
                  <div className="mt-1 text-[12px] text-slate-400">наша цена снята {age(item.ourCollectedAt)}</div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="grid grid-cols-[110px_130px_90px_120px] gap-3">
                    <div className="text-right text-[17px] font-bold tabular-nums text-slate-800">{money(item.ourPrice)}</div>
                    <div className="text-right text-[17px] font-semibold tabular-nums text-slate-600">{money(item.average)}</div>
                    <div className={`text-right text-[17px] font-bold tabular-nums ${
                      item.diffPct == null ? "text-slate-300" : item.diffPct > 0 ? "text-rose-600" : "text-emerald-600"
                    }`}>
                      {item.diffPct == null ? "—" : `${item.diffPct > 0 ? "+" : ""}${item.diffPct}%`}
                    </div>
                    <div className="text-right text-[12px] text-slate-500">
                      {item.competitors.length}
                      {/* Неснятых называем вслух: без этого средняя выглядит
                          полной, хотя посчитана по части списка. */}
                      {item.pending ? <span className="text-amber-600"> · {item.pending} без цены</span> : null}
                    </div>
                  </div>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
                </div>
              </button>

              {open ? (
                <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                  <div className="space-y-1.5">
                    {item.competitors.map((competitor) => (
                      <div key={competitor.nmId} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200/60">
                        <WbProductImage
                          nm={competitor.nmId}
                          src={competitor.img}
                          label={String(competitor.nmId)}
                          className="h-10 w-[34px] shrink-0 rounded bg-slate-100 object-cover ring-1 ring-slate-200/60"
                        />
                        <div className="min-w-0 flex-1">
                          <a
                            href={`https://www.wildberries.ru/catalog/${competitor.nmId}/detail.aspx`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="truncate text-[13px] font-semibold text-slate-700 hover:text-violet-600"
                          >
                            {competitor.brand ?? `WB ${competitor.nmId}`}
                          </a>
                          <div className="truncate text-[11px] tabular-nums text-slate-400">
                            WB {competitor.nmId}
                            {competitor.label ? <span className="ml-2 text-slate-400">· {competitor.label}</span> : null}
                          </div>
                        </div>
                        <div className="w-[110px] shrink-0 text-right text-[15px] font-semibold tabular-nums text-slate-800">{money(competitor.price)}</div>
                        <div className="w-[110px] shrink-0 text-right text-[11px] text-slate-400">{age(competitor.collectedAt)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
