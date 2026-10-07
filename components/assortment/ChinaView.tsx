"use client";

import Link from "next/link";
import { ExternalLink, ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import { CHINA_LINKS_PATH, nicheLinks, nicheShortLabel, offerLink } from "@/lib/assortment/chinaLinks";
import { CHINA_NICHES } from "@/lib/assortment/chinaNiches";
import type { ChinaArticleCard, ChinaMarket, ChinaNicheBlock, ChinaOfferCard, ChinaOpportunity, ChinaView as ChinaViewData } from "@/lib/assortment/chinaStore";
import { changeText, CHINA_SCREEN_NOTE, dm, offerBadges, soldText, type BadgeKind } from "@/lib/assortment/chinaUi";
import type { AssortmentDirection } from "@/lib/assortment/constants";
import { BRAND_LABEL, refArticle } from "@/lib/assortment/socialFeed";
import { plural } from "@/lib/warehouse/plural";

/**
 * «Китай (1688)»: недельный снимок топа ниш оптовой площадки 1688 — по нишам раздела (переключатель), карточка: фото (ссылка 1688 на
 * картинку, не копия), название (перевод и китайское мелко), счётчик продаж «корзиной», «новое в топе» и «поднялось на N» неделя к неделе,
 * значки, ссылка «На 1688». Ниже — копии по номерам из рилсов («ставки фабрик»), «возможности» (гипотеза) и ссылки на площадки вручную.
 * Цен и продавцов нет. Телефон — одна колонка, цели нажатия ≥ 44 px, пояснения видимым текстом.
 */

type Ready = Extract<ChinaViewData, { available: true }>;
type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; data: Ready };

/** Сколько карточек ниши видно сразу; дальше — «Показать ещё». */
export const CHINA_PAGE = 12;

export type OfferFilter = "all" | "new" | "rose";

const chip = (active: boolean) => `h-11 shrink-0 rounded-full px-4 text-sm ${active ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
const linkButton = "inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 hover:bg-slate-50";
const kindTag = "text-xs text-slate-400";
const BADGE_CLASS: Record<BadgeKind, string> = {
  fact: "bg-sky-50 text-sky-800",
  estimate: "bg-amber-50 text-amber-900",
  hypothesis: "bg-slate-100 text-slate-600",
};
const CHANGE_CLASS = { new: "bg-violet-100 text-violet-800", up: "bg-emerald-100 text-emerald-800", down: "bg-slate-100 text-slate-600" } as const;

const num = (n: number) => Math.round(n).toLocaleString("ru-RU");
const month = (yyyymm: string) => `${yyyymm.slice(4, 6)}.${yyyymm.slice(0, 4)}`;

export function ChinaView({ direction }: { direction: AssortmentDirection }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/assortment-development/china?direction=${direction}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as Partial<ChinaViewData> & { error?: string; reason?: string };
        if (cancelled) return;
        if (!response.ok) return setState({ kind: "error", message: body.error || `Блок «Китай (1688)» не загрузился (${response.status})` });
        if (body.available === false) return setState({ kind: "unavailable", reason: String(body.reason ?? "Снимка 1688 ещё нет.") });
        setState({ kind: "ready", data: body as Ready });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, [direction]);

  return (
    <div className="flex flex-col gap-4">
      <ChinaIntro />
      {state.kind === "loading" && <div className="text-sm text-slate-500">Загружаем снимок 1688…</div>}
      {state.kind === "error" && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>}
      {state.kind === "unavailable" && <ChinaUnavailable reason={state.reason} />}
      {state.kind === "ready" && <ChinaBody data={state.data} />}
    </div>
  );
}

/** Подпись вкладки: что это и чем не является. */
export function ChinaIntro() {
  return (
    <p className="text-sm leading-6 text-slate-600">
      Топ продаж оптовой площадки 1688 по нишам раздела — снимок раз в неделю, с понедельника. {CHINA_SCREEN_NOTE}
    </p>
  );
}

/** Блок скрыт (нет ключа, миграции, снимка; ключ отвергнут) — одна строка причины; ссылки на площадки вручную доступны всегда. */
export function ChinaUnavailable({ reason }: { reason: string }) {
  return (
    <div role="status" className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
      <span>Снимка 1688 нет: {reason}.</span>
      <Link href={CHINA_LINKS_PATH} className="inline-flex min-h-11 items-center font-medium text-violet-700 hover:text-violet-900">Китайские площадки — ссылки по нишам</Link>
    </div>
  );
}

/** Снимок раздела: переключатель ниш, ниша, копии по номерам, «возможности», правило и ссылки. */
export function ChinaBody({ data, initialNiche = null, initialFilter = "all" }: { data: Ready; initialNiche?: string | null; initialFilter?: OfferFilter }) {
  const [nicheKey, setNicheKey] = useState<string | null>(initialNiche);
  const niche = data.niches.find((n) => n.key === nicheKey) ?? data.niches[0];
  return (
    <div className="flex flex-col gap-4">
      {data.status && <p role="status" className="text-sm leading-6 text-amber-900">{data.status}.</p>}
      {/* Ниш до 12: на телефоне и iPad ряд едет вбок, на широком экране — переносится (прокрутка мышью без полосы незаметна). */}
      <div className="chip-row -mx-3 gap-2 px-3 sm:mx-0 sm:px-0 lg:flex-wrap" aria-label="Ниши">
        {data.niches.map((n) => (
          <button key={n.key} type="button" aria-pressed={n.key === niche?.key} onClick={() => setNicheKey(n.key)} className={chip(n.key === niche?.key)}>
            {nicheShortLabel(n.ru)}{n.newInTop > 0 ? ` · +${n.newInTop}` : ""}
          </button>
        ))}
      </div>
      {niche && <ChinaNicheSection key={niche.key} niche={niche} initialFilter={initialFilter} />}
      {data.articles.length > 0 && <ChinaArticles articles={data.articles} />}
      {data.opportunities.length > 0 && <ChinaOpportunities items={data.opportunities} />}
      <ChinaRule />
      <p className="text-sm text-slate-600">
        <Link href={CHINA_LINKS_PATH} className="inline-flex min-h-11 items-center font-medium text-violet-700 hover:text-violet-900">Китайские площадки — ссылки по всем нишам</Link>
      </p>
    </div>
  );
}

/** Одна ниша: шапка с датами и числами, фильтр «новое / поднялось», карточки, ссылки на площадки вручную. */
export function ChinaNicheSection({ niche, initialFilter = "all" }: { niche: ChinaNicheBlock; initialFilter?: OfferFilter }) {
  const [filter, setFilter] = useState<OfferFilter>(initialFilter);
  const [shown, setShown] = useState(CHINA_PAGE);
  const rose = niche.offers.filter((o) => o.change?.kind === "rose");
  const fresh = niche.offers.filter((o) => o.change?.kind === "new");
  const list = filter === "new" ? fresh : filter === "rose" ? rose : niche.offers;
  const filters: Array<{ id: OfferFilter; label: string; count: number }> = [
    { id: "all", label: "Все", count: niche.offers.length },
    { id: "new", label: "Новое в топе", count: fresh.length },
    { id: "rose", label: "Поднялось", count: rose.length },
  ];
  const nicheDef = CHINA_NICHES.find((n) => n.key === niche.key);
  return (
    <section className="flex flex-col gap-3" aria-label={niche.ru}>
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-900">
          {niche.ru} <span lang="zh" className="text-sm font-normal text-slate-500">{niche.zh}</span>
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          Снимок недели с {dm(niche.observedOn)}
          {niche.previousOn ? `, сравнение со снимком ${dm(niche.previousOn)}` : " — прошлого снимка ниши нет: «новое в топе» и «поднялось» появятся со следующей недели"}.
          {niche.sellers != null && (
            <>
              {" "}Разных продавцов в топе: {niche.sellers} <span className={kindTag}>— факт 1688; самих продавцов не храним</span>
            </>
          )}
        </p>
        {niche.previousOn && (
          <p className="text-sm leading-6 text-slate-600">
            Новое в топе: {niche.newInTop}, поднялось: {niche.rose} <span className={kindTag}>— расчёт, неделя к неделе по позиции в выдаче 1688</span>
          </p>
        )}
        {niche.market && <ChinaMarketLine market={niche.market} />}
      </header>
      {niche.previousOn && (
        <div className="chip-row -mx-3 gap-2 px-3 sm:mx-0 sm:px-0" aria-label="Что показать">
          {/* Пустой фильтр прячем, а не серим. */}
          {filters.filter((f) => f.id === "all" || f.count > 0).map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setShown(CHINA_PAGE); }} className={chip(filter === f.id)}>
              {f.label} · {f.count}
            </button>
          ))}
        </div>
      )}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.slice(0, shown).map((card) => <ChinaOfferCardView key={card.offerId} card={card} />)}
      </ul>
      {list.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + CHINA_PAGE)} className={`${linkButton} self-start`}>
          Показать ещё {Math.min(CHINA_PAGE, list.length - shown)}{list.length - shown > CHINA_PAGE ? ` из ${list.length - shown}` : ""}
        </button>
      )}
      {nicheDef && <ChinaNicheLinks keyword={nicheDef.zh[0]} />}
    </section>
  );
}

/** Покупатели в день по ключу ниши (ряд 1688 отстаёт на 5–6 недель) и изменение к прошлому году. */
export function ChinaMarketLine({ market }: { market: ChinaMarket }) {
  const parts: string[] = [];
  if (market.buyersPerDay != null) parts.push(`покупателей в день на 1688 по ключу «${market.keyword}»: ≈${num(market.buyersPerDay)}`);
  if (market.yoyPct != null) parts.push(`к прошлому году ${market.yoyPct > 0 ? "+" : market.yoyPct < 0 ? "−" : ""}${Math.abs(market.yoyPct).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`);
  if (parts.length === 0) return null;
  const text = parts.join("; ");
  return (
    <p className="text-sm leading-6 text-slate-600">
      {text[0].toUpperCase() + text.slice(1)}{" "}
      <span className={kindTag}>— факт 1688{market.lastMonth ? `, ряд по ${month(market.lastMonth)}` : ""} (отстаёт на 5–6 недель); к году — расчёт 1688; это просмотры покупателей, не продажи</span>
    </p>
  );
}

function OfferPhoto({ card }: { card: ChinaOfferCard }) {
  const [failed, setFailed] = useState(false);
  if (!card.imageUrl || failed) {
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center text-slate-500">
        <ImageOff className="h-6 w-6" />
        <span className="text-xs">{card.imageUrl ? "фото не открылось" : "фото нет"}</span>
      </span>
    );
  }
  return (
    // Фото — ссылкой на картинку 1688 (без копирования к себе); адрес страницы панели площадке не уходит.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={card.imageUrl} alt={card.titleRu ?? card.titleZh} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />
  );
}

/** Карточка топа ниши: фото, позиция и изменение, название, счётчик продаж, значки, «На 1688». Чистая разметка. */
export function ChinaOfferCardView({ card }: { card: ChinaOfferCard }) {
  const change = changeText(card.change);
  const sold = soldText(card);
  const badges = offerBadges(card);
  const link = offerLink(card.offerId, card.titleZh);
  return (
    <li className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3">
      {/* self-start: в ряду flex фото иначе растягивается на высоту карточки, и квадрат превращается в полосу. */}
      <div className="relative aspect-square w-24 shrink-0 self-start overflow-hidden rounded-xl bg-[#f4f2ee] sm:w-28">
        <OfferPhoto card={card} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-slate-500">№{card.rank} в выдаче 1688</span>
          {change && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHANGE_CLASS[change.tone]}`}>{change.text}</span>
          )}
          {change && <span className={kindTag}>расчёт</span>}
        </div>
        <div className="break-anywhere line-clamp-2 text-sm font-medium leading-5 text-slate-900">{card.titleRu ?? card.titleZh}</div>
        {card.titleRu && <div lang="zh" className="break-anywhere line-clamp-1 text-xs text-slate-500">{card.titleZh}</div>}
        {sold && (
          <div className="text-sm leading-5 text-slate-700">
            {sold} <span className={kindTag}>— факт 1688, период не указан</span>
          </div>
        )}
        {card.orders30d != null && (
          <div className="text-sm leading-5 text-slate-700">
            заказов за 30 дней: {card.orders30d.toLocaleString("ru-RU")} <span className={kindTag}>— факт 1688</span>
          </div>
        )}
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {badges.map((b) => (
              <span key={b.key} title={b.title} className={`rounded-full px-2 py-0.5 text-xs ${BADGE_CLASS[b.kind]}`}>{b.text}</span>
            ))}
          </div>
        )}
        <a href={link.url} target="_blank" rel="noopener noreferrer" className={`${linkButton} mt-1 self-start`}>
          <ExternalLink className="h-4 w-4" /> {link.kind === "card" ? "На 1688" : "Найти на 1688"}
        </a>
      </div>
    </li>
  );
}

/** Ссылки ниши для ручного просмотра: 1688 по продажам, Taobao, AlphaShop. */
export function ChinaNicheLinks({ keyword }: { keyword: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-slate-600">Посмотреть нишу вручную <span lang="zh" className="text-slate-500">«{keyword}»</span>:</span>
      <div className="flex flex-wrap gap-2">
        {nicheLinks({ zh: [keyword] }).map((l) => (
          <a key={l.platform} href={l.url} target="_blank" rel="noopener noreferrer" title={l.note} className={linkButton}>
            <ExternalLink className="h-4 w-4" /> {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

/** Копии по номерам из рилсов — «ставки фабрик»: оценка снизу, прирост — расчёт; образцы — ссылками на карточки 1688. */
export function ChinaArticles({ articles }: { articles: ChinaArticleCard[] }) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4" aria-label="Копии по номерам из рилсов">
      <h2 className="text-base font-semibold text-slate-900">Копии по номерам из рилсов — «ставки фабрик»</h2>
      <p className="text-xs leading-5 text-slate-500">
        Номера Zara и Uniqlo из ленты «Залетает» за 30 дней. Копия — карточка 1688 с номером в названии; поиск 1688 смысловой и находит часть
        карточек, поэтому число — оценка снизу, прирост — расчёт к прошлому снимку номера.
      </p>
      <ul className="divide-y divide-slate-100">
        {articles.map((a) => (
          <li key={a.refKey} className="flex flex-col gap-1 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-medium text-slate-900">{BRAND_LABEL[a.brand]} {refArticle(a.refKey) ?? a.number}</span>
              <span className="text-sm text-slate-700">
                {a.offers > 0 ? `${a.offers} ${plural(a.offers, "копия", "копии", "копий")}` : "копий не нашли"}
                {a.delta != null && a.delta !== 0 ? ` (${a.delta > 0 ? "+" : "−"}${Math.abs(a.delta)} за неделю)` : ""}
                {a.sellers > 0 ? `, продавцов от ${a.sellers}` : ""}
              </span>
              <span className={kindTag}>— оценка снизу{a.delta != null ? ", прирост — расчёт" : ""}; снимок {dm(a.observedOn)}</span>
            </div>
            {a.sampleUrls.length > 0 && (
              <div className="flex flex-wrap gap-x-3">
                {a.sampleUrls.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm text-violet-700 hover:text-violet-900">
                    <ExternalLink className="h-3.5 w-3.5" /> карточка {i + 1}
                  </a>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const PLATFORM_LABEL: Record<string, string> = { "1688": "1688", taobao: "Taobao", xiaohongshu: "Xiaohongshu" };

/** «Возможности» 1688 за последний час — свёрнуто и с меткой «гипотеза»: свежесть сомнительна (на 07.10 темы летние). */
export function ChinaOpportunities({ items }: { items: ChinaOpportunity[] }) {
  return (
    <details className="rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700">
      <summary className="flex min-h-11 cursor-pointer items-center font-medium text-slate-900">Темы «возможностей» 1688 · {items.length} — гипотеза</summary>
      <p className="text-xs leading-5 text-slate-500">Подборка 1688 «за последний час» по площадкам, отфильтрована по нашим категориям; свежесть не проверена — не факт.</p>
      <ul className="flex flex-col gap-1 py-2">
        {items.map((o) => (
          <li key={`${o.listKey}#${o.rank}`} className="leading-6">
            <span className="font-medium">{o.topicRu ?? o.topic}</span>
            {o.topicRu && <span lang="zh" className="text-slate-500"> {o.topic}</span>}
            <span className="text-slate-500"> · {PLATFORM_LABEL[o.platform] ?? o.platform}{o.count ? ` · ${o.count}` : ""}</span>
            {o.words.length > 0 && (
              <span className="text-slate-500"> · {o.words.map((w) => `${w.word}${w.growthPct != null ? ` (рост поиска ${w.growthPct}%)` : ""}`).join(", ")}</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Правило словами — свёрнуто, чтобы не занимать экран телефона. */
export function ChinaRule() {
  return (
    <details className="rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700">
      <summary className="flex h-11 cursor-pointer items-center font-medium text-slate-900">Как считаем</summary>
      <ul className="flex list-disc flex-col gap-1 pb-3 pl-5 leading-6">
        <li>Снимок — раз в неделю, с понедельника: топ ниши по продажам 1688 (до 40 карточек одного запроса), без платных размещений, мужского и детского.</li>
        <li>«Продано» — счётчик 1688: накопленный и округлённый «корзиной» (5000+, 900+); за какой период — 1688 не указывает. Факт площадки, нижняя граница.</li>
        <li>«Новое в топе» — карточки не было в прошлом снимке ниши; «поднялось на N» — позиция в выдаче выше на N, от 3 мест (на 1–2 выдача гуляет сама). Расчёт.</li>
        <li>«Новинка — оценка» — по номеру карточки 1688 (номера растут со временем); «新款» — слово продавца в названии, гипотеза.</li>
        <li>Цены и продавцов не храним и не показываем — только число разных продавцов в топе. Оптовые продажи в Китае — не спрос WB.</li>
      </ul>
    </details>
  );
}
