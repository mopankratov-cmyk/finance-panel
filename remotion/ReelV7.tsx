import React, {useEffect, useState} from "react";
import {
  AbsoluteFill, OffthreadVideo, Audio, Sequence,
  useCurrentFrame, useVideoConfig, spring, interpolate, staticFile, delayRender, continueRender,
} from "remotion";

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const DURATION = 490;
const VEO_END = 240; // Veo hook 8s
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

const OUTLINE = {WebkitTextStroke: "9px #000", paintOrder: "stroke", textShadow: "0 5px 22px rgba(0,0,0,.65)"};

const Clip = ({src, durationInFrames, startFrom, cropScale = 1, ty = 0, flash = false}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const entry = spring({frame, fps, config: {damping: 15, mass: 0.4}});
  const punch = interpolate(entry, [0, 1], [1.2, 1]);
  const kb = interpolate(frame, [0, durationInFrames], [1, 1.08], {extrapolateRight: "clamp"});
  const op = interpolate(frame, [0, 3], [0, 1], {extrapolateRight: "clamp"});
  const sh = Math.sin(frame * 1.8) * 3.5;
  const flashOp = flash ? interpolate(frame, [0, 5], [0.75, 0], {extrapolateRight: "clamp"}) : 0;
  return (
    <AbsoluteFill style={{overflow: "hidden", opacity: op}}>
      <OffthreadVideo src={staticFile(src)} startFrom={startFrom} muted
        style={{width: "100%", height: "100%", objectFit: "cover", transform: `translate(${sh}px,0) scale(${cropScale * punch * kb}) translateY(${ty}%)`, filter: "contrast(1.08) saturate(1.18)"}} />
      {flash ? <AbsoluteFill style={{background: "#fff", opacity: flashOp}} /> : null}
    </AbsoluteFill>
  );
};

const Scrim = () => (<AbsoluteFill style={{background: "linear-gradient(180deg, rgba(0,0,0,.35) 0%, rgba(0,0,0,0) 24%, rgba(0,0,0,0) 52%, rgba(0,0,0,.62) 100%)"}} />);
const Vignette = () => (<AbsoluteFill style={{background: "radial-gradient(118% 78% at 50% 44%, rgba(0,0,0,0) 54%, rgba(0,0,0,.44) 100%)"}} />);
const Grade = () => (<AbsoluteFill style={{background: "linear-gradient(180deg, rgba(255,170,85,0.12), rgba(255,135,55,0.07))", mixBlendMode: "soft-light", pointerEvents: "none"}} />);

const CAPS = [
  {t: "не показывай детям", s: 12, e: 115, big: true},
  {t: "это не игрушка", s: 120, e: 182},
  {t: "это водяной Узи", s: 186, e: 238, acc: true},
  {t: "лупит очередями на 8 метров", s: 246, e: 308, acc: true},
  {t: "светится, со звуком", s: 313, e: 378},
  {t: "купил детям... ну да, конечно", s: 383, e: 428},
];

const Captions = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const cur = CAPS.find((c) => frame >= c.s && frame < c.e);
  if (!cur) return null;
  const local = frame - cur.s;
  const words = cur.t.split(" ");
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "flex-end", paddingBottom: cur.big ? "22%" : "14%"}}>
      <div style={{display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 14px", maxWidth: cur.big ? "94%" : "88%",
        fontFamily: "Montserrat", fontWeight: 800, fontSize: cur.big ? 100 : 76, lineHeight: 1.05, textAlign: "center", letterSpacing: -1, textTransform: cur.big ? "uppercase" : "none"}}>
        {words.map((w, i) => {
          const sp = spring({frame: local - i * 1.5, fps, config: {damping: 14, mass: 0.35}});
          return (<span key={i} style={{display: "inline-block", transform: `translateY(${interpolate(sp, [0, 1], [30, 0])}px) scale(${interpolate(sp, [0, 1], [0.55, 1])})`, opacity: sp, color: cur.acc ? ACCENT : "#fff", ...OUTLINE}}>{w}</span>);
        })}
      </div>
    </AbsoluteFill>
  );
};

const CtaCard = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (frame < 430) return null;
  const s = spring({frame: frame - 430, fps, config: {damping: 13, mass: 0.5}});
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}>
      <div style={{transform: `translateY(${interpolate(s, [0, 1], [60, 0])}px)`, opacity: s, textAlign: "center", width: "92%"}}>
        <div style={{fontFamily: "Unbounded", fontWeight: 800, fontSize: 120, lineHeight: 0.98, textTransform: "uppercase", letterSpacing: -2, color: "#fff", ...OUTLINE, WebkitTextStroke: "10px #000"}}>водяной<br />Узи</div>
        <div style={{marginTop: 32, display: "inline-block", background: ACCENT, color: "#fff", fontFamily: "Montserrat", fontWeight: 800, fontSize: 54, padding: "16px 36px", borderRadius: 18, boxShadow: "0 10px 30px rgba(0,0,0,.45)"}}>ищи на WB</div>
        <div style={{marginTop: 22, fontFamily: "Montserrat", fontWeight: 800, fontSize: 34, letterSpacing: 2, color: "#fff", opacity: 0.92, ...OUTLINE, WebkitTextStroke: "5px #000"}}>TIM TIN</div>
      </div>
    </AbsoluteFill>
  );
};

export const ReelV7 = () => {
  useFonts();
  return (
    <AbsoluteFill style={{backgroundColor: "#000"}}>
      {/* music low under the spoken hook, then swells into an energetic montage when the voice ends */}
      <Audio src={staticFile("reel-assets/music2.mp3")} volume={(f) => (f < VEO_END - 12 ? 0.16 : interpolate(f, [VEO_END - 12, VEO_END + 8], [0.16, 0.6], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}))} />

      {/* VEO energetic hook (his video + voice) */}
      <Sequence from={0} durationInFrames={VEO_END}>
        <AbsoluteFill style={{overflow: "hidden"}}>
          <OffthreadVideo src={staticFile("reel-assets/veo.mp4")} style={{width: "100%", height: "100%", objectFit: "cover", filter: "contrast(1.06) saturate(1.12)"}} />
        </AbsoluteFill>
        <Scrim />
      </Sequence>

      {/* our real product + kids b-roll */}
      <Sequence from={240} durationInFrames={70}>
        <Clip src="reel-assets/boy.mp4" durationInFrames={70} startFrom={8} cropScale={1.66} ty={-11} flash />
        <Scrim />
      </Sequence>
      <Sequence from={310} durationInFrames={70}>
        <Clip src="reel-assets/girl.mp4" durationInFrames={70} startFrom={6} cropScale={1.18} ty={-2} flash />
        <Scrim />
      </Sequence>
      <Sequence from={380} durationInFrames={110}>
        <Clip src="reel-assets/hook.mp4" durationInFrames={110} startFrom={70} flash />
        <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(0,0,0,.15) 0%, rgba(0,0,0,.3) 45%, rgba(0,0,0,.72) 100%)"}} />
      </Sequence>

      <Grade />
      <Captions />
      <CtaCard />
      <Vignette />
    </AbsoluteFill>
  );
};
