"use client";

import { AlertTriangle, Boxes, CheckCircle2, FileSpreadsheet, HeartPulse, Loader2, PackageCheck, Play, RefreshCw, Save, ShieldCheck, Unplug, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatTime } from "@/lib/analytics/format";

interface ConnectionStatus {
  connected: boolean;
  accountName?: string | null;
  tokenMask?: string;
  organization?: { href: string; name: string } | null;
  store?: { href: string; name: string } | null;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
}

interface ImportSummary { containers: number; skuRows: number; quantity: number; volumeLiters: number }
interface ActiveImport { id: string; file_name: string; summary: ImportSummary; updated_at: string }
interface Preview {
  fileName: string;
  summary: ImportSummary;
  sourceSummary: ImportSummary;
  columns: Record<string, string>;
  errors: string[];
  warnings: string[];
  lines: { lineNumber: number; container: string; nmId: number | null; article: string; barcode: string; quantity: number }[];
  hiddenLines: number;
}

interface Reference { name: string; meta: { href: string } }
interface Health {
  ok: boolean;
  checks: { key: string; name: string; ok: boolean; detail: string }[];
  references: { organizations: Reference[]; stores: Reference[] };
  selected: { organizationHref: string | null; storeHref: string | null };
}

interface Run {
  id: string;
  status: "dry_run" | "creating" | "created" | "failed";
  plan_json: {
    sourceFile?: string;
    totalQuantity: number;
    excludedContainers: string[];
    orders: { warehouse: string; containers: string[]; totalQuantity: number; positions: unknown[] }[];
  };
  external_orders: { syncId: string; warehouse: string; id: string; name: string; href: string }[];
  error?: string | null;
  created_at: string;
}

interface Props { cabinetId: string; canWrite: boolean }

const count = (value: number) => Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const messageClass = (ok: boolean) => ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700";

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { data?: T; error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
  return body.data as T;
}

export function MoySkladSourceTab({ cabinetId, canWrite }: Props) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [activeImport, setActiveImport] = useState<ActiveImport | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [token, setToken] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const api = useMemo(() => `cabinet=${encodeURIComponent(cabinetId)}`, [cabinetId]);

  const checkHealth = useCallback(async (quiet = false) => {
    if (!cabinetId || !canWrite) return;
    if (!quiet) setBusy("health");
    try {
      const data = await json<Health>(await fetch(`/api/supplies/wms-health?${api}`, { cache: "no-store" }));
      setHealth(data);
      if (!quiet) setMessage({ ok: data.ok, text: data.ok ? "Контур WMS готов к dry-run" : "Есть незавершённые шаги — они отмечены ниже" });
    } catch (error) {
      if (!quiet) setMessage({ ok: false, text: error instanceof Error ? error.message : "Не удалось проверить WMS" });
    } finally {
      if (!quiet) setBusy(null);
    }
  }, [api, cabinetId, canWrite]);

  const load = useCallback(async () => {
    if (!cabinetId || !canWrite) return;
    setBusy("load");
    setMessage(null);
    try {
      const [connection, tara, runData] = await Promise.all([
        json<ConnectionStatus>(await fetch(`/api/moysklad?${api}`, { cache: "no-store" })),
        json<{ activeImport: ActiveImport | null }>(await fetch(`/api/supplies/tara?${api}`, { cache: "no-store" })),
        json<{ runs: Run[] }>(await fetch(`/api/supplies/wms-runs?${api}`, { cache: "no-store" })),
      ]);
      setStatus(connection);
      setActiveImport(tara.activeImport);
      setRuns(runData.runs);
      if (connection.connected) void checkHealth(true);
      else setHealth(null);
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Не удалось загрузить источник" });
    } finally {
      setBusy(null);
    }
  }, [api, cabinetId, canWrite, checkHealth]);

  useEffect(() => {
    setPreview(null);
    setFile(null);
    setHealth(null);
    void load();
  }, [load]);

  const connect = async () => {
    if (!token.trim()) return;
    setBusy("connect"); setMessage(null);
    try {
      await json(await fetch("/api/moysklad", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cabinetId, token }) }));
      setToken("");
      setMessage({ ok: true, text: "МойСклад подключён только к выбранному кабинету" });
      await load();
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "Не удалось подключить" }); }
    finally { setBusy(null); }
  };

  const disconnect = async () => {
    if (!window.confirm("Отключить МойСклад только у выбранного кабинета?")) return;
    setBusy("disconnect");
    try {
      await json(await fetch(`/api/moysklad?${api}`, { method: "DELETE" }));
      setMessage({ ok: true, text: "МойСклад отключён" });
      await load();
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "Не удалось отключить" }); }
    finally { setBusy(null); }
  };

  const saveReferences = async (organizationHref: string, storeHref: string | null) => {
    setBusy("references");
    try {
      await json(await fetch("/api/moysklad", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cabinetId, organizationHref, storeHref }) }));
      setMessage({ ok: true, text: "Юрлицо и склад-источник сохранены" });
      await load();
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "Не удалось сохранить настройки" }); }
    finally { setBusy(null); }
  };

  const upload = async (mode: "preview" | "activate") => {
    if (!file) return;
    setBusy(mode); setMessage(null);
    const form = new FormData();
    form.set("cabinetId", cabinetId);
    form.set("mode", mode);
    form.set("file", file);
    try {
      const result = await json<{ preview: Preview; activeImport?: ActiveImport }>(await fetch("/api/supplies/tara", { method: "POST", body: form }));
      setPreview(result.preview);
      if (result.activeImport) setActiveImport(result.activeImport);
      setMessage({ ok: result.preview.errors.length === 0, text: mode === "activate" ? "Файл стал активным источником готовой тары" : result.preview.errors.length ? "В файле есть ошибки — активация заблокирована" : "Предпросмотр готов. Проверьте итоги и активируйте файл" });
      if (mode === "activate") await checkHealth(true);
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "Не удалось обработать XLSX" }); }
    finally { setBusy(null); }
  };

  const dryRun = async () => {
    setBusy("dry-run"); setMessage(null);
    try {
      const result = await json<{ run: Run }>(await fetch("/api/supplies/wms-runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cabinetId }) }));
      setRuns((current) => [result.run, ...current.filter((run) => run.id !== result.run.id)]);
      setMessage({ ok: true, text: "Dry-run готов: внешние документы ещё не создавались" });
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "Dry-run не выполнен" }); }
    finally { setBusy(null); }
  };

  const createOrders = async (run: Run) => {
    if (!window.confirm(`Создать ${run.plan_json.orders.length} внутренних WMS-заказа в МойСклад? Повторный запуск не создаст дубли.`)) return;
    setBusy("create"); setMessage(null);
    try {
      await json(await fetch("/api/supplies/wms-runs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: run.id, confirm: "CREATE_WMS_ORDERS" }) }));
      setMessage({ ok: true, text: "WMS-заказы созданы в МойСклад" });
      await load();
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "Создание остановлено; безопасный повтор доступен" }); await load(); }
    finally { setBusy(null); }
  };

  if (!canWrite || !cabinetId || cabinetId === "all") {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">Источник и WMS настраиваются отдельно для каждого кабинета. Выберите один реальный WB-кабинет в верхней панели.</div>;
  }

  const latestRun = runs[0] ?? null;
  const working = busy !== null;

  return (
    <div className="space-y-3">
      {message ? <div role="status" aria-live="polite" className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${messageClass(message.ok)}`}>{message.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}<span>{message.text}</span></div> : null}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {(health?.checks ?? [
          { key: "connection", name: "МойСклад", ok: Boolean(status?.connected), detail: status?.connected ? "Подключён" : "Не подключён" },
          { key: "tara", name: "Готовая тара", ok: Boolean(activeImport), detail: activeImport?.file_name ?? "Нет файла" },
        ]).map((check) => <div key={check.key} className={`rounded-xl border bg-white p-3 ${check.ok ? "border-emerald-200" : "border-slate-200"}`}><div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{check.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}{check.name}</div><div className="mt-1 truncate text-[10px] text-slate-600" title={check.detail}>{check.detail}</div></div>)}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="moysklad-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 id="moysklad-title" className="text-sm font-semibold text-slate-900">1. МойСклад этого кабинета</h3><p className="mt-1 text-[11px] leading-5 text-slate-500">Токен, юрлицо и склад не используются другими кабинетами.</p></div>
          <button type="button" onClick={() => void checkHealth()} disabled={working || !status?.connected} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 hover:border-violet-300 hover:text-violet-700 disabled:opacity-50 sm:min-h-9">{busy === "health" ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <HeartPulse className="h-3.5 w-3.5" />} Проверить контур</button>
        </div>
        {status?.connected ? <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" /><span className="font-semibold">{status.accountName || "МойСклад"}</span><span className="text-slate-400">токен {status.tokenMask}</span>{status.lastSyncAt ? <span className="text-slate-400">проверка {formatTime(status.lastSyncAt)}</span> : null}</div>
          {health?.references.organizations.length ? <div className="grid gap-3 md:grid-cols-2"><label className="text-[11px] font-medium text-slate-600">Юрлицо<select aria-label="Юрлицо МойСклад" value={health.selected.organizationHref ?? ""} onChange={(event) => void saveReferences(event.target.value, health.selected.storeHref)} disabled={working} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-400 disabled:opacity-50">{health.references.organizations.map((item) => <option key={item.meta.href} value={item.meta.href}>{item.name}</option>)}</select></label><label className="text-[11px] font-medium text-slate-600">Склад-источник<select aria-label="Склад-источник МойСклад" value={health.selected.storeHref ?? ""} onChange={(event) => void saveReferences(health.selected.organizationHref ?? "", event.target.value || null)} disabled={working || !health.selected.organizationHref} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-400 disabled:opacity-50"><option value="">Без склада</option>{health.references.stores.map((item) => <option key={item.meta.href} value={item.meta.href}>{item.name}</option>)}</select></label></div> : <div className="grid gap-2 text-[11px] text-slate-500 sm:grid-cols-2"><div className="rounded-lg bg-slate-50 p-3">Юрлицо: <span className="font-semibold text-slate-700">{status.organization?.name ?? "не выбрано"}</span></div><div className="rounded-lg bg-slate-50 p-3">Склад: <span className="font-semibold text-slate-700">{status.store?.name ?? "без склада"}</span></div></div>}
          {status.lastSyncError ? <div role="alert" className="text-xs text-rose-600">{status.lastSyncError}</div> : null}
          <button type="button" onClick={() => void disconnect()} disabled={working} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 sm:min-h-9"><Unplug className="h-3.5 w-3.5" /> Отключить у кабинета</button>
        </div> : <div className="mt-4 space-y-2"><label htmlFor="moysklad-token" className="block text-[11px] font-medium text-slate-600">API-токен МойСклад</label><div className="flex flex-col gap-2 sm:flex-row"><input id="moysklad-token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Настройки → Обмен данными → API токены" className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 font-mono text-xs outline-none focus:border-violet-400" /><button type="button" onClick={() => void connect()} disabled={working || !token.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ShieldCheck className="h-4 w-4" />} Подключить и проверить</button></div></div>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="tara-title">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="tara-title" className="text-sm font-semibold text-slate-900">2. Готовая тара · containerscontent.xlsx</h3><p className="mt-1 text-[11px] leading-5 text-slate-500">Сначала предпросмотр. Короба не дробятся между складами.</p></div>{activeImport ? <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[10px] font-semibold text-emerald-700"><PackageCheck className="mr-1 inline h-3.5 w-3.5" />Активен {activeImport.file_name}</div> : null}</div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center"><label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-violet-300 bg-violet-50 px-4 text-xs font-semibold text-violet-700 hover:bg-violet-100"><FileSpreadsheet className="h-4 w-4" />{file?.name ?? "Выбрать XLSX"}<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} /></label><button type="button" onClick={() => void upload("preview")} disabled={working || !file} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:border-violet-300 hover:text-violet-700 disabled:opacity-50">{busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-4 w-4" />} Предпросмотр</button></div>
        {preview ? <div className="mt-4 space-y-3"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Коробов", preview.summary.containers], ["Строк SKU", preview.summary.skuRows], ["Единиц", preview.summary.quantity], ["Объём, л", preview.summary.volumeLiters]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] text-slate-400">{label}</div><div className="mt-1 text-lg font-bold tabular-nums text-slate-800">{count(Number(value))}</div></div>)}</div>{preview.warnings.map((warning) => <div key={warning} className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}</div>)}{preview.errors.map((error) => <div key={error} role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 p-2 text-[11px] text-rose-700"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>)}{preview.lines.length ? <div className="max-h-72 overflow-auto rounded-lg border border-slate-200"><table className="min-w-[680px] w-full text-[10px]"><thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left">Короб</th><th className="px-3 py-2 text-left">Артикул</th><th className="px-3 py-2 text-left">nmId</th><th className="px-3 py-2 text-left">ШК</th><th className="px-3 py-2 text-right">Шт.</th></tr></thead><tbody>{preview.lines.map((line) => <tr key={`${line.lineNumber}-${line.container}-${line.article}`} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold text-slate-700">{line.container}</td><td className="px-3 py-2 text-violet-700">{line.article || "—"}</td><td className="px-3 py-2 tabular-nums text-slate-500">{line.nmId ?? "—"}</td><td className="px-3 py-2 font-mono text-slate-500">{line.barcode || "—"}</td><td className="px-3 py-2 text-right tabular-nums">{count(line.quantity)}</td></tr>)}</tbody></table></div> : null}<button type="button" onClick={() => void upload("activate")} disabled={working || preview.errors.length > 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{busy === "activate" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Save className="h-4 w-4" />} Активировать этот файл</button></div> : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="dry-run-title">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="dry-run-title" className="text-sm font-semibold text-slate-900">3. WMS-заказы</h3><p className="mt-1 text-[11px] leading-5 text-slate-500">Dry-run обязателен и повторно проверяет ограничения WB. До подтверждения МойСклад не меняется.</p></div><button type="button" onClick={() => void dryRun()} disabled={working || !status?.connected || !activeImport} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"><Play className="h-4 w-4" />{busy === "dry-run" ? "Проверяю…" : "Собрать dry-run"}</button></div>
        {latestRun ? <div className="mt-4 space-y-3"><div className="flex flex-wrap items-center gap-2 text-[11px]"><span className={`rounded-full px-2 py-1 font-semibold ${latestRun.status === "created" ? "bg-emerald-100 text-emerald-700" : latestRun.status === "failed" ? "bg-rose-100 text-rose-700" : latestRun.status === "creating" ? "bg-amber-100 text-amber-700" : "bg-violet-100 text-violet-700"}`}>{latestRun.status === "dry_run" ? "DRY-RUN" : latestRun.status === "creating" ? "СОЗДАНИЕ" : latestRun.status === "created" ? "СОЗДАНО" : "ОШИБКА"}</span><span className="text-slate-400">{formatTime(latestRun.created_at)}</span><span className="font-semibold text-slate-700">{count(latestRun.plan_json.totalQuantity)} шт · {latestRun.plan_json.orders.length} заказов</span></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{latestRun.plan_json.orders.map((order) => <div key={order.warehouse} className="rounded-lg border border-slate-200 p-3"><div className="truncate text-[11px] font-semibold text-slate-800">{order.warehouse}</div><div className="mt-2 flex items-end justify-between"><span className="text-lg font-bold tabular-nums text-violet-700">{count(order.totalQuantity)}</span><span className="text-[10px] text-slate-400">{order.containers.length} коробов</span></div></div>)}</div>{latestRun.plan_json.excludedContainers?.length ? <div className="text-[11px] text-amber-700">Целиком исключено коробов: {latestRun.plan_json.excludedContainers.length}</div> : null}{latestRun.error ? <div role="alert" className="rounded-lg bg-rose-50 p-3 text-[11px] text-rose-700">{latestRun.error}</div> : null}{latestRun.status !== "created" ? <button type="button" onClick={() => void createOrders(latestRun)} disabled={working || latestRun.status === "creating"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{busy === "create" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Boxes className="h-4 w-4" />} Создать в МойСклад</button> : <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Создано документов: {latestRun.external_orders?.length ?? latestRun.plan_json.orders.length}</div>}</div> : <div className="mt-4 rounded-lg bg-slate-50 p-4 text-[11px] text-slate-500">Подключите источник, активируйте XLSX и сохраните распределение. Затем dry-run покажет точные документы до создания.</div>}
      </section>
    </div>
  );
}
