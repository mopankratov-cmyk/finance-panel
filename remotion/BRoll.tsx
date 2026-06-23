import React, {useEffect, useState} from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
  staticFile, delayRender, continueRender, Sequence,
} from "remotion";

// ── B-ROLL · агент-«монтажёр» рендерит ЧИСТУЮ моушен-графику (без медиа/fal) по JSON-спеке. ──
// Дизайн-канон (зафиксирован один раз, см. docs/factory-broll-canon.md): тёмный графит + 1-2 акцента,
// цифры моноширинным шрифтом, плавная анимация БЕЗ отскоков (overdamped spring), КАЖДЫЙ кадр в движении.
// Props-driven (как ReelV5): агент эмитит spec, композиция детерминированно рендерит — не ломает билд.
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const DURATION = 120; // 4 c @30fps

export type BRollPreset = "cascade" | "quote" | "stat";
export type BRollProps = {
  durationInFrames: number;
  preset: BRollPreset;
  accent: string;            // основной акцент-цвет
  accent2?: string;          // вторичный акцент (по умолчанию приглушённый от accent)
  kicker?: string;           // мелкая верхняя плашка (моноширинная, UPPERCASE)
  lines: string[];           // 1-4 коротких фразы (для cascade/quote)
  emphasizeIndex?: number;   // индекс строки-акцента (подсветка + подчёркивание)
  stat?: {value: string; label: string}; // preset='stat': крупное моноширинное число + подпись
};

export const DEFAULT_PROPS: BRollProps = {
  durationInFrames: DURATION,
  preset: "cascade",
  accent: "#ff5a1f",
  kicker: "FABLE 5",
  lines: ["тебе не нужен", "ещё один тул", "тебе нужен", "результат"],
  emphasizeIndex: 3,
};

const GRAPHITE_A = "#0e0f12";
const GRAPHITE_B = "#15171a";
const INK = "#f2f3f5";
const MUTED = "rgba(242,243,245,0.55)";
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', 'DejaVu Sans Mono', Menlo, monospace";
const SANS = "Montserrat, system-ui, sans-serif";
const DISPLAY = "Unbounded, Montserrat, system-ui, sans-serif";

// overdamped (БЕЗ отскока): damping ≥ 2·√(stiffness·mass) → нет overshoot. Плавно «приезжает» и стоит.
const ease = (frame: number, fps: number, delay = 0) =>
  spring({frame: frame - delay, fps, config: {damping: 22, stiffness: 100, mass: 0.6}, durationInFrames: 24});

function useFonts() {
  const [handle] = useState(() => delayRender("broll-fonts"));
  useEffect(() => {
    const load = (f: string, file: string) => new FontFace(f, `url(${staticFile(file)}) format('truetype')`, {weight: "100 900"}).load();
    Promise.all([load("Montserrat", "fonts/Montserrat.ttf"), load("Unbounded", "fonts/Unbounded.ttf")])
      .then((fs) => { fs.forEach((f) => document.fonts.add(f)); continueRender(handle); })
      .catch(() => continueRender(handle));
  }, [handle]);
}

// Живой графитовый фон: дрейфующее радиальное свечение акцента + медленная сетка → каждый кадр в движении.
const LiveBackground: React.FC<{accent: string}> = ({accent}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const gx = 50 + Math.sin(frame / 38) * 14;          // свечение медленно ходит
  const gy = 42 + Math.cos(frame / 46) * 10;
  const gridShift = (frame * 0.6) % 80;                // сетка ползёт
  const glow = interpolate(frame, [0, 20], [0, 0.5], {extrapolateRight: "clamp"});
  const drift = interpolate(frame, [0, durationInFrames], [1.0, 1.05]); // лёгкий зум всей сцены
  return (
    <AbsoluteFill style={{transform: `scale(${drift})`}}>
      <AbsoluteFill style={{background: `linear-gradient(160deg, ${GRAPHITE_B} 0%, ${GRAPHITE_A} 100%)`}} />
      <AbsoluteFill style={{backgroundImage:
        `linear-gradient(${accent}14 1px, transparent 1px), linear-gradient(90deg, ${accent}14 1px, transparent 1px)`,
        backgroundSize: "80px 80px", backgroundPosition: `${gridShift}px ${gridShift}px`, opacity: 0.5}} />
      <AbsoluteFill style={{background: `radial-gradient(circle at ${gx}% ${gy}%, ${accent}40 0%, transparent 45%)`, opacity: glow}} />
      <AbsoluteFill style={{background: "radial-gradient(circle at 50% 120%, rgba(0,0,0,.55) 0%, transparent 55%)"}} />
    </AbsoluteFill>
  );
};

const Kicker: React.FC<{text: string; accent: string}> = ({text, accent}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const e = ease(frame, fps, 2);
  return (
    <div style={{position: "absolute", top: 150, left: 96, display: "flex", alignItems: "center", gap: 18,
      opacity: e, transform: `translateX(${interpolate(e, [0, 1], [-28, 0])}px)`}}>
      <div style={{width: 46, height: 6, background: accent, borderRadius: 3}} />
      <span style={{fontFamily: MONO, fontSize: 34, letterSpacing: 6, color: MUTED, textTransform: "uppercase"}}>{text}</span>
    </div>
  );
};

// одна строка — приезжает снизу с лёгким клипом, без отскока; акцентная — цветом + анимированное подчёркивание
const Line: React.FC<{text: string; delay: number; accent: boolean; accentColor: string}> = ({text, delay, accent, accentColor}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const e = ease(frame, fps, delay);
  const y = interpolate(e, [0, 1], [54, 0]);
  const underline = accent ? interpolate(frame - delay - 6, [0, 16], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}) : 0;
  return (
    <div style={{overflow: "hidden", padding: "2px 0"}}>
      <div style={{transform: `translateY(${y}px)`, opacity: e}}>
        <span style={{fontFamily: DISPLAY, fontWeight: 800, fontSize: 96, lineHeight: 1.04,
          color: accent ? accentColor : INK, letterSpacing: -1, textShadow: "0 6px 30px rgba(0,0,0,.5)"}}>{text}</span>
        {accent ? (
          <div style={{height: 10, marginTop: 14, width: `${underline * 100}%`, maxWidth: 560,
            background: accentColor, borderRadius: 5, boxShadow: `0 0 28px ${accentColor}`}} />
        ) : null}
      </div>
    </div>
  );
};

const Cascade: React.FC<BRollProps> = (p) => {
  const emph = p.emphasizeIndex ?? -1;
  return (
    <div style={{position: "absolute", left: 96, right: 96, top: 0, bottom: 0, display: "flex",
      flexDirection: "column", justifyContent: "center", gap: 6}}>
      {p.lines.map((t, i) => (
        <Line key={i} text={t} delay={8 + i * 9} accent={i === emph} accentColor={p.accent} />
      ))}
    </div>
  );
};

const Quote: React.FC<BRollProps> = (p) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const e = ease(frame, fps, 6);
  const bar = interpolate(frame - 10, [0, 18], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  return (
    <div style={{position: "absolute", left: 110, right: 110, top: 0, bottom: 0, display: "flex",
      flexDirection: "column", justifyContent: "center", gap: 30}}>
      <div style={{width: interpolate(bar, [0, 1], [0, 120]), height: 12, background: p.accent, borderRadius: 6, boxShadow: `0 0 30px ${p.accent}`}} />
      <div style={{transform: `translateY(${interpolate(e, [0, 1], [40, 0])}px)`, opacity: e}}>
        <span style={{fontFamily: DISPLAY, fontWeight: 800, fontSize: 112, lineHeight: 1.02, color: INK, letterSpacing: -1.5}}>
          {p.lines.join(" ")}
        </span>
      </div>
    </div>
  );
};

const Stat: React.FC<BRollProps> = (p) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const e = ease(frame, fps, 6);
  // число «набегает»: если value числовое — counter, иначе просто проявляем
  const num = Number(String(p.stat?.value ?? "").replace(/[^\d.]/g, ""));
  const suffix = String(p.stat?.value ?? "").replace(/[\d.\s]/g, "");
  const shown = Number.isFinite(num) && num > 0
    ? Math.round(interpolate(frame, [6, 40], [0, num], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})).toLocaleString("ru-RU") + suffix
    : (p.stat?.value ?? "");
  return (
    <div style={{position: "absolute", left: 96, right: 96, top: 0, bottom: 0, display: "flex",
      flexDirection: "column", justifyContent: "center", gap: 18, opacity: e}}>
      <span style={{fontFamily: MONO, fontWeight: 800, fontSize: 240, lineHeight: 1, color: p.accent,
        fontVariantNumeric: "tabular-nums", textShadow: `0 0 40px ${p.accent}66`}}>{shown}</span>
      {p.stat?.label ? (
        <span style={{fontFamily: SANS, fontWeight: 700, fontSize: 64, color: INK, letterSpacing: -0.5}}>{p.stat.label}</span>
      ) : null}
      {p.lines[0] ? (
        <span style={{fontFamily: SANS, fontWeight: 500, fontSize: 40, color: MUTED}}>{p.lines[0]}</span>
      ) : null}
    </div>
  );
};

export const BRoll: React.FC<BRollProps> = (props) => {
  useFonts();
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const accent = props.accent || DEFAULT_PROPS.accent;
  // общий вход/выход — каждый кадр живой, мягкое затемнение к концу
  const out = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], {extrapolateLeft: "clamp"});
  const Body = props.preset === "stat" ? Stat : props.preset === "quote" ? Quote : Cascade;
  return (
    <AbsoluteFill style={{backgroundColor: GRAPHITE_A, opacity: out}}>
      <LiveBackground accent={accent} />
      {props.kicker ? <Kicker text={props.kicker} accent={accent} /> : null}
      <Sequence from={0}><Body {...props} accent={accent} /></Sequence>
      {/* нижняя акцент-линия прогресса — движение в каждом кадре */}
      <div style={{position: "absolute", left: 0, bottom: 0, height: 8,
        width: `${interpolate(frame, [0, durationInFrames], [0, 100])}%`, background: accent, opacity: 0.8}} />
    </AbsoluteFill>
  );
};
