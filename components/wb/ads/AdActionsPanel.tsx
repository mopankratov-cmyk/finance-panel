"use client";

import { PauseCircle, PlayCircle, Square, Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import type { BidRecommendation } from "@/app/api/adverts/cpm-reco/route";
import { adGet, adPost, money, type AdCabinetConfig } from "./adControlApi";
import type { ConfirmRequest } from "./ConfirmAction";

export interface AdActionsCampaign {
  id: number;
  name: string;
  status: number;
  bid_cpm_rub: number | null;
  bid_type?: string;
  nm: number;
  art: string;
  /** Показатели, ради которых решение и принимается. */
  breakEvenDrr: number | null;
  currentDrr: number | null;
  profitAfterAds: number | null;
}

/**
 * Единственная дверь к деньгам кампании.
 *
 * Панель живёт в карточке — то есть открыта ровно на одну кампанию, которую
 * человек перед этим читал. Это и есть смысл слияния: раньше рекомендация
 * «снизить на 20%» жила на одном экране, а поле ввода — на другом, и между
 * ними человек шёл через список из двух сотен кампаний, держа в голове имя и
 * умножая в уме.
 *
 * Три решения, которые здесь важнее вёрстки.
 *
 * Имя кампании и артикул продублированы в шапке панели. Карточка длинная, и к
 * моменту, когда человек доскроллил до поля ввода, заголовок с именем ушёл
 * далеко вверх. Вводить сумму, не видя, по какой кампании, — ровно тот случай,
 * ради которого всё и затевалось.
 *
 * Рядом с полем ставки стоят безубыточный ДРР, текущий ДРР и прибыль после
 * рекламы. Число, ради которого принимается решение, обязано быть в поле
 * зрения в момент решения, а не в полутора экранах выше.
 *
 * Подтверждение остаётся у ВСЕХ операций, включая паузу. Пауза выглядит
 * безобидной ровно до того момента, когда список пересортировался и кнопка под
 * курсором принадлежит другой кампании.
 */
export function AdActionsPanel({
  cabinetId,
  campaign,
  cabinetMoney,
  currency,
  onAsk,
  onDone,
}: {
  cabinetId: string;
  campaign: AdActionsCampaign;
  cabinetMoney: AdCabinetConfig | null;
  currency: string;
  onAsk: (request: ConfirmRequest) => void;
  onDone: () => void;
}) {
  const isUnified = campaign.bid_type === "unified" || campaign.bid_type === "auto";
  const [bid, setBid] = useState("");
  const [placement, setPlacement] = useState(isUnified ? "combined" : "search");
  const [sum, setSum] = useState("");
  const [source, setSource] = useState("1");
  const [reco, setReco] = useState<BidRecommendation[] | null>(null);
  const [recoNote, setRecoNote] = useState<string | null>(null);

  /**
   * Рекомендации WB рядом с полем ставки.
   *
   * Это единственный в панели ответ на вопрос, с которого начинается работа со
   * ставкой: «а сколько ставить». Раньше роут существовал, но его не звал ни
   * один экран — человек оставался наедине с пустым полем.
   *
   * Числа кликабельны: нажатие подставляет ставку в поле, но НЕ отправляет её.
   * Между «WB считает так» и «я решил так» должен остаться шаг.
   */
  useEffect(() => {
    let cancelled = false;
    setReco(null);
    setRecoNote(null);
    adGet<{ recommendations: BidRecommendation[]; note: string | null }>(
      `/api/adverts/cpm-reco?cabinet=${cabinetId}&advertId=${campaign.id}&nmId=${campaign.nm}`,
    ).then((result) => {
      if (cancelled) return;
      if (!result.ok) { setRecoNote(result.error); return; }
      setReco(result.data?.recommendations ?? []);
      setRecoNote(result.data?.note ?? null);
    });
    return () => { cancelled = true; };
  }, [cabinetId, campaign.id, campaign.nm]);

  // Артикул почти всегда уже стоит в названии кампании — WB так их и заводит.
  // Дублировать его значит писать «HT-83-35 · HT-83-35» и приучать глаз
  // пропускать эту строку, а она здесь ровно затем, чтобы её читали.
  const subject = campaign.name.includes(campaign.art)
    ? `${campaign.name} · ${campaign.nm}`
    : `${campaign.name} · ${campaign.art} · ${campaign.nm}`;
  const allowance = cabinetMoney?.depositAllowance ?? null;
  const minTopUp = cabinetMoney?.config?.minTopUpRub ?? null;
  const step = cabinetMoney?.config?.cpmStepRub ?? 1;

  const lifecycle = (action: "start" | "pause" | "stop") =>
    onAsk({
      actionId: action,
      subject,
      run: async () => {
        const result = await adPost("/api/adverts/action", { cabinetId, advertId: campaign.id, action });
        if (result.ok) onDone();
        return { ok: result.ok, error: result.error };
      },
    });

  const bidValue = Number(bid);
  const bidReady = Number.isFinite(bidValue) && bidValue > 0;
  const sumValue = Number(sum);
  const sumReady = Number.isFinite(sumValue) && sumValue > 0;

  return (
    <section className="mt-3 rounded-xl border border-slate-300 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
        <h2 className="text-xs font-bold text-slate-800">Действия</h2>
        <span className="truncate text-[10px] text-slate-500">{subject}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {campaign.status !== 9 && campaign.status !== 7 ? (
          <button type="button" onClick={() => lifecycle("start")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100">
            <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" /> Запустить
          </button>
        ) : null}
        {campaign.status === 9 ? (
          <button type="button" onClick={() => lifecycle("pause")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100">
            <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" /> Пауза
          </button>
        ) : null}
        {campaign.status !== 7 ? (
          <button type="button" onClick={() => lifecycle("stop")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50">
            <Square className="h-3.5 w-3.5" aria-hidden="true" /> Завершить
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Ставка</div>
          <div className="mt-1 text-[10px] leading-4 text-slate-500">
            Сейчас {campaign.bid_cpm_rub == null ? "неизвестна" : money(campaign.bid_cpm_rub, currency)}
            {" · "}безубыточный ДРР {campaign.breakEvenDrr == null ? "—" : `${campaign.breakEvenDrr}%`}
            {" · "}текущий {campaign.currentDrr == null ? "—" : `${campaign.currentDrr}%`}
            {campaign.profitAfterAds == null ? "" : ` · прибыль после рекламы ${money(campaign.profitAfterAds, currency)}`}
          </div>
          {reco && reco.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="text-[9px] uppercase tracking-wide text-slate-400">WB советует</span>
              {reco.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  title={item.hint}
                  onClick={() => setBid(String(item.bidRub))}
                  className="rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 transition-colors hover:bg-violet-100"
                >
                  {item.label} {money(item.bidRub, currency)}
                </button>
              ))}
            </div>
          ) : recoNote ? (
            <div className="mt-2 text-[10px] leading-4 text-slate-400">{recoNote}</div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <input
              value={bid}
              onChange={(event) => setBid(event.target.value)}
              inputMode="numeric"
              placeholder={`шаг ${step}`}
              className="h-9 w-24 rounded-lg border border-slate-300 px-2 text-[12px] tabular-nums focus:border-violet-500 focus:outline-none"
            />
            {!isUnified ? (
              <select value={placement} onChange={(event) => setPlacement(event.target.value)} className="h-9 rounded-lg border border-slate-300 px-1.5 text-[11px] focus:border-violet-500 focus:outline-none">
                <option value="search">поиск</option>
                <option value="recommendations">полки</option>
              </select>
            ) : (
              <span className="text-[10px] text-slate-400">единая ставка — место выбирает WB</span>
            )}
            <button
              type="button"
              disabled={!bidReady}
              onClick={() =>
                onAsk({
                  actionId: "bid",
                  subject,
                  detail: campaign.bid_cpm_rub == null
                    ? `Станет ${bidValue} ${currency}. Прежняя ставка панели неизвестна, поэтому защита от роста ×2 не сработает — проверьте сумму сами.`
                    : `Было ${campaign.bid_cpm_rub} ${currency}, станет ${bidValue} ${currency}.`,
                  run: async () => {
                    const result = await adPost("/api/adverts/bid", {
                      cabinetId,
                      advertId: campaign.id,
                      bids: [{ nmId: campaign.nm, bidRub: bidValue, placement }],
                    });
                    if (result.ok) {
                      setBid("");
                      onDone();
                    }
                    return { ok: result.ok, error: result.error };
                  },
                })
              }
              className="h-9 rounded-lg bg-slate-800 px-3 text-[11px] font-semibold text-white disabled:opacity-40"
            >
              Изменить
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-2.5">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-rose-500">Пополнить бюджет</div>
          <div className="mt-1 text-[10px] leading-4 text-slate-600">
            {cabinetMoney?.money ? `Счёт ${money(cabinetMoney.money.account, currency)} · взаимозачёт ${money(cabinetMoney.money.net, currency)}` : "Остаток счёта не прочитан"}
            {allowance ? ` · сегодня пополнено ${money(allowance.spentToday, currency)} из ${money(allowance.maxPerDay, currency)}` : ""}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <input
              value={sum}
              onChange={(event) => setSum(event.target.value)}
              inputMode="numeric"
              placeholder={minTopUp ? `от ${minTopUp}` : "сумма"}
              className="h-9 w-24 rounded-lg border border-slate-300 px-2 text-[12px] tabular-nums focus:border-rose-400 focus:outline-none"
            />
            <select value={source} onChange={(event) => setSource(event.target.value)} className="h-9 rounded-lg border border-slate-300 px-1.5 text-[11px] focus:border-rose-400 focus:outline-none">
              <option value="1">взаимозачёт</option>
              <option value="0">счёт</option>
              <option value="3">бонусы</option>
            </select>
            <button
              type="button"
              disabled={!sumReady}
              onClick={() =>
                onAsk({
                  actionId: "deposit",
                  subject,
                  amount: `Списать ${sumValue.toLocaleString("ru-RU")} ${currency}`,
                  detail: allowance
                    ? `Сегодня уже пополнено ${allowance.spentToday.toLocaleString("ru-RU")} ${currency} из ${allowance.maxPerDay.toLocaleString("ru-RU")} ${currency}. Вернуть сумму из бюджета кампании обратно нельзя.`
                    : "Вернуть сумму из бюджета кампании обратно нельзя.",
                  run: async () => {
                    const result = await adPost("/api/adverts/deposit", {
                      cabinetId,
                      advertId: campaign.id,
                      sum: sumValue,
                      type: Number(source),
                    });
                    if (result.ok) {
                      setSum("");
                      onDone();
                    }
                    return { ok: result.ok, error: result.error };
                  },
                })
              }
              className="h-9 rounded-lg bg-rose-600 px-3 text-[11px] font-semibold text-white disabled:opacity-40"
            >
              Пополнить
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
