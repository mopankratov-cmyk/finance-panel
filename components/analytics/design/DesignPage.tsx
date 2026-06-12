"use client";

import { Download, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { exportCsv, formatPct } from "@/lib/analytics/format";
import type { CardChange } from "@/app/api/design/route";
import type { ContentProduct } from "@/app/api/content/route";

const TYPES = [
  { key: "price", label: "Цена" },
  { key: "content", label: "Контент" },
  { key: "photo", label: "Фото" },
  { key: "seo", label: "SEO" },
  { key: "other", label: "Другое" },
];

function effectClass(p: number | null): string {
  if (p === null) return "text-slate-400";
  if (p > 5) return "text-emerald-600";
  if (p < -5) return "text-red-600";
  return "text-slate-500";
}

export function DesignPage() {
  const [rows, setRows] = useState<CardChange[]>([]);
  const [products, setProducts] = useState<ContentProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [article, setArticle] = useState("");
  const [type, setType] = useState("price");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/design", { cache: "no-store" });
      const json = await res.json();
      setRows(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    fetch("/api/content").then((r) => r.json()).then((j) => setProducts(j.data ?? [])).catch(() => {});
  }, [load]);

  const add = async () => {
    const p = products.find((x) => x.article === article);
    if (!p || !p.nmId) return;
    await fetch("/api/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nm_id: p.nmId, article: p.article, change_type: type, note }),
    });
    setNote("");
    load();
  };

  const del = async (id: number) => {
    await fetch(`/api/design?id=${id}`, { method: "DELETE" });
    load();
  };

  const exportPrices = async () => {
    const res = await fetch("/api/design/prices");
    const json = await res.json();
    if (json.error || !json.data) return;
    exportCsv(
      "prices.csv",
      ["Артикул", "nmID", "Текущая ср. цена ₽", "Новая цена ₽"],
      json.data.map((r: { article: string; nmId: number; avgPrice: number }) => [r.article, String(r.nmId), String(r.avgPrice), ""]),
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Дизайн · эффекты изменений</h1>
          <p className="text-sm text-slate-400 mt-1">Журнал правок карточек и их влияние на заказы (±7 дней)</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportPrices} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            <Download className="h-4 w-4" /> Экспорт цен CSV
          </button>
          <button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <select value={article} onChange={(e) => setArticle(e.target.value)} className="rounded border border-slate-200 px-2 py-2 text-sm">
          <option value="">— артикул —</option>
          {products.filter((p) => p.nmId).map((p) => (
            <option key={p.article} value={p.article}>{p.article}{p.name ? ` · ${p.name}` : ""}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded border border-slate-200 px-2 py-2 text-sm">
          {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="что изменили..." className="flex-1 min-w-[160px] rounded border border-slate-200 px-3 py-2 text-sm" />
        <button onClick={add} disabled={!article} className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
          <Plus className="h-4 w-4" /> Зафиксировать
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Дата</th>
              <th className="px-4 py-3">Артикул</th>
              <th className="px-4 py-3">Тип</th>
              <th className="px-4 py-3">Заметка</th>
              <th className="px-4 py-3 text-right">Заказы до</th>
              <th className="px-4 py-3 text-right">После</th>
              <th className="px-4 py-3 text-right">Эффект</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">{loading ? "Загрузка..." : "Пока нет записей"}</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 text-slate-500">{r.date}</td>
                <td className="px-4 py-2.5 font-medium text-slate-800">{r.article || r.nm_id}</td>
                <td className="px-4 py-2.5"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{TYPES.find((t) => t.key === r.change_type)?.label ?? r.change_type}</span></td>
                <td className="px-4 py-2.5 text-slate-600">{r.note || "—"}</td>
                <td className="px-4 py-2.5 text-right text-slate-500">{r.ordersBefore ?? "—"}</td>
                <td className="px-4 py-2.5 text-right text-slate-500">{r.ordersAfter ?? "—"}</td>
                <td className={`px-4 py-2.5 text-right font-medium ${effectClass(r.effectPct)}`}>
                  {r.effectPct !== null ? (r.effectPct > 0 ? "+" : "") + formatPct(r.effectPct) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right"><button onClick={() => del(r.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
