"use client";

import { KeyRound, Loader2, X } from "lucide-react";
import { useState } from "react";

import { adPost } from "./adControlApi";

interface TokenVerdict {
  ok: boolean;
  mask: string;
  sandbox: boolean;
  expiresAt: string | null;
  daysLeft: number | null;
  promotionAvailable: boolean;
  canWrite: boolean;
  message: string;
  saved?: boolean;
}

/**
 * Ключ Продвижения прямо в модуле.
 *
 * Раньше ключ жил только на экране кабинетов, и это выглядело правильно — одно
 * место для одного секрета. Практика поправила: упираешься в ключ здесь, в
 * момент, когда кнопка не сработала, и уход на другой экран разрывает ровно то
 * действие, ради которого пришёл. Место хранения не меняется — тот же
 * `wb_cabinets.token_advert`, просто вводить его можно оттуда, где стало ясно,
 * что он не тот.
 *
 * Поле ввода — типа password: ключ Продвижения даёт право менять ставки и
 * тратить деньги, и показывать его на экране, за которым может кто-то стоять,
 * незачем. Обратно ключ никогда не отдаётся, только маска из четырёх символов.
 */
export function AdTokenPanel({ cabinetId, onClose, onSaved }: { cabinetId: string; onClose: () => void; onSaved: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<TokenVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (withToken: boolean) => {
    setBusy(true);
    setError(null);
    const result = await adPost<TokenVerdict>("/api/adverts/token", {
      cabinetId,
      ...(withToken ? { token: token.trim() } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setVerdict(null);
      return;
    }
    setVerdict(result.data);
    if (result.data?.saved) {
      setToken("");
      onSaved();
    }
  };

  const tone = !verdict
    ? "bg-slate-50 text-slate-600"
    : verdict.canWrite
      ? "bg-emerald-50 text-emerald-800"
      : verdict.promotionAvailable
        ? "bg-amber-50 text-amber-800"
        : "bg-rose-50 text-rose-800";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-slate-800">Ключ Продвижения</div>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
            Чтобы модуль мог менять кампании, ключ должен быть выпущен <b>без галочки «Только на чтение»</b> и с категорией
            «Продвижение». Проверка ниже спрашивает у WB напрямую и ничего в кабинете не трогает.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="tap rounded-lg text-slate-400 hover:bg-slate-50">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Вставьте новый ключ Продвижения"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-[12px] focus:border-violet-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={busy || token.trim().length === 0}
          onClick={() => void run(true)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-slate-800 px-3 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          Проверить и сохранить
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(false)}
          className="min-h-10 rounded-lg border border-slate-200 px-3 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          Проверить текущий
        </button>
      </div>

      {error ? <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div> : null}

      {verdict ? (
        <div className={`mt-3 rounded-lg px-3 py-2 text-[12px] leading-5 ${tone}`}>
          <div className="font-semibold">{verdict.message}</div>
          <div className="mt-1 text-[11px] opacity-80">
            Ключ {verdict.mask}
            {verdict.daysLeft != null ? ` · осталось ${verdict.daysLeft} дн.` : ""}
            {verdict.sandbox ? " · песочница" : ""}
            {" · чтение "}
            {verdict.promotionAvailable ? "есть" : "нет"}
            {" · запись "}
            {verdict.canWrite ? "есть" : "нет"}
          </div>
        </div>
      ) : null}

      <details className="mt-3 text-[11px] text-slate-500">
        <summary className="tap-row flex cursor-pointer list-none items-center font-semibold text-slate-600">Где взять ключ</summary>
        <p className="mt-1.5 leading-4">
          Личный кабинет WB → Настройки → Доступ к API → создать токен. Отметьте категорию «Продвижение» и{" "}
          <b>не ставьте</b> «Только на чтение». Ключ показывается один раз — скопируйте сразу.
        </p>
      </details>
    </div>
  );
}
