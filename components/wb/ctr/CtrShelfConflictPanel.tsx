"use client";

import { AlertTriangle, Loader2, PauseCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { WB_RK_BLOCK_LABELS, type WbRkBlock } from "@/lib/wb/advertBlocks";

interface ShelfCandidate {
  advertId: number;
  name: string | null;
  block: WbRkBlock;
  statusBefore: number;
}

interface ShelfState {
  state: "unchecked" | "none" | "pending" | "confirmed" | "declined";
  candidates: ShelfCandidate[];
}

/**
 * Конкурирующие полочные кампании на артикуле теста.
 *
 * Пауза — не молчаливое действие: владелец подтвердил 15.09.2026, что панель
 * не выключает рекламу сама, только показывает список и просит явного
 * решения. Пока решение не принято (или отклонено осознанно), автоматическая
 * смена фото остаётся заблокирована — см. гейт в
 * app/api/ctrtest/[id]/action/route.ts.
 */
export function CtrShelfConflictPanel({ testId, onResolved }: { testId: number; onResolved: () => void }) {
  const [data, setData] = useState<ShelfState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/ctrtest/${testId}/shelf-conflicts`)
      .then((response) => response.json())
      .then((body) => { if (!cancelled) setData(body?.data ?? null); })
      .catch(() => { if (!cancelled) setError("Не удалось прочитать список кампаний"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [testId]);

  const resolve = async (decision: "pause" | "decline") => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/ctrtest/${testId}/shelf-conflicts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Не удалось применить решение (${response.status})`);
      onResolved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось применить решение");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;
  if (!data || data.state !== "pending" || data.candidates.length === 0) return null;

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div>
          <h3 className="text-sm font-bold text-amber-900">На этом артикуле ещё крутятся полочные кампании</h3>
          <p className="mt-1 text-[11px] leading-5 text-amber-800">
            Пока они активны, показы теста будут смешаны с показами полок, и замер CTR обложки станет
            неточным. Поставить их на паузу на время теста, или продолжить осознанно без паузы?
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {data.candidates.map((candidate) => (
          <li key={candidate.advertId} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[11px]">
            <span className="font-semibold text-slate-700">{candidate.name || `Кампания ${candidate.advertId}`}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-slate-500">{WB_RK_BLOCK_LABELS[candidate.block]}</span>
          </li>
        ))}
      </ul>

      {error ? <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">{error}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve("pause")}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-[11px] font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <PauseCircle className="h-3.5 w-3.5" />}
          Поставить {data.candidates.length} на паузу
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve("decline")}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-amber-300 px-3 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          Продолжить без паузы
        </button>
      </div>
    </section>
  );
}
