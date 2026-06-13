"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, BarChart3 } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-gray-50"><Loader2 className="h-6 w-6 animate-spin text-violet-600" /></div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [firstRun, setFirstRun] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/status", { cache: "no-store" }).then((r) => r.json()).then((j) => setFirstRun(!j.hasUsers)).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || `Ошибка ${r.status}`); return; }
      const from = sp.get("from");
      router.push(from && from !== "/login" ? from : "/");
      router.refresh();
    } catch (e2) { setErr("Сеть: " + String(e2)); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600 text-white"><BarChart3 className="h-5 w-5" /></div>
          <div>
            <div className="text-lg font-bold text-gray-900">Финансы МП</div>
            <div className="text-xs text-gray-500">{firstRun ? "Создание аккаунта директора" : "Вход в панель"}</div>
          </div>
        </div>
        {firstRun && (
          <div className="mb-4 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-700">
            Первый запуск. Задайте свои email и пароль — будет создан аккаунт <b>директора</b> (полный доступ). Дальше добавите сотрудников в разделе «Сотрудники».
          </div>
        )}
        <label className="mb-1 block text-xs text-gray-500">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
          className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500" />
        <label className="mb-1 block text-xs text-gray-500">{firstRun ? "Придумайте пароль (≥6)" : "Пароль"}</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={firstRun ? "new-password" : "current-password"}
          className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500" />
        {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}
        <button type="submit" disabled={busy || !email || !password}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {firstRun ? "Создать директора и войти" : "Войти"}
        </button>
      </form>
    </div>
  );
}
