"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Layers3, Plus, Trash2, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { CabinetGroup } from "@/app/api/cabinet-groups/route";

interface Cabinet {
  id: string;
  name: string;
  marketplace: string;
  trade_mark: string | null;
  seller_id: string;
  client_id: string | null;
  inn: string | null;
  is_active: boolean;
  created_at: string;
  token_mask: string;
  has_advert: boolean;
  has_content: boolean;
  has_feedbacks: boolean;
}

type Scope = "statistics" | "analytics" | "advert" | "content" | "prices" | "feedbacks";
const SCOPE_LABEL: Record<Scope, string> = {
  statistics: "Статистика",
  analytics: "Аналитика",
  advert: "Продвижение",
  content: "Контент",
  prices: "Цены и скидки",
  feedbacks: "Вопросы и отзывы",
};
interface ScopeReport {
  scopes: Record<Scope, boolean | null>;
  expiresAt: string | null;
  daysLeft: number | null;
  isTest: boolean;
}

export default function CabinetsPage() {
  const [cabinets, setCabinets] = useState<Cabinet[]>([]);
  const [loading, setLoading] = useState(true);
  const [mp, setMp] = useState<"wb" | "ozon">("wb");
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [perfId, setPerfId] = useState("");
  const [perfSecret, setPerfSecret] = useState("");
  const [name, setName] = useState("");
  const [advert, setAdvert] = useState("");
  const [content, setContent] = useState("");
  const [feedbacks, setFeedbacks] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAdv, setShowAdv] = useState(false);
  const [scopeRep, setScopeRep] = useState<ScopeReport | null>(null);

  const [groups, setGroups] = useState<CabinetGroup[]>([]);
  const [groupMp, setGroupMp] = useState<"wb" | "ozon">("wb");
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupMsg, setGroupMsg] = useState<{ ok: boolean; text: string } | null>(null);

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

  const loadGroups = useCallback(async () => {
    try {
      const r = await fetch(`/api/cabinet-groups?mp=${groupMp}`, { cache: "no-store" });
      const j = await r.json();
      setGroups(j.groups ?? []);
    } catch { /* ignore */ }
  }, [groupMp]);
  useEffect(() => { loadGroups(); }, [loadGroups]);

  const toggleMember = (id: string) => setGroupMembers((ms) => ms.includes(id) ? ms.filter((m) => m !== id) : [...ms, id]);

  const createGroup = async () => {
    if (!groupName.trim() || groupMembers.length < 2) return;
    setGroupBusy(true); setGroupMsg(null);
    try {
      const r = await fetch("/api/cabinet-groups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: groupName, marketplace: groupMp, memberIds: groupMembers }),
      });
      const j = await r.json();
      if (!r.ok || j.error) setGroupMsg({ ok: false, text: j.error || `Ошибка ${r.status}` });
      else { setGroupMsg({ ok: true, text: `Группа «${groupName}» создана` }); setGroupName(""); setGroupMembers([]); await loadGroups(); }
    } catch (e) {
      setGroupMsg({ ok: false, text: "Сеть: " + String(e) });
    }
    setGroupBusy(false);
  };

  const removeGroup = async (id: number, label: string) => {
    if (!confirm(`Удалить группу «${label}»?`)) return;
    await fetch(`/api/cabinet-groups/${id}`, { method: "DELETE" });
    await loadGroups();
  };

  const add = async () => {
    if (!token.trim()) return;
    setBusy(true);
    setMsg(null);
    setScopeRep(null);
    try {
      const r = await fetch("/api/cabinets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketplace: mp, token, client_id: clientId, name, token_advert: advert, token_content: content, token_feedbacks: feedbacks, perf_client_id: perfId, perf_secret: perfSecret }),
      });
      const j = await r.json();
      if (!r.ok || j.error) {
        setMsg({ ok: false, text: j.error || `Ошибка ${r.status}` });
      } else {
        setMsg({ ok: true, text: `Кабинет «${j.cabinet?.name}» добавлен` });
        if (mp === "wb" && j.scopes) setScopeRep({ scopes: j.scopes, expiresAt: j.expiresAt ?? null, daysLeft: j.daysLeft ?? null, isTest: !!j.isTest });
        setToken(""); setClientId(""); setPerfId(""); setPerfSecret(""); setName(""); setAdvert(""); setContent(""); setFeedbacks("");
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
        <div className="mb-3 flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700">Добавить кабинет</span>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
            <button type="button" onClick={() => setMp("wb")} className={`rounded px-3 py-1 text-xs font-semibold ${mp === "wb" ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}>Wildberries</button>
            <button type="button" onClick={() => setMp("ozon")} className={`rounded px-3 py-1 text-xs font-semibold ${mp === "ozon" ? "bg-white text-sky-700 shadow" : "text-gray-500"}`}>Ozon</button>
          </div>
        </div>
        {mp === "wb" ? (
          <>
            <label className="mb-1 block text-xs text-gray-500">
              API-токен WB <span className="text-gray-400">(Настройки → Доступ к API → токен с категориями Статистика, Аналитика, Контент, Продвижение, Цены и скидки)</span>
            </label>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={2}
              placeholder="eyJhbGciOi… вставьте токен"
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </>
        ) : (
          <>
            <label className="mb-1 block text-xs text-gray-500">
              Ozon Client-Id и Api-Key <span className="text-gray-400">(Настройки → Seller API → создать ключ)</span>
            </label>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Client-Id (число)"
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Api-Key"
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            <div className="mb-1 text-[11px] text-gray-400">Реклама (опц.) — Performance API (Реклама → API → создать ключ): даст Реклама ₽ и ДРР в РНП</div>
            <input value={perfId} onChange={(e) => setPerfId(e.target.value)} placeholder="Performance Client Id (…@advertising.performance.ozon.ru)" className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-sky-500 focus:outline-none" />
            <input value={perfSecret} onChange={(e) => setPerfSecret(e.target.value)} placeholder="Performance Client Secret" className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-sky-500 focus:outline-none" />
          </>
        )}
        <div className="mb-2 grid grid-cols-2 gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название (необяз. — подтянем из WB)"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
          />
          {mp === "wb" ? (
            <button
              type="button"
              onClick={() => setShowAdv((s) => !s)}
              className="text-left text-xs text-gray-400 hover:text-violet-600"
            >
              {showAdv ? "▾" : "▸"} отдельные токены (если нужно)
            </button>
          ) : <span />}
        </div>
        {mp === "wb" && showAdv && (
          <div className="mb-2 grid grid-cols-1 gap-2">
            <input value={advert} onChange={(e) => setAdvert(e.target.value)} placeholder="Токен Продвижение (если отдельный)" className="rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none" />
            <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="Токен Контент (если отдельный)" className="rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none" />
            <input value={feedbacks} onChange={(e) => setFeedbacks(e.target.value)} placeholder="Токен Вопросы и Отзывы (если отдельный)" className="rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none" />
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={add}
            disabled={busy || !token.trim() || (mp === "ozon" && !clientId.trim())}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${mp === "ozon" ? "bg-sky-600 hover:bg-sky-700" : "bg-violet-600 hover:bg-violet-700"}`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {busy ? `Проверяю ключ в ${mp === "ozon" ? "Ozon" : "WB"}…` : "Добавить и проверить"}
          </button>
          {msg && (
            <span className={`inline-flex items-center gap-1 text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>
              {msg.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {msg.text}
            </span>
          )}
        </div>
        {scopeRep && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-gray-600">Доступ токена:</span>
              {(["statistics", "analytics", "advert", "content", "prices", "feedbacks"] as Scope[]).map((s) => {
                const ok = scopeRep.scopes[s];
                return (
                  <span
                    key={s}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${ok === true ? "bg-emerald-100 text-emerald-700" : ok === false ? "bg-red-100 text-red-700" : "bg-gray-200 text-gray-500"}`}
                  >
                    {ok === true ? <CheckCircle2 className="h-3 w-3" /> : ok === false ? <XCircle className="h-3 w-3" /> : "?"}
                    {SCOPE_LABEL[s]}
                  </span>
                );
              })}
              {scopeRep.isTest && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">тестовый токен</span>}
              {scopeRep.daysLeft != null && (
                <span className={`rounded-full px-2 py-0.5 font-medium ${scopeRep.daysLeft < 14 ? "bg-amber-100 text-amber-700" : "bg-gray-200 text-gray-500"}`}>
                  {scopeRep.daysLeft <= 0 ? "истёк" : `действует ещё ${scopeRep.daysLeft} дн.`}
                </span>
              )}
            </div>
            {(["statistics", "analytics", "advert", "content", "prices", "feedbacks"] as Scope[]).some((s) => scopeRep.scopes[s] === false) && (
              <p className="text-[11px] text-red-600">
                Не хватает категорий: {(["statistics", "analytics", "advert", "content", "prices", "feedbacks"] as Scope[]).filter((s) => scopeRep.scopes[s] === false).map((s) => SCOPE_LABEL[s]).join(", ")}.
                Перевыпустите токен в WB, отметив эти категории. Продвижение и Контент можно дать отдельным токеном в «расширенном».
              </p>
            )}
          </div>
        )}
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
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${c.marketplace === "ozon" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"}`}>
                      {c.marketplace === "ozon" ? "OZON" : "WB"}
                    </span>
                    <span className="font-semibold text-gray-900">{c.name}</span>
                    {c.trade_mark && c.trade_mark !== c.name && <span className="text-xs text-gray-400">бренд: {c.trade_mark}</span>}
                  </div>
                  <div className="text-xs text-gray-400">
                    {c.marketplace === "ozon" ? `Client-Id ${c.client_id} · Api-Key ${c.token_mask}` : `sid ${c.seller_id?.slice(0, 8)}… · ${c.inn ? `ИНН ${c.inn} · ` : ""}токен ${c.token_mask}`}
                    {c.has_advert && " · +Продвижение"}{c.has_content && " · +Контент"}{c.has_feedbacks && " · +Отзывы"}
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

      {/* Группы кабинетов (комбо) */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex items-center gap-3">
          <Layers3 className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-700">Группы кабинетов</span>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
            <button type="button" onClick={() => { setGroupMp("wb"); setGroupMembers([]); }} className={`rounded px-3 py-1 text-xs font-semibold ${groupMp === "wb" ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}>Wildberries</button>
            <button type="button" onClick={() => { setGroupMp("ozon"); setGroupMembers([]); }} className={`rounded px-3 py-1 text-xs font-semibold ${groupMp === "ozon" ? "bg-white text-sky-700 shadow" : "text-gray-500"}`}>Ozon</button>
          </div>
        </div>
        <p className="mb-3 text-xs text-gray-400">Объедини несколько кабинетов в один пункт свитчера (например «Опт+Розница») — аналитика Закупок покажет их сумму.</p>

        {groups.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {groups.map((g) => (
              <div key={g.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <Layers3 className="h-3.5 w-3.5 text-gray-400" />
                <span className="font-medium text-gray-800">{g.name}</span>
                <span className="text-xs text-gray-400">{g.memberIds.length} кабинета</span>
                <button onClick={() => removeGroup(g.id, g.name)} className="ml-auto rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Удалить"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {cabinets.filter((c) => c.marketplace === groupMp).map((c) => (
            <label key={c.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <input type="checkbox" checked={groupMembers.includes(c.id)} onChange={() => toggleMember(c.id)} />
              {c.name}
            </label>
          ))}
        </div>
        {cabinets.filter((c) => c.marketplace === groupMp).length < 2 && (
          <p className="mt-2 text-xs text-gray-400">Нужно минимум 2 подключённых кабинета {groupMp === "wb" ? "WB" : "Ozon"}, чтобы собрать группу.</p>
        )}

        <div className="mt-3 flex items-center gap-3">
          <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Название группы"
            className="w-56 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
          <button onClick={createGroup} disabled={groupBusy || !groupName.trim() || groupMembers.length < 2}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
            {groupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Создать группу
          </button>
          {groupMsg && (
            <span className={`inline-flex items-center gap-1 text-sm ${groupMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
              {groupMsg.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {groupMsg.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
