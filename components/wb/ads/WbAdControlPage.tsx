"use client";

import { FlaskConical, KeyRound, Loader2, PauseCircle, PlayCircle, RefreshCw, Settings2, Square, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { deploymentPinnedFetch } from "@/lib/http/deploymentPinnedFetch";
import { readApiResponse } from "@/lib/http/readApiResponse";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "@/components/wb/WbModuleHeader";
import { useWbCabinet } from "@/components/wb/WbCabinetContext";
import { adPost, money, type AdCabinetConfig } from "./adControlApi";
import { ConfirmAction, type ConfirmRequest } from "./ConfirmAction";
import { AdClustersTab } from "./AdClustersTab";
import { AdCreateTab } from "./AdCreateTab";
import { AdJournalTab } from "./AdJournalTab";
import { AdRulesTab } from "./AdRulesTab";
import { AdTokenPanel } from "./AdTokenPanel";

interface ListCampaign {
  id: number;
  name: string;
  status: number;
  bid_cpm_rub: number | null;
  bid_type?: string;
  spend_today: number;
  drr: number | null;
}

interface ListArticle {
  nm: number;
  art: string;
  campaigns: ListCampaign[];
}

interface ListResponse {
  ok: boolean;
  error?: string;
  articles?: ListArticle[];
}

export interface CampaignRow {
  campaign: ListCampaign;
  nm: number;
  art: string;
}

const TABS = [
  { id: "campaigns", label: "Кампании" },
  { id: "clusters", label: "Кластеры и минус-фразы" },
  { id: "create", label: "Создание" },
  { id: "rules", label: "Автоправила" },
  { id: "journal", label: "Журнал" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// Статусы кампаний WB. 9 — идёт, 11 — на паузе, 7 — завершена, 4 — готова к запуску.
const STATUS_LABEL: Record<number, string> = { 4: "Готова", 7: "Завершена", 9: "Идёт", 11: "Пауза" };

function statusTone(status: number): string {
  if (status === 9) return "bg-emerald-50 text-emerald-700";
  if (status === 11) return "bg-amber-50 text-amber-700";
  if (status === 7) return "bg-slate-100 text-slate-500";
  return "bg-sky-50 text-sky-700";
}

/**
 * Кокпит управления рекламой WB.
 *
 * Отличие от экрана «Реклама» в том, что тот показывает, а этот меняет. Всё,
 * что здесь есть, уходит в кабинет WB и стоит денег, поэтому у модуля три
 * сквозных правила.
 *
 * Состояние кабинета всегда на виду — сверху, а не по клику. Ставка, которую
 * ставят, не зная остатка на счету, и пополнение без остатка суточного лимита
 * — это решения вслепую, и прятать эти числа за вкладкой значит поощрять их.
 *
 * Песочница называется песочницей крупно. Токен WB сам говорит, что он тестовый,
 * и человек должен видеть, что нажимает не по боевому кабинету, до нажатия.
 *
 * Всё, что сделано, попадает в журнал — включая то, что не пропустили
 * предохранители. Вкладка «Журнал» не приложение к модулю, а его половина.
 */
export function WbAdControlPage() {
  const { cabinetId } = useWbCabinet();
  const [tab, setTab] = useState<TabId>("campaigns");
  const [config, setConfig] = useState<AdCabinetConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tokenPanelOpen, setTokenPanelOpen] = useState(false);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    if (!cabinetId || cabinetId === "all") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setConfigError(null);
    setListError(null);

    const load = async () => {
      const [configResponse, listResponse] = await Promise.all([
        deploymentPinnedFetch(`/api/adverts/config?cabinet=${cabinetId}`).then((response) =>
          readApiResponse<AdCabinetConfig & { error?: string }>(response, "Реклама WB"),
        ),
        deploymentPinnedFetch(`/api/adverts/list?cabinet=${cabinetId}`).then((response) =>
          readApiResponse<ListResponse>(response, "Реклама WB"),
        ),
      ]);
      if (cancelled) return;

      if ("error" in configResponse && configResponse.error) setConfigError(configResponse.error);
      else setConfig(configResponse as AdCabinetConfig);

      if (listResponse.error) setListError(listResponse.error);
      else {
        const flat: CampaignRow[] = [];
        for (const article of listResponse.articles ?? []) {
          for (const campaign of article.campaigns) flat.push({ campaign, nm: article.nm, art: article.art });
        }
        // Идущие впереди: с ними и работают. Завершённые внизу — они уже история.
        flat.sort((a, b) => {
          const weight = (status: number) => (status === 9 ? 0 : status === 4 ? 1 : status === 11 ? 2 : 3);
          return weight(a.campaign.status) - weight(b.campaign.status) || b.campaign.spend_today - a.campaign.spend_today;
        });
        setRows(flat);
      }
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [cabinetId, reloadKey]);

  const currency = config?.config?.currency === "RUB" || !config?.config ? "₽" : config.config.currency;
  const allowance = config?.depositAllowance ?? null;

  const runLifecycle = (row: CampaignRow, action: "start" | "pause" | "stop") => {
    setConfirmRequest({
      actionId: action,
      subject: `${row.campaign.name} · ${row.art}`,
      run: async () => {
        const result = await adPost("/api/adverts/action", { cabinetId, advertId: row.campaign.id, action });
        if (result.ok) {
          setFlash(`${row.campaign.name}: готово`);
          reload();
        }
        return { ok: result.ok, error: result.error };
      },
    });
  };

  const header = useMemo(() => {
    if (!config) return null;
    const token = config.token;
    return (
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {token.sandbox ? (
          <span className="inline-flex items-center gap-1 rounded-lg bg-violet-100 px-2 py-1 font-bold text-violet-700">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
            ПЕСОЧНИЦА — действия не стоят денег
          </span>
        ) : null}
        {config.money ? (
          <span className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 font-semibold text-slate-600 shadow-sm">
            <Wallet className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            Счёт {money(config.money.account, currency)} · Баланс {money(config.money.net, currency)}
            {config.money.bonus == null ? null : ` · Бонусы ${money(config.money.bonus, currency)}`}
          </span>
        ) : config.moneyError ? (
          <span className="rounded-lg bg-amber-50 px-2 py-1 font-semibold text-amber-700">Деньги не прочитались: {config.moneyError}</span>
        ) : null}
        {allowance ? (
          <span className="rounded-lg bg-white px-2 py-1 font-semibold text-slate-600 shadow-sm">
            Лимит пополнений: сегодня {money(allowance.spentToday, currency)} из {money(allowance.maxPerDay, currency)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setTokenPanelOpen((open) => !open)}
          title="Проверить или заменить ключ Продвижения"
          className={`inline-flex min-h-7 items-center gap-1 rounded-lg px-2 py-1 font-semibold shadow-sm transition-colors ${token.promotionAvailable ? "bg-white text-slate-600 hover:bg-slate-50" : "bg-rose-50 text-rose-700 hover:bg-rose-100"}`}
        >
          <KeyRound className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          {token.promotionAvailable
            ? `Ключ Продвижения${token.daysLeft != null ? `, ${token.daysLeft} дн.` : ""}`
            : token.promotionError ?? "Ключ не работает"}
        </button>
      </div>
    );
  }, [config, currency, allowance]);


  if (!cabinetId || cabinetId === "all") {
    return (
      <div className="min-h-full bg-[#f6f7f9]">
        <WbModuleHeader icon={Settings2} title="Управление рекламой" description="Действия в кабинете WB" />
        <div className="p-3 sm:p-6">
          <WbEmptyState>
            Выберите один кабинет. Управление рекламой не работает по сводному режиму: действие всегда уходит в конкретный кабинет,
            и «все сразу» здесь означало бы неизвестно куда.
          </WbEmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#f6f7f9]">
      <WbModuleHeader
        icon={Settings2}
        title="Управление рекламой"
        description="Действия уходят в кабинет WB и попадают в журнал"
        actions={
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            Обновить
          </button>
        }
      />

      <div className="space-y-3 p-3 sm:p-6">
        {header}
        {tokenPanelOpen ? (
          <AdTokenPanel
            cabinetId={cabinetId}
            onClose={() => setTokenPanelOpen(false)}
            onSaved={reload}
          />
        ) : null}
        {configError ? <WbErrorState message={configError} onRetry={reload} /> : null}
        {flash ? (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700">{flash}</div>
        ) : null}

        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`min-h-8 rounded-lg px-2.5 font-semibold transition-colors ${tab === item.id ? "bg-slate-800 text-white" : "bg-white text-slate-600 shadow-sm hover:bg-slate-50"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "campaigns" ? (
          listError ? (
            <WbErrorState message={listError} onRetry={reload} />
          ) : loading ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">Загружаю кампании…</div>
          ) : rows.length === 0 ? (
            <WbEmptyState>В кабинете нет кампаний. Их можно завести на вкладке «Создание».</WbEmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[720px] text-[12px]">
                <thead className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Кампания</th>
                    <th className="px-3 py-2 text-left font-semibold">Статус</th>
                    <th className="px-3 py-2 text-right font-semibold">Ставка</th>
                    <th className="px-3 py-2 text-right font-semibold">Расход сегодня</th>
                    <th className="px-3 py-2 text-right font-semibold">ДРР</th>
                    <th className="px-3 py-2 text-right font-semibold">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.campaign.id}-${row.nm}`} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-800">{row.campaign.name}</div>
                        <div className="text-[10px] text-slate-400">
                          {row.art} · {row.nm} · {row.campaign.bid_type === "unified" ? "единая ставка" : "ручная ставка"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusTone(row.campaign.status)}`}>
                          {STATUS_LABEL[row.campaign.status] ?? row.campaign.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(row.campaign.bid_cpm_rub, currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(row.campaign.spend_today, currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {row.campaign.drr == null ? "—" : `${row.campaign.drr.toFixed(1)}%`}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          {row.campaign.status !== 9 && row.campaign.status !== 7 ? (
                            <IconButton title="Запустить" onClick={() => runLifecycle(row, "start")}>
                              <PlayCircle className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                            </IconButton>
                          ) : null}
                          {row.campaign.status === 9 ? (
                            <IconButton title="Пауза" onClick={() => runLifecycle(row, "pause")}>
                              <PauseCircle className="h-4 w-4 text-amber-600" aria-hidden="true" />
                            </IconButton>
                          ) : null}
                          {row.campaign.status !== 7 ? (
                            <IconButton title="Завершить" onClick={() => runLifecycle(row, "stop")}>
                              <Square className="h-4 w-4 text-slate-400" aria-hidden="true" />
                            </IconButton>
                          ) : null}
                          <BidButton
                            row={row}
                            cabinetId={cabinetId}
                            currency={currency}
                            step={config?.config?.cpmStepRub ?? 1}
                            onAsk={setConfirmRequest}
                            onDone={reload}
                          />
                          <DepositButton
                            row={row}
                            cabinetId={cabinetId}
                            currency={currency}
                            minTopUp={config?.config?.minTopUpRub ?? null}
                            allowance={allowance}
                            onAsk={setConfirmRequest}
                            onDone={reload}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "clusters" ? <AdClustersTab cabinetId={cabinetId} rows={rows} currency={currency} onAsk={setConfirmRequest} /> : null}
        {tab === "create" ? <AdCreateTab cabinetId={cabinetId} onAsk={setConfirmRequest} onCreated={reload} /> : null}
        {tab === "rules" ? <AdRulesTab cabinetId={cabinetId} rows={rows} currency={currency} onAsk={setConfirmRequest} /> : null}
        {tab === "journal" ? <AdJournalTab cabinetId={cabinetId} /> : null}
      </div>

      <ConfirmAction request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm transition-colors hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

/**
 * Смена ставки. Артикул и место показа берутся из строки, а не подставляются:
 * ставка в WB задаётся потоварно и поместно, и «ставка кампании» — величина
 * справочная.
 */
function BidButton({
  row,
  cabinetId,
  currency,
  step,
  onAsk,
  onDone,
}: {
  row: CampaignRow;
  cabinetId: string;
  currency: string;
  step: number;
  onAsk: (request: ConfirmRequest) => void;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(row.campaign.bid_cpm_rub ?? ""));
  const isUnified = row.campaign.bid_type === "unified";
  const [placement, setPlacement] = useState(isUnified ? "combined" : "search");

  if (!open) {
    return (
      <IconButton title="Изменить ставку" onClick={() => setOpen(true)}>
        <span className="text-[11px] font-bold text-slate-600">₽</span>
      </IconButton>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        inputMode="numeric"
        className="h-8 w-20 rounded-lg border border-slate-300 px-2 text-[12px] tabular-nums focus:border-violet-500 focus:outline-none"
        placeholder="ставка"
      />
      {!isUnified ? (
        <select
          value={placement}
          onChange={(event) => setPlacement(event.target.value)}
          className="h-8 rounded-lg border border-slate-300 px-1 text-[11px] focus:border-violet-500 focus:outline-none"
        >
          <option value="search">поиск</option>
          <option value="recommendations">полки</option>
        </select>
      ) : null}
      <button
        type="button"
        className="h-8 rounded-lg bg-slate-800 px-2 text-[11px] font-semibold text-white"
        onClick={() => {
          const bidRub = Number(value);
          if (!Number.isFinite(bidRub) || bidRub <= 0) return;
          onAsk({
            actionId: "bid",
            subject: `${row.campaign.name} · ${row.art} · ${row.nm}`,
            detail: row.campaign.bid_cpm_rub == null
              ? `Станет ${bidRub} ${currency}. Прежняя ставка панели неизвестна, поэтому защита от роста ×2 не сработает — проверьте сумму сами. Шаг ставки кабинета — ${step} ${currency}.`
              : `Было ${row.campaign.bid_cpm_rub} ${currency}, станет ${bidRub} ${currency}. Шаг ставки кабинета — ${step} ${currency}.`,
            run: async () => {
              const result = await adPost("/api/adverts/bid", {
                cabinetId,
                advertId: row.campaign.id,
                bids: [{ nmId: row.nm, bidRub, placement }],
              });
              if (result.ok) {
                setOpen(false);
                onDone();
              }
              return { ok: result.ok, error: result.error };
            },
          });
        }}
      >
        ОК
      </button>
      <button type="button" className="h-8 px-1 text-[11px] text-slate-400" onClick={() => setOpen(false)}>
        ✕
      </button>
    </div>
  );
}

/** Пополнение бюджета: сумма, источник и явное подтверждение с числом. */
function DepositButton({
  row,
  cabinetId,
  currency,
  minTopUp,
  allowance,
  onAsk,
  onDone,
}: {
  row: CampaignRow;
  cabinetId: string;
  currency: string;
  minTopUp: number | null;
  allowance: AdCabinetConfig["depositAllowance"];
  onAsk: (request: ConfirmRequest) => void;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [source, setSource] = useState("1");

  if (!open) {
    return (
      <IconButton title="Пополнить бюджет" onClick={() => setOpen(true)}>
        <Wallet className="h-4 w-4 text-slate-500" aria-hidden="true" />
      </IconButton>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        inputMode="numeric"
        placeholder={minTopUp ? `от ${minTopUp}` : "сумма"}
        className="h-8 w-20 rounded-lg border border-slate-300 px-2 text-[12px] tabular-nums focus:border-violet-500 focus:outline-none"
      />
      <select
        value={source}
        onChange={(event) => setSource(event.target.value)}
        className="h-8 rounded-lg border border-slate-300 px-1 text-[11px] focus:border-violet-500 focus:outline-none"
      >
        <option value="1">баланс</option>
        <option value="0">счёт</option>
        <option value="3">бонусы</option>
      </select>
      <button
        type="button"
        className="h-8 rounded-lg bg-rose-600 px-2 text-[11px] font-semibold text-white"
        onClick={() => {
          const sum = Number(value);
          if (!Number.isFinite(sum) || sum <= 0) return;
          onAsk({
            actionId: "deposit",
            subject: `${row.campaign.name} · ${row.art}`,
            amount: `Списать ${sum.toLocaleString("ru-RU")} ${currency}`,
            detail: allowance
              ? `Сегодня уже пополнено ${allowance.spentToday.toLocaleString("ru-RU")} ${currency} из ${allowance.maxPerDay.toLocaleString("ru-RU")} ${currency}. Вернуть сумму из бюджета кампании обратно нельзя.`
              : "Вернуть сумму из бюджета кампании обратно нельзя.",
            run: async () => {
              const result = await adPost("/api/adverts/deposit", {
                cabinetId,
                advertId: row.campaign.id,
                sum,
                type: Number(source),
              });
              if (result.ok) {
                setOpen(false);
                onDone();
              }
              return { ok: result.ok, error: result.error };
            },
          });
        }}
      >
        Пополнить
      </button>
      <button type="button" className="h-8 px-1 text-[11px] text-slate-400" onClick={() => setOpen(false)}>
        ✕
      </button>
    </div>
  );
}
