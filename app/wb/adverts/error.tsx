"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

const RECOVERY_KEY = "fp:wb-adverts:last-hard-reload";
const RECOVERY_WINDOW_MS = 60_000;

export default function WbAdvertsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [autoRecovering, setAutoRecovering] = useState(true);

  useEffect(() => {
    console.error("WB adverts render failed", error);

    let shouldReload = true;
    try {
      const lastReload = Number(sessionStorage.getItem(RECOVERY_KEY) ?? 0);
      shouldReload = !Number.isFinite(lastReload) || Date.now() - lastReload > RECOVERY_WINDOW_MS;
      if (shouldReload) sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));
    } catch {
      // sessionStorage may be disabled; the manual controls below remain available.
    }

    if (!shouldReload) {
      setAutoRecovering(false);
      return;
    }

    const timer = window.setTimeout(() => window.location.reload(), 250);
    return () => window.clearTimeout(timer);
  }, [error]);

  const hardReload = () => {
    try {
      sessionStorage.removeItem(RECOVERY_KEY);
    } catch {
      // Reload still works when storage is unavailable.
    }
    window.location.reload();
  };

  return (
    <div className="grid min-h-[calc(100vh-54px)] place-items-center bg-[#f6f7f9] px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-amber-50 text-amber-600">
          {autoRecovering ? <RefreshCw className="h-6 w-6 animate-spin motion-reduce:animate-none" /> : <AlertTriangle className="h-6 w-6" />}
        </div>
        <h1 className="mt-4 text-lg font-bold text-slate-900">
          {autoRecovering ? "Обновляем экран рекламы" : "Не удалось открыть рекламу"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {autoRecovering
            ? "Обнаружена старая версия страницы. Сейчас загрузим актуальную."
            : "Страница уже была обновлена. Попробуйте ещё раз или вернитесь к списку кампаний позже."}
        </p>
        {!autoRecovering ? (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={hardReload} className="min-h-10 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700">
              Попробовать снова
            </button>
            <button type="button" onClick={reset} className="min-h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Повторить без перезагрузки
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
