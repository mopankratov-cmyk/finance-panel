"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, Download, Tag } from "lucide-react";

// Палитра infernoff (склонирована с живых computed-стилей — см. docs/design/inferno-tokens.css).
const C = {
  pageBg: "#F7F8FA", surface: "#FFFFFF", subtle2: "#F3F4F6", border: "#E5E7EB",
  textPrimary: "#111827", textSecondary: "#374151", textMuted: "#6B7280",
  teal: "#0A8888", violet: "#7C3AED", violetSurface: "#F4F1FE",
  pos: "#16A34A", neg: "#DC2626", warn: "#F59E0B", orange: "#EA580C", greenStrong: "#4ADE80",
  greenBg: "#DCFCE7",
};

interface Strategy { id: number; name: string; action: string; amount: number; marginFloor: number; enabled: boolean }
interface DecMetrics { gmroi: number | null; margin: number | null; drr: number | null; stock: number; turnover: number | null }
interface Decision {
  nm_id: number; article: string | null; strategy_name: string | null;
  old_price: number | null; new_price: number | null; metrics: DecMetrics | null;
  status: string; note: string | null;
}
interface SignalItem { nm: number; signal: string }

const STRATEGY_DOT: Record<string, string> = {
  "Разгон GMROI": C.greenStrong, "Рост маржи": C.violet, "Скоро аут": C.warn, "ДРР позволяет": C.teal,
};
const SIGNAL_DOT: Record<string, string> = {
  "Контент": C.violet, "Конкуренты": C.neg, "Реклама": C.teal, "Остатки": C.warn, "ДРР": C.orange, "Маржа": C.pos,
};
const rub = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString("ru-RU")} ₽`);
const today = () => new Date().toISOString().slice(0, 10);

export default function RepricerPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [signals, setSignals] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [date] = useState(today());
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [st, dec, sig] = await Promise.all([
        fetch("/api/repricer/state", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/repricer/decisions?date=${date}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        fetch("/api/signals", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      ]);
      setStrategies(st.strategies ?? []);
      setDecisions(dec.decisions ?? []);
      const m = new Map<number, string>();
      for (const s of (sig.items ?? []) as SignalItem[]) m.set(s.nm, s.signal);
      setSignals(m);
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    }
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const run = async () => {
    setRunning(true);
    try {
      const r = await fetch("/api/repricer/run", { method: "POST" });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "Ошибка прогона");
      else await load();
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    }
    setRunning(false);
  };

  const proposed = decisions.filter((d) => d.status === "proposed");
  const chip = (bg: string, fg: string, text: string) => (
    <span style={{ background: bg, color: fg, borderRadius: 10, fontSize: 12.8, fontWeight: 600, padding: "6px 10px" }}>{text}</span>
  );

  return (
    <div style={{ fontFamily: "var(--font-sans), Inter, system-ui, sans-serif", color: C.textPrimary, padding: "8px 4px 48px" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
        <Tag size={22} color={C.violet} />
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Репрайсер</h1>
        {chip(C.violetSurface, "#6D28D9", `Стратегии (${strategies.length})`)}
        {chip(C.greenBg, C.pos, "Применение по подтверждению")}
      </div>
      <p style={{ color: C.textMuted, fontSize: 13, margin: "0 0 16px" }}>
        Движок правил меняет цену по марже / остатку / GMROI / ДРР. Прогон пишет предложения, применение — через XLSX.
      </p>

      {/* toolbar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={run} disabled={running}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.violet, color: "#fff", border: "none", borderRadius: 8, fontSize: 12.8, fontWeight: 600, padding: "9px 14px", cursor: "pointer", opacity: running ? 0.6 : 1 }}>
          {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Прогнать сейчас
        </button>
        <a href={`/api/repricer/export?date=${date}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.surface, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12.8, fontWeight: 600, padding: "9px 14px", textDecoration: "none" }}>
          <Download size={15} /> Скачать XLSX
        </a>
        <span style={{ marginLeft: "auto", color: C.textMuted, fontSize: 12.8 }}>
          прогон за {date} · предложений {proposed.length} из {decisions.length}
        </span>
      </div>

      {/* strategies row */}
      {strategies.length > 0 && (
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 14 }}>
          {strategies.map((s) => (
            <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: s.enabled ? C.textSecondary : C.textMuted }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: STRATEGY_DOT[s.name] ?? C.textMuted }} />
              {s.name} <span style={{ color: C.textMuted }}>· {s.action === "dec_pct" ? "−" : "+"}{s.amount}% · пол {s.marginFloor}%</span>
            </span>
          ))}
        </div>
      )}

      {err && <div style={{ background: "#FEE2E2", color: C.neg, borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>{err}</div>}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.textMuted, padding: 40, justifyContent: "center" }}>
          <Loader2 size={18} className="animate-spin" /> Загружаю…
        </div>
      ) : strategies.length === 0 ? (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 24, color: C.textMuted, fontSize: 14 }}>
          Стратегий нет. Примените миграцию <code style={{ color: C.teal }}>supabase/migrations/20260626_repricer.sql</code> (таблицы + сид-стратегии), затем нажмите «Прогнать сейчас».
        </div>
      ) : decisions.length === 0 ? (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 24, color: C.textMuted, fontSize: 14 }}>
          Прогонов за {date} нет. Нажмите «Прогнать сейчас».
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.8 }}>
            <thead>
              <tr style={{ background: C.subtle2, color: C.textMuted, textAlign: "right" }}>
                {["Артикул", "Стратегия", "Цена", "Новая", "Δ", "Маржа", "GMROI", "ДРР", "Остаток", "Сигнал"].map((h, i) => (
                  <th key={h} style={{ padding: "9px 12px", fontWeight: 600, textAlign: i === 0 || i === 1 || i === 9 ? "left" : "right", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => {
                const delta = d.old_price != null && d.new_price != null ? d.new_price - d.old_price : null;
                const sig = signals.get(d.nm_id);
                const m = d.metrics;
                return (
                  <tr key={d.nm_id} style={{ borderTop: `1px solid ${C.subtle2}` }}>
                    <td style={{ padding: "9px 12px", color: C.textPrimary }}>{d.article ?? d.nm_id}</td>
                    <td style={{ padding: "9px 12px" }}>
                      {d.strategy_name ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: STRATEGY_DOT[d.strategy_name] ?? C.textMuted }} />
                          {d.strategy_name}
                        </span>
                      ) : <span style={{ color: C.textMuted }}>—</span>}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>{rub(d.old_price)}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 600 }}>{rub(d.new_price)}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 600, color: delta == null ? C.textMuted : delta > 0 ? C.pos : delta < 0 ? C.neg : C.textMuted }}>
                      {delta == null ? "—" : delta > 0 ? `+${rub(delta)}` : rub(delta)}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: m?.margin != null && m.margin < 15 ? C.neg : C.textSecondary }}>{m?.margin != null ? `${m.margin}%` : "—"}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: C.textSecondary }}>{m?.gmroi != null ? `${m.gmroi}%` : "—"}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: C.textSecondary }}>{m?.drr != null ? `${m.drr}%` : "—"}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: C.textSecondary }}>{m?.stock ?? "—"}</td>
                    <td style={{ padding: "9px 12px" }}>
                      {sig ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.subtle2, color: C.textSecondary, borderRadius: 6, fontSize: 12, fontWeight: 600, padding: "2px 8px" }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: SIGNAL_DOT[sig] ?? C.textMuted }} />
                          {sig}
                        </span>
                      ) : <span style={{ color: C.textMuted }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
