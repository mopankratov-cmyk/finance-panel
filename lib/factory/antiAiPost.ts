// Анти-AI пост-обработка (ресёрч + итерации ревьюера 2026-07-02):
// «слишком чистая картинка» — главный визуальный тел; лечится зерном сенсора,
// ручным тремором, телефонным грейдом и вторым прогоном кодека на телефонном битрейте.
// Аудио: полоса телефонного микрофона + компрессор + комнатный шум под голосом.
// Уроки ревьюера: зерно на одном проходе съедается финальной компрессией —
// класть в ОБА прохода; тёплый каст должен быть глобальным (сплит-тон палится);
// боке и глоу постом не лечатся — это уровень композита.

export interface AntiAiPostParams {
  grainPassA: number;
  grainPassB: number;
  warmthK: number;
  saturation: number;
  contrast: number;
  shakeAmpLowPx: number;
  shakeAmpHighPx: number;
  vignette: string;
  crushBitrateK: number;
  roomToneDb: number;
}

export const ANTI_AI_DEFAULTS: AntiAiPostParams = {
  grainPassA: 16,
  grainPassB: 10,
  warmthK: 7300,
  saturation: 1.05,
  contrast: 1.06,
  shakeAmpLowPx: 8,
  shakeAmpHighPx: 3,
  vignette: "PI/8",
  crushBitrateK: 2200,
  roomToneDb: 0.0035,
};

export function buildAntiAiVideoFilter(p: AntiAiPostParams = ANTI_AI_DEFAULTS): string {
  return [
    "fps=30",
    "scale=iw*1.04:ih*1.04",
    `crop=iw/1.04:ih/1.04:x='(in_w-out_w)/2+${p.shakeAmpLowPx}*sin(t*1.3)+${p.shakeAmpHighPx}*sin(t*7.9)':y='(in_h-out_h)/2+${Math.max(1, p.shakeAmpLowPx - 2)}*sin(t*1.7)+${Math.max(1, p.shakeAmpHighPx - 1)}*sin(t*9.3)'`,
    `eq=contrast=${p.contrast}:saturation=${p.saturation}:gamma=1.0:brightness=0.01`,
    `colortemperature=temperature=${p.warmthK}`,
    "curves=all='0/0.02 0.5/0.52 1/1'",
    "rgbashift=rh=-1:bh=1",
    `noise=alls=${p.grainPassA}:allf=t+u`,
    `vignette=${p.vignette}`,
  ].join(",");
}

export function buildAntiAiAudioFilter(): string {
  return [
    "highpass=f=120",
    "lowpass=f=9000",
    "acompressor=threshold=-18dB:ratio=3:attack=20:release=250:makeup=2",
    "aecho=0.8:0.88:30|45:0.18|0.12",
  ].join(",");
}

export function buildAntiAiFilterComplex(p: AntiAiPostParams = ANTI_AI_DEFAULTS): string {
  return `[0:v]${buildAntiAiVideoFilter(p)}[v];[0:a]${buildAntiAiAudioFilter()}[voice];[voice][1:a]amix=inputs=2:duration=first:normalize=0[a]`;
}

// два прохода: A = грейд+зерно на высоком качестве, B = телефонный битрейт + добивка зерна,
// пережившего компрессию (урок ревьюера v3)
export function buildAntiAiPassArgs(input: string, output: string, p: AntiAiPostParams = ANTI_AI_DEFAULTS): { passA: string[]; passB: (graded: string) => string[] } {
  const roomTone = `anoisesrc=colour=brown:amplitude=${p.roomToneDb}:r=44100`;
  return {
    passA: [
      "-y", "-i", input, "-f", "lavfi", "-i", roomTone,
      "-filter_complex", buildAntiAiFilterComplex(p),
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-crf", "17", "-tune", "grain", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
    ],
    passB: (graded: string) => [
      "-y", "-i", graded,
      "-vf", `noise=alls=${p.grainPassB}:allf=t+u`,
      "-c:v", "libx264", "-profile:v", "main",
      "-b:v", `${p.crushBitrateK}k`, "-maxrate", `${p.crushBitrateK + 500}k`, "-bufsize", `${p.crushBitrateK * 2}k`,
      "-c:a", "aac", "-b:a", "96k",
      output,
    ],
  };
}
