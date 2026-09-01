"use client";

import { useCallback, useEffect, useState } from "react";

import { WbEmptyState } from "@/components/wb/WbModuleHeader";
import { adDelete, adGet, adPost, type AdRule } from "./adControlApi";
import type { ConfirmRequest } from "./ConfirmAction";
import type { CampaignRow } from "./campaignRow";

const DECISION_LABEL: Record<string, string> = {
  raise: "подняло",
  lower: "снизило",
  hold: "не трогало",
  error: "ошибка",
};

/**
 * Автоправила — единственная часть модуля, которая действует без человека.
 *
 * Поэтому здесь два отличия от остальных вкладок. Правило заводится
 * выключенным: включение — отдельное осознанное движение, а не побочный эффект
 * сохранения формы. И у каждого правила на виду его последний прогон вместе с
 * причиной — включая «не трогало». Правило, которое неделю ничего не делало,
 * и правило, которое неделю не запускалось, выглядят одинаково ровно до тех
 * пор, пока причина не написана словами.
 */
export function AdRulesTab({
  cabinetId,
  rows,
  currency,
  onAsk,
}: {
  cabinetId: string;
  rows: CampaignRow[];
  currency: string;
  onAsk: (request: ConfirmRequest) => void;
}) {
  const [rules, setRules] = useState<AdRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dryRun, setDryRun] = useState<string | null>(null);

  const [advertId, setAdvertId] = useState("");
  const [goal, setGoal] = useState<"drr" | "cpo">("drr");
  const [target, setTarget] = useState("15");
  const [windowDays, setWindowDays] = useState("3");
  const [stepPercent, setStepPercent] = useState("10");
  const [minBid, setMinBid] = useState("");
  const [maxBid, setMaxBid] = useState("");
  const [minOrders, setMinOrders] = useState("5");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await adGet<{ rules: AdRule[]; error?: string }>(`/api/adverts/rules?cabinet=${cabinetId}`);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setRules(result.data?.rules ?? []);
  }, [cabinetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const candidates = rows.filter((row) => row.campaign.status !== 7);
  const selected = candidates.find((row) => String(row.campaign.id) === advertId) ?? null;

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    const result = await adPost("/api/adverts/rules", {
      cabinetId,
      advertId: selected.campaign.id,
      nmId: selected.nm,
      placement: selected.campaign.bid_type === "unified" ? "combined" : "search",
      goal,
      target: Number(target),
      windowDays: Number(windowDays),
      stepPercent: Number(stepPercent),
      minBid: Number(minBid),
      maxBid: Number(maxBid),
      minOrders: Number(minOrders),
      enabled: false,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setAdvertId("");
    setMinBid("");
    setMaxBid("");
    void load();
  };

  const saveRule = async (rule: AdRule, enabled: boolean) => {
    setBusy(true);
    const result = await adPost("/api/adverts/rules", {
      cabinetId,
      id: rule.id,
      advertId: rule.advertId,
      nmId: rule.nmId,
      placement: rule.placement,
      goal: rule.goal,
      target: rule.target,
      windowDays: rule.windowDays,
      stepPercent: rule.stepPercent,
      minBid: rule.minBid,
      maxBid: rule.maxBid,
      minOrders: rule.minOrders,
      enabled,
    });
    setBusy(false);
    if (!result.ok) setError(result.error);
    void load();
    return { ok: result.ok, error: result.error };
  };

  /**
   * Выключить правило можно сразу: это снятие полномочий, а не выдача.
   * Включить — только через подтверждение: с этой секунды ставку меняет машина
   * без человека, и по весу это не меньше разовой смены ставки, у которой
   * диалог есть.
   */
  const toggle = (rule: AdRule) => {
    if (rule.enabled) {
      void saveRule(rule, false);
      return;
    }
    onAsk({
      actionId: "rule_enable",
      subject: `Кампания ${rule.advertId}${rule.nmId ? ` · артикул ${rule.nmId}` : ""}`,
      detail: `Цель ${rule.goal === "drr" ? "ДРР" : "CPO"} ≤ ${rule.target}${rule.goal === "drr" ? "%" : ` ${currency}`}, шаг ${rule.stepPercent}%, ставка не выйдет за ${rule.minBid}–${rule.maxBid} ${currency}. Правило не сработает, пока в окне меньше ${rule.minOrders} заказов.`,
      run: () => saveRule(rule, true),
    });
  };

  const remove = (rule: AdRule) => {
    onAsk({
      actionId: "rule_delete",
      subject: `Кампания ${rule.advertId}${rule.nmId ? ` · артикул ${rule.nmId}` : ""}`,
      run: async () => {
        setBusy(true);
        const result = await adDelete("/api/adverts/rules", { cabinetId, id: rule.id });
        setBusy(false);
        void load();
        return { ok: result.ok, error: result.error };
      },
    });
  };

  const preview = async () => {
    setBusy(true);
    setDryRun(null);
    const result = await adGet<{ results: Array<{ advertId: number; decision: string; reason: string; oldBid: number | null; newBid: number | null }> }>(
      `/api/adverts/rules/run?cabinet=${cabinetId}&dry=1`,
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const lines = (result.data?.results ?? []).map((item) =>
      `Кампания ${item.advertId}: ${DECISION_LABEL[item.decision] ?? item.decision}${item.newBid ? ` → ${item.newBid} ${currency}` : ""} — ${item.reason}`,
    );
    setDryRun(lines.length ? lines.join("\n") : "Ни одно правило не сработало бы прямо сейчас.");
  };

  return (
    <div className="space-y-3">
      {error ? <div className="rounded-xl bg-rose-50 px-4 py-3 text-[12px] text-rose-700">{error}</div> : null}

      {/*
        Расписание названо вслух и точным временем. «Работает автоматически» —
        бесполезная фраза: когда правило не сработало, первый вопрос человека
        «а оно вообще запускалось?», и ответ должен быть на экране, а не в
        vercel.json. Окно факта заканчивается вчера, поэтому прогон суточный:
        в течение дня цифры, на которые смотрит правило, не меняются.
      */}
      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[12px] leading-5 text-sky-900">
        <b>Прогон раз в сутки, 10:00 по Москве.</b> Включённое правило меняет ставку само. Кнопка «Что сделали бы правила
        сейчас» считает то же самое, ничего не отправляя в WB — ей можно пользоваться в любой момент.
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Новое правило</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-[11px] text-slate-500">
            Кампания
            <select
              value={advertId}
              onChange={(event) => setAdvertId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-[12px] focus:border-violet-500 focus:outline-none"
            >
              <option value="">— выберите —</option>
              {candidates.map((row) => (
                <option key={`${row.campaign.id}-${row.nm}`} value={row.campaign.id}>
                  {row.campaign.name} · {row.art}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-slate-500">
            Цель
            <select
              value={goal}
              onChange={(event) => setGoal(event.target.value as "drr" | "cpo")}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-[12px] focus:border-violet-500 focus:outline-none"
            >
              <option value="drr">Держать ДРР, %</option>
              <option value="cpo">Держать CPO, {currency}</option>
            </select>
          </label>
          <NumberField label="Значение цели" value={target} onChange={setTarget} />
          <NumberField label="Окно, дней" value={windowDays} onChange={setWindowDays} />
          <NumberField label="Шаг, %" value={stepPercent} onChange={setStepPercent} />
          <NumberField label={`Минимум ставки, ${currency}`} value={minBid} onChange={setMinBid} />
          <NumberField label={`Максимум ставки, ${currency}`} value={maxBid} onChange={setMaxBid} />
          <NumberField label="Порог заказов" value={minOrders} onChange={setMinOrders} />
        </div>

        <p className="mt-2 text-[11px] leading-4 text-slate-400">
          Правило считает факт за окно, заканчивающееся вчера: сегодняшний день неполон — расход в нём уже есть, а заказы ещё
          доедут, и по такому дню ДРР всегда выглядит хуже, чем он есть. Ниже порога заказов правило не срабатывает вовсе.
        </p>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={!selected || !minBid || !maxBid || busy}
            onClick={() => void save()}
            className="min-h-9 rounded-lg bg-slate-800 px-3 text-[12px] font-semibold text-white disabled:opacity-40"
          >
            Сохранить выключенным
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void preview()}
            className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Что сделали бы правила сейчас
          </button>
        </div>

        {dryRun ? (
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-600">
            {dryRun}
          </pre>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">Загружаю правила…</div>
      ) : rules.length === 0 ? (
        <WbEmptyState>Правил пока нет. Заведите первое и посмотрите неделю в режиме «что сделали бы», прежде чем включать.</WbEmptyState>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${rule.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {rule.enabled ? "Включено" : "Выключено"}
                </span>
                <span className="text-[12px] font-semibold text-slate-800">Кампания {rule.advertId}</span>
                <span className="text-[11px] text-slate-500">
                  {rule.goal === "drr" ? "ДРР" : "CPO"} ≤ {rule.target}
                  {rule.goal === "drr" ? "%" : ` ${currency}`} · окно {rule.windowDays} дн. · шаг {rule.stepPercent}% · ставка{" "}
                  {rule.minBid}–{rule.maxBid} {currency} · порог {rule.minOrders} заказов
                </span>
                <div className="ml-auto flex gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggle(rule)}
                    className="min-h-8 rounded-lg border border-slate-200 px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    {rule.enabled ? "Выключить" : "Включить"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(rule)}
                    className="min-h-8 rounded-lg border border-slate-200 px-2 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                  >
                    Удалить
                  </button>
                </div>
              </div>
              <div className="mt-1.5 text-[11px] text-slate-400">
                {rule.lastRun
                  ? `Последний прогон ${new Date(rule.lastRun.ran_at).toLocaleString("ru-RU")}: ${DECISION_LABEL[rule.lastRun.decision] ?? rule.lastRun.decision}. ${rule.lastRun.reason ?? ""}`
                  : "Ещё ни разу не запускалось."}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-[11px] text-slate-500">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="numeric"
        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-[12px] tabular-nums focus:border-violet-500 focus:outline-none"
      />
    </label>
  );
}
