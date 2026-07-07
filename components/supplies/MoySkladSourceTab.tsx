"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, RefreshCw } from "lucide-react";
import { formatTime } from "@/lib/analytics/format";

interface Status {
  connected: boolean;
  accountName?: string | null;
  tokenMask?: string;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
}

export function MoySkladSourceTab() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const r = await fetch("/api/moysklad", { cache: "no-store" });
    setStatus(await r.json());
  };
  useEffect(() => { load(); }, []);

  const connect = async () => {
    if (!token.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/moysklad", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      const j = await r.json();
      if (!r.ok || j.error) setMsg({ ok: false, text: j.error || `Ошибка ${r.status}` });
      else { setMsg({ ok: true, text: `Подключено${j.accountName ? `: ${j.accountName}` : ""}` }); setToken(""); await load(); }
    } catch (e) {
      setMsg({ ok: false, text: "Сеть: " + String(e) });
    }
    setBusy(false);
  };

  const disconnect = async () => {
    if (!confirm("Отключить МойСклад?")) return;
    await fetch("/api/moysklad", { method: "DELETE" });
    await load();
  };

  const checkConnection = async () => {
    setChecking(true);
    try {
      await fetch("/api/sync/trigger?job=moysklad", { method: "POST" });
      await load();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-900">Источник МойСклад</h3>
        <p className="mb-3 text-xs text-slate-400">
          Подключение — первый шаг. Импорт товаров/остатков из МойСклад в каталог пока
          не реализован (заглушка) — обсудим и добавим отдельно, когда решим, что именно
          и как синхронизировать.
        </p>

        {status?.connected ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Подключено{status.accountName ? `: ${status.accountName}` : ""} · токен {status.tokenMask}
            </div>
            {status.lastSyncAt && (
              <p className="text-xs text-slate-400">Последняя проверка: {formatTime(status.lastSyncAt)}</p>
            )}
            {status.lastSyncError && (
              <div className="flex items-center gap-2 text-xs text-red-600"><XCircle className="h-3.5 w-3.5" /> {status.lastSyncError}</div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={checkConnection} disabled={checking}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} /> Проверить соединение
              </button>
              <button onClick={disconnect} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                Отключить
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-xs text-slate-500">
              API-токен МойСклад <span className="text-slate-400">(Настройки → Обмен данными → API токены → создать)</span>
            </label>
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="вставьте токен"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none" />
            <button onClick={connect} disabled={busy || !token.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? "Проверяю…" : "Подключить и проверить"}
            </button>
          </div>
        )}
        {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
