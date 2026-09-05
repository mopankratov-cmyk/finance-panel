"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDialogBehavior } from "@/hooks/useDialogBehavior";

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
  /** Спросить причину. Поле пустое и необязательное — см. комментарий ниже. */
  askReason?: boolean;
  run: (reason: string) => Promise<{ ok: boolean; error: string | null }>;
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
  const [reason, setReason] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Ссылка, а не значение: замыкание должно оставаться стабильным, иначе
  // ловушка фокуса пересобиралась бы на каждом переключении busy.
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (request) {
      setError(null);
      setBusy(false);
      setReason("");
      cancelRef.current?.focus();
    }
  }, [request]);

  // Escape (пока операция не пошла), замкнутый Tab и неподвижный фон. Последнее
  // особенно важно здесь: это окно спрашивает разрешение на трату, и уезжающая
  // за его спиной страница — не косметика.
  const closeIfIdle = useCallback(() => {
    if (!busyRef.current) onClose();
  }, [onClose]);
  useDialogBehavior(Boolean(request), closeIfIdle, boxRef);

  if (!request) return null;
  const spec = advertAction(request.actionId);
  const isMoney = spec?.risk === "money";

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await request.run(reason);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Не получилось");
      return;
    }
    onDone?.(true);
    onClose();
  };

  // z-[100], а не z-50. На z-50 подложка честно накрывала окно целиком, но
  // сайдбар оболочки стоит на z-[70] и шапка на z-[60] — они рисовались ПОВЕРХ
  // затемнения, и половина экрана оставалась светлой и кликабельной. Для окна,
  // которое спрашивает разрешение на трату, это плохо вдвойне: рядом с вопросом
  // остаётся живое меню, по которому можно уйти, не ответив.
  // Слой и цвет взяты у соседей по разделу — WbCtrDayPopup и WbRkNotePopup.
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      {/*
        Высота ограничена окном, а кнопки закреплены снизу. В ландшафте телефона
        (высота 390-430px) и с поднятой клавиатурой окно раньше обрезалось сверху
        и снизу: сумму не видно, «Подтвердить» недостижимо. `--kb-inset` — датчик
        экранной клавиатуры, она не двигает fixed-элементы сама.
      */}
      <div ref={boxRef} className="flex max-h-[calc(100dvh-2rem-var(--kb-inset))] w-full max-w-md flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
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

          {request.askReason ? (
            <label className="mt-3 block">
              <span className="text-[11px] font-semibold text-slate-500">Почему <span className="font-normal text-slate-400">— необязательно, но через неделю пригодится</span></span>
              {/*
                Поле открывается ПУСТЫМ и остаётся необязательным.
                Предзаполнить его формулировкой панели было бы вредно вдвойне:
                обязательность, которую закрывает значение по умолчанию, не
                обязательность, а в аудите осталась бы фраза алгоритма, подписанная
                именем человека. Ценность записи именно в том, что её написали.
              */}
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Например: ДРР вырос после смены главного фото, снижаю до выяснения"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[12px] focus:border-violet-500 focus:outline-none"
              />
            </label>
          ) : null}

          {error ? <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div> : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-4 pt-3 pb-[calc(0.75rem+var(--safe-b))]">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 rounded-lg border border-slate-200 px-4 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 lg:min-h-9 lg:px-3"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-4 text-[12px] font-semibold text-white disabled:opacity-60 lg:min-h-9 lg:px-3 ${isMoney ? "bg-rose-600 hover:bg-rose-700" : "bg-slate-800 hover:bg-slate-900"}`}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            {busy ? "Выполняю…" : "Подтвердить"}
          </button>
        </div>
      </div>
    </div>
  );
}
