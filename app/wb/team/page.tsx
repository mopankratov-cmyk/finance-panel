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
    const response = await fetch("/api/wb/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) {
      setMsg({ ok: false, text: body?.error || "Не получилось" });
      return false;
    }
    setMsg({ ok: true, text: okText });
    return true;
  };

  const create = async () => {
    setSaving(true);
    const ok = await send({ action: "create", email, password }, `Сотрудник ${email} сохранён`);
    setSaving(false);
    if (ok) { setEmail(""); setPassword(""); await load(); }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold text-slate-900">Команда кабинета</h1>
      <p className="mt-1 text-sm text-slate-500">
        Сотрудники вашей организации и их уровни доступа. Заводить людей и выдавать уровни
        может руководитель кабинета.
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
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="почта"
            className="min-w-[14rem] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="пароль, не короче 10 символов"
            className="min-w-[14rem] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={saving || !email || password.length < 10}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
          >
            {saving ? "Сохраняем…" : "Добавить"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Пароль передайте лично или через менеджер паролей — не в переписке. Сотрудник
          сможет сменить его после входа.
        </p>
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
                      className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                    >{user.isActive ? "Выключить" : "Включить"}</button>
                  )}
                </div>

                <div className="mt-2 space-y-1.5 pl-6">
                  {cabinets.map((cabinet) => {
                    const level = access[`${user.id}|${cabinet.id}`] ?? "";
                    const self = user.id === me;
                    return (
                      <div key={cabinet.id} className="flex items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate text-slate-600">{cabinet.name}</span>
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
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs disabled:bg-slate-50 disabled:text-slate-400"
                        >
                          <option value="">не задано</option>
                          <option value="manager">менеджер</option>
                          <option value="lead">руководитель</option>
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
        <b>Менеджер</b> ведёт задачи, заметки и ярлыки. <b>Руководитель</b> — плюс ставки,
        статусы кампаний и цены, и может заводить сотрудников. Не задано — работает
        обычная роль сотрудника.
      </p>
    </div>
  );
}
