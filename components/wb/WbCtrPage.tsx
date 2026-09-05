"use client";

import {
  FlaskConical,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { CTR_FORCE_HINT, type CtrTestType } from "@/lib/ctrtest/model";
import { useDashboardFilter } from "@/lib/useDashboardFilter";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { CtrCampaignBridge } from "./ctr/CtrCampaignBridge";
import { CtrTestDetail } from "./ctr/CtrTestDetail";
import { CtrTestWizard } from "./ctr/CtrTestWizard";
import type { CtrCandidate, CtrTestView, CtrVariantView, CtrWizardSeed } from "./ctr/types";
import { useWbCabinet } from "./WbCabinetContext";
import { plural } from "@/lib/warehouse/plural";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";

interface CtrData {
  items: CtrCandidate[];
  count: number;
  days: number;
  error?: string;
}

interface ApiEnvelope<T> { data?: T; error?: string | null }

const ROW_HEIGHT = 44;
/**
 * Тип теста — главный переключатель экрана: от него зависит и таблица, и то,
 * что вообще меряется. Раньше он стоял третьей строкой сверху и был нарисован
 * набором отдельных кнопок, тогда как период рядом — сегментированным
 * контролом: два разных вида у двух одинаковых по смыслу переключателей.
 *
 * `note` объясняет, ЧТО меряет тест. Заголовок экрана его не назовёт: он один
 * на все три типа, и «Тестирование CTR» над таблицей видео-тестов врало.
 */
const typeTabs: { value: CtrTestType; label: string; note: string }[] = [
  { value: "ctr", label: "CTR", note: "кликабельность обложки в выдаче" },
  { value: "cr", label: "CR · beta", note: "конверсия карточки в заказ" },
  { value: "video", label: "Видео", note: "ролик карточки: заказы к открытиям" },
];
const statusLabel = { draft: "черновик", running: "идёт", paused: "пауза", done: "завершён", cancelled: "отменён" } as const;
const statusTone = { draft: "bg-slate-100 text-slate-600", running: "bg-violet-100 text-violet-700", paused: "bg-amber-100 text-amber-700", done: "bg-emerald-100 text-emerald-700", cancelled: "bg-rose-100 text-rose-700" } as const;
const number = (value: number | null) => value == null ? "—" : Math.round(value).toLocaleString("ru-RU");
const percent = (value: number | null) => value == null ? "—" : `${Math.round(value * 100) / 100}%`;

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
  return body.data as T;
}

function testResult(test: CtrTestView) {
  const winner = test.variants.find((variant) => variant.id === test.winnerVariantId || variant.isWinner);
  if (!winner) return test.status === "running" ? "идёт измерение" : "—";
  return `${winner.label}${winner.resultPct == null ? "" : ` · ${winner.resultPct > 0 ? "+" : ""}${winner.resultPct.toFixed(1)}%`}`;
}

export function WbCtrPage() {
  const { activeCabinet, cabinetId, cabinets, ready, loading: cabinetsLoading, error: cabinetsError, hasExactCabinet, canWrite } = useWbCabinet();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<CtrData | null>(null);
  const [tests, setTests] = useState<CtrTestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  /**
   * Артикул, ради которого сюда пришли.
   *
   * Из карточки кампании в «Рекламе» есть ссылка сюда — обратная той, что ведёт
   * из теста к кампаниям. Без параметра она приводила бы на общий список: у
   * кабинета сотня тестов и тысяча кандидатов, и человек, пришедший с вопросом
   * «а тестировали ли мы эту картинку», начинал бы с поиска того, что панель
   * и так знает.
   */
  const [focusNm, setFocusNm] = useDashboardFilter<string>("nm", "");
  // Поиск по кандидатам стартует с этого же артикула: таблица кандидатов —
  // то место, где тест заводят, и ради него сюда чаще всего и приходят.
  const [query, setQuery] = useState(() => focusNm);
  const [category, setCategory] = useState("");
  const [type, setType] = useState<CtrTestType>("ctr");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [wizard, setWizard] = useState<CtrWizardSeed | null | false>(false);
  const [busy, setBusy] = useState(false);
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 18 });
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);
  const { categories, byArticle } = useCategoryMap();

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (cabinets.length === 0) {
      setLoading(false);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return;
    }
    const controller = new AbortController();
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    const analysis = hasExactCabinet
      ? fetch(`/api/ctrtest/adv-analysis?days=${days}&cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          // Пустое тело (таймаут шлюза) раньше падало «Unexpected end of JSON
          // input» — человеку нужен читаемый ответ, а не внутренности парсера.
          const body = await response.json().catch(() => null) as CtrData | null;
          if (!response.ok || !body || body.error) {
            throw new Error(body?.error || `Реклама WB не ответила (${response.status}) — повторите позже`);
          }
          return body;
        })
      : Promise.resolve({ items: [], count: 0, days } as CtrData);
    const lifecycle = hasExactCabinet
      ? fetch(`/api/ctrtest/list?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store", signal: controller.signal }).then((response) => responseJson<{ tests: CtrTestView[] }>(response))
      : Promise.resolve({ tests: [] as CtrTestView[] });
    Promise.all([analysis, lifecycle])
      .then(([analysisBody, lifecycleBody]) => {
        if (current !== requestId.current) return;
        setData(analysisBody);
        setTests(lifecycleBody.tests ?? []);
        setSelectedId((id) => id && lifecycleBody.tests.some((test) => test.id === id) ? id : null);
      })
      .catch((cause: unknown) => {
        if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить тесты");
      })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, days, hasExactCabinet, ready, retryKey]);

  const candidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return (data?.items ?? []).filter((item) => {
      if (category && (category === "__none" ? Boolean(byArticle[item.art]) : byArticle[item.art] !== category)) return false;
      return !needle || `${item.nm} ${item.art}`.toLocaleLowerCase("ru-RU").includes(needle);
    });
  }, [byArticle, category, data?.items, query]);
  // Тесты по этому артикулу — по ВСЕМ типам, а не только по открытой вкладке.
  // Иначе «тестов нет» означало бы «нет тестов выбранного типа», и человек
  // уходил бы заводить второй тест поверх существующего.
  const testsForFocus = useMemo(
    () => focusNm ? tests.filter((test) => String(test.nmId) === focusNm) : [],
    [focusNm, tests],
  );
  const visibleTests = useMemo(
    () => tests.filter((test) => test.testType === type && (!focusNm || String(test.nmId) === focusNm)),
    [focusNm, tests, type],
  );
  const focusOtherTypes = useMemo(
    () => [...new Set(testsForFocus.filter((test) => test.testType !== type).map((test) => test.testType))],
    [testsForFocus, type],
  );
  const selectedTest = tests.find((test) => test.id === selectedId) ?? null;
  const eligibleCount = candidates.filter((item) => item.views >= 1000 && (item.ctr ?? 0) < 3).length;

  useEffect(() => setRowWindow({ start: 0, end: Math.min(18, candidates.length) }), [candidates.length, query, category]);

  const updateWindow = (element: HTMLDivElement) => {
    const first = Math.floor(Math.max(0, element.scrollTop - 36) / ROW_HEIGHT);
    const visible = Math.ceil(element.clientHeight / ROW_HEIGHT);
    const start = Math.max(0, first - 5);
    const end = Math.min(candidates.length, first + visible + 6);
    setRowWindow((current) => current.start === start && current.end === end ? current : { start, end });
  };

  const reload = (notice?: string) => {
    setWizard(false);
    if (notice) setMessage(notice);
    setRetryKey((value) => value + 1);
  };

  const action = async (actionName: string, variantId?: number, explanation?: string, force?: boolean) => {
    if (!selectedTest || busy) return;
    const confirmation = actionName === "start" || actionName === "advance"
      ? "CONTENT_IS_SET"
      : actionName === "finish"
        ? "FINISH_TEST"
        : actionName === "cancel"
          ? "CANCEL_TEST"
          : actionName === "winner"
            ? "SELECT_WINNER"
            : undefined;
    setBusy(true); setError(null);
    try {
      const response = await responseJson(await fetch(`/api/ctrtest/${selectedTest.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionName, variantId, explanation, confirm: confirmation, force }),
      })) as { outcome?: string } | null;
      // Упор в потолок расхода возвращал ровно тот же нейтральный успех, что
      // обычный переход, — и человек не узнавал, что тест встал, а кампания в
      // кабинете WB продолжает жечь бюджет. Панель в WB не пишет и остановить
      // её не может, поэтому обязана сказать это прямо.
      if (response?.outcome === "cap_paused") {
        reload("Лимит расходов выбран — тест на паузе. Остановите кампанию в кабинете WB: панель этого не делает.");
      } else if (response?.outcome === "cap_finished") {
        reload("Лимит расходов выбран, но данных хватило — тест закрыт с победителем. Остановите кампанию в кабинете WB.");
      } else {
        reload("Действие сохранено в журнале теста");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Не удалось выполнить действие";
      // Отказ, который человек может снять сам: спрашиваем прямо и повторяем
      // с force. Отказаться — значит дать тесту добрать норму, и это тоже ответ.
      if (!force && message.startsWith(CTR_FORCE_HINT)) {
        setBusy(false);
        if (window.confirm(`${message}\n\nЗакрыть тест всё равно? В объяснении победителя останется пометка, что норма добрана не всеми.`)) {
          await action(actionName, variantId, explanation, true);
        }
        return;
      }
      setError(message);
    }
    finally { setBusy(false); }
  };

  const removeDraft = async (test: CtrTestView) => {
    if (!window.confirm(`Удалить черновик теста #${test.id}?`)) return;
    setBusy(true); setError(null);
    try {
      await responseJson(await fetch(`/api/ctrtest/${test.id}?cabinet=${encodeURIComponent(cabinetId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE_DRAFT" }),
      }));
      reload("Черновик удалён");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось удалить черновик"); }
    finally { setBusy(false); }
  };

  const openFlywheelFor = (sourceTest: CtrTestView, winner: CtrVariantView) => {
    setType(sourceTest.testType);
    setSelectedId(null);
    setWizard({
      sourceTestId: sourceTest.id,
      candidate: candidates.find((candidate) => candidate.nm === sourceTest.nmId) ?? {
        nm: sourceTest.nmId, art: sourceTest.article, views: 0, spend: 0, ctr: null, cpc: null, drr: null, stock: 0,
      },
      baseline: { label: winner.label, imageUrl: winner.imageUrl },
    });
  };
  const openFlywheel = (winner: CtrVariantView) => { if (selectedTest) openFlywheelFor(selectedTest, winner); };
  const flywheelSource = tests.find((test) => test.status === "done" && test.variants.some((variant) => variant.id === test.winnerVariantId || variant.isWinner)) ?? null;

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={FlaskConical}
        title="Тесты контента"
        description={`${typeTabs.find((tab) => tab.value === type)?.note ?? ""} · реальные метрики выбранного кабинета`}
        actions={<div className="flex items-center gap-2">
          <div className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm sm:min-h-8">{[7, 14, 30].map((value) => <button key={value} type="button" onClick={() => setDays(value)} className={`min-h-10 rounded-md px-3 text-[11px] font-semibold transition-colors sm:min-h-7 ${days === value ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{value} дней</button>)}</div>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)} disabled={loading} aria-label="Обновить тесты" className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 disabled:opacity-60 sm:h-8 sm:w-8">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5" />}</button>
        </div>}
      />

      <div className="space-y-3 px-2 py-3 sm:px-6">

        {!canWrite ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">Для создания и управления тестами выберите один реальный кабинет. В режиме «Все кабинеты» доступна только сводная аналитика кандидатов.</div> : null}
        {message ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{message}</div> : null}
        {error && !loading ? <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /> : null}

        {selectedTest ? <><CtrTestDetail test={selectedTest} busy={busy} onBack={() => setSelectedId(null)} onAction={(name, variantId, explanation) => void action(name, variantId, explanation)} onFlywheel={openFlywheel} /><CtrCampaignBridge cabinetId={cabinetId} nmId={selectedTest.nmId} /></> : wizard !== false && canWrite ? <CtrTestWizard cabinetId={cabinetId} type={type} candidates={candidates} seed={wizard} onClose={() => setWizard(false)} onCreated={() => reload("Черновик теста создан")} /> : <>
          {/*
            Одна панель управления вместо трёх строк.
            Было: строка-описание с двумя цветными кнопками, отдельная секция
            «Новый тест» ради одной кнопки, и ниже — переключатель типа
            отдельными кнопками. Три полосы на три элемента управления, причём
            главный из них, тип теста, стоял последним и выглядел слабее
            периода. Здесь тип слева как основной выбор, действия справа, и
            один акцентный цвет на весь экран — у создания теста.
          */}
          <section className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm sm:min-h-9" role="tablist" aria-label="Тип теста">
              {typeTabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={type === tab.value}
                  title={tab.note}
                  onClick={() => setType(tab.value)}
                  className={`min-h-10 rounded-md px-3 text-[11px] font-semibold transition-colors sm:min-h-8 ${type === tab.value ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <button
                type="button"
                disabled={!canWrite || !flywheelSource}
                title="Взять победителя завершённого теста и запустить следующий раунд от него"
                onClick={() => { const winner = flywheelSource?.variants.find((variant) => variant.id === flywheelSource.winnerVariantId || variant.isWinner); if (flywheelSource && winner) openFlywheelFor(flywheelSource, winner); }}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-40 sm:min-h-9"
              >
                <RotateCcw className="h-3.5 w-3.5" />Маховик
              </button>
              <Link
                href="/wb/product"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 sm:min-h-9"
              >
                <WandSparkles className="h-3.5 w-3.5" />Лаборатория контента
              </Link>
              <button
                type="button"
                disabled={!canWrite || loading}
                onClick={() => setWizard(null)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-40 sm:min-h-9"
              >
                <Plus className="h-3.5 w-3.5" />Создать тест
              </button>
            </div>
          </section>

          {focusNm ? (
            /*
              Пришли по ссылке из карточки кампании. Сказать об этом надо прямо:
              отфильтрованный список, который выглядит как полный, — это способ
              заставить человека поверить, что тестов у кабинета всего один.
              Рядом выход одним нажатием.
            */
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] text-violet-900">
              <span>
                Показан один артикул — <b>nm {focusNm}</b>
                {testsForFocus.length === 0
                  ? ": тестов по нему ещё не заводили."
                  : ` · тестов по нему ${testsForFocus.length}.`}
                {focusOtherTypes.length ? ` Есть тесты другого типа: ${focusOtherTypes.map((value) => typeTabs.find((tab) => tab.value === value)?.label ?? value).join(", ")}.` : ""}
              </span>
              <button
                type="button"
                onClick={() => { setFocusNm(""); setQuery(""); }}
                className="ml-auto min-h-8 rounded-lg bg-white px-2.5 font-semibold text-violet-700 shadow-sm transition-colors hover:bg-violet-100"
              >
                Показать все
              </button>
            </div>
          ) : null}


          {loading ? <div className="rounded-xl border border-slate-200 bg-white p-3"><LoadingBanner seconds={elapsed} hint={`тесты · ${activeCabinet?.name ?? "все кабинеты"}`} /><SkeletonTableRows rows={5} cols={8} /></div> : canWrite && visibleTests.length ? <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-[920px] w-full border-collapse text-[10px]">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-3 text-left">Товар</th><th className="px-3 py-3 text-left">Статус</th><th className="px-3 py-3 text-left">Результат</th><th className="px-3 py-3 text-center">Варианты</th><th className="px-3 py-3 text-center">Раунд</th><th className="px-3 py-3 text-center">Интервал</th><th className="px-3 py-3 text-left">Создан</th><th className="w-14 px-3 py-3" /></tr></thead>
              <tbody>{visibleTests.map((test) => <tr key={test.id} onClick={() => setSelectedId(test.id)} className="cursor-pointer border-t border-slate-100 hover:bg-violet-50/40"><td className="px-3 py-3"><div className="font-semibold text-violet-700">{test.article}</div><div className="text-[9px] text-slate-400">nm {test.nmId} · тест #{test.id}</div></td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${statusTone[test.status]}`}>{statusLabel[test.status]}</span></td><td className="px-3 py-3 font-medium text-slate-600">{testResult(test)}</td><td className="px-3 py-3 text-center tabular-nums">{test.variants.length}</td><td className="px-3 py-3 text-center tabular-nums">{test.roundNum}</td><td className="px-3 py-3 text-center tabular-nums">{test.intervalMin} мин</td><td className="px-3 py-3 text-slate-500">{new Date(test.createdAt).toLocaleDateString("ru-RU")}</td><td className="px-3 py-3">{test.status === "draft" ? <button type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); void removeDraft(test); }} aria-label={`Удалить черновик ${test.id}`} className="grid h-11 w-11 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button> : null}</td></tr>)}</tbody>
            </table>
          </div> : canWrite ? <WbEmptyState>{focusNm ? `По артикулу nm ${focusNm} тестов этого типа не заводили — заведите первый в таблице кандидатов ниже.` : "Для этого типа тестов пока нет запусков. Создайте первый черновик."}</WbEmptyState> : null}

          <section className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><div><h2 className="text-xs font-bold text-slate-700">Кандидаты по рекламе</h2><p className="text-[10px] text-slate-400">
                  Реальные данные выбранного периода; клик по строке открывает мастер с этим товаром.
                  {eligibleCount > 0
                    ? ` Кандидат — от 1 000 показов и CTR ниже 3%: ${eligibleCount} ${plural(eligibleCount, "товар подходит", "товара подходят", "товаров подходят")}.`
                    : " Кандидат — от 1 000 показов и CTR ниже 3%: сейчас таких нет."}
                </p></div><div className="flex min-w-0 flex-1 flex-col gap-2 sm:ml-auto sm:max-w-xl sm:flex-row">{categories.length ? <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Категория" className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 outline-none focus:border-violet-400"><option value="">Все категории</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}<option value="__none">Без категории</option></select> : null}<label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 focus-within:border-violet-400"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SKU или nm" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label></div></div>
            {loading ? null : candidates.length === 0 ? <WbEmptyState>Нет рекламных данных по выбранному периоду и фильтрам.</WbEmptyState> : <div className="h-[360px] overflow-auto rounded-xl border border-slate-200 bg-white" onScroll={(event) => updateWindow(event.currentTarget)}><table className="min-w-[860px] w-full border-collapse text-[10px]"><thead className="sticky top-0 z-20 bg-slate-50"><tr className="h-9 border-b border-slate-200 text-slate-500"><th className="sticky left-0 z-30 min-w-[220px] border-r border-slate-200 bg-slate-50 px-3 text-left">Товар</th><th className="px-3 text-left">Статус</th><th className="px-3 text-right">Показы</th><th className="px-3 text-right">CTR</th><th className="px-3 text-right">CPC</th><th className="px-3 text-right">ДРР</th><th className="px-3 text-right">Расход</th><th className="px-3 text-right">Остаток</th></tr></thead><tbody>
              {rowWindow.start > 0 ? <tr aria-hidden="true"><td colSpan={8} style={{ height: rowWindow.start * ROW_HEIGHT }} /></tr> : null}
              {candidates.slice(rowWindow.start, rowWindow.end).map((item) => { const eligible = item.views >= 1000 && (item.ctr ?? 0) < 3; return <tr key={item.nm} onClick={() => { if (canWrite) setWizard({ candidate: item }); }} className={`h-11 border-b border-slate-100 ${canWrite ? "cursor-pointer hover:bg-violet-50/30" : ""}`}><td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3"><div className="font-semibold text-violet-700">{item.art}</div><div className="text-[9px] text-slate-400">nm {item.nm}</div></td><td className="px-3"><span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${eligible ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{eligible ? "кандидат" : "наблюдение"}</span></td><td className="px-3 text-right tabular-nums">{number(item.views)}</td><td className={`px-3 text-right tabular-nums ${(item.ctr ?? 0) < 3 ? "font-semibold text-rose-600" : "text-emerald-700"}`}>{percent(item.ctr)}</td><td className="px-3 text-right tabular-nums">{number(item.cpc)} ₽</td><td className="px-3 text-right tabular-nums">{percent(item.drr)}</td><td className="px-3 text-right tabular-nums">{number(item.spend)} ₽</td><td className="px-3 text-right tabular-nums">{number(item.stock)}</td></tr>; })}
              {rowWindow.end < candidates.length ? <tr aria-hidden="true"><td colSpan={8} style={{ height: (candidates.length - rowWindow.end) * ROW_HEIGHT }} /></tr> : null}
            </tbody></table></div>}
          </section>
        </>}

        <div className="rounded-xl border border-slate-200 bg-white p-3 text-[10px] leading-5 text-slate-500">
          <b className="text-slate-700">Панель ничего не меняет в карточке сама.</b> Вариант вы ставите руками и
          сами подтверждаете начало раунда — автоматической подмены контента здесь нет и не включается.
          У видео-тестов вместо просмотров считается отношение заказов к открытиям карточки: просмотры
          конкретного ролика WB не отдаёт, и подставлять вместо них похожее число было бы обманом.
        </div>
      </div>
    </div>
  );
}
