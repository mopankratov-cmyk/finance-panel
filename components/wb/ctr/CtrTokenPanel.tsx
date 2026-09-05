"use client";

import { KeyRound, Loader2, X } from "lucide-react";
import { useState } from "react";

interface Verdict {
  ok: boolean;
  mask: string | null;
  hasOwnKey: boolean;
  expiresAt: string | null;
  daysLeft: number | null;
  canWrite: boolean;
  reason: "read-only" | "no-scope" | "unknown" | null;
  message: string;
  saved?: boolean;
}

/**
 * Ключ «Контент» в модуле тестов.
 *
 * Автоматическая смена фото пишет в живую карточку, а ключи кабинетов выпущены
 * «только на чтение» — WB отвечает 403. Панель обязана сказать это здесь и
 * заранее, а не оставить человека выяснять причину из ошибки крона.
 *
 * Поле — password: ключ контента даёт право переписать витрину товара, и
 * показывать его на экране, за которым может кто-то стоять, незачем. Обратно
 * ключ не отдаётся никогда, только маска последних четырёх символов.
 */
export function CtrTokenPanel({ cabinetId, onClose }: { cabinetId: string; onClose: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (save: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ctrtest/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cabinetId, token: token.trim() || undefined, save }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Проверка не удалась (${response.status})`);
      setVerdict(body as Verdict);
      if ((body as Verdict).saved) setToken("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверка не удалась");
    } finally {
      setBusy(false);
    }
  };

  const tone = verdict === null ? "" : verdict.canWrite
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <h3 className="text-sm font-bold text-slate-800">Ключ контента</h3>
        <p className="text-[11px] text-slate-500">Нужен, чтобы панель могла менять фото карточки сама</p>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">
        В личном кабинете WB: <b>Настройки → Доступ к API → создать новый токен</b>. Категория <b>«Контент»</b>,
        галочку <b>«Только на чтение» снять</b>. Ключ вставляется сюда и уходит прямо в кабинет — я его не вижу
        и никуда не пересылаю.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Вставьте новый ключ (или проверьте текущий)"
          autoComplete="off"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400"
        />
        <button
          type="button"
          onClick={() => void run(false)}
          disabled={busy}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : null}
          Проверить
        </button>
        <button
          type="button"
          onClick={() => void run(true)}
          disabled={busy || token.trim().length === 0}
          title="Сохраняется только ключ, который умеет писать: класть в кабинет второй ключ на чтение незачем"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
        >
          Сохранить
        </button>
      </div>

      {error ? <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">{error}</p> : null}

      {verdict ? (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-[11px] leading-5 ${tone}`}>
          <p className="font-semibold">{verdict.message}</p>
          <p className="mt-1 opacity-80">
            Проверен ключ {verdict.mask ?? "—"} · {verdict.hasOwnKey ? "отдельный ключ контента" : "общий ключ кабинета"}
            {verdict.daysLeft != null ? ` · осталось ${verdict.daysLeft} дн.` : ""}
            {verdict.saved ? " · сохранён" : ""}
          </p>
          {verdict.reason === "read-only" ? (
            <p className="mt-1 opacity-80">
              Автоматическая смена на таком ключе не заработает: тест встанет на первом же переключении
              и напишет причину. Варианты можно ставить руками — для этого ключ не нужен.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
