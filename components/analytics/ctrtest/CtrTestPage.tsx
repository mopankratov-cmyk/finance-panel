"use client";

import { BarChart2, ImagePlus, Plus, RefreshCw, Sparkles, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatPct, formatRub } from "@/lib/analytics/format";
import type { CtrTest } from "@/app/api/ctrtest/route";
import type { ContentProduct } from "@/app/api/content/route";

interface Analysis {
  openCard: number;
  cartRate: number | null;
  adViews: number;
  adCtr: number | null;
  adCpc: number | null;
  adCpm: number | null;
  recommendedCpm: number | null;
  recommendation: string;
  wbSource?: boolean;
  keywords?: { query: string; cpm: number | null }[];
}

export function CtrTestPage() {
  const [tests, setTests] = useState<CtrTest[]>([]);
  const [products, setProducts] = useState<ContentProduct[]>([]);
  const [article, setArticle] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<Record<number, Analysis>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ctrtest", { cache: "no-store" });
      const json = await res.json();
      setTests(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    fetch("/api/content").then((r) => r.json()).then((j) => setProducts(j.data ?? [])).catch(() => {});
  }, [load]);

  const createTest = async () => {
    const p = products.find((x) => x.article === article);
    if (!p?.nmId) return;
    await fetch("/api/ctrtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nm_id: p.nmId, article: p.article, name: p.name }),
    });
    load();
  };

  const addVariant = async (test: CtrTest, source: "card" | "generated") => {
    setBusy(test.id);
    try {
      await fetch("/api/ctrtest/variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_id: test.id, source, nmId: test.nm_id, article: test.article, name: test.name }),
      });
      load();
    } finally {
      setBusy(null);
    }
  };

  const setWinner = async (testId: number, id: number) => {
    await fetch("/api/ctrtest/variant", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, test_id: testId }),
    });
    load();
  };

  const delVariant = async (id: number) => {
    await fetch(`/api/ctrtest/variant?id=${id}`, { method: "DELETE" });
    load();
  };
  const delTest = async (id: number) => {
    if (!confirm("Удалить тест?")) return;
    await fetch(`/api/ctrtest?id=${id}`, { method: "DELETE" });
    load();
  };

  const runAnalysis = async (test: CtrTest) => {
    const res = await fetch(`/api/ctrtest/analysis?nmId=${test.nm_id}`);
    const json = await res.json();
    if (json.data) setAnalysis((a) => ({ ...a, [test.id]: json.data }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">CTR-тесты</h1>
          <p className="text-sm text-slate-400 mt-1">A/B обложек + анализ рекламы и рекомендация CPM</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Обновить
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <select value={article} onChange={(e) => setArticle(e.target.value)} className="rounded border border-slate-200 px-2 py-2 text-sm">
          <option value="">— артикул —</option>
          {products.filter((p) => p.nmId).map((p) => (
            <option key={p.article} value={p.article}>{p.article}{p.name ? ` · ${p.name}` : ""}</option>
          ))}
        </select>
        <button onClick={createTest} disabled={!article} className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
          <Plus className="h-4 w-4" /> Новый тест
        </button>
      </div>

      {tests.length === 0 && !loading && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Нет тестов. Создайте первый.</div>
      )}

      {tests.map((t) => {
        const a = analysis[t.id];
        return (
          <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-900">{t.article || t.nm_id}</p>
                <p className="text-xs text-slate-400">{t.name || `nmId ${t.nm_id}`}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => runAnalysis(t)} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                  <BarChart2 className="h-3.5 w-3.5" /> Анализ
                </button>
                <button onClick={() => delTest(t.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>

            {/* варианты */}
            <div className="mt-4 flex flex-wrap gap-3">
              {t.variants.map((v) => (
                <div key={v.id} className={`relative w-32 rounded-lg border p-1 ${v.is_winner ? "border-emerald-400" : "border-slate-200"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.image_url} alt={v.label ?? ""} className="h-40 w-full rounded object-cover" />
                  <div className="mt-1 flex items-center justify-between px-1">
                    <span className="text-xs font-semibold text-slate-600">{v.label}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setWinner(t.id, v.id)} title="Победитель" className={v.is_winner ? "text-emerald-500" : "text-slate-300 hover:text-emerald-500"}>
                        <Star className="h-3.5 w-3.5" fill={v.is_winner ? "currentColor" : "none"} />
                      </button>
                      <button onClick={() => delVariant(v.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex w-32 flex-col justify-center gap-2 rounded-lg border border-dashed border-slate-200 p-2">
                <button onClick={() => addVariant(t, "card")} disabled={busy === t.id} className="flex items-center justify-center gap-1 rounded bg-slate-50 py-2 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                  <ImagePlus className="h-3.5 w-3.5" /> из карточки
                </button>
                <button onClick={() => addVariant(t, "generated")} disabled={busy === t.id} className="flex items-center justify-center gap-1 rounded bg-violet-50 py-2 text-xs text-violet-700 hover:bg-violet-100 disabled:opacity-50">
                  <Sparkles className={`h-3.5 w-3.5 ${busy === t.id ? "animate-pulse" : ""}`} /> {busy === t.id ? "..." : "генерация"}
                </button>
              </div>
            </div>

            {/* анализ */}
            {a && (
              <div className="mt-4 rounded-lg bg-slate-50 p-4">
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>Показы карточки: <b>{a.openCard}</b></span>
                  <span>CV карточки: <b>{a.cartRate !== null ? formatPct(a.cartRate) : "—"}</b></span>
                  <span>Рекл. CTR: <b>{a.adCtr !== null ? formatPct(a.adCtr) : "—"}</b></span>
                  <span>CPC: <b>{a.adCpc !== null ? formatRub(a.adCpc) : "—"}</b></span>
                  <span>CPM: <b>{a.adCpm !== null ? formatRub(a.adCpm) : "—"}</b></span>
                </div>
                <p className="mt-2 text-sm text-violet-700">
                  <span className={`mr-1 rounded px-1.5 py-0.5 text-[10px] ${a.wbSource ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                    {a.wbSource ? "WB ставки" : "эвристика"}
                  </span>
                  💡 {a.recommendation}
                </p>
                {a.keywords && a.keywords.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-slate-400">Ключевые кластеры (рекоменд. CPM):</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {a.keywords.map((k, i) => (
                        <span key={i} className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600">
                          {k.query}{k.cpm ? ` · ${k.cpm}₽` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
