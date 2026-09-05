"use client";

import { ChevronDown, ChevronRight, Download, FileSpreadsheet, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { exportCsv } from "@/lib/analytics/format";
import { parseKizCode, type KizBrandExport } from "@/lib/wb/kizCodes";
import type { KizExportResponse } from "@/app/api/supplies/kiz/export/route";
import { WbEmptyState, WbErrorState } from "./WbModuleHeader";

type SourceKey = "fbs" | "dbs" | "returns";

interface KizFiles {
  fbs: File | null;
  dbs: File | null;
  returns: File | null;
}

interface CodeRow {
  code: string;
  gtin: string;
  /** Первые 9 знаков GTIN — технический ключ группировки, НЕ владелец кода. */
  gtinPrefix: string;
}

const EMPTY_FILES: KizFiles = { fbs: null, dbs: null, returns: null };

const UPLOADERS: { key: SourceKey; title: string; hint: string }[] = [
  { key: "fbs", title: "Продажи FBS", hint: "ЛК WB → Маркетплейс → FBS → архив продаж за период" },
  { key: "dbs", title: "Продажи DBS", hint: "ЛК WB → Маркетплейс → DBS → архив продаж за период" },
  { key: "returns", title: "Возвраты", hint: "ЛК WB → Возвраты → выгрузка; берутся только строки «Возврат брака»" },
];

const fmt = (value: number) => value.toLocaleString("ru-RU");
const today = () => new Date().toISOString().slice(0, 10);
const fileSlug = (value: string) => value.trim().toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "") || "bez-brenda";

const codeColumns: Column<CodeRow>[] = [
  { key: "code", label: "Код КИЗ", render: (row) => <span className="font-mono text-[11px] break-all text-slate-700">{row.code}</span>, csv: (row) => row.code },
  { key: "gtin", label: "GTIN", render: (row) => <span className="font-mono text-[11px] text-slate-500">{row.gtin || "—"}</span>, csv: (row) => row.gtin },
  {
    key: "gtinPrefix",
    label: "Префикс GTIN (9 знаков)",
    render: (row) => <span className="font-mono text-[11px] text-slate-500">{row.gtinPrefix || "—"}</span>,
    csv: (row) => row.gtinPrefix,
  },
];

/** Подпись колонки префикса — одна и та же в таблице, в сводном CSV и в пояснении. */
const GTIN_PREFIX_LABEL = "Префикс GTIN (9 знаков)";

function toCodeRows(brand: KizBrandExport): CodeRow[] {
  return brand.codes.map((code) => {
    const parsed = parseKizCode(code);
    return { code, gtin: parsed.gtin ?? "", gtinPrefix: parsed.gtinPrefix ?? "" };
  });
}

function UploadCard({
  title,
  hint,
  file,
  disabled,
  onPick,
}: {
  title: string;
  hint: string;
  file: File | null;
  disabled: boolean;
  onPick: (next: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-2">
        <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-slate-700">{title}</div>
          <div className="mt-0.5 text-[11px] leading-4 text-slate-400">{hint}</div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        disabled={disabled}
        className="mt-2 block w-full text-[11px] text-slate-500 file:mr-2 file:min-h-11 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:text-[11px] file:font-semibold file:text-slate-700 hover:file:bg-slate-200 disabled:opacity-50 lg:file:min-h-0 lg:file:px-2.5 lg:file:py-1.5"
        onChange={(event) => onPick(event.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
          <span className="truncate text-slate-500" title={file.name}>{file.name}</span>
          <button
            type="button"
            className="tap shrink-0 font-semibold text-slate-400 hover:text-rose-600"
            onClick={() => {
              if (inputRef.current) inputRef.current.value = "";
              onPick(null);
            }}
          >
            убрать
          </button>
        </div>
      ) : null}
    </div>
  );
}

function BrandCard({ brand }: { brand: KizBrandExport }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => toCodeRows(brand), [brand]);
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-slate-700">{brand.brand}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            FBS {fmt(brand.sources.fbs)} · DBS {fmt(brand.sources.dbs)} · возвраты {fmt(brand.sources.returns)}
            {brand.duplicatesRemoved ? ` · снято дублей ${fmt(brand.duplicatesRemoved)}` : ""}
            {brand.codeGroup.gtinPrefix ? ` · префикс GTIN ${brand.codeGroup.gtinPrefix}…` : ""}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-bold tabular-nums text-violet-700">{fmt(brand.codes.length)}</div>
          <div className="text-[11px] text-slate-400">кодов</div>
        </div>
      </button>
      {open ? (
        <div className="border-t border-slate-100 p-3">
          <AnalyticsTable
            columns={codeColumns}
            data={rows}
            filename={`wb-kiz-${fileSlug(brand.brand)}-${today()}.csv`}
            emptyMessage="У бренда нет распознанных кодов."
          />
        </div>
      ) : null}
    </div>
  );
}

export function WbKizExportTab({
  cabinetId,
  cabinetName,
  // Права не переданы — считаем, что их нет: раздел разбирает коды конкретного
  // кабинета, и «неизвестно» здесь безопаснее трактовать как «нельзя».
  canWrite = false,
}: { cabinetId: string; cabinetName?: string; canWrite?: boolean }) {
  const [files, setFiles] = useState<KizFiles>(EMPTY_FILES);
  const [data, setData] = useState<KizExportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Уход со вкладки посреди разбора не должен оставлять висящий запрос.
  useEffect(() => () => abortRef.current?.abort(), []);

  // canWrite кодирует сразу две вещи (роль и выбор кабинета) — разделяем их,
  // иначе продавцу показывается «выберите кабинет», хотя кабинет уже выбран.
  const singleCabinet = Boolean(cabinetId) && cabinetId !== "all" && !cabinetId.startsWith("group:");

  const hasFiles = Boolean(files.fbs || files.dbs || files.returns);
  const brands = data?.data?.brands ?? [];
  const warnings = data?.meta?.warnings ?? [];

  const submit = () => {
    if (!hasFiles || loading) return;
    const current = ++requestId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const body = new FormData();
    body.set("cabinetId", cabinetId);
    if (files.fbs) body.set("fbs", files.fbs);
    if (files.dbs) body.set("dbs", files.dbs);
    if (files.returns) body.set("returns", files.returns);
    setLoading(true);
    setError(null);
    fetch("/api/supplies/kiz/export", { method: "POST", body, signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as KizExportResponse;
        if (!response.ok || payload.error) throw new Error(payload.error || `Ошибка ${response.status}`);
        return payload;
      })
      .then((payload) => { if (current === requestId.current) setData(payload); })
      .catch((cause: unknown) => {
        if (current === requestId.current && !controller.signal.aborted) {
          setData(null);
          setError(cause instanceof Error ? cause.message : "Не удалось собрать списки КИЗ");
        }
      })
      .finally(() => { if (current === requestId.current) setLoading(false); });
  };

  const exportAll = () => {
    const rows: string[][] = [];
    for (const brand of brands) {
      for (const row of toCodeRows(brand)) rows.push([brand.brand, row.code, row.gtin, row.gtinPrefix]);
    }
    exportCsv(`wb-kiz-svodny-${fileSlug(cabinetName ?? "cabinet")}-${today()}.csv`, ["Бренд", "Код КИЗ", "GTIN", GTIN_PREFIX_LABEL], rows);
  };

  if (!singleCabinet) {
    return <WbEmptyState>Коды маркировки разбираются по одному реальному кабинету — выберите кабинет в верхней панели (сводный режим «Все» и группы кабинетов здесь не работают).</WbEmptyState>;
  }
  if (!canWrite) {
    return <WbEmptyState>У вашей роли нет доступа к разбору кодов маркировки этого кабинета — обратитесь к владельцу панели.</WbEmptyState>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="text-[13px] font-semibold text-slate-700">Списки кодов маркировки по брендам</div>
        <div className="mt-0.5 text-[12px] text-slate-500">
          Коды берутся из выгрузок ЛК WB — токен Честного Знака для этого не нужен.
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-3">
        {UPLOADERS.map((uploader) => (
          <UploadCard
            key={uploader.key}
            title={uploader.title}
            hint={uploader.hint}
            file={files[uploader.key]}
            disabled={loading}
            onPick={(next) => setFiles((previous) => ({ ...previous, [uploader.key]: next }))}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!hasFiles || loading}
          onClick={submit}
          className="rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          {loading ? "Собираем…" : "Сформировать"}
        </button>
        {brands.length ? (
          <button
            type="button"
            onClick={exportAll}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Сводный CSV
          </button>
        ) : null}
        <span className="text-[11px] text-slate-400">
          Достаточно любого одного файла. Файлы не сохраняются на сервере — разбор живёт до перезагрузки страницы.
        </span>
      </div>

      {error ? <WbErrorState message={error} onRetry={submit} /> : null}

      {warnings.length ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <ul className="space-y-0.5">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      {data?.data ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-[11px] text-slate-500">Кодов всего</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-violet-700">{fmt(data.data.totalCodes)}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">после снятия дублей</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-[11px] text-slate-500">Брендов</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-slate-700">{fmt(brands.length)}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">по каталогу кабинета</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-[11px] text-slate-500">Разобрано файлов</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-slate-700">
              {fmt([data.data.files.fbs, data.data.files.dbs, data.data.files.returns].filter(Boolean).length)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">{cabinetName ?? "кабинет"}</div>
          </div>
        </div>
      ) : null}

      {data?.data ? (
        brands.length ? (
          <div className="space-y-2">
            {brands.map((brand) => <BrandCard key={brand.brand} brand={brand} />)}
          </div>
        ) : (
          <WbEmptyState>В загруженных выгрузках нет распознанных кодов маркировки.</WbEmptyState>
        )
      ) : !error && !loading ? (
        <WbEmptyState>Загрузите выгрузку из ЛК WB — коды берутся из неё, ЧЗ-токен для этого не нужен.</WbEmptyState>
      ) : null}

      <div className="text-[11px] leading-4 text-slate-400">
        Методика: из марки берётся код идентификации — 31 символ, без криптохвоста. Бренд определяется по артикулу WB из
        каталога кабинета, а не из отчёта. Дубли снимаются по коду идентификации. Владелец кода не определяется: ИНН в марке нет,
        а «префикс GTIN» — это просто первые 9 знаков GTIN, техническая группировка. Длина настоящего префикса GS1 переменная
        (7–10 знаков) и без реестра GS1 неизвестна, поэтому в одну группу могут попасть коды разных юрлиц, а коды одного —
        разойтись по двум. Чьи коды на самом деле — видно только в ЛК Честного Знака.
      </div>
    </div>
  );
}
