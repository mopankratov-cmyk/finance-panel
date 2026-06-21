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
export const DURATION = 506;
const VO_RATE = 1.15;
const ACCENT = "#ff5a1f";

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

const SceneClip: React.FC<{
  src: string;
  durationInFrames: number;
  startFrom: number;
  cropScale?: number;
  ty?: number;
  flash?: boolean;
  shake?: number;
  punchFrom?: number;
}> = ({src, durationInFrames, startFrom, cropScale = 1, ty = 0, flash = false, shake = 3, punchFrom = 1.18}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const entry = spring({frame, fps, config: {damping: 16, mass: 0.4}});
  const punch = interpolate(entry, [0, 1], [punchFrom, 1]);
  const kb = interpolate(frame, [0, durationInFrames], [1, 1.07], {extrapolateRight: "clamp"});
  const opacity = interpolate(frame, [0, 3], [0, 1], {extrapolateRight: "clamp"});
  const scale = cropScale * punch * kb;
  const dx = shake ? Math.sin(frame * 1.7) * shake : 0;
  const dy = shake ? Math.cos(frame * 2.3) * shake : 0;
  const flashOp = flash ? interpolate(frame, [0, 5], [0.75, 0], {extrapolateRight: "clamp"}) : 0;
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
          transform: `translate(${dx}px, ${dy}px) scale(${scale}) translateY(${ty}%)`,
          filter: "contrast(1.09) saturate(1.2) brightness(1.02)",
        }}
      />
      {flash ? <AbsoluteFill style={{background: "#fff", opacity: flashOp}} /> : null}
    </AbsoluteFill>
  );
};

const Scrim: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(180deg, rgba(0,0,0,.4) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 50%, rgba(0,0,0,.66) 100%)",
    }}
  />
);

const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{background: "radial-gradient(118% 78% at 50% 44%, rgba(0,0,0,0) 52%, rgba(0,0,0,.46) 100%)"}}
  />
);

// ── native running captions ─────────────────────────────────────
const CHUNKS = [
  "Не показывай детям",
  "это не игрушка",
  "это водяной Узи",
  "лупит очередями",
  "на 8 метров",
  "светится, со звуком",
  "купил, типа, детям...",
  "а сам бегаю по даче",
];
const WEIGHTS = CHUNKS.map((c) => Math.max(5, c.replace(/\s/g, "").length));
const TOTAL_W = WEIGHTS.reduce((a, b) => a + b, 0);
const CAP_END = 440; // captions occupy 0..440; CTA card takes the tail
const RANGES = (() => {
  let acc = 0;
  return CHUNKS.map((text, i) => {
    const start = acc / TOTAL_W;
    acc += WEIGHTS[i];
    return {text, startF: Math.round(start * CAP_END), endF: Math.round((acc / TOTAL_W) * CAP_END)};
  });
})();

const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (frame >= CAP_END) return null;
  const cur = RANGES.find((r) => frame >= r.startF && frame < r.endF) ?? RANGES[0];
  const local = frame - cur.startF;
  const words = cur.text.split(" ");
  const accentChunk = cur.text.includes("Узи") || cur.text.includes("8 метров");
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "flex-end", paddingBottom: "25%"}}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0 16px",
          maxWidth: "88%",
          fontFamily: "Montserrat",
          fontWeight: 800,
          fontSize: 84,
          lineHeight: 1.04,
          textAlign: "center",
          letterSpacing: -1,
        }}
      >
        {words.map((w, i) => {
          const s = spring({frame: local - i * 1.5, fps, config: {damping: 14, mass: 0.35}});
          const y = interpolate(s, [0, 1], [30, 0]);
          const sc = interpolate(s, [0, 1], [0.5, 1]);
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                transform: `translateY(${y}px) scale(${sc})`,
                opacity: s,
                color: accentChunk ? ACCENT : "#fff",
                WebkitTextStroke: "9px #000",
                paintOrder: "stroke" as React.CSSProperties["paintOrder"],
                textShadow: "0 5px 22px rgba(0,0,0,.65)",
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

// ── branded CTA end card ────────────────────────────────────────
const CtaCard: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (frame < CAP_END) return null;
  const local = frame - CAP_END;
  const s = spring({frame: local, fps, config: {damping: 13, mass: 0.5}});
  const y = interpolate(s, [0, 1], [60, 0]);
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}>
      <div style={{transform: `translateY(${y}px)`, opacity: s, textAlign: "center", width: "92%"}}>
        <div
          style={{
            fontFamily: "Unbounded",
            fontWeight: 800,
            fontSize: 118,
            lineHeight: 0.98,
            textTransform: "uppercase",
            letterSpacing: -2,
            color: "#fff",
            WebkitTextStroke: "10px #000",
            paintOrder: "stroke" as React.CSSProperties["paintOrder"],
            textShadow: "0 8px 30px rgba(0,0,0,.6)",
          }}
        >
          водяной<br />Узи
        </div>
        <div
          style={{
            marginTop: 34,
            display: "inline-block",
            background: ACCENT,
            color: "#fff",
            fontFamily: "Montserrat",
            fontWeight: 800,
            fontSize: 52,
            letterSpacing: 0,
            padding: "16px 34px",
            borderRadius: 18,
            boxShadow: "0 10px 30px rgba(0,0,0,.45)",
          }}
        >
          ищи на WB · 800 ₽
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const ReelV3: React.FC = () => {
  useFonts();
  return (
    <AbsoluteFill style={{backgroundColor: "#000"}}>
      <Audio src={staticFile("reel-assets/vo4.mp3")} volume={1} playbackRate={VO_RATE} />
      <Audio src={staticFile("reel-assets/music.mp3")} volume={0.16} />

      <Sequence from={0} durationInFrames={60}>
        <SceneClip src="reel-assets/hook.mp4" durationInFrames={60} startFrom={64} punchFrom={1.38} shake={2} />
        <Scrim />
      </Sequence>
      <Sequence from={60} durationInFrames={42}>
        <SceneClip src="reel-assets/hook.mp4" durationInFrames={42} startFrom={96} flash shake={9} />
        <Scrim />
      </Sequence>
      <Sequence from={102} durationInFrames={128}>
        <SceneClip src="reel-assets/boy.mp4" durationInFrames={128} startFrom={6} cropScale={1.66} ty={-11} flash />
        <Scrim />
      </Sequence>
      <Sequence from={230} durationInFrames={150}>
        <SceneClip src="reel-assets/girl.mp4" durationInFrames={150} startFrom={0} cropScale={1.18} ty={-2} flash />
        <Scrim />
      </Sequence>
      <Sequence from={380} durationInFrames={126}>
        <SceneClip src="reel-assets/hook.mp4" durationInFrames={126} startFrom={10} cropScale={1.04} flash />
        <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(0,0,0,.15) 0%, rgba(0,0,0,.25) 45%, rgba(0,0,0,.75) 100%)"}} />
      </Sequence>

      <Captions />
      <CtaCard />
      <Vignette />
    </AbsoluteFill>
  );
};
