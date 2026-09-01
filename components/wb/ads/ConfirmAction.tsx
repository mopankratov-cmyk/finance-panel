"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { advertAction, ADVERT_RISK_LABEL } from "@/lib/adverts/actionCatalog";

export interface ConfirmRequest {
  /** Код действия из реестра — из него берутся подпись и последствие. */
  actionId: string;
  /** Что именно затрагивается: имя кампании, артикул, сумма. */
  subject: string;
  /** Дополнительная строка: во что превратится значение. */
  detail?: string;
  /** Для операций с деньгами — сумма, которую человек должен подтвердить. */
  amount?: string;
  run: () => Promise<{ ok: boolean; error: string | null }>;
}

/**
 * Подтверждение действия.
 *
 * Диалог берёт текст последствия не из места вызова, а из реестра действий.
 * Иначе один и тот же «Завершить» объяснялся бы по-разному в списке кампаний и
 * в карточке, и рано или поздно где-то объяснялся бы неверно.
 *
 * Кнопка подтверждения не автофокусируется намеренно. Автофокус превращает
 * Enter, нажатый по инерции после ввода суммы, в подтверждение траты.
 */
export function ConfirmAction({
  request,
  onClose,
  onDone,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
  onDone?: (ok: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (request) {
      setError(null);
      setBusy(false);
      cancelRef.current?.focus();
    }
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, busy, onClose]);

  if (!request) return null;
  const spec = advertAction(request.actionId);
  const isMoney = spec?.risk === "money";

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await request.run();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Не получилось");
      return;
    }
    onDone?.(true);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${isMoney ? "text-rose-500" : "text-amber-500"}`} aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[15px] font-bold text-slate-800">{spec?.label ?? request.actionId}</div>
            <div className="mt-0.5 text-[12px] text-slate-500">{request.subject}</div>
          </div>
        </div>

        <p className="mt-3 text-[13px] leading-5 text-slate-700">{spec?.effect}</p>
        {request.detail ? <p className="mt-1.5 text-[12px] text-slate-500">{request.detail}</p> : null}

        {request.amount ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] font-bold text-rose-700">
            {request.amount}
          </div>
        ) : null}

        {spec ? (
          <div className="mt-3 text-[11px] uppercase tracking-wide text-slate-400">
            {ADVERT_RISK_LABEL[spec.risk]}
            {spec.endpoint ? <span className="ml-2 font-mono normal-case tracking-normal text-slate-300">{spec.endpoint}</span> : null}
          </div>
        ) : null}

        {error ? <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-9 rounded-lg border border-slate-200 px-3 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold text-white disabled:opacity-60 ${isMoney ? "bg-rose-600 hover:bg-rose-700" : "bg-slate-800 hover:bg-slate-900"}`}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            {busy ? "Выполняю…" : "Подтвердить"}
          </button>
        </div>
      </div>
    </div>
  );
}
