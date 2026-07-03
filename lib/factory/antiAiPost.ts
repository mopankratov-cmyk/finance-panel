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
  sharpenCas: number;
  // Реализм-пас 2026-07-03 (исследование «очеловечивания» AI-видео, 59 находок → 6 приёмов):
  // физика сенсора и оптики, которой нет у чистого рендера. Все приёмы ЗАМЕНЯЮТ, а не
  // добавляют энергию (яркостный шум даже снижен — против вердикта «слишком много шума»).
  lensK1: number;        // бочкообразная дисторсия фронталки (широкоугольный бульж)
  lensK2: number;
  lumaNoiseA: number;    // сенсорный шум ХРОМО-доминантный: яркость тонко, цвет крупнее
  chromaNoiseA: number;  // (реальный CMOS шумит цветом в тенях; равномерный gaussian палится)
  lumaNoiseB: number;
  chromaNoiseB: number;
  aeDriftBright: number; // «дыхание» автоэкспозиции во времени (телефон микро-охотится ±1%)
  aeDriftContrast: number;
}

// grainPassA/B: ревьюер просил «зерно должно читаться» (16+10), владелец 2026-07-02
// вердиктнул «слишком много шума» — калибровка глазом владельца сильнее: 8+5.
// Вердикты владельца 2026-07-02: «мягкая картинка» → CAS+lanczos; «мыла многовато» → 1080p+CAS 0.55;
// «камера дрожит» → тряска вдвое ниже (4/1.5px — дыхание руки, не дрожь);
// CAS 0.55 + битрейт 3200k + рендеры Avatar IV на 1080p (720p был источником мыла).
// 2026-07-03 «сильно тёплые, настройка камеры чуть другая» → warmthK 7300→6400:
// белое перестаёт рыжить даже на золотом часе. Grayworld-автобаланс ОТКЛОНЁН —
// слепнет на тёплых сценах (уводит в синеву), даже в бленде 35%.
export const ANTI_AI_DEFAULTS: AntiAiPostParams = {
  grainPassA: 8, // legacy (заменён на luma/chromaNoise; оставлен для обратной совместимости)
  grainPassB: 5,
  warmthK: 6400,
  saturation: 1.05,
  contrast: 1.06,
  shakeAmpLowPx: 4,
  shakeAmpHighPx: 1.5,
  vignette: "PI/8",
  crushBitrateK: 3200,
  roomToneDb: 0.0035,
  sharpenCas: 0.55,
  lensK1: -0.05,
  lensK2: -0.012,
  lumaNoiseA: 5,     // ниже прежнего grainPassA=8 → меньше «шума» глазом, но реалистичнее
  chromaNoiseA: 12,
  lumaNoiseB: 3,
  chromaNoiseB: 7,
  aeDriftBright: 0.012,
  aeDriftContrast: 0.006,
};

// Адаптивный грейд (урок 2026-07-02: «дотенение», откалиброванное на ярком v6,
// утопило тёмный HeyGen-рендер). Замер: ffmpeg signalstats YAVG по первым кадрам.
export function adaptGradeToLuma(yavg: number, base: AntiAiPostParams = ANTI_AI_DEFAULTS): AntiAiPostParams & { gamma: number; brightness: number; blackLift: number } {
  if (yavg < 105) {
    // тёмный исходник: лифт вместо прижатия
    return { ...base, contrast: 1.05, gamma: 1.06, brightness: 0.04, blackLift: 0.01 };
  }
  if (yavg > 150) {
    // яркий глянцевый: дотенение
    return { ...base, contrast: 1.08, gamma: 0.97, brightness: 0.005, blackLift: 0.035 };
  }
  return { ...base, gamma: 1.0, brightness: 0.01, blackLift: 0.02 };
}

// Порядок физически когерентен: линза (бочка) ДО кропа/шейка и виньетки — чтобы
// геометрия краёв и виньетка сошлись; хромо-смаз (hqdn3d) ДО резкости по яркости
// (иначе режем, потом мылим цвет); шум ПОЗДНО и до виньетки. Дрейф экспозиции —
// временной (через eq-выражения по t), добавляет 0 зерна, читается как «дыхание» AE.
// Дрейф баланса белого НЕ вводим: warmthK только что откалиброван (6400), качание
// на пиках рисковало бы вернуть вердикт «слишком тёплое».
export function buildAntiAiVideoFilter(p: AntiAiPostParams = ANTI_AI_DEFAULTS): string {
  return [
    "fps=30",
    "scale=iw*1.04:ih*1.04:flags=lanczos",
    `lenscorrection=cx=0.5:cy=0.5:k1=${p.lensK1}:k2=${p.lensK2}:i=bilinear`,
    `crop=iw/1.04:ih/1.04:x='(in_w-out_w)/2+${p.shakeAmpLowPx}*sin(t*1.3)+${p.shakeAmpHighPx}*sin(t*7.9)':y='(in_h-out_h)/2+${Math.max(1, p.shakeAmpLowPx - 2)}*sin(t*1.7)+${Math.max(1, p.shakeAmpHighPx - 1)}*sin(t*9.3)'`,
    `eq=contrast='${p.contrast}+${p.aeDriftContrast}*sin(2*PI*t/5)':saturation=${p.saturation}:gamma=1.0:brightness='0.01+${p.aeDriftBright}*sin(2*PI*t/3.3)'`,
    `colortemperature=temperature=${p.warmthK}`,
    "curves=all='0/0.02 0.5/0.52 1/0.97'",
    "hqdn3d=1.5:6:3:5",
    "unsharp=5:5:0.4:5:5:0",
    "rgbashift=rh=-1:bh=1",
    `noise=c0s=${p.lumaNoiseA}:c0f=t:c1s=${p.chromaNoiseA}:c1f=t:c2s=${p.chromaNoiseA}:c2f=t`,
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
    // passB: телефонный битрейт-краш + добивка хромо-шума, пережившего компрессию.
    // Длинный GOP + грубое ME (veryfast) заставляют блокинг проступать НА ДВИЖЕНИИ —
    // реальный телефон блокует на жестах, AI-движение остаётся гладким.
    passB: (graded: string) => [
      "-y", "-i", graded,
      "-vf", `noise=c0s=${p.lumaNoiseB}:c0f=t:c1s=${p.chromaNoiseB}:c1f=t:c2s=${p.chromaNoiseB}:c2f=t`,
      "-c:v", "libx264", "-profile:v", "main",
      "-b:v", `${p.crushBitrateK}k`, "-maxrate", `${p.crushBitrateK + 500}k`, "-bufsize", `${p.crushBitrateK * 2}k`,
      "-preset", "veryfast", "-g", "250", "-bf", "3", "-x264-params", "scenecut=0:rc-lookahead=10",
      "-c:a", "aac", "-b:a", "96k",
      output,
    ],
  };
}
