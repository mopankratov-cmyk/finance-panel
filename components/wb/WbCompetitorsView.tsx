"use client";

import { useEffect, useState, useRef } from "react";
import { ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
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

interface HistoryPoint {
  date: string;
  our: number | null;
  average: number | null;
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
  history: HistoryPoint[];
}

/**
 * Искра цены за период: наша линия и средняя по конкурентам.
 *
 * Дни без сбора остаются разрывом, а не тянутся прямой — иначе график
 * покажет стабильность там, где цену просто не мерили.
 */
function Spark({ history }: { history: HistoryPoint[] }) {
  const values = history.flatMap((point) => [point.our, point.average]).filter((v): v is number => v != null && v > 0);
  if (values.length < 2) return <span className="hidden h-[26px] w-[88px] sm:block" aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const x = (index: number) => 2 + (index / Math.max(1, history.length - 1)) * 84;
  const y = (value: number) => 22 - ((value - min) / spread) * 18;
  const line = (pick: (point: HistoryPoint) => number | null) => {
    const runs: string[] = [];
    let current: string[] = [];
    history.forEach((point, index) => {
      const value = pick(point);
      if (value == null || value <= 0) { if (current.length > 1) runs.push(current.join(" ")); current = []; return; }
      current.push(`${x(index).toFixed(1)},${y(value).toFixed(1)}`);
    });
    if (current.length > 1) runs.push(current.join(" "));
    return runs;
  };
  return (
    <svg viewBox="0 0 88 26" className="hidden h-[26px] w-[88px] sm:block" role="img" aria-label="Наша цена и средняя по конкурентам">
      {line((point) => point.average).map((points, index) => (
        <polyline key={`a${index}`} points={points} fill="none" stroke="#94a3b8" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {line((point) => point.our).map((points, index) => (
        <polyline key={`o${index}`} points={points} fill="none" stroke="#7c3aed" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      ))}
    </svg>
  );
}

/** График цены в раскрытой карточке: те же две линии, крупнее и с подписями. */
function PriceChart({ history }: { history: HistoryPoint[] }) {
  const values = history.flatMap((point) => [point.our, point.average]).filter((v): v is number => v != null && v > 0);
  if (values.length < 2) {
    return <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-[11px] text-slate-400">Для графика нужно хотя бы два дня со снятой ценой.</div>;
  }
  const W = 720;
  const H = 150;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const x = (index: number) => 40 + (index / Math.max(1, history.length - 1)) * (W - 60);
  const y = (value: number) => H - 26 - ((value - min) / spread) * (H - 50);
  const line = (pick: (point: HistoryPoint) => number | null) => {
    const runs: string[] = [];
    let current: string[] = [];
    history.forEach((point, index) => {
      const value = pick(point);
      if (value == null || value <= 0) { if (current.length > 1) runs.push(current.join(" ")); current = []; return; }
      current.push(`${x(index).toFixed(1)},${y(value).toFixed(1)}`);
    });
    if (current.length > 1) runs.push(current.join(" "));
    return runs;
  };
  const label = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px]" role="img" aria-label="Динамика нашей цены и средней по конкурентам">
        <text x="4" y={y(max) + 4} className="fill-slate-400" fontSize="9">{Math.round(max)}</text>
        <text x="4" y={y(min) + 4} className="fill-slate-400" fontSize="9">{Math.round(min)}</text>
        {line((point) => point.average).map((points, index) => (
          <polyline key={`a${index}`} points={points} fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {line((point) => point.our).map((points, index) => (
          <polyline key={`o${index}`} points={points} fill="none" stroke="#7c3aed" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {history.map((point, index) => index === 0 || index === history.length - 1 || index === Math.floor(history.length / 2) ? (
          <text key={point.date} x={x(index)} y={H - 6} textAnchor="middle" className="fill-slate-400" fontSize="9">{label(point.date)}</text>
        ) : null)}
      </svg>
      <div className="mt-1 flex gap-4 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-[2px] w-4 rounded bg-violet-600" />наша</span>
        <span className="flex items-center gap-1"><span className="h-[2px] w-4 rounded bg-slate-400" />средняя у конкурентов</span>
      </div>
    </div>
  );
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
  const [newProduct, setNewProduct] = useState("");
  const [newRival, setNewRival] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  /** Добавить товар в мониторинг или конкурента к нему. */
  const add = async (nm: string, ourNmId?: number) => {
    const nmId = Number(String(nm).replace(/\D/g, ""));
    if (!Number.isInteger(nmId) || nmId <= 0 || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/wb/competitors?cabinet=${encodeURIComponent(cabinetId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nmId, ourNmId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      if (ourNmId) setNewRival((current) => ({ ...current, [ourNmId]: "" })); else setNewProduct("");
      setReloadKey((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось добавить");
    } finally { setBusy(false); }
  };

  const remove = async (nmId: number, ourNmId?: number) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const query = new URLSearchParams({ cabinet: cabinetId, nmId: String(nmId) });
      if (ourNmId) query.set("ourNmId", String(ourNmId));
      const response = await fetch(`/api/wb/competitors?${query}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      setReloadKey((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось убрать");
    } finally { setBusy(false); }
  };

  // Период переключают подряд, и ответы возвращаются вразнобой: без счётчика
  // на экран ложились цены не за тот период, который подписан сверху.
  const requestId = useRef(0);
  useEffect(() => {
    if (!ready) return;
    if (!hasExactCabinet) { setItems([]); setLoading(false); return; }
    const current = ++requestId.current;
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetch(`/api/wb/competitors?cabinet=${encodeURIComponent(cabinetId)}&days=${days}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (current !== requestId.current) return;
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        setItems(body.items ?? []);
        setNotes(Array.isArray(body.notes) ? body.notes : []);
      })
      .catch((cause) => {
        if (current !== requestId.current || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить");
      })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, days, hasExactCabinet, ready, reloadKey]);

  if (loading && items.length === 0) {
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
      {/* Добавление товара — как на полках: номер артикула и кнопка. */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Артикул WB</span>
          <input
            value={newProduct}
            onChange={(event) => setNewProduct(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") add(newProduct); }}
            inputMode="numeric"
            placeholder="1224108263"
            className="min-h-11 w-44 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400 sm:min-h-9"
          />
        </label>
        <button
          type="button"
          onClick={() => add(newProduct)}
          disabled={busy || !newProduct.trim()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50 sm:min-h-9"
        >
          <Plus className="h-3.5 w-3.5" /> отслеживать
        </button>
        <span className="text-[11px] text-slate-400">
          Цена появится после ближайшего обхода сборщика — он ходит раз в 15 минут.
        </span>
      </div>

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
                  <Spark history={item.history} />
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
                  <div className="mb-3 rounded-lg bg-white p-3 ring-1 ring-slate-200/60">
                    <PriceChart history={item.history} />
                  </div>

                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <input
                      value={newRival[item.nmId] ?? ""}
                      onChange={(event) => setNewRival((current) => ({ ...current, [item.nmId]: event.target.value }))}
                      onKeyDown={(event) => { if (event.key === "Enter") add(newRival[item.nmId] ?? "", item.nmId); }}
                      inputMode="numeric"
                      placeholder="артикул конкурента"
                      className="min-h-10 w-52 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400"
                    />
                    <button
                      type="button"
                      onClick={() => add(newRival[item.nmId] ?? "", item.nmId)}
                      disabled={busy || !(newRival[item.nmId] ?? "").trim()}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" /> добавить конкурента
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(item.nmId)}
                      disabled={busy}
                      className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> убрать товар
                    </button>
                  </div>

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
                        <button
                          type="button"
                          onClick={() => remove(competitor.nmId, item.nmId)}
                          disabled={busy}
                          aria-label={`Убрать конкурента ${competitor.nmId}`}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
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
