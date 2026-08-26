"use client";

import { useEffect, useState } from "react";
import { Loader2, Users as UsersIcon, Plus, Trash2 } from "lucide-react";

interface U { id: string; email: string; role: string; cabinet_ids: string[]; access_cabinet_ids?: string[]; is_active: boolean }
interface Cab { id: string; name: string; marketplace: string }
const ROLES = [["director", "Директор всей панели"], ["finance", "Финотдел/аналитик"], ["manager", "Менеджер МП"], ["seller", "Внешний селлер WB"], ["warehouse", "Оператор склада"]] as const;
const roleLabel = (r: string) => ROLES.find(([k]) => k === r)?.[1] ?? r;
/**
 * Кабинеты, в которых человеку есть что делать. Сервер считает их по роли:
 * у селлера доступ идёт через организацию, и собственный список кабинетов у
 * него пуст. Старый экран смотрел именно в него — и кнопка выдачи уровня у
 * селлера не появлялась вовсе.
 */
const accessCabs = (u: U) => (u.access_cabinet_ids ?? u.cabinet_ids ?? []);

export default function UsersPage() {
  const [users, setUsers] = useState<U[]>([]);
  const [cabs, setCabs] = useState<Cab[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("manager");
  const [sel, setSel] = useState<string[]>([]);
  /**
   * Уровни доступа по кабинетам: ключ «пользователь|кабинет».
   * Глобальная роль отвечает, КУДА пускать; уровень — ЧТО там можно.
   */
  const [access, setAccess] = useState<Record<string, string>>({});
  const [openAccess, setOpenAccess] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  /**
   * Подтверждение рядом со строкой, а не только вверху страницы.
   *
   * Уровень и роль сохраняются сразу при выборе, кнопки «Сохранить» здесь нет.
   * Экран при этом молчал и при успехе, и при отказе сервера — и отказ выглядел
   * ровно как «настройки не сохраняются». Особенно коварно, когда в соседней
   * вкладке вошли под другим пользователем: список остаётся на экране прежним,
   * а каждая запись возвращает 403.
   */
  const [rowMsg, setRowMsg] = useState<Record<string, { ok: boolean; t: string }>>({});
  const flash = (userId: string, ok: boolean, t: string) => {
    setRowMsg((prev) => ({ ...prev, [userId]: { ok, t } }));
    if (ok) setTimeout(() => setRowMsg((prev) => { const copy = { ...prev }; delete copy[userId]; return copy; }), 2500);
  };
  const denied = (status: number) => status === 401 || status === 403
    ? "Сессия сменилась — обновите страницу и войдите директором"
    : null;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const setLevel = async (userId: string, cabinetId: string, level: string) => {
    const response = await fetch("/api/users/cabinet-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, cabinetId, level }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) {
      flash(userId, false, denied(response.status) ?? body?.error ?? "Не удалось выдать уровень");
      return;
    }
    flash(userId, true, level === "lead" ? "админ кабинета сохранён" : level ? "уровень сохранён" : "уровень снят");
    setAccess((prev) => {
      const next = { ...prev };
      const key = `${userId}|${cabinetId}`;
      if (level) next[key] = level; else delete next[key];
      return next;
    });
  };

  const load = async () => {
    fetch("/api/users/cabinet-access", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : { access: [] })
      .then((b) => setAccess(Object.fromEntries((b.access ?? []).map((a: { userId: string; cabinetId: string; level: string }) => [`${a.userId}|${a.cabinetId}`, a.level]))))
      .catch(() => {});

    setLoading(true);
    const r = await fetch("/api/users", { cache: "no-store" });
    if (r.status === 403) { setForbidden(true); setLoading(false); return; }
    const j = await r.json();
    setUsers(j.users ?? []);
    setMe(j.me ?? null);
    const c = await fetch("/api/cabinets", { cache: "no-store" }).then((x) => x.json()).catch(() => ({ cabinets: [] }));
    setCabs(c.cabinets ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, role, cabinet_ids: role === "manager" ? sel : [] }),
    });
    const j = await r.json();
    if (!r.ok || j.error) setMsg({ ok: false, t: j.error || `Ошибка ${r.status}` });
    else { setMsg({ ok: true, t: `${role === "seller" ? "Внешний селлер" : "Сотрудник"} ${email} сохранён` }); setEmail(""); setPassword(""); setSel([]); await load(); }
    setBusy(false);
  };
  const patch = async (id: string, body: object) => {
    const response = await fetch(`/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const answer = await response.json().catch(() => null);
    if (!response.ok) flash(id, false, denied(response.status) ?? answer?.error ?? "Не удалось сохранить");
    else flash(id, true, "сохранено");
    await load();
  };
  const remove = async (id: string, em: string) => { if (confirm(`Удалить ${em}?`)) { await fetch(`/api/users/${id}`, { method: "DELETE" }); await load(); } };

  if (forbidden) return <div className="mx-auto max-w-2xl px-6 py-16 text-center text-gray-500">Раздел доступен только директору.</div>;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><UsersIcon className="h-5 w-5" /></div>
        <div><h1 className="text-2xl font-bold text-gray-900">Пользователи</h1><p className="text-sm text-gray-500">Сотрудники и внешние WB-селлеры</p></div>
      </div>

      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 text-sm font-semibold text-gray-700">Добавить пользователя</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="email" className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="пароль (≥10)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
            {ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {role === "seller" ? <div className="mt-2 rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-800">После первого входа селлер сам подключит свой WB-кабинет проверенным API-токеном.</div> : null}
        {role === "manager" && cabs.length > 0 && (
          <div className="mt-2">
            <div className="mb-1 text-xs text-gray-500">Кабинеты менеджера (пусто = все):</div>
            <div className="flex flex-wrap gap-1.5">
              {cabs.map((c) => {
                const on = sel.includes(c.id);
                return <button key={c.id} type="button" onClick={() => setSel((s) => on ? s.filter((x) => x !== c.id) : [...s, c.id])}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${on ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                  {c.marketplace === "ozon" ? "Ozon" : "WB"}: {c.name}</button>;
              })}
            </div>
          </div>
        )}
        <div className="mt-3 flex items-center gap-3">
          <button onClick={add} disabled={busy || !email || password.length < 10} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Сохранить
          </button>
          {msg && <span className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.t}</span>}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-700">Пользователи {!loading && `(${users.length})`}</div>
        {loading ? <div className="py-10 text-center text-gray-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          : <div className="divide-y divide-gray-100">
              {users.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${u.is_active ? "bg-emerald-500" : "bg-gray-300"}`} />
                  <div className="min-w-0 flex-1"><div className="font-medium text-gray-900">{u.email}</div><div className="text-xs text-gray-400">{roleLabel(u.role)}{(u.role === "manager" || u.role === "seller") && accessCabs(u).length ? ` · ${accessCabs(u).length} каб.` : ""}</div></div>
                  <select
                    value={u.role}
                    disabled={u.id === me}
                    title={u.id === me ? "Свою роль менять нельзя" : undefined}
                    onChange={(e) => {
                      // Директор всей панели видит все кабинеты и финансы всех
                      // юрлиц. Это не «главный в своём кабинете» — для этого
                      // ниже есть уровень «админ кабинета».
                      if (e.target.value === "director" && !confirm(
                        `${u.email} получит доступ ко ВСЕМ кабинетам и финансам всех юрлиц.\n\n` +
                        "Если нужен хозяин одного кабинета — закройте это окно и выдайте " +
                        "ему «админ кабинета» в «Доступ по кабинетам».",
                      )) { e.target.value = u.role; return; }
                      void patch(u.id, { role: e.target.value });
                    }}
                    className="rounded-md border border-gray-200 px-2 py-1 text-xs disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    {ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <button onClick={() => patch(u.id, { is_active: !u.is_active })} className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">{u.is_active ? "Выключить" : "Включить"}</button>
                  {accessCabs(u).length ? (
                    <button
                      onClick={() => setOpenAccess(openAccess === u.id ? null : u.id)}
                      className={`rounded-md px-2 py-1 text-xs ${openAccess === u.id ? "bg-violet-100 text-violet-700" : "text-gray-500 hover:bg-gray-100"}`}
                    >Доступ по кабинетам</button>
                  ) : null}
                  {rowMsg[u.id] ? (
                    <span className={`text-xs ${rowMsg[u.id].ok ? "text-emerald-600" : "text-red-600"}`}>{rowMsg[u.id].t}</span>
                  ) : null}
                  <button onClick={() => remove(u.id, u.email)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>

                  {openAccess === u.id ? (
                    <div className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3">
                      {/* Уровень задаётся на пару «сотрудник × кабинет». Пусто —
                          действует глобальная роль, а не запрет: снятие уровня
                          не должно отключать человека от работы. */}
                      <div className="mb-2 text-xs text-gray-500">
                        <b>Менеджер кабинета</b> ведёт задачи, заметки и ярлыки. <b>Админ кабинета</b> — плюс ставки,
                        статусы кампаний, цены и свои сотрудники. Власть только внутри этого кабинета:
                        соседние кабинеты и чужие юрлица ему не видны. Не задано — работает роль
                        «{roleLabel(u.role)}».
                      </div>
                      <div className="space-y-1.5">
                        {cabs.filter((c) => accessCabs(u).includes(c.id)).map((c) => {
                          const level = access[`${u.id}|${c.id}`] ?? "";
                          return (
                            <div key={c.id} className="flex items-center gap-2 text-xs">
                              <span className="min-w-0 flex-1 truncate text-gray-700">{c.name}</span>
                              <select
                                value={level}
                                onChange={(e) => void setLevel(u.id, c.id, e.target.value)}
                                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
                              >
                                <option value="">не задано</option>
                                <option value="manager">менеджер кабинета</option>
                                <option value="lead">админ кабинета</option>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>}
      </div>
    </div>
  );
}
