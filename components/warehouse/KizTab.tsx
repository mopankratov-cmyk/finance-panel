"use client";

import { CloudDownload, Download, FileUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { KizUploadResult, KizWithdrawalSummary } from "@/app/api/warehouse/kiz/route";
import type { KizCollectResult } from "@/app/api/warehouse/kiz/collect/route";
import type { KizSalesResult } from "@/app/api/warehouse/kiz/sales/route";
import type { KizTasksResult } from "@/app/api/warehouse/kiz/tasks/route";

const money = (value: number) => `${formatNumber(Math.round(value))} ₽`;

/**
 * Вывод из оборота проданного по FBS.
 *
 * Порядок работы задан тем, кто выводит коды, и экран повторяет его буквально:
 * две выгрузки за период → вычитание возвратов → файл «КИЗ + цена».
 */
export function KizTab({ refreshKey }: { refreshKey: number }) {
  const [summary, setSummary] = useState<KizWithdrawalSummary | null>(null);
  const [result, setResult] = useState<KizUploadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collected, setCollected] = useState<KizCollectResult | null>(null);
  // С какой даты читать отчёт. Не украшение: у метода лимит 10 запросов за
  // 5 часов, период режется на месячные окна, и лишние месяцы — это выброшенные
  // запросы. Там, где наших товаров в кабинете ещё не было, читать нечего.
  const [since, setSince] = useState("");
  const [sales, setSales] = useState<KizSalesResult | null>(null);
  const [tasks, setTasks] = useState<KizTasksResult | null>(null);
  const soldRef = useRef<HTMLInputElement>(null);
  const returnsRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/warehouse/kiz", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось прочитать реестр");
      setSummary(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать реестр");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const upload = async () => {
    const sold = soldRef.current?.files?.[0];
    if (!sold) { setError("Выберите выгрузку завершённых заказов"); return; }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.set("sold", sold);
      const returns = returnsRef.current?.files?.[0];
      if (returns) form.set("returns", returns);
      const res = await fetch("/api/warehouse/kiz", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить выгрузки");
      setResult(json.data as KizUploadResult);
      setSummary((json.data as KizUploadResult).summary);
      if (soldRef.current) soldRef.current.value = "";
      if (returnsRef.current) returnsRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить выгрузки");
    } finally {
      setBusy(false);
    }
  };

  // Главный путь: коды тянутся из отчёта WB по маркированным товарам. Он помнит
  // около полугода и отдаёт длинное окно одним запросом — ручные выгрузки нужны
  // только для того, что старше его горизонта.
  const collect = async () => {
    setBusy(true);
    setError(null);
    setCollected(null);
    setResult(null);
    try {
      const res = await fetch("/api/warehouse/kiz/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(since ? { from: since } : {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось собрать коды");
      setCollected(json.data as KizCollectResult);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось собрать коды");
    } finally {
      setBusy(false);
    }
  };

  // Главный автоматический источник списка К ВЫВОДУ: детализация реализации
  // отдаёт код прямо в строке продажи, вместе с ценой. В отличие от отчёта по
  // маркированным товарам показывает то, что ещё НЕ выведено.
  const collectSales = async () => {
    setBusy(true);
    setError(null);
    setSales(null);
    try {
      const res = await fetch("/api/warehouse/kiz/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(since ? { from: since } : {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось собрать проданное");
      setSales(json.data as KizSalesResult);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось собрать проданное");
    } finally {
      setBusy(false);
    }
  };

  // Самый быстрый источник: КИЗ проставляется в сборочное задание при сборке,
  // то есть код известен в день отгрузки, а не через неделю. Для трёхдневного
  // срока вывода это решающая разница.
  const collectTasks = async () => {
    setBusy(true);
    setError(null);
    setTasks(null);
    try {
      const res = await fetch("/api/warehouse/kiz/tasks", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось прочитать сборочные задания");
      setTasks(json.data as KizTasksResult);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать сборочные задания");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/kiz/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markSent: true }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
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
      setBusy(false);
    }
  };

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Читаю реестр кодов…</div>;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-400">Ждут вывода</p>
          <p className="text-xl font-bold text-violet-700">{formatNumber(summary?.pending ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-400">на {money(summary?.pendingAmount ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-400">Отправлено</p>
          <p className="text-xl font-bold text-slate-900">{formatNumber(summary?.sent ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-400">уже у того, кто выводит</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-400">Вернулись в оборот</p>
          <p className="text-xl font-bold text-slate-900">{formatNumber(summary?.returned ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-400">выводить нельзя</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-400">Выводит Wildberries</p>
          <p className="text-xl font-bold text-slate-900">{formatNumber(summary?.fbw ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-400">продажи FBW — не наше дело</p>
        </div>
        <div className={`rounded-xl border p-4 ${summary?.returnedAfterSent ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
          <p className="text-xs text-slate-400">Вернулись после отправки</p>
          <p className={`text-xl font-bold ${summary?.returnedAfterSent ? "text-red-700" : "text-slate-900"}`}>
            {formatNumber(summary?.returnedAfterSent ?? 0)}
          </p>
          <p className="mt-1 text-xs text-slate-400">разбирать руками</p>
        </div>
      </div>

      {(summary?.withdrawn ?? 0) > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          {formatNumber(summary!.withdrawn)} кодов уже выведены из оборота по данным Wildberries.
          В файл они не пойдут: вывести один код дважды нельзя.
        </div>
      )}

      {(summary?.overdue ?? 0) > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>{formatNumber(summary!.overdue)}</b> кодов ждут вывода дольше трёх рабочих дней.
          По правилам маркировки вывести из оборота положено не позднее трёх рабочих дней после отгрузки —
          за нарушение сроков предусмотрен штраф по статье 15.12.1 КоАП. Выгрузите их и передайте тому, кто выводит.
        </div>
      )}

      {summary?.firstSoldAt && (
        <p className="text-xs text-slate-400">
          В реестре продажи с {summary.firstSoldAt} по {summary.lastSoldAt}.
          {summary.withoutPrice > 0 && ` У ${formatNumber(summary.withoutPrice)} кодов нет цены реализации — проверьте, та ли колонка была в выгрузке.`}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-700">Отметить то, что уже выведено</p>
        <p className="mt-1 text-xs text-slate-500">
          Отчёт Wildberries по маркированным товарам показывает <b>совершённые</b> операции с кодом: вывод из
          оборота и возврат в оборот. При FBW там всё, потому что маркетплейс выводит сам; при FBS там пусто
          ровно потому, что никто ещё не вывел. Поэтому отчёт даёт не список к выводу, а список «этого делать
          не надо» — он вычитается из того, что уходит на вывод, чтобы не выводить дважды.
          Чужие коды отсекаются товарным контуром кабинета: у агентского кабинета большинство строк не наши.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            С даты
            <input
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            onClick={() => void collect()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <CloudDownload className="h-4 w-4" /> {busy ? "Читаю отчёт WB…" : since ? "Собрать с этой даты" : "Собрать за полгода"}
          </button>
          <span className="text-xs text-slate-400">
            Пусто — полгода назад, дальше отчёт не помнит. Ставьте дату, с которой ваши товары появились в кабинете:
            период режется на месячные окна, а у метода лимит 10 запросов за 5 часов.
          </span>
        </div>
        {collected && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <p>Период {collected.from} — {collected.to}. Добавлено {formatNumber(collected.addedTotal)}
              {collected.returnedTotal > 0 && `, переведено в «вернулись» ${formatNumber(collected.returnedTotal)}`}.</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {collected.cabinets.map((row) => (
                <li key={row.name} className={row.error ? "text-red-700" : "text-emerald-700"}>
                  {row.name}: {row.error
                    ? row.error
                    : `отчёт ${formatNumber(row.rows)} строк за ${row.windows} окон, наших ${formatNumber(row.ours)} · FBS ${formatNumber(row.fbs)}, FBW ${formatNumber(row.fbw)}, схема неизвестна ${formatNumber(row.unknown)} · записано ${formatNumber(row.added)}`}
                  {row.failedWindows.length > 0 && ` · не отдались окна: ${row.failedWindows.join(", ")}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-700">Взять из сборочных заданий</p>
        <p className="mt-1 text-xs text-slate-500">
          Самый быстрый путь. КИЗ проставляется в задание при сборке, значит код известен в день отгрузки,
          а не через неделю, когда продажа дойдёт до отчёта о реализации. Для трёхдневного срока вывода это
          решающая разница. В список попадает только выкупленное: пока товар едет, выводить нечего,
          а отказ покупателя вернёт код в оборот.
        </p>
        <button
          onClick={() => void collectTasks()}
          disabled={busy}
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          <CloudDownload className="h-4 w-4" /> {busy ? "Читаю задания…" : "Взять из заданий"}
        </button>
        {tasks && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <p>
              Заданий с кодами {formatNumber(tasks.withCodes)} · связано с продажей {formatNumber(tasks.linked)} ·
              выкуплено {formatNumber(tasks.bought)} · добавлено к выводу {formatNumber(tasks.added)}
            </p>
            {tasks.unlinked > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                У {formatNumber(tasks.unlinked)} заданий код есть, но связать с продажей нечем: не сохранён srid.
                Он записывается при опросе — эти задания подтянутся, когда синхронизация пройдёт по ним заново.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-700">Добрать из отчёта о реализации</p>
        <p className="mt-1 text-xs text-slate-500">
          Детализация отчёта о реализации отдаёт код маркировки прямо в строке продажи, вместе с ценой.
          Это то же, что выгружать завершённые заказы руками, только без выгрузки. Учтите задержку:
          в отчёт о реализации продажа попадает после выкупа и расчёта, поэтому вчерашние продажи там
          ещё не появятся.
        </p>
        <button
          onClick={() => void collectSales()}
          disabled={busy}
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          <CloudDownload className="h-4 w-4" /> {busy ? "Читаю реализацию…" : "Собрать проданное"}
        </button>
        {sales && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <p>Период {sales.from} — {sales.to}. Добавлено к выводу {formatNumber(sales.addedTotal)}.</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {sales.cabinets.map((row) => (
                <li key={row.name} className={row.error ? "text-red-700" : "text-emerald-700"}>
                  {row.name}: {row.error
                    ? row.error
                    : `строк с кодом ${formatNumber(row.withCode)}, наших ${formatNumber(row.ours)} · FBS ${formatNumber(row.fbs)}, FBW ${formatNumber(row.fbw)}, схема неизвестна ${formatNumber(row.unknown)} · возвратов ${formatNumber(row.returns)} · записано ${formatNumber(row.added)}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-700">Загрузить файлами, если нужно вручную</p>
        <p className="mt-1 text-xs text-slate-500">
          Запасной путь, если в отчёте о реализации нужного периода ещё нет.
          Первый файл — «Поставки → ФБС → завершённые заказы» с фильтром «товар выкуплен»: в нём КИЗ и цена реализации.
          Второй — «Аналитика → Отчёты → по возвратам и перемещению товара» за тот же диапазон дат.
          Возвраты вычитаются: вернувшийся товар снова в обороте WB, и выводить его нельзя.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-xs text-slate-500">Завершённые заказы (обязательно)</span>
            <input ref={soldRef} type="file" accept=".xlsx" className="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-50 file:px-3 file:py-1.5 file:text-violet-700" />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-500">Возвраты за тот же период</span>
            <input ref={returnsRef} type="file" accept=".xlsx" className="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-slate-700" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => void upload()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <FileUp className="h-4 w-4" /> {busy ? "Разбираю…" : "Загрузить"}
          </button>
          <button
            onClick={() => void download()}
            disabled={busy || !summary?.pending}
            title="Собрать файл «КИЗ + цена» и пометить коды отправленными"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Выгрузить на вывод ({formatNumber(summary?.pending ?? 0)})
          </button>
        </div>
      </div>

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <p>
            Добавлено кодов: <b>{formatNumber(result.added)}</b>
            {result.updatedByReturn > 0 && ` · переведено в «вернулись»: ${formatNumber(result.updatedByReturn)}`}
            {result.alreadyKnown > 0 && ` · уже отправлялись: ${formatNumber(result.alreadyKnown)}`}
            {result.duplicatesInFile > 0 && ` · дублей в файле: ${formatNumber(result.duplicatesInFile)}`}
          </p>
          {result.withoutPrice > 0 && (
            <p className="mt-1 text-amber-700">
              Без цены реализации: {formatNumber(result.withoutPrice)} строк. Прочитанные колонки: {Object.values(result.soldColumns).join(", ") || "—"}.
            </p>
          )}
          {result.returnedAfterSent.length > 0 && (
            <p className="mt-1 font-medium text-red-700">
              {formatNumber(result.returnedAfterSent.length)} кодов вернулись уже после отправки на вывод.
              Их вывели, а товар вернулся в оборот — сообщите тому, кто выводит: сами мы это исправить не можем.
            </p>
          )}
          {result.returnsWithoutSale > 0 && (
            <p className="mt-1 text-slate-600">
              Возвратов без известной продажи: {formatNumber(result.returnsWithoutSale)} — их продажа в другом периоде, загрузите его тоже.
            </p>
          )}
          {result.issues.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-600">Строки, которые не прочитались ({result.issues.length})</summary>
              <ul className="mt-1 list-inside list-disc text-xs text-slate-500">
                {result.issues.map((issue) => <li key={issue.line}>строка {issue.line}: {issue.reason}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      <p className="text-xs text-slate-400">
        Реестр помнит все коды за всю историю, поэтому периоды можно загружать в любом порядке и с перекрытием:
        один и тот же КИЗ не уйдёт на вывод дважды. Выгрузка помечает коды отправленными — если файл не дошёл,
        повторить его можно только через тех, кто выводит.
      </p>
    </div>
  );
}
