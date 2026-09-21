import { Hint } from "@/components/ui/Hint";
import { formatTime } from "@/lib/analytics/format";
import { buildCtrMatrix, buildStepHistory, type Counters, type HistoryInput, type StepRow } from "@/lib/ctrtest/roundHistory";
import type { CtrTestView } from "./types";

/**
 * Сравнение CTR по раундам и история шагов нового движка.
 *
 * Итог теста — сумма по истории: показы и клики закрытых шагов, а не среднее
 * процентов. Ниже — сами шаги с тремя замерами: при старте, при стопе и после
 * стабилизации статистики.
 */

const STEP_PHASE_LABEL: Record<string, string> = {
  swap: "меняем фото",
  starting: "запускаем рекламу",
  warmup: "прогрев",
  collecting: "набираем показы",
  settling: "реклама на паузе, ждём статистику",
};

const int = (value: number) => Math.round(value).toLocaleString("ru-RU");
const pct = (value: number | null) => (value == null ? "—" : `${value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const pair = (counters: Counters | null) => (counters ? `${int(counters.impressions)} / ${int(counters.clicks)}` : "—");

export function historyInputOf(test: CtrTestView): HistoryInput {
  return {
    rounds: test.rounds,
    variants: test.variants.map((variant) => ({ id: variant.id, label: variant.label, position: variant.position })),
    variantOrders: test.variantOrders ?? null,
    roundsTotal: test.roundsTotal ?? null,
    impressionsPerStep: test.impressionsPerRound,
  };
}

function CtrByRound({ test }: { test: CtrTestView }) {
  const matrix = buildCtrMatrix(historyInputOf(test));
  const closed = matrix.rows.some((row) => row.total.impressions > 0);
  return (
    <section aria-label="CTR по раундам">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-bold text-slate-700">CTR по раундам</h3>
        <Hint label="Как считается итог">
          Итог варианта — сумма показов и кликов по всем его закрытым шагам, а не среднее процентов по раундам: у раундов разный объём, и среднее дало бы десятку показов тот же вес, что тысяче. Процент не рисуется, пока у варианта меньше 50 показов: на таком объёме он случаен.
        </Hint>
      </div>
      {!closed ? (
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-8 text-center text-[10px] text-slate-400">Сравнение появится после первого закрытого шага: шаг закрывается, когда статистика устоялась.</p>
      ) : (
        <div className="scroll-x rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[520px] text-[10px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Вариант</th>
                {matrix.passes.map((pass) => (
                  <th key={pass.passNo} className="px-3 py-2 text-right">
                    Раунд {pass.passNo}
                    {pass.order ? <div className="font-normal text-slate-400">{pass.order}</div> : null}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Итого</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.variantId} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-violet-700">{row.letter} · {row.label}</td>
                  {row.cells.map((cell, index) => (
                    <td key={index} className={`px-3 py-2 text-right tabular-nums ${matrix.leaderByPass[index] === row.variantId ? "font-semibold text-emerald-700" : "text-slate-700"}`}>
                      {cell ? (
                        <>
                          {pct(cell.ctr)}
                          <div className="font-normal text-slate-400">{int(cell.impressions)} показов{cell.short ? <span className="text-amber-700"> · недобор</span> : null}</div>
                        </>
                      ) : "—"}
                    </td>
                  ))}
                  <td className={`px-3 py-2 text-right font-bold tabular-nums ${matrix.leaderTotal === row.variantId ? "text-emerald-700" : "text-slate-800"}`}>
                    {pct(row.total.ctr)}
                    <div className="font-normal text-slate-400">{int(row.total.impressions)} показов · {int(row.total.clicks)} кликов</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StepCells({ step }: { step: StepRow }) {
  const muted = "text-slate-400 italic";
  return (
    <>
      <td className="px-3 py-2 font-semibold text-violet-700">
        {step.passNo != null ? `${step.passNo} · ` : ""}{step.letter}
        <div className="font-normal text-slate-400">{step.label}</div>
      </td>
      <td className="px-3 py-2">
        {step.status === "active" ? <span className="text-violet-700">{STEP_PHASE_LABEL[step.phase ?? "swap"] ?? step.phase}</span> : step.stopReason === "timeout" ? <span className="text-amber-700">время шага вышло</span> : step.stopReason === "target" ? "цель набрана" : "закрыт досрочно"}
        {step.attempts > 0 ? <div className="text-amber-700">повторов: {step.attempts}</div> : null}
        {step.lastError && step.status === "active" ? <div className="max-w-[200px] truncate text-rose-700" title={step.lastError}>{step.lastError}</div> : null}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{pair(step.start)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{pair(step.stop)}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${step.finalProvisional ? muted : ""}`}>{pair(step.final)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{step.lagged ? `+${int(step.lagged.impressions)} / +${int(step.lagged.clicks)}` : "—"}</td>
      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${step.resultProvisional ? muted : "text-slate-800"}`}>
        {step.result ? <>{pair(step.result)}<div className="font-normal">{pct(step.result.ctr)}{step.short ? <span className="text-amber-700"> · недобор</span> : null}</div></> : "—"}
      </td>
    </>
  );
}

export function CtrRoundHistory({ test }: { test: CtrTestView }) {
  const steps = buildStepHistory(historyInputOf(test));
  return (
    <div className="space-y-6">
      <CtrByRound test={test} />
      <section aria-label="История шагов">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-xs font-bold text-slate-700">История шагов</h3>
          <Hint label="Три замера шага">
            <b>При старте</b> — счётчики кампании после прогрева. <b>При стопе</b> — когда цель набрана и реклама поставлена на паузу. <b>После стабилизации</b> — когда статистика перестала меняться. Разница между стопом и стабилизацией — показы и клики, которые WB донёс с задержкой. Итог шага — после стабилизации минус старт. Ячейки пишутся как «показы / клики».
          </Hint>
        </div>
        {steps.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-3 py-8 text-center text-[10px] text-slate-400">История появится после запуска первого шага.</p>
        ) : (
          <div className="scroll-x rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[1040px] text-[10px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Раунд · вариант</th>
                  <th className="px-3 py-2 text-left">Состояние</th>
                  <th className="px-3 py-2 text-right">При старте</th>
                  <th className="px-3 py-2 text-right">При стопе</th>
                  <th className="px-3 py-2 text-right">После стабилизации</th>
                  <th className="px-3 py-2 text-right">Донесено позже</th>
                  <th className="px-3 py-2 text-right">Итог шага</th>
                  <th className="px-3 py-2 text-left">Начало</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step) => {
                  const round = test.rounds.find((item) => item.id === step.id);
                  return (
                    <tr key={step.id} className="border-t border-slate-100 align-top">
                      <StepCells step={step} />
                      <td className="px-3 py-2 text-slate-500">{round?.started_at ? formatTime(round.started_at) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
