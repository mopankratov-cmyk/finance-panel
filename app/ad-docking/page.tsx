"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Megaphone, Plus, Check, AlertTriangle } from "lucide-react";

// Палитра infernoff (docs/design/inferno-tokens.css).
const C = {
  surface: "#FFFFFF", subtle2: "#F3F4F6", border: "#E5E7EB",
  textPrimary: "#111827", textSecondary: "#374151", textMuted: "#6B7280",
  violet: "#7C3AED", violetSurface: "#F4F1FE",
  pos: "#16A34A", neg: "#DC2626", warn: "#F59E0B", greenBg: "#DCFCE7", yellowBg: "#FEF9C3",
};

interface Cfg {
  advert_id: number; name: string | null; cabinet: string | null; enabled: boolean;
  hours: number[] | null; amount_rub: number; threshold_rub: number;
}
interface LogRow { advert_id: number; hour: number | null; budget_before: number | null; amount: number | null; action: string; status: string; detail: string | null; created_at: string }

export default function AdDockingPage() {
  const [configs, setConfigs] = useState<Cfg[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [killSwitch, setKill] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [nw, setNw] = useState({ advertId: "", cabinet: "", hours: "8,17", amount: "1000", threshold: "300" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/adverts/dock", { cache: "no-store" });
      const j = await r.json();
      setConfigs(j.configs ?? []);
      setLog(j.log ?? []);
      setKill(!!j.killSwitch);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (advertId: number, patch: Record<string, unknown>) => {
    setSaving(advertId);
    try {
      await fetch("/api/adverts/dock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ advertId, ...patch }) });
      await load();
    } catch { /* ignore */ }
    setSaving(null);
  };

  const addCfg = async () => {
    const advertId = Number(nw.advertId);
    if (!advertId) return;
    await save(advertId, {
      cabinet: nw.cabinet || undefined,
      hours: nw.hours.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0 && n < 24),
      amountRub: Number(nw.amount) || 1000,
      thresholdRub: Number(nw.threshold) || 300,
    });
    setNw({ ...nw, advertId: "", cabinet: "" });
  };

  const inp = (w: number): React.CSSProperties => ({ width: w, fontSize: 12.8, padding: "6px 8px", border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSecondary });
  const enabledCount = configs.filter((c) => c.enabled).length;

  return (
    <div style={{ fontFamily: "var(--font-sans), Inter, system-ui, sans-serif", color: C.textPrimary, padding: "8px 4px 48px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
        <Megaphone size={22} color={C.violet} />
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Докидывание рекламы</h1>
        <span style={{ background: C.violetSurface, color: "#6D28D9", borderRadius: 10, fontSize: 12.8, fontWeight: 600, padding: "6px 10px" }}>включено РК: {enabledCount}</span>
        {killSwitch && <span style={{ background: C.yellowBg, color: C.warn, borderRadius: 6, fontSize: 12.8, fontWeight: 600, padding: "4px 8px" }}>kill-switch ON (ADVERT_DOCKING_OFF)</span>}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#FEF9C3", border: "1px solid #FDE68A", borderRadius: 10, padding: "10px 14px", margin: "8px 0 16px", fontSize: 13, color: "#92722A" }}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>Включение РК = разрешение на <b>авто-списание бюджета</b> по расписанию. Крон в окне проверяет бюджет и докидывает сумму, если он ниже порога. Глобальный стоп — env <code>ADVERT_DOCKING_OFF=1</code>.</span>
      </div>

      {/* add */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
        <input style={inp(120)} placeholder="advertId" value={nw.advertId} onChange={(e) => setNw({ ...nw, advertId: e.target.value })} />
        <input style={inp(110)} placeholder="кабинет id" value={nw.cabinet} onChange={(e) => setNw({ ...nw, cabinet: e.target.value })} />
        <input style={inp(110)} placeholder="окна 8,17" value={nw.hours} onChange={(e) => setNw({ ...nw, hours: e.target.value })} />
        <input style={inp(90)} placeholder="сумма" value={nw.amount} onChange={(e) => setNw({ ...nw, amount: e.target.value })} />
        <input style={inp(90)} placeholder="порог" value={nw.threshold} onChange={(e) => setNw({ ...nw, threshold: e.target.value })} />
        <button onClick={addCfg} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.violet, color: "#fff", border: "none", borderRadius: 8, fontSize: 12.8, fontWeight: 600, padding: "8px 12px", cursor: "pointer" }}>
          <Plus size={14} /> Добавить
        </button>
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.textMuted, padding: 40, justifyContent: "center" }}><Loader2 size={18} className="animate-spin" /> Загружаю…</div>
      ) : (
        <>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.8 }}>
              <thead><tr style={{ background: C.subtle2, color: C.textMuted, textAlign: "left" }}>
                {["РК (advertId)", "Кабинет", "Окна МСК", "Сумма ₽", "Порог ₽", "Статус", ""].map((h) => <th key={h} style={{ padding: "9px 12px", fontWeight: 600 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {configs.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 20, color: C.textMuted, textAlign: "center" }}>Пока нет настроенных РК. Добавь advertId выше.</td></tr>
                ) : configs.map((c) => (
                  <tr key={c.advert_id} style={{ borderTop: `1px solid ${C.subtle2}` }}>
                    <td style={{ padding: "9px 12px", color: C.textPrimary }}>{c.advert_id}{c.name ? <span style={{ color: C.textMuted }}> · {c.name}</span> : null}</td>
                    <td style={{ padding: "9px 12px", color: C.textSecondary }}>{c.cabinet ?? "—"}</td>
                    <td style={{ padding: "9px 12px", color: C.textSecondary }}>{(c.hours ?? []).join(", ") || "каждый час"}</td>
                    <td style={{ padding: "9px 12px", color: C.textSecondary }}>{c.amount_rub}</td>
                    <td style={{ padding: "9px 12px", color: C.textSecondary }}>{c.threshold_rub}</td>
                    <td style={{ padding: "9px 12px" }}>
                      <span style={{ background: c.enabled ? C.greenBg : C.subtle2, color: c.enabled ? C.pos : C.textMuted, borderRadius: 6, fontSize: 12, fontWeight: 600, padding: "2px 8px" }}>{c.enabled ? "включено" : "выключено"}</span>
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>
                      <button onClick={() => save(c.advert_id, { enabled: !c.enabled })} disabled={saving === c.advert_id}
                        style={{ background: c.enabled ? C.surface : C.pos, color: c.enabled ? C.neg : "#fff", border: `1px solid ${c.enabled ? C.border : "transparent"}`, borderRadius: 8, fontSize: 12, fontWeight: 600, padding: "6px 12px", cursor: "pointer" }}>
                        {saving === c.advert_id ? "…" : c.enabled ? "Выключить" : "Включить"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* log */}
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 8px", color: C.textSecondary }}>Лог докидываний</h2>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.8 }}>
              <thead><tr style={{ background: C.subtle2, color: C.textMuted, textAlign: "left" }}>
                {["Время", "РК", "Час", "Бюджет до", "+Сумма", "Действие", "Статус"].map((h) => <th key={h} style={{ padding: "9px 12px", fontWeight: 600 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {log.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 20, color: C.textMuted, textAlign: "center" }}>Пусто — крон ещё не докидывал.</td></tr>
                ) : log.map((l, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.subtle2}` }}>
                    <td style={{ padding: "8px 12px", color: C.textMuted }}>{l.created_at?.slice(5, 16).replace("T", " ")}</td>
                    <td style={{ padding: "8px 12px", color: C.textPrimary }}>{l.advert_id}</td>
                    <td style={{ padding: "8px 12px", color: C.textSecondary }}>{l.hour ?? "—"}</td>
                    <td style={{ padding: "8px 12px", color: C.textSecondary }}>{l.budget_before ?? "—"}</td>
                    <td style={{ padding: "8px 12px", color: C.textSecondary }}>{l.amount ?? "—"}</td>
                    <td style={{ padding: "8px 12px", color: C.textSecondary }}>{l.action}</td>
                    <td style={{ padding: "8px 12px", color: l.status === "ok" ? C.pos : l.status === "error" ? C.neg : C.textMuted }}>{l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
