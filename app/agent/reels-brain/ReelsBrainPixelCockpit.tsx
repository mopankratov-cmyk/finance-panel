"use client";

import { useEffect, useMemo, useState } from "react";

type AnyRecord = Record<string, any>;

const NICHES = "ru_toys,ru_clothing,ru_cosmetics";
const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmt(value: unknown) {
  const num = n(value);
  return new Intl.NumberFormat("ru-RU").format(Math.round(num));
}

function usd(value: unknown) {
  const num = n(value);
  if (!num) return "—";
  return `$${num.toFixed(num < 1 ? 2 : 1)}`;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    return res.ok ? json as T : null;
  } catch {
    return null;
  }
}

function SectionTitle({ n, eyebrow, title, danger = false }: { n: string; eyebrow: string; title: string; danger?: boolean }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ font: "600 11px/1 'JetBrains Mono'", letterSpacing: ".16em", color: danger ? "#be123c" : "#0891b2", textTransform: "uppercase" }}>{n} · {eyebrow}</div>
      <h2 style={{ font: "600 30px/1.15 'Space Grotesk'", letterSpacing: "-.01em", margin: "9px 0 0", color: "#0f172a" }}>{title}</h2>
    </div>
  );
}

function MiniIcon({ children, bg, fg }: { children: React.ReactNode; bg: string; fg: string }) {
  return (
    <div style={{ width: 32, height: 32, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center", color: fg, flex: "0 0 auto" }}>
      {children}
    </div>
  );
}

function Gauge({ score, confidence }: { score: number; confidence: string }) {
  const circumference = 2 * Math.PI * 120;
  const dash = `${(circumference * score / 100).toFixed(1)} ${circumference.toFixed(1)}`;
  const conf = confidence === "high"
    ? { bg: "rgba(16,185,129,.14)", bd: "rgba(16,185,129,.36)", dot: "#34d399", fg: "#6ee7b7" }
    : confidence === "medium"
      ? { bg: "rgba(245,158,11,.13)", bd: "rgba(245,158,11,.34)", dot: "#fbbf24", fg: "#fcd34d" }
      : { bg: "rgba(225,29,72,.13)", bd: "rgba(225,29,72,.34)", dot: "#fb7185", fg: "#fda4af" };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", animation: "rbFloatOrb 7s ease-in-out infinite" }}>
      <div style={{ position: "relative", width: 300, height: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", inset: 38, borderRadius: "50%", background: "radial-gradient(circle,rgba(34,211,238,.35),rgba(16,185,129,.08) 60%,transparent 72%)", filter: "blur(12px)", animation: "rbPulseGlow 4.5s ease-in-out infinite" }} />
        <svg width="300" height="300" viewBox="0 0 300 300" style={{ position: "relative", transform: "rotate(-90deg)" }}>
          <circle cx="150" cy="150" r="120" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="16" />
          <circle cx="150" cy="150" r="120" fill="none" stroke="url(#rbGaugeGrad)" strokeWidth="16" strokeLinecap="round" strokeDasharray={dash} strokeDashoffset="0" />
          <defs>
            <linearGradient id="rbGaugeGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#22d3ee" />
              <stop offset="1" stopColor="#34d399" />
            </linearGradient>
          </defs>
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ font: "500 10px/1 'JetBrains Mono'", letterSpacing: ".18em", color: "#7dd3fc", textTransform: "uppercase" }}>Понимание</div>
          <div style={{ font: "600 62px/1 'Space Grotesk'", color: "#f1f6fb", marginTop: 6 }}>{score}<span style={{ fontSize: 26, color: "#7f97ad" }}>%</span></div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 12, padding: "5px 12px", borderRadius: 999, background: conf.bg, border: `1px solid ${conf.bd}` }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: conf.dot }} />
            <span style={{ font: "600 11px/1 'JetBrains Mono'", color: conf.fg, textTransform: "uppercase", letterSpacing: ".04em" }}>уверенность · {confidence}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReelsBrainPixelCockpit() {
  const [learning, setLearning] = useState<AnyRecord | null>(null);
  const [media, setMedia] = useState<AnyRecord | null>(null);
  const [director, setDirector] = useState<AnyRecord | null>(null);
  const [worker, setWorker] = useState<AnyRecord | null>(null);
  const [backlog, setBacklog] = useState<AnyRecord | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      const [learningData, mediaData, directorData, workerData, backlogData] = await Promise.all([
        getJson<AnyRecord>(`/api/factory/reels-brain/learning-economics?niches=${encodeURIComponent(NICHES)}`),
        getJson<AnyRecord>(`/api/factory/reels-brain/media-intelligence?niches=${encodeURIComponent(NICHES)}&limit_per_niche=500`),
        getJson<AnyRecord>(`/api/factory/reels-brain/content-director?niches=${encodeURIComponent(NICHES)}&limit_per_niche=500`),
        getJson<AnyRecord>("/api/factory/worker-state"),
        getJson<AnyRecord>(`/api/factory/jobs/reels-brain-analyze-backlog?niches=${encodeURIComponent(NICHES)}&platforms=tiktok,instagram,youtube&max_lanes=9&limit=18`),
      ]);
      if (!alive) return;
      setLearning(learningData);
      setMedia(mediaData);
      setDirector(directorData);
      setWorker(workerData);
      setBacklog(backlogData);
    }
    void load();
    return () => { alive = false; };
  }, []);

  const data = useMemo(() => {
    const learningTotals = learning?.totals || {};
    const mediaSummary = media?.summary || {};
    const dna = media?.creative_dna_insights || {};
    const q = director?.quality_monitor || {};
    const lanes = Array.isArray(backlog?.lanes) ? backlog.lanes : [];
    const backlogTotal = lanes.reduce((sum: number, row: AnyRecord) => sum + n(row.total), 0);
    const backlogAnalyzed = lanes.reduce((sum: number, row: AnyRecord) => sum + n(row.analyzed), 0);
    const backlogUnanalyzed = lanes.reduce((sum: number, row: AnyRecord) => sum + n(row.unanalyzed), 0);
    const corpus = Math.max(n(learningTotals.total_videos), backlogTotal, n(q.total));
    const analyzed = Math.max(n(learningTotals.analyzed_videos), backlogAnalyzed);
    const ready = n(mediaSummary.ready);
    const av = n(mediaSummary.media_probe_ok);
    const feature = n(dna.feature_probed_videos);
    const generatorReady = n(learningTotals.generator_ready_patterns);
    const score = Math.min(100, Math.round(
      Math.min(100, corpus / 100) * .18
      + (corpus ? analyzed / corpus * 100 : 0) * .20
      + (corpus ? ready / corpus * 100 : 0) * .12
      + (ready ? av / ready * 100 : 0) * .18
      + (ready ? feature / ready * 100 : 0) * .18
      + Math.min(100, generatorReady * 2) * .14
    ));
    const confidence = score >= 70 ? "high" : score >= 42 ? "medium" : "low";
    const topHooks = learning?.insights?.top_hooks || [];
    const recipes = learning?.insights?.recipes || [];
    const retentions = learning?.insights?.retention_mechanics || [];
    const formats = learning?.insights?.winning_formats || [];
    const today = learning?.daily_costs?.today || {};
    const yesterday = learning?.daily_costs?.yesterday || {};
    const layers = director?.layers || [];
    const workerRow = (worker?.workers || []).find((w: AnyRecord) => w.worker_id === "railway-reels-brain-offline") || worker?.worker || {};
    const lastSeen = workerRow.last_seen ? Math.max(0, Math.round((Date.now() - Date.parse(workerRow.last_seen)) / 60000)) : null;
    return { learningTotals, mediaSummary, dna, q, corpus, analyzed, backlogUnanalyzed, ready, av, feature, generatorReady, score, confidence, topHooks, recipes, retentions, formats, today, yesterday, layers, workerRow, lastSeen };
  }, [learning, media, director, worker, backlog]);

  const heroStats = [
    { value: fmt(data.corpus), label: "видео в корпусе", color: "#f1f6fb" },
    { value: fmt(data.analyzed), label: "в памяти", color: "#5eead4" },
    { value: fmt(data.feature), label: "creative DNA", color: "#7dd3fc" },
    { value: fmt(data.generatorReady), label: "brief-ready", color: "#fbbf24" },
  ];
  const funnel = [
    { name: "Сырой корпус", count: data.corpus, pct: Math.min(100, Math.round(data.corpus / 100)), note: "Все найденные ролики из TikTok / Reels / Shorts, которые попали в слой насмотренности.", color: "#0f172a", bg: "linear-gradient(90deg,#22d3ee,#34d399)", status: "live" },
    { name: "Pattern Memory", count: data.analyzed, pct: data.corpus ? Math.round(data.analyzed / data.corpus * 100) : 0, note: "Видео, разобранные в хуки, структуру, удержание и паттерны.", color: "#059669", bg: "#10b981", status: "memory" },
    { name: "Direct MP4", count: data.ready, pct: data.corpus ? Math.round(data.ready / data.corpus * 100) : 0, note: "Ролики, где есть прямой mp4/audio asset для глубокого анализа.", color: "#0891b2", bg: "#22d3ee", status: "asset" },
    { name: "Audio / Visual", count: data.av, pct: data.ready ? Math.round(data.av / data.ready * 100) : 0, note: "FFmpeg-пробы: звук, вертикальность, длительность, монтаж, громкость.", color: "#2563eb", bg: "#60a5fa", status: "av" },
    { name: "Creative DNA", count: data.feature, pct: data.ready ? Math.round(data.feature / data.ready * 100) : 0, note: "Сжатые формулы роликов: hook + emotion + camera + editing + CTA.", color: "#7c3aed", bg: "linear-gradient(90deg,#8b5cf6,#22d3ee)", status: "dna" },
  ];
  const coverageRows = ["ru_toys", "ru_clothing", "ru_cosmetics"].map((niche) => ({
    niche,
    cells: PLATFORMS.map((platform) => {
      const platformRow = director?.platform_coverage?.find((row: AnyRecord) => String(row.platform).toLowerCase().includes(platform));
      const conf = n(platformRow?.confidence);
      const label = conf >= 70 ? "strong" : conf >= 35 ? "watch" : conf > 0 ? "weak" : "empty";
      const map: AnyRecord = {
        strong: { bg: "#ecfdf5", bd: "#bbf7d0", fg: "#059669" },
        watch: { bg: "#fffbeb", bd: "#fde68a", fg: "#b45309" },
        weak: { bg: "#f8fafc", bd: "#e2e8f0", fg: "#64748b" },
        empty: { bg: "#fff1f2", bd: "#fecdd3", fg: "#be123c" },
      };
      return { label, ...map[label] };
    }),
  }));
  const confReasons = [
    data.ready < data.corpus * .1 ? "Direct mp4 покрытие еще маленькое относительно всего корпуса." : "Direct mp4 слой уже дает базу для audio/visual анализа.",
    data.backlogUnanalyzed > 0 ? `Осталось разобрать ${fmt(data.backlogUnanalyzed)} видео в память.` : "Backlog почти закрыт, можно переходить к дообучению.",
    !data.av ? "ASR/transcript еще не подключен как runtime." : "Audio/visual features уже пишутся в мозг.",
    "Instagram и YouTube нужно держать отдельными мозгами, не смешивать с TikTok.",
  ];
  const costCards = [
    { label: "Сегодня / полезное видео", value: usd(data.today.usd_per_analyzed || data.today.usd_per_relevant || data.today.spend_usd), trend: "today", note: `${fmt(data.today.analyzed)} memory · ${fmt(data.today.inserted)} saved · источник ${data.today.spend_source || "estimated"}` },
    { label: "Вчера / полезное видео", value: usd(data.yesterday.usd_per_analyzed || data.yesterday.usd_per_relevant || data.yesterday.spend_usd), trend: "history", note: `${fmt(data.yesterday.analyzed)} memory · ${fmt(data.yesterday.inserted)} saved` },
    { label: "Brief-ready", value: fmt(data.generatorReady), trend: "ready", note: "Паттерны, которые уже можно переводить в creative brief без копирования чужого креатива." },
  ];
  const hooks = (data.topHooks.length ? data.topHooks : [{ hook_label: "прямое заявление", op_score: 72 }, { hook_label: "демо / обзор", op_score: 64 }, { hook_label: "слом ожидания", op_score: 58 }]).slice(0, 4);
  const editBuckets = data.dna.edit_pace_buckets || {};
  const loudBuckets = data.dna.loudness_buckets || {};
  const patterns = (director?.export_briefs || data.recipes || []).slice(0, 2);
  const blindSpots = [
    !data.ready ? "Мало direct mp4: часть корпуса пока metadata-only." : `${fmt(Math.max(0, data.ready - data.feature))} mp4 ждут Creative DNA.`,
    "ASR/transcript слой пока не понимает дословные первые фразы.",
    "Instagram/YouTube требуют отдельного confidence, не смешанного с TikTok.",
    "Anti Pattern Brain еще копит отрицательные примеры.",
  ];
  const decisions = [
    { title: "Проверить главный OP-хук", why: `Взять "${hooks[0]?.hook_label || "прямое заявление"}" и снять 3 товарных варианта.`, products: "игрушки / одежда / косметика", variable: "hook" },
    { title: "Запустить fast-edit тест", why: "Оставить тот же оффер, поменять только темп монтажа и первый cut.", products: "товары с демо", variable: "editing" },
    { title: "Собрать anti-pattern контроль", why: "Один слабый вариант нужен, чтобы мозг учился не только победителям.", products: "любая ниша", variable: "negative" },
  ];
  const roadmap = (data.layers.length ? data.layers : [
    { title: "ASR / Transcript", status: "prototype", score: 35, next: "first phrase + speech rate" },
    { title: "Audience Brain", status: "training", score: 55, next: "сегменты аудитории" },
    { title: "Product Brain", status: "training", score: 60, next: "тип товара" },
    { title: "Anti Pattern Brain", status: "prototype", score: 25, next: "что не работает" },
  ]).slice(0, 6);

  return (
    <div style={{ width: "100%", overflowX: "hidden", background: "#eef1f6", color: "#0f172a", fontFamily: "'Hanken Grotesk',system-ui,sans-serif", WebkitFontSmoothing: "antialiased" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        @keyframes rbPulseGlow{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.9;transform:scale(1.06)}}
        @keyframes rbFloatOrb{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
        @keyframes rbBlink{0%,100%{opacity:1}50%{opacity:.25}}
        .rb-pixel *{box-sizing:border-box}
        @media(max-width:980px){.rb-hero-grid,.rb-two,.rb-knowledge,.rb-cost,.rb-patterns,.rb-loop,.rb-questions{grid-template-columns:1fr!important}.rb-hero-stats{grid-template-columns:repeat(2,1fr)!important}.rb-shell{padding-left:20px!important;padding-right:20px!important}.rb-coverage{overflow-x:auto}.rb-funnel-row{align-items:flex-start!important;flex-direction:column}.rb-funnel-left{flex:initial!important}.rb-funnel-status{align-items:flex-start!important}}
      `}</style>
      <div className="rb-pixel">
        <section style={{ position: "relative", background: "radial-gradient(1200px 600px at 78% -10%, #12324a 0%, #0b1b2e 42%, #081422 100%)", color: "#e8eef6", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -160, right: -40, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle,#12d0c0 0%,rgba(18,208,192,0) 68%)", filter: "blur(20px)", opacity: .5, animation: "rbPulseGlow 6s ease-in-out infinite", pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: -220, left: -80, width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle,#0ea5e9 0%,rgba(14,165,233,0) 70%)", filter: "blur(30px)", opacity: .32, animation: "rbPulseGlow 8s ease-in-out infinite", pointerEvents: "none" }} />
          <div className="rb-shell" style={{ position: "relative", maxWidth: 1240, margin: "0 auto", padding: "26px 40px 8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#22d3ee,#10b981)", display: "flex", alignItems: "center", justifyContent: "center", color: "#04121c", boxShadow: "0 0 24px rgba(34,211,238,.45)" }}>♧</div>
                <div>
                  <div style={{ font: "600 11px/1 'JetBrains Mono'", letterSpacing: ".24em", color: "#5eead4", textTransform: "uppercase" }}>Reels Brain</div>
                  <div style={{ font: "500 12px/1 'Hanken Grotesk'", color: "#8aa2b8", marginTop: 4 }}>Кокпит креативного интеллекта</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 14px", borderRadius: 999, background: "rgba(16,185,129,.13)", border: "1px solid rgba(16,185,129,.35)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#34d399", boxShadow: "0 0 10px #34d399", animation: "rbBlink 1.8s ease-in-out infinite" }} />
                <span style={{ font: "600 12px/1 'JetBrains Mono'", color: "#6ee7b7", letterSpacing: ".02em" }}>мозг жив · учится</span>
              </div>
            </div>
          </div>
          <div className="rb-shell rb-hero-grid" style={{ position: "relative", maxWidth: 1240, margin: "0 auto", padding: "30px 40px 46px", display: "grid", gridTemplateColumns: "1fr 360px", gap: 48, alignItems: "center" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "6px 13px", borderRadius: 999, background: "rgba(34,211,238,.1)", border: "1px solid rgba(34,211,238,.28)", marginBottom: 22 }}>
                <span style={{ font: "600 11px/1 'JetBrains Mono'", letterSpacing: ".06em", color: "#7dd3fc" }}>СТАДИЯ</span>
                <span style={{ font: "600 12px/1 'Hanken Grotesk'", color: "#cffafe" }}>{data.backlogUnanalyzed ? "превращаем корпус в память" : "готов к дообучению"}</span>
              </div>
              <h1 style={{ font: "600 46px/1.08 'Space Grotesk'", letterSpacing: "-.02em", margin: "0 0 20px", color: "#f1f6fb", textWrap: "balance" }}>Насколько умён Reels&nbsp;Brain <span style={{ background: "linear-gradient(90deg,#22d3ee,#34d399)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>прямо сейчас?</span></h1>
              <p style={{ font: "400 17px/1.6 'Hanken Grotesk'", color: "#a9bccf", maxWidth: 560, margin: "0 0 30px", textWrap: "pretty" }}>Мозг ежедневно превращает вирусные ролики в Creative DNA: хуки, удержание, монтаж, аудио, слепые зоны и готовые creative briefs для следующего пакета контента.</p>
              <div className="rb-hero-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, maxWidth: 600 }}>
                {heroStats.map((s) => <div key={s.label} style={{ padding: "15px 16px", borderRadius: 14, background: "rgba(255,255,255,.045)", border: "1px solid rgba(255,255,255,.09)", backdropFilter: "blur(4px)" }}><div style={{ font: "600 26px/1 'Space Grotesk'", color: s.color }}>{s.value}</div><div style={{ font: "500 10px/1.3 'JetBrains Mono'", color: "#7f97ad", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 8 }}>{s.label}</div></div>)}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 24, padding: "13px 17px", borderRadius: 13, background: "rgba(245,158,11,.11)", border: "1px solid rgba(245,158,11,.32)", maxWidth: 600 }}>
                <span style={{ color: "#fbbf24", fontSize: 17 }}>△</span>
                <div><span style={{ font: "600 11px/1 'JetBrains Mono'", color: "#fbbf24", textTransform: "uppercase", letterSpacing: ".08em" }}>Текущее узкое место</span><div style={{ font: "500 14px/1.4 'Hanken Grotesk'", color: "#fde9c4", marginTop: 3 }}>ASR/transcript еще не подключен к runtime: мозг понимает структуру и visual/audio features, но не дословные фразы.</div></div>
              </div>
            </div>
            <Gauge score={data.score} confidence={data.confidence} />
          </div>
        </section>

        <div className="rb-shell" style={{ maxWidth: 1240, margin: "0 auto", padding: "44px 40px 80px", display: "flex", flexDirection: "column", gap: 52 }}>
          <section>
            <SectionTitle n="01" eyebrow="Прогресс обучения" title="От сырого видео к Creative DNA" />
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {funnel.map((f, idx) => (
                <div key={f.name}>
                  <div className="rb-funnel-row" style={{ display: "flex", alignItems: "center", gap: 20, padding: "18px 22px", borderRadius: 16, background: "#fff", border: "1px solid #e2e8f0", boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
                    <div className="rb-funnel-left" style={{ flex: "0 0 148px" }}><div style={{ font: "600 32px/1 'Space Grotesk'", color: f.color }}>{fmt(f.count)}</div><div style={{ font: "500 12px/1.2 'Hanken Grotesk'", color: "#94a3b8", marginTop: 5 }}>{f.name}</div></div>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ height: 9, borderRadius: 99, background: "#eef2f7", overflow: "hidden" }}><div style={{ height: "100%", borderRadius: 99, width: `${Math.max(3, Math.min(100, f.pct))}%`, background: f.bg }} /></div><div style={{ font: "400 13px/1.45 'Hanken Grotesk'", color: "#64748b", marginTop: 10, textWrap: "pretty" }}>{f.note}</div></div>
                    <div className="rb-funnel-status" style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 7 }}><span style={{ display: "inline-flex", padding: "4px 11px", borderRadius: 999, font: "600 11px/1 'JetBrains Mono'", background: "#ecfdf5", color: "#059669", border: "1px solid #bbf7d0" }}>{f.status}</span><span style={{ font: "500 12px/1 'JetBrains Mono'", color: "#94a3b8" }}>{Math.round(f.pct)}%</span></div>
                  </div>
                  {idx < funnel.length - 1 && <div style={{ display: "flex", justifyContent: "center", padding: "5px 0", color: "#cbd5e1" }}>↓</div>}
                </div>
              ))}
            </div>
          </section>

          <section className="rb-two" style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 24, alignItems: "start" }}>
            <div>
              <SectionTitle n="02" eyebrow="Уверенность мозга" title="Насколько можно доверять" />
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 24, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
                  <div><div style={{ font: "500 11px/1 'JetBrains Mono'", color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em" }}>Объём данных</div><div style={{ font: "600 34px/1 'Space Grotesk'", marginTop: 8 }}>{fmt(data.corpus)} <span style={{ font: "500 15px/1 'Hanken Grotesk'", color: "#94a3b8" }}>видео</span></div></div>
                  <div style={{ textAlign: "right" }}><div style={{ font: "500 11px/1 'JetBrains Mono'", color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em" }}>Уверенность</div><div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 8, padding: "6px 13px", borderRadius: 999, background: "#fef3c7", border: "1px solid #fde68a" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f59e0b" }} /><span style={{ font: "600 13px/1 'JetBrains Mono'", color: "#b45309", textTransform: "uppercase" }}>{data.confidence}</span></div></div>
                </div>
                <div style={{ display: "flex", gap: 5, margin: "20px 0 22px" }}><div style={{ flex: 1, height: 7, borderRadius: 99, background: "#10b981" }} /><div style={{ flex: 1, height: 7, borderRadius: 99, background: data.confidence === "low" ? "#e2e8f0" : "#f59e0b" }} /><div style={{ flex: 1, height: 7, borderRadius: 99, background: data.confidence === "high" ? "#10b981" : "#e2e8f0" }} /></div>
                <div style={{ font: "500 11px/1 'JetBrains Mono'", color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>Почему не абсолютная уверенность</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{confReasons.map((r, i) => <div key={r} style={{ display: "flex", alignItems: "flex-start", gap: 11 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: i < 2 ? "#f59e0b" : "#22d3ee", marginTop: 7, flex: "0 0 auto" }} /><span style={{ font: "400 14px/1.45 'Hanken Grotesk'", color: "#475569" }}>{r}</span></div>)}</div>
              </div>
            </div>
            <div>
              <SectionTitle n="03" eyebrow="Карта покрытия" title="Где мозг силён" />
              <div className="rb-coverage" style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 22, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "128px repeat(3,1fr)", gap: 10, alignItems: "center", minWidth: 540 }}>
                  <div />
                  {["TikTok", "Instagram", "YouTube"].map((c) => <div key={c} style={{ font: "600 11px/1.1 'JetBrains Mono'", color: "#64748b", textAlign: "center", textTransform: "uppercase", letterSpacing: ".03em" }}>{c}</div>)}
                  {coverageRows.map((row) => <><div key={`${row.niche}-title`} style={{ font: "600 14px/1.1 'Hanken Grotesk'", color: "#334155" }}>{row.niche}</div>{row.cells.map((cell, i) => <div key={`${row.niche}-${i}`} style={{ height: 46, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: cell.bg, border: `1px solid ${cell.bd}` }}><span style={{ font: "600 11px/1 'JetBrains Mono'", color: cell.fg, textTransform: "uppercase", letterSpacing: ".02em" }}>{cell.label}</span></div>)}</>)}
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionTitle n="04" eyebrow="Стоимость обучения" title="Сколько стоит интеллект" />
            <div className="rb-cost" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
              {costCards.map((c) => <div key={c.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 20, boxShadow: "0 1px 2px rgba(15,23,42,.04)", display: "flex", flexDirection: "column", gap: 12 }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}><span style={{ font: "500 11px/1.3 'JetBrains Mono'", color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".04em" }}>{c.label}</span><span style={{ padding: "3px 9px", borderRadius: 999, font: "600 10px/1 'JetBrains Mono'", background: "#ecfdf5", color: "#059669", border: "1px solid #bbf7d0" }}>{c.trend}</span></div><div style={{ font: "600 30px/1 'Space Grotesk'", color: "#0f172a" }}>{c.value}</div><div style={{ font: "400 13px/1.4 'Hanken Grotesk'", color: "#64748b", textWrap: "pretty" }}>{c.note}</div></div>)}
            </div>
          </section>

          <section>
            <SectionTitle n="05" eyebrow="Что мозг понимает сейчас" title="Не данные — знания" />
            <div className="rb-knowledge" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 22, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><MiniIcon bg="#ecfeff" fg="#0891b2">↪</MiniIcon><div style={{ font: "600 17px/1 'Space Grotesk'" }}>Хуки</div></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>{hooks.map((h: AnyRecord) => <div key={h.hook_label} style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ flex: 1, font: "500 14px/1.3 'Hanken Grotesk'", color: "#334155" }}>{h.hook_label}</span><div style={{ flex: "0 0 88px", height: 7, borderRadius: 99, background: "#eef2f7", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.max(8, Math.min(100, n(h.op_score)))}%`, background: "#22d3ee" }} /></div><span style={{ flex: "0 0 auto", font: "600 10px/1 'JetBrains Mono'", color: "#0891b2", textTransform: "uppercase", width: 78, textAlign: "right" }}>{h.status || "watch"}</span></div>)}</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 22, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><MiniIcon bg="#f0fdf4" fg="#059669">)))</MiniIcon><div style={{ font: "600 17px/1 'Space Grotesk'" }}>Аудио</div></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}><div><div style={{ font: "600 24px/1 'Space Grotesk'", color: "#059669" }}>{fmt(data.dna.audio_share_pct)}%</div><div style={{ font: "500 11px/1.3 'Hanken Grotesk'", color: "#94a3b8", marginTop: 5 }}>разобранных mp4 со звуком</div></div><div><div style={{ font: "600 24px/1 'Space Grotesk'" }}>{fmt(data.dna.immediate_sound_share_pct)}%</div><div style={{ font: "500 11px/1.3 'Hanken Grotesk'", color: "#94a3b8", marginTop: 5 }}>начинают звук сразу</div></div></div>
                <div style={{ display: "flex", gap: 6, height: 34, borderRadius: 9, overflow: "hidden" }}>{Object.entries(loudBuckets).slice(0, 3).map(([k, v]: any) => <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: Math.max(1, n(v)), background: k.includes("loud") ? "#dcfce7" : "#e0f2fe" }}><span style={{ font: "600 10px/1 'JetBrains Mono'", color: "#0f766e" }}>{k}</span></div>)}</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 22, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><MiniIcon bg="#eff6ff" fg="#2563eb">▥</MiniIcon><div style={{ font: "600 17px/1 'Space Grotesk'" }}>Визуал и монтаж</div></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}><div><div style={{ font: "600 24px/1 'Space Grotesk'", color: "#2563eb" }}>{fmt(data.dna.vertical_share_pct)}%</div><div style={{ font: "500 11px/1.3 'Hanken Grotesk'", color: "#94a3b8", marginTop: 5 }}>вертикальный формат</div></div><div><div style={{ font: "600 24px/1 'Space Grotesk'" }}>{Object.keys(editBuckets).length}</div><div style={{ font: "500 11px/1.3 'Hanken Grotesk'", color: "#94a3b8", marginTop: 5 }}>темпа монтажа найдено</div></div></div>
                <div style={{ display: "flex", gap: 8 }}>{Object.entries(editBuckets).slice(0, 3).map(([k, v]: any) => <div key={k} style={{ flex: 1, padding: 10, borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0", textAlign: "center" }}><div style={{ font: "600 18px/1 'Space Grotesk'", color: "#2563eb" }}>{fmt(v)}</div><div style={{ font: "500 10px/1.2 'JetBrains Mono'", color: "#94a3b8", marginTop: 5, textTransform: "uppercase" }}>{k}</div></div>)}</div>
              </div>
              <div style={{ background: "linear-gradient(135deg,#0b1b2e,#12324a)", border: "1px solid #1e3a52", borderRadius: 18, padding: 22, color: "#e8eef6", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: -60, right: -30, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle,rgba(34,211,238,.28),transparent 70%)", filter: "blur(10px)" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, position: "relative" }}><MiniIcon bg="rgba(34,211,238,.16)" fg="#5eead4">⌁</MiniIcon><div style={{ font: "600 17px/1 'Space Grotesk'", color: "#f1f6fb" }}>Creative DNA</div></div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9, position: "relative" }}>{["Hook", "Emotion", "Camera", "Editing", "CTA"].map((d, i) => <span key={d} style={{ padding: "8px 13px", borderRadius: 10, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", font: "600 12px/1 'JetBrains Mono'", color: "#cffafe" }}>{d}{i < 4 ? "" : ""}</span>)}<span style={{ font: "600 15px/1 'Space Grotesk'", color: "#5eead4" }}>=</span><span style={{ padding: "8px 14px", borderRadius: 10, background: "linear-gradient(90deg,#22d3ee,#34d399)", font: "700 12px/1 'JetBrains Mono'", color: "#04121c" }}>DNA-паттерн</span></div>
              </div>
            </div>
          </section>

          <section>
            <SectionTitle n="06" eyebrow="Доказательность и лучшие паттерны" title="Что уже можно использовать" />
            <div className="rb-patterns" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>{patterns.map((p: AnyRecord, i: number) => <div key={p.id || p.title || i} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 22, boxShadow: "0 1px 2px rgba(15,23,42,.04)", display: "flex", flexDirection: "column", gap: 15 }}><div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}><div><div style={{ font: "600 11px/1 'JetBrains Mono'", color: "#0891b2", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Паттерн</div><div style={{ font: "600 20px/1.15 'Space Grotesk'" }}>{p.title || p.hook || "Creative brief"}</div></div><span style={{ padding: "3px 10px", borderRadius: 999, font: "600 10px/1 'JetBrains Mono'", background: "#ecfdf5", color: "#059669", border: "1px solid #bbf7d0" }}>{p.priority || p.confidence || "ready"}</span></div><div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "7px 14px", font: "400 13px/1.4 'Hanken Grotesk'" }}><span style={{ color: "#94a3b8", font: "500 11px/1.5 'JetBrains Mono'", textTransform: "uppercase" }}>Хук</span><span style={{ color: "#334155" }}>{p.hook || p.creative_brief?.hook}</span><span style={{ color: "#94a3b8", font: "500 11px/1.5 'JetBrains Mono'", textTransform: "uppercase" }}>Удержание</span><span style={{ color: "#334155" }}>{p.retention_mechanic || p.retention || p.creative_brief?.retention_mechanic}</span><span style={{ color: "#94a3b8", font: "500 11px/1.5 'JetBrains Mono'", textTransform: "uppercase" }}>Для</span><span style={{ color: "#334155" }}>{(p.product_fit || p.niches || []).slice(0, 3).join(" · ")}</span></div><div style={{ display: "flex", gap: 10 }}><div style={{ flex: 1, padding: "11px 13px", borderRadius: 11, background: "#ecfdf5", border: "1px solid #bbf7d0" }}><div style={{ font: "600 10px/1 'JetBrains Mono'", color: "#059669", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Копировать механику</div><div style={{ font: "400 12.5px/1.4 'Hanken Grotesk'", color: "#3f6151" }}>{(p.copy_as_mechanic || p.creative_brief?.copy_as_mechanic || ["структуру"]).slice(0, 2).join(" · ")}</div></div><div style={{ flex: 1, padding: "11px 13px", borderRadius: 11, background: "#fff1f2", border: "1px solid #fecdd3" }}><div style={{ font: "600 10px/1 'JetBrains Mono'", color: "#be123c", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Не копировать</div><div style={{ font: "400 12.5px/1.4 'Hanken Grotesk'", color: "#8b3a48" }}>{(p.do_not_copy || p.creative_brief?.do_not_copy || ["лицо/голос автора"]).slice(0, 2).join(" · ")}</div></div></div></div>)}</div>
          </section>

          <section className="rb-two" style={{ display: "grid", gridTemplateColumns: "1fr 1.25fr", gap: 24, alignItems: "start" }}>
            <div><SectionTitle n="07" eyebrow="Слепые зоны" title="Чего мозг ещё не видит" danger /><div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 12, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>{blindSpots.map((b) => <div key={b} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 12px", borderRadius: 11 }}><span style={{ width: 26, height: 26, borderRadius: 8, background: "#fff1f2", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", color: "#e11d48" }}>⊘</span><span style={{ font: "400 14px/1.4 'Hanken Grotesk'", color: "#475569" }}>{b}</span></div>)}</div></div>
            <div><SectionTitle n="08" eyebrow="Слой решений" title="Что тестировать дальше" /><div style={{ display: "flex", flexDirection: "column", gap: 13 }}>{decisions.map((d, i) => <div key={d.title} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "19px 20px", boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}><div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}><div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#22d3ee,#10b981)", color: "#04121c", display: "flex", alignItems: "center", justifyContent: "center", font: "700 14px/1 'Space Grotesk'", flex: "0 0 auto" }}>{i + 1}</div><div style={{ flex: 1, minWidth: 0 }}><div style={{ font: "600 16px/1.2 'Space Grotesk'" }}>{d.title}</div><div style={{ font: "400 13.5px/1.5 'Hanken Grotesk'", color: "#64748b", marginTop: 8, textWrap: "pretty" }}>{d.why}</div><div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}><span style={{ padding: "4px 10px", borderRadius: 8, background: "#f1f5f9", font: "500 11px/1.2 'JetBrains Mono'", color: "#475569" }}>для · {d.products}</span><span style={{ padding: "4px 10px", borderRadius: 8, background: "#ecfeff", font: "500 11px/1.2 'JetBrains Mono'", color: "#0e7490" }}>A/B · {d.variable}</span></div></div></div></div>)}</div></div>
          </section>

          <section className="rb-loop" style={{ display: "grid", gridTemplateColumns: "1fr 1.35fr", gap: 24, alignItems: "start" }}>
            <div><SectionTitle n="09" eyebrow="Текущий цикл обучения" title="Работает сам" /><div style={{ background: "linear-gradient(135deg,#0b1b2e,#0f2438)", border: "1px solid #1e3a52", borderRadius: 18, padding: 22, color: "#e8eef6" }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}><div style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "6px 12px", borderRadius: 999, background: "rgba(16,185,129,.14)", border: "1px solid rgba(16,185,129,.35)" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "#34d399", boxShadow: "0 0 9px #34d399", animation: "rbBlink 1.8s ease-in-out infinite" }} /><span style={{ font: "600 11px/1 'JetBrains Mono'", color: "#6ee7b7" }}>воркер жив</span></div><span style={{ font: "500 11px/1 'JetBrains Mono'", color: "#8aa2b8" }}>последний цикл · {data.lastSeen == null ? "—" : `${data.lastSeen} мин назад`}</span></div>{["Собирает свежие источники", "Разбирает backlog в память", "Обогащает mp4 в Creative DNA"].map((text, i) => <div key={text} style={{ display: "flex", alignItems: "flex-start", gap: 13 }}><div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}><span style={{ width: 11, height: 11, borderRadius: "50%", background: i === 2 ? "#fbbf24" : "#34d399", boxShadow: i === 2 ? "0 0 9px #fbbf24" : "0 0 9px #34d399" }} /><span style={{ display: i === 2 ? "none" : "block", width: 2, height: 26, background: "#1e3a52" }} /></div><div style={{ paddingBottom: 14 }}><div style={{ font: "600 10px/1 'JetBrains Mono'", color: i === 2 ? "#fbbf24" : "#6ee7b7", textTransform: "uppercase", letterSpacing: ".05em" }}>phase {i + 1}</div><div style={{ font: "400 13.5px/1.45 'Hanken Grotesk'", color: "#c3d2e0", marginTop: 5 }}>{text}</div></div></div>)}</div></div>
            <div><SectionTitle n="10" eyebrow="Следующие слои интеллекта" title="Дорожная карта понимания" /><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>{roadmap.map((r: AnyRecord) => <div key={r.key || r.title} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 19, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}><div style={{ width: 34, height: 34, borderRadius: 10, background: "#ecfeff", display: "flex", alignItems: "center", justifyContent: "center", color: "#0891b2" }}>✦</div><span style={{ font: "600 10px/1 'JetBrains Mono'", color: "#059669", background: "#ecfdf5", border: "1px solid #bbf7d0", padding: "3px 9px", borderRadius: 999, textTransform: "uppercase" }}>{r.status}</span></div><div style={{ font: "600 16px/1.15 'Space Grotesk'", marginBottom: 6 }}>{r.title}</div><div style={{ font: "400 13px/1.45 'Hanken Grotesk'", color: "#64748b", textWrap: "pretty" }}>{r.next}</div></div>)}</div></div>
          </section>

          <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, padding: "30px 34px", boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
            <div style={{ font: "600 11px/1 'JetBrains Mono'", letterSpacing: ".16em", color: "#94a3b8", textTransform: "uppercase", marginBottom: 20 }}>Кокпит отвечает на четыре вопроса</div>
            <div className="rb-questions" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 22 }}>{[
              ["01", "Насколько мозг обучен?", `${data.score}% понимания`],
              ["02", "Чему можно доверять?", `${data.confidence} confidence`],
              ["03", "Что снимать дальше?", `${fmt(director?.export_briefs?.length || patterns.length)} briefs`],
              ["04", "Где слепые зоны?", blindSpots[0]],
            ].map((q, i) => <div key={q[0]}><div style={{ font: "600 30px/1 'Space Grotesk'", color: ["#0891b2", "#10b981", "#f59e0b", "#e11d48"][i], marginBottom: 11 }}>{q[0]}</div><div style={{ font: "600 15px/1.3 'Space Grotesk'", marginBottom: 6 }}>{q[1]}</div><div style={{ font: "400 13px/1.45 'Hanken Grotesk'", color: "#64748b" }}>{q[2]}</div></div>)}</div>
          </section>
        </div>
      </div>
    </div>
  );
}
