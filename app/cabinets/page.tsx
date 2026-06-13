"use client";

import { useEffect, useState } from "react";
import { Building2, Plus, Trash2, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface Cabinet {
  id: string;
  name: string;
  trade_mark: string | null;
  seller_id: string;
  inn: string | null;
  is_active: boolean;
  created_at: string;
  token_mask: string;
  has_advert: boolean;
  has_content: boolean;
}

export default function CabinetsPage() {
  const [cabinets, setCabinets] = useState<Cabinet[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [advert, setAdvert] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAdv, setShowAdv] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/cabinets", { cache: "no-store" });
      const j = await r.json();
      setCabinets(j.cabinets ?? []);
    } catch {
      /* ignore */
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!token.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/cabinets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, token_advert: advert, token_content: content }),
      });
      const j = await r.json();
      if (!r.ok || j.error) {
        setMsg({ ok: false, text: j.error || `Ошибка ${r.status}` });
      } else {
        setMsg({ ok: true, text: `Кабинет «${j.cabinet?.name}» добавлен` });
        setToken(""); setName(""); setAdvert(""); setContent("");
        await load();
      }
    } catch (e) {
      setMsg({ ok: false, text: "Сеть: " + String(e) });
    }
    setBusy(false);
  };

  const remove = async (id: string, label: string) => {
    if (!confirm(`Удалить кабинет «${label}»?`)) return;
    await fetch(`/api/cabinets/${id}`, { method: "DELETE" });
    await load();
  };

  const toggle = async (c: Cabinet) => {
    await fetch(`/api/cabinets/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !c.is_active }),
    });
    await load();
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
          <Building2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Кабинеты WB</h1>
          <p className="text-sm text-gray-500">Подключение аккаунтов Wildberries по API-токену</p>
        </div>
      </div>

      {/* Форма добавления */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 text-sm font-semibold text-gray-700">Добавить кабинет</div>
        <label className="mb-1 block text-xs text-gray-500">
          API-токен WB <span className="text-gray-400">(Настройки → Доступ к API → создать токен с категориями Статистика, Аналитика, Контент, Продвижение)</span>
        </label>
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          rows={2}
          placeholder="eyJhbGciOi… вставьте токен"
          className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <div className="mb-2 grid grid-cols-2 gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название (необяз. — подтянем из WB)"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowAdv((s) => !s)}
            className="text-left text-xs text-gray-400 hover:text-violet-600"
          >
            {showAdv ? "▾" : "▸"} отдельные токены (если нужно)
          </button>
        </div>
        {showAdv && (
          <div className="mb-2 grid grid-cols-1 gap-2">
            <input value={advert} onChange={(e) => setAdvert(e.target.value)} placeholder="Токен Продвижение (если отдельный)" className="rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none" />
            <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="Токен Контент (если отдельный)" className="rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none" />
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={add}
            disabled={busy || !token.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {busy ? "Проверяю токен в WB…" : "Добавить и проверить"}
          </button>
          {msg && (
            <span className={`inline-flex items-center gap-1 text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>
              {msg.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {msg.text}
            </span>
          )}
        </div>
        <p className="mt-2 text-[11px] text-gray-400">Токен проверяется через WB (common-api/seller-info) — добавится только рабочий. Имя и ИНН подтянутся автоматически.</p>
      </div>

      {/* Список */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-700">
          Подключённые кабинеты {!loading && <span className="text-gray-400">({cabinets.length})</span>}
        </div>
        {loading ? (
          <div className="px-5 py-10 text-center text-gray-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : cabinets.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">Пока нет кабинетов — добавьте первый по токену выше.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {cabinets.map((c) => (
              <div key={c.id} className="flex items-center gap-4 px-5 py-3">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.is_active ? "bg-emerald-500" : "bg-gray-300"}`} title={c.is_active ? "активен" : "выключен"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">{c.name}</span>
                    {c.trade_mark && c.trade_mark !== c.name && <span className="text-xs text-gray-400">бренд: {c.trade_mark}</span>}
                  </div>
                  <div className="text-xs text-gray-400">
                    sid {c.seller_id?.slice(0, 8)}… · {c.inn ? `ИНН ${c.inn} · ` : ""}токен {c.token_mask}
                    {c.has_advert && " · +Продвижение"}{c.has_content && " · +Контент"}
                  </div>
                </div>
                <button onClick={() => toggle(c)} className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">
                  {c.is_active ? "Выключить" : "Включить"}
                </button>
                <button onClick={() => remove(c.id, c.name)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Удалить">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
