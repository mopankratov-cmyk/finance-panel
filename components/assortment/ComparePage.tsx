"use client";

import Link from "next/link";
import { plural } from "@/lib/warehouse/plural";
import { ArrowLeft, ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import { ASSORTMENT_BASE_PATH, DIRECTION_LABEL, type AssortmentDirection } from "@/lib/assortment/constants";
import type { CompareResult } from "@/lib/assortment/attributes";
import type { CompareCard } from "@/lib/assortment/model";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: { models: CompareCard[] } & CompareResult };

/** Сравнение 2–6 моделей: фото рядом, признаки построчно, общее и различия. */
export function ComparePage({ direction, ids }: { direction: AssortmentDirection; ids: string[] }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const base = `${ASSORTMENT_BASE_PATH}/${direction}`;
  const key = ids.join(",");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/assortment-development/compare?direction=${direction}&ids=${encodeURIComponent(key)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setState({ kind: "error", message: body?.error || `Сравнение не загрузилось (${response.status})` });
        else setState({ kind: "ready", data: body });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, [direction, key]);

  const columns = state.kind === "ready" ? state.data.models.length : 0;
  const minWidth = 180 + columns * 200;

  return (
    <div className="px-3 pb-16 pt-4 sm:px-6 md:pb-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <Link href={base} className="inline-flex h-10 items-center gap-1.5 self-start text-sm text-violet-700 hover:text-violet-900">
          <ArrowLeft className="h-4 w-4" /> {DIRECTION_LABEL[direction]}
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">
          Сравнение{state.kind === "ready" && ` · ${state.data.models.length} ${plural(state.data.models.length, "модель", "модели", "моделей")}`}
        </h1>

        {state.kind === "loading" && <div className="text-sm text-slate-500">Загружаем модели…</div>}
        {state.kind === "error" && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>}

        {state.kind === "ready" && (
          <>
            {state.data.models.length < ids.length && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Часть моделей не найдена в разделе «{DIRECTION_LABEL[direction]}» — сравниваем {state.data.models.length}.
              </div>
            )}
            <div className="scroll-x rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-sm" style={{ minWidth }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 w-[180px] bg-white p-3" />
                    {state.data.models.map((m) => (
                      <th key={m.id} className="p-3 text-left align-top font-normal">
                        <Link href={`${base}/${m.id}`} className="block">
                          <div className="aspect-[4/5] overflow-hidden rounded-xl bg-[#ece9e3]">
                            {m.coverUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.coverUrl} alt={m.title} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full items-center justify-center text-slate-400"><ImageOff className="h-8 w-8" /></div>
                            )}
                          </div>
                          <div className="mt-2 line-clamp-2 font-semibold text-slate-900">{m.title}</div>
                        </Link>
                        <div className="text-xs text-slate-500 break-anywhere">{[m.brand, m.article].filter(Boolean).join(" · ")}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.data.rows.map((row) => (
                    <tr key={row.key}>
                      {/* Названия признаков не уезжают при прокрутке к третьей модели: иначе значения нечем подписать. */}
                      <th scope="row" className="sticky left-0 z-10 border-r border-slate-100 bg-white p-3 text-left align-top font-normal text-slate-500">{row.label}</th>
                      {row.values.map((value, index) => (
                        <td key={index} className={`p-3 align-top ${value ? "text-slate-900" : "text-slate-400"}`}>{value ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                  {state.data.rows.length === 0 && (
                    <tr>
                      <td colSpan={columns + 1} className="p-4 text-center text-slate-500">Признаков пока нет ни у одной модели — заполните их в карточках.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">Общее</div>
                {state.data.common.length > 0 ? (
                  <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-slate-700">{state.data.common.map((line) => <li key={line}>{line}</li>)}</ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">Совпадений по заполненным признакам нет.</p>
                )}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">Различия</div>
                {state.data.differences.length > 0 ? (
                  <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-slate-700">{state.data.differences.map((line) => <li key={line}>{line}</li>)}</ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">Различий по заполненным признакам нет.</p>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-500">Общее и различия собраны только из признаков карточек — с сайта и вручную. Оценки ИИ по фото добавятся позже.</p>
          </>
        )}
      </div>
    </div>
  );
}
