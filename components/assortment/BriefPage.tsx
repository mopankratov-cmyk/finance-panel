"use client";

import Link from "next/link";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { periodLabel } from "@/lib/assortment/collections";
import type { BriefView } from "@/lib/assortment/collectionsStore";
import { ASSORTMENT_BASE_PATH, DIRECTION_LABEL } from "@/lib/assortment/constants";
import { ruDate } from "@/lib/assortment/evidence";
import { sampleLinks } from "@/lib/assortment/whereToBuy";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; brief: BriefView };

/**
 * Задание на образец для своей фабрики — из сохранённой версии подборки.
 * Страница для печати в PDF прямо из браузера; рядом CSV для Excel и JSON.
 */
export function BriefPage({ id, version }: { id: string; version: number | null }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const query = version ? `&version=${version}` : "";
  const exportUrl = `/api/assortment-development/collections/${id}/export`;

  useEffect(() => {
    let cancelled = false;
    fetch(`${exportUrl}?format=view${query}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setState({ kind: "error", message: body?.error || `Задание не загрузилось (${response.status})` });
        else setState({ kind: "ready", brief: body.brief });
      })
      .catch(() => !cancelled && setState({ kind: "error", message: "Нет связи с сервером" }));
    return () => {
      cancelled = true;
    };
  }, [exportUrl, query]);

  const back = `${ASSORTMENT_BASE_PATH}/collections/${id}`;
  if (state.kind !== "ready") {
    return (
      <div className="px-3 py-6 sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-3">
          <Link href={back} className="inline-flex h-10 items-center gap-1.5 self-start text-sm text-violet-700"><ArrowLeft className="h-4 w-4" /> К подборке</Link>
          {state.kind === "loading" ? <div className="text-sm text-slate-500">Собираем задание…</div> : <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>}
        </div>
      </div>
    );
  }

  const { collection, items, photos } = state.brief;
  const button = "inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 hover:bg-slate-50";

  return (
    <div className="px-3 pb-16 pt-4 sm:px-6 md:pb-6 print:p-0">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <Link href={back} className="inline-flex h-10 items-center gap-1.5 text-sm text-violet-700 hover:text-violet-900"><ArrowLeft className="h-4 w-4" /> К подборке</Link>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => window.print()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800">
              <Printer className="h-4 w-4" /> Печать или PDF
            </button>
            <a href={`${exportUrl}?format=csv&version=${collection.version}`} className={button}><Download className="h-4 w-4" /> CSV</a>
            <a href={`${exportUrl}?format=json&version=${collection.version}`} className={button}><Download className="h-4 w-4" /> JSON</a>
          </div>
        </div>

        <article className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-8 print:rounded-none print:border-0 print:p-0">
          <header className="flex flex-col gap-2 border-b border-slate-200 pb-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Задание на разработку образцов</div>
            <h1 className="text-2xl font-semibold text-slate-900">{collection.title}</h1>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Раздел</dt><dd>{DIRECTION_LABEL[collection.direction]} · {periodLabel(collection.period)}</dd>
              <dt className="text-slate-500">Версия</dt><dd>{collection.version} от {ruDate(collection.savedAt)}</dd>
              <dt className="text-slate-500">Ответственный</dt><dd>{collection.responsible || "не назначен"}</dd>
              <dt className="text-slate-500">Сохранил</dt><dd className="break-anywhere">{collection.savedBy}</dd>
            </dl>
            <p className="text-sm leading-6 text-slate-600">
              Задание для изучения конструкции дизайнером и конструктором собственного производства. Это не заказ партии и не обещание
              лекал по фото: после получения образца приложите свои фотографии и замечания. Цены не указываются.
            </p>
          </header>

          {items.map((item) => {
            const pics = photos[item.referenceId] ?? [];
            return (
              <section key={item.referenceId} className="flex flex-col gap-3 border-b border-slate-100 pb-6 last:border-0" style={{ breakInside: "avoid" }}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">{item.position}</span>
                  <h2 className="text-lg font-semibold text-slate-900">{item.idea || item.title}</h2>
                </div>
                {pics.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {pics.map((src, index) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={index} src={src} alt={`${item.title} — фото ${index + 1}`} className="aspect-[4/5] w-full rounded-lg bg-[#ece9e3] object-cover" />
                    ))}
                  </div>
                )}
                <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[200px_minmax(0,1fr)]">
                  <dt className="text-slate-500">Референс</dt>
                  <dd className="break-anywhere">
                    {[item.brand, item.title].filter(Boolean).join(" · ")}
                    {item.article && ` · арт. ${item.article}`}
                    {item.sourceUrl && <> · <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-violet-700">{item.sourceUrl.replace(/^https?:\/\/(www\.)?/, "")}</a></>}
                  </dd>
                  <dt className="text-slate-500">Детали для изучения</dt>
                  <dd>{item.details.length > 0 ? item.details.join("; ") : "не указаны"}</dd>
                  {item.attributes.length > 0 && (<><dt className="text-slate-500">Признаки</dt><dd>{item.attributes.map((a) => `${a.label}: ${a.value}`).join("; ")}</dd></>)}
                  <dt className="text-slate-500">Идея разработки: отличия нашей модели</dt>
                  <dd>{item.differences || "не указаны"}</dd>
                  <dt className="text-slate-500">Вопросы к образцу</dt>
                  <dd className="whitespace-pre-line">{item.questions || "не указаны"}</dd>
                  <dt className="text-slate-500">Сезон и аудитория</dt>
                  <dd>{item.seasonFit || "не указано"}</dd>
                  <dt className="text-slate-500">Что наблюдается</dt>
                  <dd>{item.observed.length > 0 ? item.observed.join("; ") : "наблюдений нет"}</dd>
                  <dt className="text-slate-500">Каких фактов нет</dt>
                  <dd className="text-slate-600">{item.missing.length > 0 ? item.missing.join("; ") : "—"}</dd>
                  <dt className="text-slate-500">Следующий шаг</dt>
                  <dd className="font-medium">{item.nextStep || "не указан"}</dd>
                  <dt className="text-slate-500">Где купить образец</dt>
                  <dd className="flex flex-wrap gap-x-3 gap-y-1">
                    {sampleLinks({ brand: item.brand, title: item.title, article: item.article, url: item.sourceUrl }).map((link) => (
                      <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer" className="text-violet-700">{link.label}</a>
                    ))}
                  </dd>
                </dl>
              </section>
            );
          })}
          <footer className="text-xs text-slate-500">Фото — референсы из открытых источников, только для внутренней работы.</footer>
        </article>
      </div>
    </div>
  );
}
