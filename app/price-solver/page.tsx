"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Calculator } from "lucide-react";

// Палитра infernoff (docs/design/inferno-tokens.css).
const C = {
  surface: "#FFFFFF", subtle2: "#F3F4F6", border: "#E5E7EB",
  textPrimary: "#111827", textSecondary: "#374151", textMuted: "#6B7280",
  teal: "#0A8888", violet: "#7C3AED", violetSurface: "#F4F1FE",
  pos: "#16A34A", neg: "#DC2626",
};

interface Target { margin: number; neededRevenue: number | null; neededCatalogPrice: number | null; deltaPct: number | null; reachable: boolean }
interface Item {
  nm: number; article: string; cogs: number | null; currentRevenue: number;
  currentCatalogPrice: number | null; currentMarginPct: number | null; targets: Target[];
}

const rub = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString("ru-RU")} ₽`);

export default function PriceSolverPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [margins, setMargins] = useState<number[]>([15, 25, 35]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/unit/price-solver?margins=15,25,35", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Ошибка"); }
      else { setItems(j.items ?? []); setMargins(j.margins ?? [15, 25, 35]); }
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ fontFamily: "var(--font-sans), Inter, system-ui, sans-serif", color: C.textPrimary, padding: "8px 4px 48px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
        <Calculator size={22} color={C.violet} />
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Решатель цены</h1>
        <span style={{ background: C.violetSurface, color: "#6D28D9", borderRadius: 10, fontSize: 12.8, fontWeight: 600, padding: "6px 10px" }}>
          цена под целевую маржу
        </span>
      </div>
      <p style={{ color: C.textMuted, fontSize: 13, margin: "0 0 16px" }}>
        Обратный расчёт: какая цена нужна под 15 / 25 / 35% маржи (МД к выручке) и Δ от текущей. Кормит margin_floor репрайсера.
      </p>

      {err && <div style={{ background: "#FEE2E2", color: C.neg, borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>{err}</div>}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.textMuted, padding: 40, justifyContent: "center" }}>
          <Loader2 size={18} className="animate-spin" /> Считаю…
        </div>
      ) : items.length === 0 ? (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 24, color: C.textMuted, fontSize: 14 }}>
          Нет данных. Нужны себестоимость (модуль «Себестоимость») и заказы по SKU.
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.8 }}>
            <thead>
              <tr style={{ background: C.subtle2, color: C.textMuted }}>
                <th style={{ padding: "9px 12px", fontWeight: 600, textAlign: "left", whiteSpace: "nowrap" }}>Артикул</th>
                <th style={{ padding: "9px 12px", fontWeight: 600, textAlign: "right" }}>Себест.</th>
                <th style={{ padding: "9px 12px", fontWeight: 600, textAlign: "right" }}>Выручка/ед</th>
                <th style={{ padding: "9px 12px", fontWeight: 600, textAlign: "right" }}>Тек. маржа</th>
                {margins.map((m) => (
                  <th key={m} style={{ padding: "9px 12px", fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" }}>под {m}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.nm} style={{ borderTop: `1px solid ${C.subtle2}` }}>
                  <td style={{ padding: "9px 12px", color: C.textPrimary }}>{it.article || it.nm}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", color: C.textSecondary }}>{rub(it.cogs)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", color: C.textSecondary }}>{rub(it.currentRevenue)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 600, color: it.currentMarginPct != null && it.currentMarginPct < 15 ? C.neg : C.textPrimary }}>
                    {it.currentMarginPct != null ? `${it.currentMarginPct}%` : "—"}
                  </td>
                  {margins.map((m) => {
                    const t = it.targets.find((x) => x.margin === m);
                    if (!t || !t.reachable) return <td key={m} style={{ padding: "9px 12px", textAlign: "right", color: C.textMuted }}>—</td>;
                    const price = t.neededCatalogPrice ?? t.neededRevenue;
                    const d = t.deltaPct;
                    return (
                      <td key={m} style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 600 }}>{rub(price)}</span>{" "}
                        {d != null && (
                          <span style={{ color: d > 0 ? C.pos : d < 0 ? C.neg : C.textMuted, fontSize: 11.5 }}>
                            ({d > 0 ? "+" : ""}{d}%)
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
