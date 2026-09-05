"use client";

import { Loader2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * Команда кабинета — экран для главного пользователя организации.
 *
 * Раньше сотрудников заводил только владелец панели, и внешний селлер ждал его
 * ради каждого нового человека. Здесь он делает это сам, но в жёстких рамках:
 * только своя организация, только роль сотрудника, уровни только в своих
 * кабинетах. Всё это проверяет сервер — экран лишь не показывает лишнего.
 */
interface TeamUser { id: string; email: string; role: string; isActive: boolean }
interface TeamCabinet { id: string; name: string }
interface TeamAccess { userId: string; cabinetId: string; level: string }

export default function TeamPage() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [cabinets, setCabinets] = useState<TeamCabinet[]>([]);
  const [access, setAccess] = useState<Record<string, string>>({});
  const [me, setMe] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/wb/team", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Не удалось загрузить команду");
      setUsers(body.users ?? []);
      setCabinets(body.cabinets ?? []);
      setMe(body.me ?? "");
      setAccess(Object.fromEntries((body.access ?? []).map((a: TeamAccess) => [`${a.userId}|${a.cabinetId}`, a.level])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const send = async (payload: Record<string, unknown>, okText: string) => {
    const post = (data: Record<string, unknown>) => fetch("/api/wb/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    let response = await post(payload);
    let body = await response.json().catch(() => null);
    // Почта уже занята в своей же организации — развилка, а не отказ: либо
    // человек заведён и трогать его не нужно, либо доступ выдаётся заново.
    if (response.status === 409 && body?.exists) {
      if (!confirm(`${body.error}\n\nПерезаписать доступ?`)) return false;
      response = await post({ ...payload, replaceExisting: true });
      body = await response.json().catch(() => null);
    }
    if (!response.ok || !body?.ok) {
      setMsg({ ok: false, text: body?.error || "Не получилось" });
      return false;
    }
    setMsg({ ok: true, text: okText });
    return true;
  };

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changing, setChanging] = useState(false);

  const changePassword = async () => {
    setChanging(true);
    setMsg(null);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        setMsg({ ok: false, text: body?.error || "Не удалось сменить пароль" });
        return;
      }
      setMsg({ ok: true, text: "Пароль изменён" });
      setCurrentPassword("");
      setNewPassword("");
    } finally {
      setChanging(false);
    }
  };

  const create = async () => {
    setSaving(true);
    const ok = await send({ action: "create", email, password }, `Сотрудник ${email} сохранён`);
    setSaving(false);
    if (ok) { setEmail(""); setPassword(""); await load(); }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-[calc(5rem+var(--safe-b))] pt-6 md:pb-6">
      <h1 className="text-xl font-semibold text-slate-900">Команда кабинета</h1>
      <p className="mt-1 text-sm text-slate-500">
        Сотрудники вашей организации и их уровни доступа. Заводить людей и выдавать уровни
        может админ кабинета.
      </p>

      {msg ? (
        <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
          {msg.text}
        </div>
      ) : null}

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <UserPlus className="h-4 w-4 text-violet-600" aria-hidden="true" /> Новый сотрудник
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-[14rem] flex-1 text-xs font-medium text-slate-500">
            Почта сотрудника
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="почта"
              autoComplete="off"
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </label>
          <label className="min-w-[14rem] flex-1 text-xs font-medium text-slate-500">
            Пароль, не короче 10 символов
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="пароль, не короче 10 символов"
              autoComplete="new-password"
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void create()}
            disabled={saving || !email || password.length < 10}
            className="min-h-11 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
          >
            {saving ? "Сохраняем…" : "Добавить"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Пароль передайте лично или через менеджер паролей — не в переписке. Сотрудник
          сможет сменить его ниже, на этой же странице, после входа.
        </p>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Сменить свой пароль</h2>
        <p className="mt-1 text-xs text-slate-400">
          Пароль, который выдал админ, знает и он. Смените его на свой — новый нужен не
          короче десяти символов.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="текущий пароль"
            autoComplete="current-password"
            className="min-h-11 w-56 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-violet-400"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="новый пароль"
            autoComplete="new-password"
            className="min-h-11 w-56 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-violet-400"
          />
          <button
            type="button"
            onClick={changePassword}
            disabled={changing || !currentPassword || newPassword.length < 10}
            className="min-h-11 rounded-lg bg-slate-800 px-4 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
          >
            {changing ? "Меняем…" : "Сменить пароль"}
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          Сотрудники {!loading && `(${users.length})`}
        </div>
        {loading ? (
          <div className="py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : error ? (
          <div className="px-4 py-6 text-sm text-rose-600">{error}</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {users.map((user) => (
              <div key={user.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${user.isActive ? "bg-emerald-500" : "bg-slate-300"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{user.email}</div>
                    {user.id === me ? <div className="text-xs text-violet-600">это вы</div> : null}
                  </div>
                  {user.id === me ? null : (
                    <button
                      type="button"
                      onClick={async () => { if (await send({ action: "toggle", userId: user.id }, "Статус изменён")) await load(); }}
                      className="min-h-11 rounded-md border border-slate-200 px-3 text-xs text-slate-600 hover:bg-slate-100 lg:min-h-9"
                    >{user.isActive ? "Выключить" : "Включить"}</button>
                  )}
                </div>

                <div className="mt-2 space-y-1.5 pl-6">
                  {cabinets.map((cabinet) => {
                    const level = access[`${user.id}|${cabinet.id}`] ?? "";
                    const self = user.id === me;
                    return (
                      <div key={cabinet.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 basis-full truncate text-slate-600 sm:basis-auto">{cabinet.name}</span>
                        <select
                          value={level}
                          disabled={self}
                          title={self ? "Свой уровень изменить нельзя" : undefined}
                          onChange={async (event) => {
                            const next = event.target.value;
                            if (await send({ action: "level", userId: user.id, cabinetId: cabinet.id, level: next }, "Уровень сохранён")) {
                              setAccess((prev) => {
                                const copy = { ...prev };
                                const key = `${user.id}|${cabinet.id}`;
                                if (next) copy[key] = next; else delete copy[key];
                                return copy;
                              });
                            }
                          }}
                          className="min-h-11 rounded-md border border-slate-200 bg-white px-2 text-xs disabled:bg-slate-50 disabled:text-slate-400 lg:min-h-9"
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
            ))}
          </div>
        )}
      </section>

      <p className="mt-4 text-xs text-slate-400">
        <b>Менеджер кабинета</b> ведёт задачи, заметки и ярлыки. <b>Админ кабинета</b> — плюс
        ставки, статусы кампаний и цены, и может заводить сотрудников. Не задано — работает
        обычная роль сотрудника.
      </p>
    </div>
  );
}
