"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Eye,
  KeyRound,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWbCabinet } from "./WbCabinetContext";

type ScopeKey = "statistics" | "analytics" | "advert" | "content" | "prices" | "feedbacks";
type ScopeStatus = Record<ScopeKey, boolean | null>;

interface ConnectedCabinet {
  id: string;
  name: string;
  trade_mark?: string | null;
  inn?: string | null;
  token_mask: string;
  is_active: boolean;
  created_at?: string;
}

interface ConnectResponse {
  ok?: boolean;
  error?: string;
  cabinet?: { id: string; name: string; token_mask: string };
  scopes?: ScopeStatus;
  expires_at?: string | null;
  days_left?: number | null;
  sync_queued?: boolean;
}

const SCOPE_LABELS: Record<ScopeKey, { label: string; required: boolean }> = {
  statistics: { label: "Статистика и продажи", required: true },
  analytics: { label: "Аналитика и воронка", required: true },
  advert: { label: "Продвижение и реклама", required: true },
  content: { label: "Карточки товаров", required: true },
  prices: { label: "Цены и скидки", required: true },
  feedbacks: { label: "Отзывы и вопросы", required: true },
};

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
  return body;
}

export function WbConnectPage() {
  const { refreshCabinets } = useWbCabinet();
  const [cabinets, setCabinets] = useState<ConnectedCabinet[]>([]);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectResponse | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await fetch("/api/cabinets/self-service", { cache: "no-store" })
        .then((response) => responseJson<{ cabinets?: ConnectedCabinet[] }>(response));
      setCabinets(body.cabinets ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить кабинеты");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const connect = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token.trim() || saving) return;
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/cabinets/self-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), name: name.trim() }),
      });
      const body = await response.json().catch(() => ({})) as ConnectResponse;
      setResult(body);
      if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
      setToken("");
      setShowToken(false);
      await load();
      refreshCabinets();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось подключить WB");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] px-3 py-5 pb-20 sm:px-6 md:pb-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700"><KeyRound className="h-5 w-5" /></div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Подключение Wildberries</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Добавьте API-токен своего кабинета. Система проверит доступы, сохранит токен в закрытом хранилище и запустит первичную загрузку аналитики.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <Info icon={LockKeyhole} title="Токен скрыт" text="После сохранения показываем только последние 4 символа" />
            <Info icon={Eye} title="Только аналитика" text="Нет изменения цен, карточек и рекламных кампаний" />
            <Info icon={ShieldCheck} title="Изоляция данных" text="Доступ только к кабинетам вашей организации" />
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
          <form onSubmit={connect} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">Добавить кабинет</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">В кабинете WB создайте токен с доступом на чтение: статистика, аналитика, продвижение, контент, цены и скидки, вопросы и отзывы.</p>
            <label className="mt-5 block text-xs font-semibold text-slate-600">Название кабинета <span className="font-normal text-slate-400">(необязательно)</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Например, Магазин одежды" className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
            </label>
            <label className="mt-4 block text-xs font-semibold text-slate-600">API-токен WB
              <div className="relative mt-2">
                <textarea value={token} onChange={(event) => setToken(event.target.value)} required spellCheck={false} autoComplete="off" rows={5} placeholder="Вставьте токен из кабинета продавца Wildberries" className={`w-full resize-none rounded-xl border border-slate-200 px-3 py-3 pr-12 font-mono text-xs leading-5 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 ${showToken ? "" : "text-security-disc"}`} style={showToken ? undefined : { WebkitTextSecurity: "disc" } as React.CSSProperties} />
                <button type="button" onClick={() => setShowToken((value) => !value)} aria-label={showToken ? "Скрыть токен" : "Показать токен"} className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"><Eye className="h-4 w-4" /></button>
              </div>
            </label>
            {error ? <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
            {error && result?.scopes ? <ScopeGrid scopes={result.scopes} /> : null}
            <button type="submit" disabled={!token.trim() || saving} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {saving ? "Проверяем доступы…" : "Проверить и подключить"}
            </button>
            <p className="mt-3 text-center text-[11px] leading-4 text-slate-400">Проверка категорий API может занять до минуты. Не закрывайте страницу.</p>
          </form>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-bold text-slate-900">Подключённые кабинеты</h2><p className="mt-1 text-xs text-slate-500">{cabinets.length ? `${cabinets.length} активных подключений` : "Пока нет подключений"}</p></div><button type="button" onClick={() => void load()} disabled={loading} aria-label="Обновить список" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button></div>
            <div className="mt-4 space-y-2">
              {loading ? <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Загружаем…</div> : cabinets.length === 0 ? <div className="grid min-h-32 place-items-center rounded-xl border border-dashed border-slate-200 text-center text-sm text-slate-400">Добавьте первый WB-кабинет</div> : cabinets.map((cabinet) => (
                <article key={cabinet.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-800">{cabinet.name}</div><div className="mt-1 text-[11px] text-slate-400">{cabinet.trade_mark || "Wildberries"}{cabinet.inn ? ` · ИНН ${cabinet.inn}` : ""}</div></div><span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">Активен</span></div>
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-500"><span className="font-mono">{cabinet.token_mask}</span><Link href={`/wb/rnp?cabinet=${encodeURIComponent(cabinet.id)}`} className="inline-flex min-h-11 items-center font-semibold text-violet-700 transition-colors hover:text-violet-800">Открыть аналитику →</Link></div>
                </article>
              ))}
            </div>
          </section>
        </div>

        {result?.ok && result.cabinet ? <section role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><div className="min-w-0 flex-1"><h2 className="font-bold text-emerald-900">Кабинет «{result.cabinet.name}» подключён</h2><p className="mt-1 text-xs leading-5 text-emerald-800">{result.sync_queued ? "Первичная синхронизация запущена. Первые показатели появятся постепенно в течение нескольких минут." : "Кабинет сохранён. Автоматическая синхронизация возьмёт его в ближайший плановый запуск."}</p>
            {result.expires_at ? <p className="mt-1 flex items-center gap-1 text-xs text-emerald-800"><Clock3 className="h-3.5 w-3.5" />Токен действует до {new Date(result.expires_at).toLocaleDateString("ru-RU")}{result.days_left != null ? ` · ${result.days_left} дн.` : ""}</p> : null}
            {result.scopes ? <ScopeGrid scopes={result.scopes} /> : null}
            <Link href={`/wb/rnp?cabinet=${encodeURIComponent(result.cabinet.id)}`} className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-700 px-4 text-xs font-semibold text-white hover:bg-emerald-800">Перейти в аналитику</Link>
          </div></div>
        </section> : null}
      </div>
    </div>
  );
}

function Info({ icon: Icon, title, text }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string }) {
  return <div className="rounded-xl bg-slate-50 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Icon className="h-4 w-4 text-violet-600" />{title}</div><p className="mt-1 text-[11px] leading-4 text-slate-500">{text}</p></div>;
}

function ScopeGrid({ scopes }: { scopes: ScopeStatus }) {
  return <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{(Object.keys(SCOPE_LABELS) as ScopeKey[]).map((scope) => {
    const value = scopes[scope];
    const meta = SCOPE_LABELS[scope];
    return <div key={scope} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${value === true ? "border-emerald-200 bg-white text-emerald-800" : value === false ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}><span className={`h-2 w-2 rounded-full ${value === true ? "bg-emerald-500" : value === false ? "bg-rose-500" : "bg-amber-500"}`} /><span>{meta.label}</span>{meta.required ? <span className="ml-auto text-[9px] uppercase opacity-60">нужно</span> : null}</div>;
  })}</div>;
}
