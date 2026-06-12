"use client";

import { Check, RefreshCw, Sparkles, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContentCard } from "@/app/api/content-cards/route";

interface Suggestion {
  title: string;
  description: string;
  keywords: string[];
}

export function SeoPage() {
  const [cards, setCards] = useState<ContentCard[]>([]);
  const [nmId, setNmId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [sug, setSug] = useState<Suggestion | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/content-cards", { cache: "no-store" });
      const json = await res.json();
      if (json.error) setMsg(json.error);
      else setCards(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const card = useMemo(() => cards.find((c) => c.nmId === nmId) ?? null, [cards, nmId]);

  const suggest = async () => {
    if (!card) return;
    setSuggesting(true);
    setSug(null);
    setMsg(null);
    try {
      const res = await fetch("/api/seo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest", nmId: card.nmId, article: card.article, title: card.title, description: card.description }),
      });
      const json = await res.json();
      if (json.error) setMsg(json.error);
      else setSug(json.data);
    } catch {
      setMsg("Ошибка генерации");
    } finally {
      setSuggesting(false);
    }
  };

  const apply = async () => {
    if (!card || !sug) return;
    if (!confirm(`Применить новый SEO-текст к карточке ${card.article} на Wildberries?`)) return;
    setApplying(true);
    setMsg(null);
    try {
      const res = await fetch("/api/seo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", nmId: card.nmId, title: sug.title, description: sug.description }),
      });
      const json = await res.json();
      if (json.error) setMsg(json.error);
      else { setMsg("✓ Применено. Изменения появятся на WB после модерации."); load(); }
    } catch {
      setMsg("Ошибка применения");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">SEO карточек</h1>
          <p className="text-sm text-slate-400 mt-1">AI-улучшение заголовка и описания + применение на WB</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Обновить
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <select value={nmId ?? ""} onChange={(e) => { setNmId(Number(e.target.value) || null); setSug(null); setMsg(null); }} className="min-w-[260px] rounded border border-slate-200 px-2 py-2 text-sm">
          <option value="">— карточка —</option>
          {cards.map((c) => <option key={c.nmId} value={c.nmId}>{c.article} · {c.title.slice(0, 40)}</option>)}
        </select>
        <button onClick={suggest} disabled={!card || suggesting} className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
          <Sparkles className={`h-4 w-4 ${suggesting ? "animate-pulse" : ""}`} /> {suggesting ? "Улучшаю..." : "AI улучшить SEO"}
        </button>
      </div>

      {msg && <div className={`rounded-lg border p-3 text-sm ${msg.startsWith("✓") ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{msg}</div>}

      {card && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* текущее */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="mb-2 text-xs uppercase text-slate-400">Сейчас</p>
            <p className="font-medium text-slate-800">{card.title}</p>
            <p className="mt-1 text-xs text-slate-400">{card.titleLen} симв</p>
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{card.description}</p>
            <p className="mt-1 text-xs text-slate-400">{card.descLen} симв</p>
          </div>
          {/* предложение */}
          <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs uppercase text-violet-500">AI-предложение</p>
              {sug && (
                <button onClick={apply} disabled={applying} className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50">
                  {applying ? <Check className="h-3.5 w-3.5 animate-pulse" /> : <Upload className="h-3.5 w-3.5" />} Применить на WB
                </button>
              )}
            </div>
            {!sug ? (
              <p className="text-sm text-slate-400">Нажмите «AI улучшить SEO»</p>
            ) : (
              <>
                <p className="font-medium text-slate-800">{sug.title}</p>
                <p className="mt-1 text-xs text-slate-400">{sug.title.length} симв</p>
                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{sug.description}</p>
                <p className="mt-1 text-xs text-slate-400">{sug.description.length} симв</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {sug.keywords.map((k, i) => <span key={i} className="rounded-full bg-white px-2 py-0.5 text-xs text-violet-700">{k}</span>)}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
