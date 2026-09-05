"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { CtrCampaignRow } from "@/app/api/wb/ctr-breakdown/route";
import { moscowYesterday } from "@/lib/wb/rkJournalDates";

/**
 * Какие рекламные кампании крутят артикул теста — и ссылка прямо на них.
 *
 * Тест CTR останавливается по лимиту расходов, и панель честно пишет:
 * «остановите кампанию в кабинете WB». Проблема в том, что человек в этот
 * момент не знает, КАКУЮ кампанию останавливать: у артикула их может быть
 * пять, и жжёт бюджет не обязательно та, о которой он думает.
 *
 * Разбор объединения рекламных экранов предлагал перенести весь экран тестов
 * внутрь «Рекламы» ради этой связи. Связи там не оказалось: рекламный список
 * привязывает кампанию к первому артикулу и посуточную разбивку по артикулам не
 * читает вовсе. Зато она есть здесь, в ctr-breakdown, — и доставляется ссылкой,
 * а не переездом двухсот семидесяти строк.
 */
export function CtrCampaignBridge({ cabinetId, nmId }: { cabinetId: string; nmId: number }) {
  const [rows, setRows] = useState<CtrCampaignRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!cabinetId || !nmId) return;
    let cancelled = false;
    const date = moscowYesterday();
    fetch(`/api/wb/ctr-breakdown?cabinet=${encodeURIComponent(cabinetId)}&nm=${nmId}&date=${date}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      // Роут отдаёт {meta, data: {campaigns, total}} — как и всплывашка по дню,
      // которая его уже использует. Читать campaigns с верхнего уровня значило бы
      // всегда получать undefined и молча не показывать блок никогда: ошибка,
      // которую видно только на живых данных, а не в типах.
      .then((json: { data?: { campaigns?: CtrCampaignRow[] } } | null) => {
        if (cancelled) return;
        if (!json) { setFailed(true); return; }
        setRows(json.data?.campaigns ?? []);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [cabinetId, nmId]);

  // Молчим, пока читаем, и молчим, если кампаний нет: пустой блок «кампаний не
  // найдено» ничего не добавляет к экрану, на котором и так много цифр.
  if (failed || rows == null || rows.length === 0) return null;

  return (
    <section className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <h2 className="text-xs font-bold text-slate-700">Кампании, которые крутят этот артикул</h2>
      <p className="mt-0.5 text-[10px] leading-4 text-slate-400">
        Вчерашняя разбивка расхода по артикулу. Тест на паузе по лимиту останавливать надо именно здесь — панель кампании WB
        не трогает сама.
      </p>
      <div className="mt-2 space-y-2">
        {rows.map((row) => (
          <Link
            key={row.advertId}
            href={`/wb/adverts?cabinet=${encodeURIComponent(cabinetId)}&campaign=${row.advertId}&status=all`}
            className="tap-row flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] transition-colors hover:bg-violet-50"
          >
            <span className="min-w-0 flex-1 basis-full truncate font-medium text-slate-700 sm:basis-auto">{row.name}</span>
            <span className="shrink-0 tabular-nums text-slate-500">{Math.round(row.spent).toLocaleString("ru-RU")} ₽</span>
            <span className="shrink-0 tabular-nums text-slate-400">CTR {row.ctr == null ? "—" : `${row.ctr.toFixed(2)}%`}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  );
}
