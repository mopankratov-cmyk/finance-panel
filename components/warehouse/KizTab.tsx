"use client";

import { AlertTriangle, ChevronDown, Download, FileUp, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { KizUploadResult, KizWithdrawalSummary } from "@/app/api/warehouse/kiz/route";
import type { KizSalesResult } from "@/app/api/warehouse/kiz/sales/route";
import type { KizTasksResult } from "@/app/api/warehouse/kiz/tasks/route";
import type { KizCollectResult } from "@/app/api/warehouse/kiz/collect/route";

const money = (value: number) => `${formatNumber(Math.round(value))} ₽`;

/**
 * Вывод из оборота проданного по FBS.
 *
 * Экран отвечает на один вопрос — надо ли что-то делать сегодня, — и потому
 * начинается вердиктом, а не показателями. Ось решения здесь возраст кода, а не
 * количество: четыреста свежих и четыреста просроченных требуют разного, хотя
 * число одинаковое.
 *
 * Источники кодов сведены к одной кнопке намеренно. Их порядок выводится из их
 * свойств: первый читает нашу базу и бесплатен, второй стоит минуту на кабинет,
 * третий ничего не добавляет, а вычитает уже выведенное. Человеку тут не из
 * чего выбирать, и решение это не его.
 */
/** Потолок документа вывода в Честном Знаке. Тот же, что на сервере. */
const CHZ_DOC_LIMIT = 30_000;

export function KizTab({ entityId, refreshKey }: { entityId: string; refreshKey: number }) {
  const [summary, setSummary] = useState<KizWithdrawalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "refresh" | "wb" | "upload" | "file">(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string[] | null>(null);
  const [reportBad, setReportBad] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const soldRef = useRef<HTMLInputElement>(null);
  const returnsRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/warehouse/kiz?entity=${encodeURIComponent(entityId)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось прочитать реестр");
      setSummary(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать реестр");
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const run = async (kind: "refresh" | "wb", fn: () => Promise<string[]>, bad = false) => {
    setBusy(kind);
    setError(null);
    setReport(null);
    try {
      const lines = await fn();
      setReport(lines);
      setReportBad(bad);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось");
    } finally {
      setBusy(null);
    }
  };

  /** Быстрый шаг: только наша база, без обращений к WB и без лимитов. */
  const refresh = () => run("refresh", async () => {
    const res = await fetch("/api/warehouse/kiz/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Собираем по кабинетам того юрлица, чьи числа человек видит на экране.
      body: JSON.stringify({ entityId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Не удалось обновить");
    const d = json.data as KizTasksResult;
    const lines = [d.added > 0 ? `К выводу добавлено ${formatNumber(d.added)}` : "Новых кодов нет — всё уже собрано"];
    if (d.enriched > 0) lines.push(`${formatNumber(d.enriched)} кодам дописаны дата продажи и товар`);
    if (d.unlinked > 0) lines.push(`${formatNumber(d.unlinked)} кодов ждут связи с продажей — подтянутся сами`);
    return lines;
  });

  /** Медленный шаг: чтение отчётов WB. Отдельно, потому что стоит минуты. */
  const fromWb = () => run("wb", async () => {
    const lines: string[] = [];
    let bad = false;
    const sales = await fetch("/api/warehouse/kiz/sales", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId }),
    }).then((r) => r.json());
    if (sales.data) {
      const d = sales.data as KizSalesResult;
      lines.push(d.addedTotal > 0 ? `Из отчёта о реализации: +${formatNumber(d.addedTotal)}` : "Из отчёта о реализации новых кодов нет");
      for (const row of d.cabinets.filter((c) => c.error)) { lines.push(`${row.name}: ${row.error}`); bad = true; }
      if (d.skipped.length) { lines.push(`Не успели: ${d.skipped.join(", ")}`); bad = true; }
    } else if (sales.error) { lines.push(String(sales.error)); bad = true; }

    const collect = await fetch("/api/warehouse/kiz/collect", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId }),
    }).then((r) => r.json());
    if (collect.data) {
      const d = collect.data as KizCollectResult;
      const failed = d.cabinets.filter((c) => c.error);
      lines.push(`Сверено с выведенным: отмечено ${formatNumber(d.addedTotal)}`);
      for (const row of failed) { lines.push(`${row.name}: ${row.error}`); bad = true; }
    } else if (collect.error) { lines.push(String(collect.error)); bad = true; }
    setReportBad(bad);
    return lines;
  });

  const upload = async () => {
    const sold = soldRef.current?.files?.[0];
    if (!sold) { setError("Выберите выгрузку завершённых заказов"); return; }
    setBusy("upload");
    setError(null);
    setReport(null);
    try {
      const form = new FormData();
      form.set("sold", sold);
      const returns = returnsRef.current?.files?.[0];
      if (returns) form.set("returns", returns);
      const res = await fetch("/api/warehouse/kiz", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить");
      const d = json.data as KizUploadResult;
      const lines = [d.added > 0 ? `Из файлов добавлено ${formatNumber(d.added)}` : "Все коды из файла уже в реестре"];
      if (d.updatedByReturn > 0) lines.push(`Вернулись в оборот: ${formatNumber(d.updatedByReturn)}`);
      if (d.withoutPrice > 0) lines.push(`Без цены реализации: ${formatNumber(d.withoutPrice)}`);
      if (d.returnedAfterSent.length > 0) lines.push(`Вернулись после отправки: ${d.returnedAfterSent.length}`);
      setReport(lines);
      setReportBad(d.returnedAfterSent.length > 0);
      if (soldRef.current) soldRef.current.value = "";
      if (returnsRef.current) returnsRef.current.value = "";
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить");
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    // Честный Знак не примет больше 30 000 кодов в одном документе, и сервер
    // режет партию по этому потолку. Обещать в подтверждении всё количество
    // значило бы соврать ровно в том месте, где человек соглашается на
    // необратимое.
    const pending = summary?.pending ?? 0;
    const inBatch = Math.min(pending, CHZ_DOC_LIMIT);
    if (!window.confirm(
      `Отправить ${formatNumber(inBatch)} кодов на вывод?\n\n`
      + (pending > inBatch ? `Это первая партия из ${formatNumber(pending)}: больше ${formatNumber(CHZ_DOC_LIMIT)} в один документ не принимают.\n\n` : "")
      + "Коды будут помечены отправленными. Повторно собрать их файлом нельзя — только скачать эту же партию заново.",
    )) return;
    setBusy("file");
    setError(null);
    try {
      const res = await fetch("/api/warehouse/kiz/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Юрлицо обязательно: сбор файла необратим, и чужие коды в свой документ
        // вывода попасть не должны.
        body: JSON.stringify({ markSent: true, entityId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        // Партия могла быть уже захвачена, а файл не собраться. Тогда коды
        // помечены отправленными, и человеку нужна плашка «Скачать заново» —
        // перечитываем реестр, чтобы она появилась сразу.
        if (json?.batch) await load();
        throw new Error(json?.error || "Не удалось собрать файл");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "kiz.xlsx";
      link.click();
      URL.revokeObjectURL(url);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось собрать файл");
    } finally {
      setBusy(null);
    }
  };

    // Заглушка — только пока данных нет ВООБЩЕ. Раньше она подменяла собой уже
  // показанное на каждое «Обновить»: экран мигал пустотой, а вкладка, которая
  // теперь остаётся смонтированной, теряла бы вид при любом обновлении соседней.
  if (loading && !summary) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Читаю реестр…</div>;

  const pending = summary?.pending ?? 0;
  const age = summary?.ageBuckets ?? { overdue: 0, lastDay: 0, twoDays: 0, fresh: 0 };
  const max = Math.max(1, age.overdue, age.lastDay, age.twoDays, age.fresh);
  const bar = (value: number, tone: string) => (
    <div className="h-2 rounded-full" style={{ width: `${Math.max(2, (value / max) * 100)}%`, background: tone }} />
  );

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-slate-700">Вывод из оборота</p>
        <button onClick={() => setHowOpen(!howOpen)} className="flex min-h-11 items-center gap-1 text-xs text-slate-400 hover:text-slate-600 lg:min-h-0">
          Как это работает <ChevronDown className={`h-3 w-3 transition-transform ${howOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {howOpen && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <ol className="list-inside list-decimal space-y-1">
            <li>Продали по FBS — код надо вывести из оборота за три рабочих дня.</li>
            <li>Система собирает коды сама: из сборочных заданий, из отчёта о реализации и из отчёта по маркировке — что уже выведено.</li>
            <li>Вы собираете файл и передаёте тому, кто выводит в Честном Знаке. Отправленные коды помечаются и дважды не уйдут.</li>
            <li>FBW не наше дело: там из оборота выводит сам Wildberries.</li>
          </ol>
        </div>
      )}

      {/* Вердикт: три состояния, три тона. Первое, что видит человек. */}
      <div className={`rounded-xl border p-5 ${
        age.overdue > 0 ? "border-red-200 bg-red-50"
        : pending > 0 ? "border-violet-200 bg-violet-50"
        : "border-slate-200 bg-white"
      }`}>
        {age.overdue > 0 ? (
          <p className="text-base font-semibold text-red-700">
            {formatNumber(age.overdue)} кодов просрочены — срок вывода истёк
          </p>
        ) : pending > 0 ? (
          <p className="text-base font-semibold text-violet-800">
            Соберите файл: {formatNumber(pending)} кодов
          </p>
        ) : (
          <p className="text-base font-medium text-slate-600">Сегодня выводить нечего</p>
        )}

        {pending > 0 && (
          <p className="mt-1 text-sm text-slate-600">
            Всего к выводу {formatNumber(pending)} · {money(summary?.pendingAmount ?? 0)}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {pending > 0 && (
            <button
              onClick={() => void download()}
              disabled={busy !== null}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <Download className="mr-1.5 inline h-4 w-4" />
              Собрать файл на {formatNumber(pending)} кодов
            </button>
          )}
          <button
            onClick={() => void refresh()}
            disabled={busy !== null}
            className="flex min-h-11 items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50 lg:min-h-0"
          >
            <RefreshCw className={`h-4 w-4 ${busy === "refresh" ? "animate-spin" : ""}`} />
            {busy === "refresh" ? "Обновляю…" : "Обновить"}
          </button>
        </div>
      </div>

      {pending > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-xs uppercase tracking-wide text-slate-400">Срок вывода</p>
          <div className="space-y-1.5">
            {([
              ["просрочено", age.overdue, "#ef4444"],
              ["крайний день", age.lastDay, "#f59e0b"],
              ["2 дня", age.twoDays, "#a78bfa"],
              ["свежие", age.fresh, "#c4b5fd"],
            ] as const).map(([label, value, tone]) => (
              <div key={label} className="grid grid-cols-[110px_1fr_56px] items-center gap-2 text-xs text-slate-500">
                <span>{label}</span>
                {bar(value, tone)}
                <span className="text-right font-medium tabular-nums text-slate-700">{formatNumber(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {report && (
        <div className={`rounded-lg border p-4 text-sm ${
          reportBad ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"
        }`}>
          {report.map((line) => <p key={line}>{line}</p>)}
        </div>
      )}

      {(summary?.returnedAfterSent ?? 0) > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <AlertTriangle className="h-4 w-4" />
            Вернулись после отправки: {formatNumber(summary!.returnedAfterSent)}
          </p>
          <p className="mt-1 text-sm text-red-700">
            Коды выведены, а товар снова в обороте. Сами исправить не можем — сообщите тому, кто выводит.
          </p>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Отправлено {formatNumber(summary?.sent ?? 0)} · выведено WB {formatNumber(summary?.withdrawn ?? 0)} ·
        FBW {formatNumber(summary?.fbw ?? 0)} · вернулись {formatNumber(summary?.returned ?? 0)}
        {(summary?.unknown ?? 0) > 0 && ` · схема не ясна ${formatNumber(summary!.unknown)}`}
        {(summary?.withoutPriceCount ?? 0) > 0 && ` · без цены ${formatNumber(summary!.withoutPriceCount)}`}
      </p>

      {summary?.lastBatch && (
        <p className="text-xs text-slate-400">
          Последняя партия: {formatNumber(summary.lastBatch.count)} кодов
          {summary.lastBatch.at ? ` от ${new Date(summary.lastBatch.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
          {" · "}
          <a
            href={`/api/warehouse/kiz/export?batch=${encodeURIComponent(summary.lastBatch.id)}&entity=${encodeURIComponent(entityId)}`}
            className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-slate-600 lg:min-h-0"
          >
            скачать заново
          </a>
        </p>
      )}

      {summary && !summary.lastRunAt && (
        // Молчание экрана неотличимо от «всё хорошо». Если ночной сбор ни разу
        // не отработал, это надо сказать: скорее всего, не задан секрет крона.
        <p className="text-xs text-amber-700">Ночной сбор ещё ни разу не отработал</p>
      )}

      {summary?.lastRunAt && (
        <p className={`text-xs ${summary.lastRunStatus === "error" ? "text-red-600" : "text-slate-400"}`}>
          {summary.lastRunStatus === "error"
            ? `Ночной сбор не прошёл: ${summary.lastRunError ?? "причина не записана"}`
            : `Собрано само ${new Date(summary.lastRunAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`}
        </p>
      )}

      {(summary?.noEntity ?? 0) > 0 && (
        // Коды, у которых владелец не установлен, не попадают ни в одно юрлицо.
        // Спрятать их значило бы показать неполный реестр и не сказать об этом.
        <p className="text-xs text-amber-700">
          {formatNumber(summary!.noEntity)} кодов без владельца — они не видны ни под одним юрлицом.
          Заведите товар в справочнике или свяжите кабинет с юрлицом.
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className="flex w-full items-center justify-between p-4 text-sm text-slate-600"
        >
          Добрать вручную
          <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
        </button>
        {moreOpen && (
          <div className="space-y-4 border-t border-slate-100 p-4">
            <div>
              <p className="text-sm text-slate-600">Из отчётов Wildberries</p>
              <p className="mt-0.5 text-xs text-slate-400">Несколько минут: WB пускает один запрос в минуту на кабинет.</p>
              <button
                onClick={() => void fromWb()}
                disabled={busy !== null}
                className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {busy === "wb" ? "Читаю отчёты…" : "Добрать из WB"}
              </button>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-600">Из выгрузок кабинета</p>
              <p className="mt-0.5 text-xs text-slate-400">Для периодов старше полугода — дальше отчёты WB не помнят.</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-slate-500">
                  Завершённые заказы ФБС
                  <input ref={soldRef} type="file" accept=".xlsx" className="mt-1 block w-full text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-slate-700" />
                </label>
                <label className="text-xs text-slate-500">
                  Возвраты за тот же период
                  <input ref={returnsRef} type="file" accept=".xlsx" className="mt-1 block w-full text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-slate-700" />
                </label>
              </div>
              <button
                onClick={() => void upload()}
                disabled={busy !== null}
                className="mt-2 flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                <FileUp className="h-4 w-4" /> {busy === "upload" ? "Разбираю…" : "Загрузить"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
