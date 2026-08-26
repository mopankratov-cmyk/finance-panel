"use client";

import { RotateCw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import type { KizReconcileResponse } from "@/app/api/supplies/kiz-reconcile/route";
import type { KizBucket, KizReconcileDays, KizReconcileRow, KizReturnTask, KizRowBucket } from "@/lib/wb/kizReconcile";
import { WbEmptyState } from "./WbModuleHeader";

// Короткие окна — для агентских кабинетов: WB отдаёт задания всего продавца,
// и на большом обороте чужие товары съедают потолок прогона целиком.
const DAYS: KizReconcileDays[] = [1, 3, 7, 30, 60, 90];
const NO_PREFIX = "__none__";

const fmt = (value: number) => value.toLocaleString("ru-RU");

/** Даты WB приходят и как «YYYY-MM-DD», и как ISO со временем — режем до дня. */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const day = iso.slice(0, 10);
  const parts = day.split("-");
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : day;
}

/** Ключ сортировки для дат: непарсируемая дата → null, такие строки уезжают в конец. */
function dayValue(iso: string | null): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso.slice(0, 10));
  return Number.isNaN(parsed) ? null : parsed;
}

const today = () => new Date().toISOString().slice(0, 10);

const BUCKETS: { key: KizBucket; label: string; hint: string; tone: string; active: string }[] = [
  { key: "retire", label: "Вывести", hint: "продано, код не выведен", tone: "text-rose-600", active: "border-rose-300 bg-rose-50" },
  // «Нет кода» намеренно не красный: кода не бывает у немаркируемого товара,
  // и пугать статьёй там, где нарушения нет, — хуже, чем промолчать.
  { key: "no_code", label: "Нет кода", hint: "код не привязан — выводить нечего", tone: "text-amber-600", active: "border-amber-300 bg-amber-50" },
  { key: "check", label: "Проверить", hint: "код противоречит фактам", tone: "text-amber-600", active: "border-amber-300 bg-amber-50" },
  // «Не проверено» ≠ «кода нет»: сюда попадают задания, про которые WB не ответил.
  { key: "not_checked", label: "Не проверено", hint: "WB не ответил — это не «кода нет»", tone: "text-slate-600", active: "border-slate-300 bg-slate-100" },
  { key: "introduce", label: "Ввести в оборот", hint: "возвраты · 3 рабочих дня", tone: "text-violet-700", active: "border-violet-300 bg-violet-50" },
];

const BUCKET_CHIP: Record<KizRowBucket, string> = {
  retire: "bg-rose-100 text-rose-700",
  no_code: "bg-amber-100 text-amber-700",
  check: "bg-amber-100 text-amber-700",
  not_checked: "bg-slate-100 text-slate-600",
};

const BUCKET_ACTION_LABEL: Record<KizRowBucket, string> = {
  retire: "Вывести",
  no_code: "Нет кода",
  check: "Проверить",
  not_checked: "Проверить ещё раз",
};

const buildRowColumns = (onHide: ((subject: string) => void) | null): Column<KizReconcileRow>[] => [
  {
    key: "action",
    label: "Действие",
    render: (row) => (
      <div className="min-w-[190px]">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BUCKET_CHIP[row.bucket]}`}>{BUCKET_ACTION_LABEL[row.bucket]}</span>
        <div className="mt-1 text-[11px] leading-snug text-slate-500">{row.action}</div>
      </div>
    ),
    csv: (row) => `${BUCKET_ACTION_LABEL[row.bucket]}: ${row.action}`,
  },
  {
    key: "article",
    label: "Артикул",
    sortable: true,
    render: (row) => (
      <div>
        <div className="font-semibold text-violet-700">{row.article || row.nmId || "—"}</div>
        {row.nmId ? <div className="text-[11px] tabular-nums text-slate-400">nm {row.nmId}</div> : null}
      </div>
    ),
    csv: (row) => row.article || String(row.nmId ?? ""),
  },
  { key: "brand", label: "Бренд", sortable: true, render: (row) => <span className="text-slate-600">{row.brand ?? "—"}</span>, csv: (row) => row.brand ?? "" },
  {
    key: "subject",
    label: "Предмет",
    sortable: true,
    render: (row) => (
      <div className="min-w-[120px]">
        <div className="text-slate-600">{row.subject ?? "—"}</div>
        {onHide && row.subject ? (
          <button
            type="button"
            onClick={() => onHide(row.subject!)}
            className="mt-0.5 text-[11px] font-semibold text-slate-400 underline underline-offset-2 hover:text-violet-700"
            title={`Скрыть «${row.subject}» из сверки: товар не маркируется`}
          >
            скрыть
          </button>
        ) : null}
      </div>
    ),
    csv: (row) => row.subject ?? "",
  },
  {
    key: "task",
    label: "Задание",
    sortable: true,
    render: (row) => (
      <div>
        <div className="font-mono text-xs text-slate-600">{row.taskId}</div>
        <div className="text-[11px] text-slate-400">продано {fmtDate(row.soldAt)}</div>
      </div>
    ),
    csv: (row) => row.taskId,
  },
  {
    key: "code",
    label: "Код КИЗ",
    // У непроверенного задания прочерк читался бы как «кода нет» — пишем прямо.
    render: (row) => row.code
      ? <span className="font-mono text-[11px] break-all text-slate-600">{row.code}</span>
      : <span className="text-slate-400">{row.bucket === "not_checked" ? "не проверен" : "—"}</span>,
    csv: (row) => row.code ?? (row.bucket === "not_checked" ? "не проверен" : ""),
  },
  { key: "reason", label: "Почему", render: (row) => <span className="text-[12px] leading-snug text-slate-600">{row.reason}</span>, csv: (row) => row.reason },
];

const returnColumns: Column<KizReturnTask>[] = [
  {
    key: "deadline",
    label: "Ввести до",
    sortable: true,
    sortValue: (row) => dayValue(row.deadline),
    render: (row) => (
      <div className="min-w-[120px]">
        <div className={row.overdue ? "font-semibold text-rose-600" : "font-semibold text-slate-700"}>{fmtDate(row.deadline)}</div>
        {row.overdue ? <span className="mt-1 inline-block rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">просрочен</span> : null}
      </div>
    ),
    csv: (row) => `${row.deadline ?? ""}${row.overdue ? " (просрочен)" : ""}`,
  },
  {
    key: "article",
    label: "Товар",
    sortable: true,
    render: (row) => (
      <div>
        <div className="font-semibold text-violet-700">{row.article || row.nmId || "—"}</div>
        {row.nmId ? <div className="text-[11px] tabular-nums text-slate-400">nm {row.nmId}</div> : null}
      </div>
    ),
    csv: (row) => row.article || String(row.nmId ?? ""),
  },
  { key: "barcode", label: "Баркод", render: (row) => <span className="font-mono text-xs text-slate-600">{row.barcode || "—"}</span>, csv: (row) => row.barcode },
  { key: "brand", label: "Бренд", sortable: true, render: (row) => <span className="text-slate-600">{row.brand ?? "—"}</span>, csv: (row) => row.brand ?? "" },
  {
    key: "returnedAt",
    label: "Вернулся",
    sortable: true,
    sortValue: (row) => dayValue(row.returnedAt),
    render: (row) => <span className="text-slate-600">{fmtDate(row.returnedAt)}</span>,
    csv: (row) => row.returnedAt ?? "",
  },
  { key: "reason", label: "Причина", render: (row) => <span className="text-[12px] leading-snug text-slate-600">{row.reason}</span>, csv: (row) => row.reason },
];

export function WbKizReconcileTab({ cabinetId, cabinetName }: { cabinetId: string; cabinetName?: string }) {
  const singleCabinet = Boolean(cabinetId) && cabinetId !== "all" && !cabinetId.startsWith("group:");
  const [days, setDays] = useState<KizReconcileDays>(30);
  const [payload, setPayload] = useState<KizReconcileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<KizBucket | null>(null);
  // Фильтр по технической группе кодов (первые 9 знаков GTIN), а не по владельцу.
  const [codeGroup, setCodeGroup] = useState<string>("");
  // Предметы, отмеченные владельцем как немаркируемые, и отказ от раздела.
  // Автоматика по метаданным WB закрывает не всё — это ручное дополнение.
  const [hidden, setHidden] = useState<string[]>([]);
  const [notApplicable, setNotApplicable] = useState(false);
  const [savingSetting, setSavingSetting] = useState(false);
  // Меняется при скрытии предмета — сверка перечитывается сразу.
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Сверка дорогая (обход сборочных заданий WB) — запускается только кнопкой.
  const check = useCallback(() => {
    if (!singleCabinet) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    fetch(`/api/supplies/kiz-reconcile?cabinet=${encodeURIComponent(cabinetId)}&days=${days}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const raw = (await response.json().catch(() => null)) as (Partial<KizReconcileResponse> & { error?: string | null }) | null;
        if (!raw?.meta) throw new Error(raw?.error || `Ошибка ${response.status}`);
        return { meta: raw.meta, data: raw.data ?? null, error: raw.error ?? null } satisfies KizReconcileResponse;
      })
      .then((body) => {
        if (current !== requestId.current) return;
        setPayload(body);
        setError(body.error);
        setBucket(null);
        setCodeGroup("");
      })
      .catch((cause: unknown) => {
        if (current !== requestId.current || controller.signal.aborted) return;
        setPayload(null);
        setError(cause instanceof Error ? cause.message : "Не удалось выполнить сверку");
      })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    // reloadKey здесь намеренно «лишний»: его инкремент пересоздаёт колбэк и
    // тем запускает повторную сверку по кнопке «Обновить».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, days, singleCabinet, reloadKey]);

  useEffect(() => {
    if (!singleCabinet) return;
    let alive = true;
    fetch(`/api/supplies/kiz-settings?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        if (!alive || !body?.data) return;
        setHidden(body.data.hiddenSubjects ?? []);
        setNotApplicable(Boolean(body.data.notApplicable));
      })
      .catch(() => {/* настройки не критичны: без них сверка просто ничего не прячет */});
    return () => { alive = false; };
  }, [cabinetId, singleCabinet]);

  const saveSetting = useCallback(async (patch: Record<string, unknown>) => {
    setSavingSetting(true);
    try {
      const response = await fetch(`/api/supplies/kiz-settings?cabinet=${encodeURIComponent(cabinetId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await response.json();
      if (body?.data) {
        setHidden(body.data.hiddenSubjects ?? []);
        setNotApplicable(Boolean(body.data.notApplicable));
        // Сверку пересчитываем: скрытое должно исчезнуть сразу, а не после F5.
        setReloadKey((value) => value + 1);
      }
    } finally {
      setSavingSetting(false);
    }
  }, [cabinetId]);

  const result = payload?.data ?? null;
  const warnings = useMemo(
    () => [...(payload?.meta.warnings ?? []), ...(result?.warnings ?? [])],
    [payload, result],
  );

  const matchesGroup = useCallback(
    (prefix: string | null) => !codeGroup || (codeGroup === NO_PREFIX ? prefix === null : prefix === codeGroup),
    [codeGroup],
  );
  const rows = useMemo(
    () => (result?.rows ?? []).filter((row) => (!bucket || bucket === row.bucket) && matchesGroup(row.gtinPrefix)),
    [result, bucket, matchesGroup],
  );
  const returns = useMemo(
    () => (result?.returns ?? []).filter((row) => matchesGroup(row.gtinPrefix)),
    [result, matchesGroup],
  );
  /**
   * Причины, по которым опрос кодов не состоялся, — берутся из самих строк
   * «Не проверено» (ядро подставляет туда текст обрыва: нет прав, лимит WB,
   * таймаут). Ничего не додумываем: если причина одна, строка будет одна.
   */
  const notCheckedReasons = useMemo(
    () => [...new Set((result?.rows ?? []).filter((row) => row.bucket === "not_checked").map((row) => row.reason))].slice(0, 4),
    [result],
  );

  if (!singleCabinet) {
    return <WbEmptyState>Сверка кодов маркировки идёт по одному реальному кабинету — коды принадлежат конкретному юрлицу. Выберите кабинет в верхней панели.</WbEmptyState>;
  }

  const showRows = bucket !== "introduce";
  const showReturns = bucket === null || bucket === "introduce";

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="text-sm font-semibold text-slate-800">Сверка оборота кодов Честного Знака</div>
        <p className="mt-1 max-w-4xl text-[12px] leading-snug text-slate-500">
          Что с оборотом кодов: проданные сборочные задания с невыведенным кодом (риск ст. 15.12 КоАП) и возвраты, чей код надо ввести обратно.
          Мы не ходим в Честный Знак за вас — УКЭП у панели нет; сверка строится на данных WB, а действия (дозагрузка и вывод кода в WB либо ввод
          в оборот в ЛК Честный Знак) выполняете вы.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex min-h-11 items-center gap-1 rounded-lg bg-slate-100 p-0.5 sm:min-h-9" role="group" aria-label="Период сверки">
            {DAYS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={days === value}
                onClick={() => setDays(value)}
                className={`min-h-10 rounded-md px-3 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8 ${days === value ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                {value} дн.
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={check}
            disabled={loading}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:min-h-9"
          >
            <RotateCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            {loading ? "Проверяем…" : "Проверить"}
          </button>
          {result && result.codeGroups.length > 1 ? (
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Группа кодов по GTIN
              <select
                value={codeGroup}
                onChange={(event) => setCodeGroup(event.target.value)}
                className="ml-2 min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-normal normal-case tracking-normal text-slate-700 outline-none focus:border-violet-400 sm:min-h-9"
              >
                <option value="">Все</option>
                {result.codeGroups.map((item) => (
                  <option key={item.gtinPrefix ?? NO_PREFIX} value={item.gtinPrefix ?? NO_PREFIX}>
                    {item.gtinPrefix ? `GTIN ${item.gtinPrefix}…` : "код не распознан"} · {fmt(item.codes)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {result && result.codeGroups.length > 1 ? (
          // Прямо говорим, что это не реестр ИП: длина префикса GS1 переменная
          // (7–10 знаков), и без реестра GS1 два юрлица могут слиться в одну группу.
          <div className="mt-2 text-[11px] leading-snug text-slate-400">
            Группировка техническая — по первым 9 знакам GTIN. Это не владелец кода: чьё юрлицо выпустило марку, из самого кода не следует
            (нужен реестр GS1 или выгрузка Честного Знака). Разные ИП могут попасть в одну группу, а один — разойтись по двум.
          </div>
        ) : null}
        {result ? (
          <div className="mt-2 text-[11px] text-slate-400">
            проверено {fmt(result.coverage.checked)} из {fmt(result.coverage.soldTotal)} проданных за {result.coverage.days} дн.
            {payload?.meta.generatedAt ? ` · срез ${new Date(payload.meta.generatedAt).toLocaleString("ru-RU")}` : ""}
          </div>
        ) : (
          <div className="mt-2 text-[11px] text-slate-400">Коды берутся из сборочных заданий WB · {cabinetName ?? "кабинет"}</div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] text-slate-600">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={notApplicable}
            disabled={savingSetting}
            onChange={(event) => void saveSetting({ notApplicable: event.target.checked })}
            className="mt-0.5 h-4 w-4 accent-violet-600"
          />
          <span>
            <span className="font-semibold text-slate-700">Не торгую маркируемым товаром</span>
            <span className="block text-[11px] text-slate-500">
              Скрыть раздел целиком. Возите и то, и другое? Не ставьте галочку — прячьте немаркируемые
              предметы по одному кнопкой «скрыть» в строке таблицы.
            </span>
          </span>
        </label>
        {hidden.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500">Скрыты как немаркируемые:</span>
            {hidden.map((subject) => (
              <button
                key={subject}
                type="button"
                disabled={savingSetting}
                onClick={() => void saveSetting({ showSubject: subject })}
                className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:border-violet-300 hover:text-violet-700 disabled:opacity-50"
                title="Вернуть предмет в сверку"
              >
                {subject} ×
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
          <div>
            <div className="font-semibold">Сверка не выполнена</div>
            <div className="text-rose-700">{error}</div>
          </div>
        </div>
      ) : null}

      {warnings.length ? (
        <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          {warnings.map((warning) => <li key={warning}>· {warning}</li>)}
        </ul>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <LoadingBanner seconds={elapsed} hint={`сверка кодов · ${cabinetName ?? "кабинет"} · ${days} дн.`} />
          <SkeletonTableRows rows={8} cols={6} />
        </div>
      ) : !result ? (
        <WbEmptyState>Выберите период и нажмите «Проверить» — коды поднимутся из сборочных заданий WB за выбранное окно.</WbEmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {BUCKETS.map((item) => {
              const value = item.key === "retire" ? result.counts.retire
                : item.key === "no_code" ? result.counts.noCode
                : item.key === "check" ? result.counts.check
                : item.key === "not_checked" ? result.counts.notChecked
                : result.counts.introduce;
              const selected = bucket === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setBucket(selected ? null : item.key)}
                  className={`rounded-xl border p-3 text-left transition ${selected ? item.active : "border-slate-200 bg-white hover:border-violet-200"}`}
                >
                  <div className="text-[11px] text-slate-500">{item.label}</div>
                  <div className={`mt-1 text-2xl font-bold tabular-nums ${item.tone}`}>{fmt(value)}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{item.hint}</div>
                </button>
              );
            })}
          </div>

          {result.counts.notChecked ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              <div>
                <div className="font-semibold">
                  Коды проверены не по всем заданиям: {fmt(result.counts.notChecked)} из {fmt(result.coverage.soldTotal)}
                </div>
                <div className="mt-0.5 leading-snug">
                  Это не «код не привязан», а «панель не смогла спросить WB»: состояние кодов по этим заданиям неизвестно.
                  Не считайте их ни нарушением, ни чистыми — повторите проверку.
                </div>
                {notCheckedReasons.length ? (
                  <ul className="mt-1 space-y-0.5">
                    {notCheckedReasons.map((reason) => <li key={reason}>· {reason}</li>)}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          {showRows ? (
            <section className="space-y-2">
              <div className="text-[13px] font-semibold text-slate-700">
                {bucket === "not_checked" ? "Задания с непроверенным кодом"
                  : bucket === "no_code" ? "Продано без кода маркировки"
                  : "Вывести из оборота"}
              </div>
              <AnalyticsTable
                columns={buildRowColumns((subject) => void saveSetting({ hideSubject: subject }))}
                data={rows}
                filename={`kiz-${bucket === "not_checked" ? "ne-provereno" : bucket === "no_code" ? "net-koda" : "vyvesti"}-${cabinetName ?? "cabinet"}-${today()}.csv`}
                emptyMessage="По выбранному фильтру заданий нет."
              />
            </section>
          ) : null}

          {showReturns ? (
            <section className="space-y-2">
              <div className="text-[13px] font-semibold text-slate-700">Возвраты — ввести код в оборот</div>
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                <div>
                  Маркируемый товар вернулся к вам — верните код в оборот в ЛК Честный Знак за 3 рабочих дня после получения, иначе перепродать единицу нельзя.
                </div>
              </div>
              <AnalyticsTable
                columns={returnColumns}
                data={returns}
                filename={`kiz-vvesti-${cabinetName ?? "cabinet"}-${today()}.csv`}
                emptyMessage="Возвратов за период нет — вводить коды в оборот не нужно."
              />
              <div className="text-[11px] text-slate-400">
                Срок считается по рабочим дням (Пн–Пт) без учёта праздников и переносов производственного календаря. Код возврата подставляется из
                сборочного задания WB; если задание вне окна сверки, код показан не будет — сверьте единицу по баркоду.
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
