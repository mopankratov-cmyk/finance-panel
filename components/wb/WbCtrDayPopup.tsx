"use client";

import { Loader2, MessageSquare, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CtrCampaignRow } from "@/app/api/wb/ctr-breakdown/route";
import { Hint } from "@/components/ui/Hint";
import { CTR_NOTE_COLORS, ctrNoteColor, type CtrNoteColor } from "@/lib/wb/ctrNoteColors";

interface Breakdown {
  meta: { minViews: number };
  data: { campaigns: CtrCampaignRow[]; total: { views: number; clicks: number; ctr: number | null } };
}

const fmt = (value: number) => value.toLocaleString("ru-RU");
const pct = (value: number | null) => (value == null ? "—" : `${value.toFixed(1)}%`);

/**
 * Из чего сложился CTR за день и что о нём известно.
 *
 * Цифра в таблице — сумма нескольких кампаний: ЕРК и пара СРС на один артикул
 * обычное дело. Когда CTR проседает, первый вопрос «какая кампания просела», и
 * до сих пор ответ искали руками в кабинете WB.
 *
 * Пометка живёт рядом с клеткой, к которой относится: через неделю никто не
 * помнит, почему 18-го числа было так. Пометка — это цвет, текст или и то и
 * другое: цвет видно сразу всей сеткой, текст объясняет подробности. Что
 * означает каждый цвет, решает сам продавец — панель значения не навязывает.
 */
export function WbCtrDayPopup({
  cabinetId, nmId, date, article, cellViews, cellClicks, onClose, onNoteSaved,
}: {
  cabinetId: string;
  nmId: number;
  date: string;
  article: string;
  /** Показы и клики из самой клетки: по ним отличаем «кампаний не было» от
   *  «разбивку не сохраняли». Без этого пустой разбор врал бы про день. */
  cellViews: number;
  cellClicks: number;
  onClose: () => void;
  /** Сообщаем таблице, чтобы она обновила пометку без перезагрузки. */
  onNoteSaved: (nmId: number, date: string, note: string, color: CtrNoteColor | null) => void;
}) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [color, setColor] = useState<CtrNoteColor | null>(null);
  const [savedColor, setSavedColor] = useState<CtrNoteColor | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Портал в body: окно рендерится внутри прокручиваемого контейнера таблицы,
  // и без портала затемнение оставалось бы внутри него — шапка и боковое меню
  // светились бы поверх. Через body перекрывается весь экран.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/wb/ctr-breakdown?cabinet=${encodeURIComponent(cabinetId)}&nm=${nmId}&date=${date}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<Breakdown> : Promise.reject(new Error("Не удалось получить разбивку"))),
      fetch(`/api/wb/ctr-notes?cabinet=${encodeURIComponent(cabinetId)}&from=${date}&till=${date}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() : { notes: [] }),
    ])
      .then(([breakdown, notes]) => {
        if (controller.signal.aborted) return;
        setData(breakdown);
        const own = (notes.notes ?? []).find((row: { nmId: number }) => row.nmId === nmId);
        setNote(own?.note ?? "");
        setSavedNote(own?.note ?? "");
        setColor(ctrNoteColor(own?.color));
        setSavedColor(ctrNoteColor(own?.color));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Ошибка загрузки");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, nmId, date]);

  // Escape закрывает, фокус уходит в окно: клавиатурой пользоваться можно.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    // Прокрутка страницы под затемнением сбивает с толку: таблица уезжает,
    // а окно остаётся. Возвращаем прежнее значение, а не ставим "" вслепую.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/wb/ctr-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cabinetId, nmId, date, note, color }),
      });
      const body = await response.json();
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Не удалось сохранить");
      const nextColor = ctrNoteColor(body.color);
      setSavedNote(body.note ?? "");
      setSavedColor(nextColor);
      setColor(nextColor);
      onNoteSaved(nmId, date, body.note ?? "", nextColor);
      // Сервер принял текст, но не цвет: колонка ещё не заведена в базе.
      // Говорим об этом прямо — иначе цвет «пропадёт» после перезагрузки.
      if (body.colorSkipped) setError("Текст сохранён, а цвет пока не сохраняется: колонка цветов ещё не заведена в базе");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }, [cabinetId, nmId, date, note, color, onNoteSaved]);

  const dirty = note.trim() !== savedNote.trim() || color !== savedColor;
  const empty = !note.trim() && !color;
  const hasSaved = Boolean(savedNote.trim() || savedColor);
  const dayLabel = new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`CTR ${article} за ${dayLabel}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[calc(100dvh-2rem-var(--kb-inset))] w-full max-w-2xl overflow-auto overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-xl focus:outline-none"
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-slate-800">{article}</div>
            <div className="text-[12px] text-slate-400">CTR за {dayLabel} · nm {nmId}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="tap ml-auto rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-5 py-8 text-[13px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Собираем разбивку по кампаниям
          </div>
        ) : error ? (
          <div className="px-5 py-6 text-[13px] text-rose-600">{error}</div>
        ) : (
          <>
            <div className="px-5 py-4">
              {data?.data.campaigns.length ? (
                <table className="w-full text-[12px]">
                  <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="pb-2 text-left font-semibold">Кампания</th>
                      <th className="pb-2 text-right font-semibold">Показы</th>
                      <th className="pb-2 text-right font-semibold">Клики</th>
                      {/*
                        Правило прочерка объясняем один раз в шапке столбца, а
                        не подсказкой у каждого «—»: оно одно на весь столбец, и
                        `title` на прочерке пальцем не открывался вовсе.
                      */}
                      <th className="pb-2 text-right font-semibold">
                        <span className="inline-flex items-center gap-1">
                          CTR
                          <Hint label="Что такое CTR и почему бывает прочерк">
                            CTR — клики, делённые на показы. Прочерк вместо числа стоит там, где показов меньше {data?.meta.minViews ?? 0}: на таком объёме доля клика ничего не значит.
                          </Hint>
                        </span>
                      </th>
                      <th className="pb-2 text-right font-semibold">Расход</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.campaigns.map((row) => (
                      <tr key={row.advertId} className="border-t border-slate-100">
                        <td className="py-1.5 pr-3">
                          {/*
                            Название кампании на узком экране переносится, а не
                            обрезается: `title` с полным именем на телефоне не
                            открыть, и от «Автоматическая кампания…» оставалось
                            два слова. С планшета и шире — прежняя одна строка.
                          */}
                          <div className="break-anywhere line-clamp-2 text-slate-700 sm:line-clamp-none sm:truncate" title={row.name}>{row.name}</div>
                          <div className="text-[10px] tabular-nums text-slate-400">№ {row.advertId}</div>
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-slate-600">{fmt(row.views)}</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-600">{fmt(row.clicks)}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold text-slate-800">
                          {row.ctr == null
                            ? <span className="font-normal text-slate-300" title={`Меньше ${data.meta.minViews} показов — доля клика ничего не значит`}>—</span>
                            : pct(row.ctr)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-slate-600">{fmt(Math.round(row.spent))} ₽</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-200 font-semibold">
                      <td className="py-2 text-slate-700">Итого</td>
                      <td className="py-2 text-right tabular-nums text-slate-800">{fmt(data.data.total.views)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-800">{fmt(data.data.total.clicks)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-900">{pct(data.data.total.ctr)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              ) : cellViews > 0 ? (
                // Показы в этот день были, а разбивки нет: сырой слой по
                // кампаниям начали вести позже. Сказать «кампаний не было»
                // значило бы соврать про день, которого мы просто не помним.
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
                  <div className="font-semibold">Разбивка по кампаниям за этот день не сохранялась</div>
                  <p className="mt-0.5">
                    Реклама в этот день шла — {fmt(cellViews)} показов и {fmt(cellClicks)} кликов, — но по каким
                    кампаниям, мы не знаем: слой с разбивкой начали вести позже. За свежие дни разбор полный.
                  </p>
                </div>
              ) : (
                <p className="text-[13px] text-slate-500">В этот день по артикулу не было ни одной кампании с показами.</p>
              )}
            </div>

            <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
              <label htmlFor="ctr-note" className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> Пометка к этому дню
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Цвет пометки">
                <button
                  type="button"
                  role="radio"
                  aria-checked={color === null}
                  onClick={() => setColor(null)}
                  title="Без цвета"
                  className={`grid h-7 w-7 place-items-center rounded-full border text-slate-400 transition-colors hover:border-slate-400 ${color === null ? "border-slate-800 ring-2 ring-slate-300" : "border-slate-200"}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                {CTR_NOTE_COLORS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="radio"
                    aria-checked={color === item.key}
                    aria-label={item.label}
                    title={item.label}
                    onClick={() => setColor(item.key)}
                    className={`h-7 w-7 rounded-full ${item.swatch} transition-transform hover:scale-110 ${color === item.key ? "ring-2 ring-slate-800 ring-offset-2" : ""}`}
                  />
                ))}
                <span className="ml-1 text-[11px] text-slate-400">цветом размечают дни, смысл выбираете вы</span>
              </div>
              <textarea
                id="ctr-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="Например: сменили обложку · кампания встала на модерации · подняли ставку"
                className="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 placeholder:text-slate-300 focus:border-violet-400 focus:outline-none"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || !dirty}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
                >
                  {saving ? "Сохраняем…" : hasSaved && empty ? "Удалить пометку" : "Сохранить"}
                </button>
                {!dirty && hasSaved ? <span className="text-[11px] text-emerald-600">пометка сохранена</span> : null}
                <button type="button" onClick={onClose} className="ml-auto text-[12px] text-slate-500 hover:text-slate-700">Закрыть</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
