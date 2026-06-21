import React, {useEffect, useState} from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Audio,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  staticFile,
  delayRender,
  continueRender,
} from "remotion";

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

// ── fonts (variable TTF, Cyrillic) ──────────────────────────────
function useFonts() {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    const load = (fam: string, file: string) =>
      new FontFace(fam, `url(${staticFile(file)}) format('truetype')`, {weight: "100 900"}).load();
    Promise.all([load("Montserrat", "fonts/Montserrat.ttf"), load("Unbounded", "fonts/Unbounded.ttf")])
      .then((fonts) => {
        fonts.forEach((f) => (document as unknown as {fonts: FontFaceSet}).fonts.add(f));
        continueRender(handle);
      })
      .catch(() => continueRender(handle));
  }, [handle]);
}

// ── scene clip: crop + ken-burns + entry punch ──────────────────
const SceneClip: React.FC<{
  src: string;
  durationInFrames: number;
  startFrom: number;
  cropScale?: number;
  ty?: number;
}> = ({src, durationInFrames, startFrom, cropScale = 1, ty = 0}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const entry = spring({frame, fps, config: {damping: 18, mass: 0.5}});
  const punch = interpolate(entry, [0, 1], [1.14, 1]);
  const kb = interpolate(frame, [0, durationInFrames], [1, 1.07], {extrapolateRight: "clamp"});
  const opacity = interpolate(frame, [0, 5], [0, 1], {extrapolateRight: "clamp"});
  const scale = cropScale * punch * kb;
  return (
    <AbsoluteFill style={{overflow: "hidden", opacity}}>
      <OffthreadVideo
        src={staticFile(src)}
        startFrom={startFrom}
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translateY(${ty}%)`,
          filter: "contrast(1.06) saturate(1.14)",
        }}
      />
    </AbsoluteFill>
  );
};

// subtle scrim for legibility
const Scrim: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(180deg, rgba(0,0,0,.45) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0) 60%, rgba(0,0,0,.55) 100%)",
    }}
  />
);

// cinematic vignette
const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background: "radial-gradient(120% 80% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,.42) 100%)",
      pointerEvents: "none",
    }}
  />
);

const OUTLINE: React.CSSProperties = {
  color: "#fff",
  WebkitTextStroke: "9px #000",
  paintOrder: "stroke" as React.CSSProperties["paintOrder"],
  textShadow: "0 6px 24px rgba(0,0,0,.55)",
};

// ── kinetic title: word-by-word spring pop ──────────────────────
const KineticTitle: React.FC<{
  text: string;
  top: string;
  size: number;
  accent?: string;
}> = ({text, top, size, accent}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const words = text.split(" ");
  return (
    <AbsoluteFill style={{top, alignItems: "center", justifyContent: "flex-start"}}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0 18px",
          maxWidth: "90%",
          fontFamily: "Unbounded",
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1.02,
          textAlign: "center",
          textTransform: "uppercase",
          letterSpacing: -1,
        }}
      >
        {words.map((w, i) => {
          const s = spring({frame: frame - i * 3, fps, config: {damping: 12, mass: 0.5}});
          const y = interpolate(s, [0, 1], [50, 0]);
          const sc = interpolate(s, [0, 1], [0.7, 1]);
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                transform: `translateY(${y}px) scale(${sc})`,
                opacity: s,
                ...OUTLINE,
                color: accent ?? "#fff",
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── small caption (specs / cta line) ────────────────────────────
const Caption: React.FC<{text: string; bottom?: string; top?: string; size?: number}> = ({
  text,
  bottom,
  top,
  size = 52,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame, fps, config: {damping: 16, mass: 0.5}});
  const y = interpolate(s, [0, 1], [30, 0]);
  return (
    <AbsoluteFill style={{top, bottom, alignItems: "center", justifyContent: top ? "flex-start" : "flex-end"}}>
      <div
        style={{
          transform: `translateY(${y}px)`,
          opacity: s,
          fontFamily: "Montserrat",
          fontWeight: 800,
          fontSize: size,
          textAlign: "center",
          maxWidth: "88%",
          letterSpacing: -0.5,
          ...OUTLINE,
          WebkitTextStroke: "6px #000",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const ACCENT = "#ff5a1f";

export const ReelV2: React.FC = () => {
  useFonts();
  return (
    <AbsoluteFill style={{backgroundColor: "#000"}}>
      <Audio src={staticFile("reel-assets/music.mp3")} volume={0.85} />

      {/* 1 — HOOK: product + blast */}
      <Sequence from={0} durationInFrames={54}>
        <SceneClip src="reel-assets/hook.mp4" durationInFrames={54} startFrom={60} />
        <Scrim />
        <KineticTitle text="Серьёзная штука?" top="13%" size={132} />
      </Sequence>

      {/* 2 — BOY aiming (real kid) */}
      <Sequence from={54} durationInFrames={60}>
        <SceneClip src="reel-assets/boy.mp4" durationInFrames={60} startFrom={8} cropScale={1.66} ty={-11} />
        <Scrim />
        <KineticTitle text="а это — водяной" top="73%" size={98} />
      </Sequence>

      {/* 3 — GIRL spray (real kid) */}
      <Sequence from={114} durationInFrames={60}>
        <SceneClip src="reel-assets/girl.mp4" durationInFrames={60} startFrom={18} cropScale={1.18} ty={-2} />
        <Scrim />
        <KineticTitle text="вот это лето" top="74%" size={92} accent={ACCENT} />
      </Sequence>

      {/* 4 — PRODUCT spec */}
      <Sequence from={174} durationInFrames={54}>
        <SceneClip src="reel-assets/hook.mp4" durationInFrames={54} startFrom={16} cropScale={1.04} />
        <Scrim />
        <Caption text="8 м · автозалп + звук" top="9%" size={56} />
      </Sequence>

      {/* 5 — CTA */}
      <Sequence from={228} durationInFrames={64}>
        <SceneClip src="reel-assets/hook.mp4" durationInFrames={64} startFrom={4} cropScale={1.04} />
        <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,.7) 100%)"}} />
        <KineticTitle text="Ищи на WB" top="58%" size={112} accent={ACCENT} />
        <Caption text="«Водяной пистолет УЗИ»" bottom="15%" size={52} />
      </Sequence>

      <Vignette />
    </AbsoluteFill>
  );
};
