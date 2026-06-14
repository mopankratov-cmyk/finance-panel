import { AbsoluteFill, Img, Series, useCurrentFrame, useVideoConfig, spring, interpolate, Audio } from "remotion";

export interface Shot {
  image: string;          // фон кадра (фото товара / AI-клип кадр)
  onscreen?: string;      // крупный текст на экране (хук/выгода/цена)
  voiceover?: string;     // субтитр-реплика снизу
  seconds?: number;       // длительность кадра
}
export interface ShortProps {
  title: string;
  shots: Shot[];
  cta: string;
  brand?: string;
  musicUrl?: string;
  accent?: string;        // цвет акцента плашек
}

const FPS = 30;

function OnScreen({ text, accent }: { text: string; accent: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const y = interpolate(s, [0, 1], [40, 0]);
  return (
    <div style={{ position: "absolute", top: "12%", left: 0, right: 0, display: "flex", justifyContent: "center", transform: `translateY(${y}px)`, opacity: s }}>
      <div style={{ background: accent, color: "#fff", fontWeight: 800, fontSize: 72, lineHeight: 1.1, padding: "18px 28px", borderRadius: 18, maxWidth: "84%", textAlign: "center", boxShadow: "0 8px 30px rgba(0,0,0,.35)" }}>{text}</div>
    </div>
  );
}

function Caption({ text }: { text: string }) {
  return (
    <div style={{ position: "absolute", bottom: "16%", left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div style={{ background: "rgba(0,0,0,.62)", color: "#fff", fontWeight: 600, fontSize: 46, lineHeight: 1.25, padding: "12px 22px", borderRadius: 14, maxWidth: "88%", textAlign: "center" }}>{text}</div>
    </div>
  );
}

export const ShortVideo: React.FC<ShortProps> = ({ shots, cta, brand, musicUrl, accent = "#e11d48" }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", fontFamily: "Arial, Helvetica, sans-serif" }}>
      {musicUrl ? <Audio src={musicUrl} volume={0.5} /> : null}
      <Series>
        {shots.map((sh, i) => (
          <Series.Sequence key={i} durationInFrames={Math.round((sh.seconds || 4) * FPS)}>
            <AbsoluteFill>
              {sh.image ? <Img src={sh.image} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <AbsoluteFill style={{ background: "#111" }} />}
              <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,0) 30%, rgba(0,0,0,0) 60%, rgba(0,0,0,.45))" }} />
              {sh.onscreen ? <OnScreen text={sh.onscreen} accent={accent} /> : null}
              {sh.voiceover ? <Caption text={sh.voiceover} /> : null}
            </AbsoluteFill>
          </Series.Sequence>
        ))}
        <Series.Sequence durationInFrames={Math.round(2.5 * FPS)}>
          <AbsoluteFill style={{ background: accent, alignItems: "center", justifyContent: "center", padding: 60 }}>
            <div style={{ color: "#fff", textAlign: "center" }}>
              <div style={{ fontSize: 60, fontWeight: 800, lineHeight: 1.15 }}>{cta}</div>
              {brand ? <div style={{ fontSize: 40, marginTop: 24, opacity: 0.9 }}>{brand}</div> : null}
              <div style={{ fontSize: 34, marginTop: 28, opacity: 0.85 }}>Ищи на Wildberries 🔍</div>
            </div>
          </AbsoluteFill>
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
