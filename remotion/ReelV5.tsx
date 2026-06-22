import React, {useEffect, useState} from "react";
import {
  AbsoluteFill, OffthreadVideo, Audio, Sequence,
  useCurrentFrame, useVideoConfig, spring, interpolate, staticFile, delayRender, continueRender,
} from "remotion";

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

// ── Пропсы (завод отдаёт JSON-бриф). Дефолты = проверенный v9 (водяной УЗИ TT04101). ──
// src может быть именем ассета в public/ (staticFile) ИЛИ полным http(s)-URL (Supabase/fal) — resolveSrc разрулит.
export type Overlay = { src: string; from: number; duration: number; startFrom?: number; cropScale?: number; ty?: number; flash?: boolean };
export type Caption = { text: string; accent?: boolean };
export type ReelV5Props = {
  durationInFrames: number;
  actorEnd: number;          // кадр, на котором актёр-спайн заканчивается (дальше CTA)
  actorRate: number;         // playbackRate актёра (энергия)
  accent: string;            // акцент-цвет
  actorSrc: string;          // база-актёр (Creatify lipsync)
  overlays: Overlay[];       // b-roll врезки (Seedance) поверх актёра
  captions: Caption[];       // кинетик-капшены по словам, равномерно по [0, actorEnd]
  audioSrc: string;          // музыка-бэд
  audioVolume: number;
  ctaTitle: string;          // крупный титул на эндкарде (\n = перенос)
  ctaButton: string;         // плашка-CTA
  ctaBrand: string;          // бренд
  ctaClipSrc: string;        // b-roll под CTA (продуктовый залп)
  ctaClipStartFrom?: number;
};

export const DEFAULT_PROPS: ReelV5Props = {
  durationInFrames: 614,
  actorEnd: 559,             // funny actor 22.37s @1.2x ≈ 18.6s
  actorRate: 1.2,
  accent: "#ff5a1f",
  actorSrc: "reel-assets/actor.mp4",
  overlays: [
    {src: "reel-assets/hook.mp4", from: 95, duration: 80, startFrom: 60, flash: true},
    {src: "reel-assets/boy.mp4", from: 175, duration: 70, startFrom: 8, cropScale: 1.66, ty: -11, flash: true},
    {src: "reel-assets/girl.mp4", from: 245, duration: 85, startFrom: 6, cropScale: 1.18, ty: -2, flash: true},
    {src: "reel-assets/boy.mp4", from: 420, duration: 70, startFrom: 70, cropScale: 1.66, ty: -11, flash: true},
  ],
  captions: [
    {text: "спрячь от детей"},
    {text: "я серьёзно"},
    {text: "это вообще не игрушка"},
    {text: "это водяной Узи", accent: true},
    {text: "лупит очередями на 8 метров", accent: true},
    {text: "светится, и звук как настоящий"},
    {text: "купил детям... ну да, конечно"},
    {text: "сам с дачи не вылезаю"},
    {text: "все мокрые, а я довольный"},
    {text: "водяной Узи — на WB", accent: true},
    {text: "беги", accent: true},
  ],
  audioSrc: "reel-assets/music2.mp3",
  audioVolume: 0.15,
  ctaTitle: "водяной\nУзи",
  ctaButton: "ищи на WB",
  ctaBrand: "TIM TIN",
  ctaClipSrc: "reel-assets/hook.mp4",
  ctaClipStartFrom: 92,
};

// staticFile для локальных ассетов; полный URL — как есть (клипы из завода приходят URL'ами)
const resolveSrc = (s: string): string => (/^https?:\/\//.test(s) ? s : staticFile(s));

function useFonts() {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    const load = (f: string, file: string) => new FontFace(f, `url(${staticFile(file)}) format('truetype')`, {weight: "100 900"}).load();
    Promise.all([load("Montserrat", "fonts/Montserrat.ttf"), load("Unbounded", "fonts/Unbounded.ttf")])
      .then((fs) => { fs.forEach((f) => document.fonts.add(f)); continueRender(handle); })
      .catch(() => continueRender(handle));
  }, [handle]);
}

const OUTLINE: React.CSSProperties = {
  WebkitTextStroke: "9px #000",
  paintOrder: "stroke",
  textShadow: "0 5px 22px rgba(0,0,0,.65)",
};

// our footage overlay: crop + ken-burns + entry punch (muted)
const Clip = ({src, durationInFrames, startFrom, cropScale = 1, ty = 0, flash = false}: {src: string; durationInFrames: number; startFrom?: number; cropScale?: number; ty?: number; flash?: boolean}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const entry = spring({frame, fps, config: {damping: 16, mass: 0.4}});
  const punch = interpolate(entry, [0, 1], [1.16, 1]);
  const kb = interpolate(frame, [0, durationInFrames], [1, 1.07], {extrapolateRight: "clamp"});
  const op = interpolate(frame, [0, 3], [0, 1], {extrapolateRight: "clamp"});
  const sh = Math.sin(frame * 1.7) * 3;
  const flashOp = flash ? interpolate(frame, [0, 5], [0.7, 0], {extrapolateRight: "clamp"}) : 0;
  return (
    <AbsoluteFill style={{overflow: "hidden", opacity: op}}>
      <OffthreadVideo src={resolveSrc(src)} startFrom={startFrom} muted
        style={{width: "100%", height: "100%", objectFit: "cover",
          transform: `translate(${sh}px,0) scale(${cropScale * punch * kb}) translateY(${ty}%)`,
          filter: "contrast(1.08) saturate(1.18)"}} />
      {flash ? <AbsoluteFill style={{background: "#fff", opacity: flashOp}} /> : null}
    </AbsoluteFill>
  );
};

const Scrim = () => (
  <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(0,0,0,.35) 0%, rgba(0,0,0,0) 24%, rgba(0,0,0,0) 52%, rgba(0,0,0,.6) 100%)"}} />
);
const Vignette = () => (
  <AbsoluteFill style={{background: "radial-gradient(118% 78% at 50% 44%, rgba(0,0,0,0) 54%, rgba(0,0,0,.44) 100%)"}} />
);
// unified warm-summer wash to bind actor / product / kids into one world
const Grade = () => (
  <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(255,170,85,0.12) 0%, rgba(255,135,55,0.07) 100%)", mixBlendMode: "soft-light", pointerEvents: "none"}} />
);

// равномерная раскладка капшенов по [0, actorEnd], вес чанка = число небелых символов
function captionRanges(captions: Caption[], actorEnd: number) {
  const w = captions.map((c) => Math.max(6, c.text.replace(/\s/g, "").length));
  const tw = w.reduce((a, b) => a + b, 0) || 1;
  let a = 0;
  return captions.map((c, i) => { const s = a / tw; a += w[i]; return {text: c.text, accent: !!c.accent, s: Math.round(s * actorEnd), e: Math.round((a / tw) * actorEnd)}; });
}

const Captions = ({captions, actorEnd, accent}: {captions: Caption[]; actorEnd: number; accent: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const ranges = React.useMemo(() => captionRanges(captions, actorEnd), [captions, actorEnd]);
  if (frame >= actorEnd || !ranges.length) return null;
  const cur = ranges.find((r) => frame >= r.s && frame < r.e) ?? ranges[0];
  const local = frame - cur.s;
  const words = cur.text.split(" ");
  const isHook = cur === ranges[0];
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "flex-end", paddingBottom: isHook ? "20%" : "13%"}}>
      <div style={{display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 14px", maxWidth: isHook ? "94%" : "88%",
        fontFamily: "Montserrat", fontWeight: 800, fontSize: isHook ? 98 : 74, lineHeight: 1.05, textAlign: "center", letterSpacing: -1, textTransform: isHook ? "uppercase" : "none"}}>
        {words.map((wd, i) => {
          const sp = spring({frame: local - i * 1.5, fps, config: {damping: 14, mass: 0.35}});
          return (
            <span key={i} style={{display: "inline-block", transform: `translateY(${interpolate(sp, [0, 1], [28, 0])}px) scale(${interpolate(sp, [0, 1], [0.6, 1])})`,
              opacity: sp, color: cur.accent ? accent : "#fff", ...OUTLINE}}>{wd}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const CtaCard = ({actorEnd, accent, title, button, brand}: {actorEnd: number; accent: string; title: string; button: string; brand: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (frame < actorEnd) return null;
  const s = spring({frame: frame - actorEnd, fps, config: {damping: 13, mass: 0.5}});
  const titleLines = title.split("\n");
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}>
      <div style={{transform: `translateY(${interpolate(s, [0, 1], [60, 0])}px)`, opacity: s, textAlign: "center", width: "92%"}}>
        <div style={{fontFamily: "Unbounded", fontWeight: 800, fontSize: 120, lineHeight: 0.98, textTransform: "uppercase",
          letterSpacing: -2, color: "#fff", ...OUTLINE, WebkitTextStroke: "10px #000"}}>
          {titleLines.map((ln, i) => <React.Fragment key={i}>{i > 0 && <br />}{ln}</React.Fragment>)}
        </div>
        <div style={{marginTop: 34, display: "inline-block", background: accent, color: "#fff", fontFamily: "Montserrat",
          fontWeight: 800, fontSize: 54, padding: "16px 36px", borderRadius: 18, boxShadow: "0 10px 30px rgba(0,0,0,.45)"}}>{button}</div>
        <div style={{marginTop: 22, fontFamily: "Montserrat", fontWeight: 800, fontSize: 34, letterSpacing: 2, color: "#fff", opacity: 0.92, ...OUTLINE, WebkitTextStroke: "5px #000"}}>{brand}</div>
      </div>
    </AbsoluteFill>
  );
};

export const ReelV5: React.FC<Partial<ReelV5Props>> = (props) => {
  const p = {...DEFAULT_PROPS, ...props};
  useFonts();
  const frame = useCurrentFrame();
  // защита от краша рендера: Remotion требует durationInFrames > 0 у Sequence/Clip.
  // если из брифа пришло actorEnd >= durationInFrames (или <= 0) — клампим, иначе вся композиция падает.
  const safeActorEnd = Math.max(1, Math.min(p.actorEnd, p.durationInFrames - 1));
  const ctaDur = Math.max(1, p.durationInFrames - safeActorEnd);
  const actorKb = 1 + Math.min(frame, safeActorEnd) / safeActorEnd * 0.03;
  return (
    <AbsoluteFill style={{backgroundColor: "#000"}}>
      {/* base: actor (audio spine + video) */}
      <Sequence from={0} durationInFrames={safeActorEnd}>
        <AbsoluteFill style={{overflow: "hidden"}}>
          <OffthreadVideo src={resolveSrc(p.actorSrc)} playbackRate={p.actorRate}
            style={{width: "100%", height: "100%", objectFit: "cover", transform: `scale(${actorKb})`, filter: "contrast(1.05) saturate(1.1)"}} />
        </AbsoluteFill>
        <Scrim />
      </Sequence>

      {/* overlays: our footage during spec narration (actor audio continues) */}
      {p.overlays.filter((o) => o.duration > 0).map((o, i) => (
        <Sequence key={i} from={o.from} durationInFrames={Math.max(1, o.duration)}>
          <Clip src={o.src} durationInFrames={Math.max(1, o.duration)} startFrom={o.startFrom} cropScale={o.cropScale} ty={o.ty} flash={o.flash} />
          <Scrim />
        </Sequence>
      ))}

      {/* CTA card over product blast */}
      <Sequence from={safeActorEnd} durationInFrames={ctaDur}>
        <Clip src={p.ctaClipSrc} durationInFrames={ctaDur} startFrom={p.ctaClipStartFrom} flash />
        <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(0,0,0,.2) 0%, rgba(0,0,0,.3) 45%, rgba(0,0,0,.7) 100%)"}} />
      </Sequence>

      <Audio src={resolveSrc(p.audioSrc)} volume={p.audioVolume} />
      <Grade />
      <Captions captions={p.captions} actorEnd={safeActorEnd} accent={p.accent} />
      <CtaCard actorEnd={safeActorEnd} accent={p.accent} title={p.ctaTitle} button={p.ctaButton} brand={p.ctaBrand} />
      <Vignette />
    </AbsoluteFill>
  );
};

// для Root.tsx (durationInFrames из дефолтов)
export const DURATION = DEFAULT_PROPS.durationInFrames;
