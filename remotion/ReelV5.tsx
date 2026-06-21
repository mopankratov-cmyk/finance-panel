import React, {useEffect, useState} from "react";
import {
  AbsoluteFill, OffthreadVideo, Audio, Sequence,
  useCurrentFrame, useVideoConfig, spring, interpolate, staticFile, delayRender, continueRender,
} from "remotion";

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const DURATION = 614;
const ACTOR_END = 559; // funny actor 22.37s @1.2x ≈ 18.6s
const ACTOR_RATE = 1.2;
const ACCENT = "#ff5a1f";

function useFonts() {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    const load = (f, file) => new FontFace(f, `url(${staticFile(file)}) format('truetype')`, {weight: "100 900"}).load();
    Promise.all([load("Montserrat", "fonts/Montserrat.ttf"), load("Unbounded", "fonts/Unbounded.ttf")])
      .then((fs) => { fs.forEach((f) => document.fonts.add(f)); continueRender(handle); })
      .catch(() => continueRender(handle));
  }, [handle]);
}

const OUTLINE = {
  WebkitTextStroke: "9px #000",
  paintOrder: "stroke",
  textShadow: "0 5px 22px rgba(0,0,0,.65)",
};

// our footage overlay: crop + ken-burns + entry punch (muted)
const Clip = ({src, durationInFrames, startFrom, cropScale = 1, ty = 0, flash = false}) => {
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
      <OffthreadVideo src={staticFile(src)} startFrom={startFrom} muted
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

const CHUNKS = [
  "спрячь от детей",
  "я серьёзно",
  "это вообще не игрушка",
  "это водяной Узи",
  "лупит очередями на 8 метров",
  "светится, и звук как настоящий",
  "купил детям... ну да, конечно",
  "сам с дачи не вылезаю",
  "все мокрые, а я довольный",
  "водяной Узи — на WB",
  "беги",
];
const W = CHUNKS.map((c) => Math.max(6, c.replace(/\s/g, "").length));
const TW = W.reduce((a, b) => a + b, 0);
const RANGES = (() => { let a = 0; return CHUNKS.map((text, i) => { const s = a / TW; a += W[i]; return {text, s: Math.round(s * ACTOR_END), e: Math.round((a / TW) * ACTOR_END)}; }); })();

const Captions = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (frame >= ACTOR_END) return null;
  const cur = RANGES.find((r) => frame >= r.s && frame < r.e) ?? RANGES[0];
  const local = frame - cur.s;
  const words = cur.text.split(" ");
  const accent = cur.text.includes("Узи") || cur.text.includes("8 метров") || cur.text.includes("WB") || cur.text === "беги";
  const isHook = cur === RANGES[0];
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "flex-end", paddingBottom: isHook ? "20%" : "13%"}}>
      <div style={{display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 14px", maxWidth: isHook ? "94%" : "88%",
        fontFamily: "Montserrat", fontWeight: 800, fontSize: isHook ? 98 : 74, lineHeight: 1.05, textAlign: "center", letterSpacing: -1, textTransform: isHook ? "uppercase" : "none"}}>
        {words.map((w, i) => {
          const sp = spring({frame: local - i * 1.5, fps, config: {damping: 14, mass: 0.35}});
          return (
            <span key={i} style={{display: "inline-block", transform: `translateY(${interpolate(sp, [0, 1], [28, 0])}px) scale(${interpolate(sp, [0, 1], [0.6, 1])})`,
              opacity: sp, color: accent ? ACCENT : "#fff", ...OUTLINE}}>{w}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const CtaCard = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (frame < ACTOR_END) return null;
  const s = spring({frame: frame - ACTOR_END, fps, config: {damping: 13, mass: 0.5}});
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}>
      <div style={{transform: `translateY(${interpolate(s, [0, 1], [60, 0])}px)`, opacity: s, textAlign: "center", width: "92%"}}>
        <div style={{fontFamily: "Unbounded", fontWeight: 800, fontSize: 120, lineHeight: 0.98, textTransform: "uppercase",
          letterSpacing: -2, color: "#fff", ...OUTLINE, WebkitTextStroke: "10px #000"}}>водяной<br />Узи</div>
        <div style={{marginTop: 34, display: "inline-block", background: ACCENT, color: "#fff", fontFamily: "Montserrat",
          fontWeight: 800, fontSize: 54, padding: "16px 36px", borderRadius: 18, boxShadow: "0 10px 30px rgba(0,0,0,.45)"}}>ищи на WB</div>
        <div style={{marginTop: 22, fontFamily: "Montserrat", fontWeight: 800, fontSize: 34, letterSpacing: 2, color: "#fff", opacity: 0.92, ...OUTLINE, WebkitTextStroke: "5px #000"}}>TIM TIN</div>
      </div>
    </AbsoluteFill>
  );
};

export const ReelV5 = () => {
  useFonts();
  const frame = useCurrentFrame();
  const actorKb = 1 + Math.min(frame, ACTOR_END) / ACTOR_END * 0.03;
  return (
    <AbsoluteFill style={{backgroundColor: "#000"}}>
      {/* base: actor (audio spine + video) */}
      <Sequence from={0} durationInFrames={ACTOR_END}>
        <AbsoluteFill style={{overflow: "hidden"}}>
          <OffthreadVideo src={staticFile("reel-assets/actor.mp4")} playbackRate={ACTOR_RATE}
            style={{width: "100%", height: "100%", objectFit: "cover", transform: `scale(${actorKb})`, filter: "contrast(1.05) saturate(1.1)"}} />
        </AbsoluteFill>
        <Scrim />
      </Sequence>

      {/* overlays: our footage during spec narration (actor audio continues) */}
      <Sequence from={95} durationInFrames={80}>
        <Clip src="reel-assets/hook.mp4" durationInFrames={80} startFrom={60} flash />
        <Scrim />
      </Sequence>
      <Sequence from={175} durationInFrames={70}>
        <Clip src="reel-assets/boy.mp4" durationInFrames={70} startFrom={8} cropScale={1.66} ty={-11} flash />
        <Scrim />
      </Sequence>
      <Sequence from={245} durationInFrames={85}>
        <Clip src="reel-assets/girl.mp4" durationInFrames={85} startFrom={6} cropScale={1.18} ty={-2} flash />
        <Scrim />
      </Sequence>
      <Sequence from={420} durationInFrames={70}>
        <Clip src="reel-assets/boy.mp4" durationInFrames={70} startFrom={70} cropScale={1.66} ty={-11} flash />
        <Scrim />
      </Sequence>

      {/* CTA card over product blast */}
      <Sequence from={ACTOR_END} durationInFrames={DURATION - ACTOR_END}>
        <Clip src="reel-assets/hook.mp4" durationInFrames={DURATION - ACTOR_END} startFrom={92} flash />
        <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(0,0,0,.2) 0%, rgba(0,0,0,.3) 45%, rgba(0,0,0,.7) 100%)"}} />
      </Sequence>

      <Audio src={staticFile("reel-assets/music2.mp3")} volume={0.15} />
      <Grade />
      <Captions />
      <CtaCard />
      <Vignette />
    </AbsoluteFill>
  );
};
