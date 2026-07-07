"use client";

import { useEffect, useState } from "react";
import { Loader2, Megaphone, Wallet, ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";

interface Day { ts: string; spend: number; clicks: number; views: number; orders: number }
interface Campaign {
  id: number; name: string; status: number; enabled: boolean;
  budget: number; spend_today: number; drr: number | null; days: Day[];
}
interface Article { nm: number; art: string; photo: string; spend: number; campaigns: Campaign[] }
interface AdvData {
  ok: boolean; error?: string; cabinet: string; articles: Article[]; count: number;
  cap_rub: number; balance: number | null; spend_today_total: number; spend_yest_total: number;
  today: string; yest: string;
}

const rub = (n: number) => Math.round(n).toLocaleString("ru-RU") + " ₽";

function drrTone(drr: number | null): [string, string] {
  if (drr == null) return ["bg-gray-100", "text-gray-400"];
  if (drr <= 10) return ["bg-emerald-100", "text-emerald-700"];
  if (drr <= 20) return ["bg-amber-100", "text-amber-700"];
  return ["bg-rose-100", "text-rose-700"];
}

function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const rng = max - min || 1;
  const w = 120, h = 28;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / rng) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-24" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}

function ArticleCard({ a }: { a: Article }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 p-3 text-left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.photo} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg bg-gray-100 object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-900">{a.art}</div>
          <div className="text-xs text-gray-400">{a.campaigns.length} {a.campaigns.length === 1 ? "кампания" : "кампаний"} · nm {a.nm}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold tabular-nums text-gray-900">{rub(a.spend)}</div>
          <div className="text-[11px] text-gray-400">сегодня</div>
        </div>
        <ChevronRight className={`h-4 w-4 shrink-0 text-gray-300 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-1 border-t border-gray-100 px-3 py-2">
          {a.campaigns.map((c) => {
            const [bg, fg] = drrTone(c.drr);
            return (
              <div key={c.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50">
                <span className={`h-2 w-2 shrink-0 rounded-full ${c.enabled ? "bg-emerald-500" : "bg-gray-300"}`} title={c.enabled ? "Активна" : "Пауза"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-gray-800">{c.name}</div>
                  <div className="text-[11px] text-gray-400">бюджет {rub(c.budget)}</div>
                </div>
                <Spark data={c.days.map((d) => d.spend)} />
                <div className="w-20 text-right text-sm font-semibold tabular-nums text-gray-900">{rub(c.spend_today)}</div>
                <span className={`w-16 rounded-md px-2 py-0.5 text-center text-xs font-semibold tabular-nums ${bg} ${fg}`}>
                  {c.drr == null ? "—" : `${c.drr}%`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdvertsPage() {
  const [cabId, setCabId] = useActiveCabinet("wb");
  const [data, setData] = useState<AdvData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    fetch(`/api/adverts/list${cabId ? `?cabinet=${cabId}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: AdvData) => { if (!d.ok) setErr(d.error || "Ошибка загрузки"); else setData(d); })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [cabId]);

  const deltaPct = data && data.spend_yest_total > 0
    ? Math.round(((data.spend_today_total - data.spend_yest_total) / data.spend_yest_total) * 100)
    : null;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Megaphone className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Реклама WB</h1>
            <p className="text-xs text-gray-500">{data ? `${data.cabinet} · расход за ${data.today || "сегодня"}` : "рекламный кабинет"}</p>
          </div>
          <div className="ml-auto">
            <CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {loading ? (
          <div className="py-20 text-center text-gray-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>
        ) : data ? (
          <>
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Расход сегодня" value={rub(data.spend_today_total)} tone="text-violet-700"
                sub={deltaPct == null ? undefined : (
                  <span className={`inline-flex items-center gap-0.5 ${deltaPct > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {deltaPct > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(deltaPct)}% к вчера
                  </span>
                )} />
              <Kpi label="Расход вчера" value={rub(data.spend_yest_total)} />
              <Kpi label="Баланс продвижения" value={data.balance == null ? "—" : rub(data.balance)}
                sub={data.balance == null ? "выберите кабинет" : (data.balance < data.cap_rub ? <span className="text-rose-600">ниже порога {rub(data.cap_rub)}</span> : "ок")} />
              <Kpi label="Активных кампаний" value={String(data.count)} />
            </div>

            {data.articles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
                <Wallet className="mx-auto mb-2 h-6 w-6 text-gray-300" />
                <div className="text-sm text-gray-500">Нет активных РК за период. Проверьте, что реклама синхронизирована по кабинету.</div>
              </div>
            ) : (
              <div className="space-y-2">
                {data.articles.map((a) => <ArticleCard key={a.nm} a={a} />)}
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
