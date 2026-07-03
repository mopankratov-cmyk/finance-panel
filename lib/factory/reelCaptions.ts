// Монтажный слой рилсов Мани: вшитые кинетические субтитры + цифры-плашки + плашка рубрики
// + луп-концовка. Всё на ffmpeg drawtext (libfreetype) — без внешних библиотек анимаций
// и без риска ненайденного шрифта у libass (drawtext берёт явный fontfile).
// Дизайн-принцип: «сырой UGC», не produced-графика — субтитры как в авто-капшенах телефона
// (жирный текст с обводкой, центр-низ), а не моушен-дизайн, чтобы не ломать реализм-пас.
// Требования алгоритмов 2026 (docs/factory-manya-content-plan.md §3): субтитры ВСЕГДА вшиты
// (+40% watch time, ранжирующий фактор); результат-вперёд (цифра в первые 0-2с); луп-концовка.

export interface CaptionStyle {
  fontFile: string;   // явный путь (drawtext не зависит от fontconfig)
  fontSize: number;   // базовый кегль субтитров (на холсте 1080-шириной)
  yFrac: number;      // вертикаль субтитров (доля высоты; 0.72 = нижняя треть, но выше края)
  outline: number;    // толщина чёрной обводки (borderw)
}
export const CAPTION_DEFAULTS: CaptionStyle = {
  fontFile: "/System/Library/Fonts/Helvetica.ttc",
  fontSize: 64,
  yFrac: 0.70,
  outline: 6,
};

export interface TimedChunk { text: string; start: number; end: number }

// Экранирование текста для drawtext: спецсимволы : ' % \ и перевод строки.
export function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’")   // апостроф → типографский (drawtext рвётся на ')
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,");
}

// Убрать голосовые теги ([exhales]/[whispers]/[laughs]) и лишние пробелы — в титрах их нет.
export function stripVoiceTags(script: string): string {
  return script.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
}

// Разбить скрипт на короткие капшен-чанки (1-3 слова / ≤14 символов) — стиль авто-капшенов
// телефона: 1-3 слова на экране, сменяются по речи.
export function chunkScript(script: string, maxChars = 14): string[] {
  const words = stripVoiceTags(script).split(" ").filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length > maxChars && cur) { chunks.push(cur); cur = w; }
    else cur = cand;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// Равномерный тайминг чанков по длительности голоса (fallback без ASR; для точного
// пословного — whisper word-timestamps из asr.ts, подставляются как TimedChunk напрямую).
// lead — задержка старта (первые кадры отдаём хук-плашке, не субтитрам).
export function evenTimings(chunks: string[], durationS: number, lead = 0.4): TimedChunk[] {
  const span = Math.max(0.1, durationS - lead);
  const per = span / Math.max(1, chunks.length);
  return chunks.map((text, i) => ({ text, start: +(lead + i * per).toFixed(2), end: +(lead + (i + 1) * per).toFixed(2) }));
}

// Кинетические субтитры: по одному drawtext на чанк с окном enable и быстрым fade-in.
// Активный чанк — крупный, белый, с чёрной обводкой, центр-низ (нативный вид).
export function buildCaptionDrawtext(chunks: TimedChunk[], style: CaptionStyle = CAPTION_DEFAULTS, canvasW = 1080, canvasH = 1920): string[] {
  const fs = Math.round((style.fontSize / 1080) * canvasW);
  const y = Math.round(style.yFrac * canvasH);
  return chunks.map((c) => {
    const fadeIn = 0.12;
    // alpha: быстрый проявляющий fade в начале окна чанка
    const alpha = `if(lt(t,${c.start}),0,if(lt(t,${(c.start + fadeIn).toFixed(2)}),(t-${c.start})/${fadeIn},1))`;
    return [
      `drawtext=fontfile=${style.fontFile}`,
      `text='${escapeDrawtext(c.text)}'`,
      `fontcolor=white`, `fontsize=${fs}`,
      `borderw=${style.outline}`, `bordercolor=black@0.9`,
      `x=(w-text_w)/2`, `y=${y}`,
      `alpha='${alpha}'`,
      `enable='between(t,${c.start},${c.end})'`,
    ].join(":");
  });
}

// Хук-плашка «результат вперёд»: крупная цифра/итог в первые 0-2.5с (паттерн-разрыв до лица).
// Fade-in + лёгкий подъём кегля (scale) через выражение fontsize по t.
export interface NumberPlate { text: string; start?: number; end?: number; accent?: string }
export function buildNumberPlateDrawtext(plate: NumberPlate, style: CaptionStyle = CAPTION_DEFAULTS, canvasW = 1080, canvasH = 1920): string {
  const start = plate.start ?? 0;
  const end = plate.end ?? 2.5;
  // fontsize в drawtext — НЕ expression-capable (только x/y/alpha), поэтому кегль константный;
  // анимируем только alpha (fade-in → hold → fade-out), этого достаточно для хук-плашки.
  const fs = Math.round((150 / 1080) * canvasW); // хук-плашка крупнее субтитров
  const alpha = `if(lt(t,${start}),0,if(lt(t,${(start + 0.15).toFixed(2)}),(t-${start})/0.15,if(lt(t,${(end - 0.2).toFixed(2)}),1,max(0,(${end}-t)/0.2))))`;
  return [
    `drawtext=fontfile=${style.fontFile}`,
    `text='${escapeDrawtext(plate.text)}'`,
    `fontcolor=${plate.accent || "white"}`, `fontsize=${fs}`,
    `borderw=8`, `bordercolor=black`,
    `x=(w-text_w)/2`, `y=${Math.round(canvasH * 0.34)}`,
    `alpha='${alpha}'`,
    `enable='between(t,${start},${end})'`,
  ].join(":");
}

// Плашка рубрики: небольшой лейбл серии в углу весь клип («Я посчитала #7», «Закат №12»).
export function buildRubricPlateDrawtext(label: string, style: CaptionStyle = CAPTION_DEFAULTS, canvasW = 1080, canvasH = 1920): string {
  const fs = Math.round((34 / 1080) * canvasW);
  return [
    `drawtext=fontfile=${style.fontFile}`,
    `text='${escapeDrawtext(label)}'`,
    `fontcolor=white@0.9`, `fontsize=${fs}`,
    `borderw=4`, `bordercolor=black@0.8`,
    `x=${Math.round(canvasW * 0.05)}`, `y=${Math.round(canvasH * 0.06)}`,
  ].join(":");
}

// Полный текст-слой рилса: рубрика (весь клип) + хук-плашка (0-2.5с) + кинетические субтитры.
// Возвращает готовую цепочку фильтров для вставки в -vf ПОСЛЕ реализм-паса, ПЕРЕД финальным кодеком.
export interface ReelTextLayerInput {
  script: string;
  durationS: number;
  rubricLabel?: string;
  numberPlate?: NumberPlate;
  wordChunks?: TimedChunk[]; // если есть ASR-тайминг — используем его вместо even
  style?: CaptionStyle;
  canvasW?: number;
  canvasH?: number;
}
export function buildReelTextLayer(input: ReelTextLayerInput): string {
  const style = input.style || CAPTION_DEFAULTS;
  const W = input.canvasW || 1080, H = input.canvasH || 1920;
  const chunks = input.wordChunks && input.wordChunks.length
    ? input.wordChunks
    : evenTimings(chunkScript(input.script), input.durationS, input.numberPlate ? Math.max(0.4, (input.numberPlate.end ?? 2.5) - 0.3) : 0.4);
  const filters: string[] = [];
  if (input.rubricLabel) filters.push(buildRubricPlateDrawtext(input.rubricLabel, style, W, H));
  if (input.numberPlate) filters.push(buildNumberPlateDrawtext(input.numberPlate, style, W, H));
  filters.push(...buildCaptionDrawtext(chunks, style, W, H));
  return filters.join(",");
}

// Луп-концовка: докрутка хвоста к первому кадру коротким crossfade (последний кадр = первый →
// бесшовный повтор, растит rewatch — сильнейший рычаг FYP). Возвращает аргументы ffmpeg для
// склейки clip + его же начала через xfade. tailS — длительность смыкания.
export function buildLoopCloseArgs(input: string, output: string, durationS: number, tailS = 0.4): string[] {
  const off = Math.max(0.1, durationS - tailS);
  return [
    "-y", "-i", input, "-i", input,
    "-filter_complex",
    `[0:v]trim=0:${off.toFixed(2)},setpts=PTS-STARTPTS[a];` +
    `[1:v]trim=0:${tailS.toFixed(2)},setpts=PTS-STARTPTS[b];` +
    `[a][b]xfade=transition=fade:duration=${tailS.toFixed(2)}:offset=${(off - tailS).toFixed(2)}[v]`,
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", output,
  ];
}
