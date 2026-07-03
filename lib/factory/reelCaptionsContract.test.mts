// Контракт монтажного слоя рилсов. Запуск: npx tsx lib/factory/reelCaptionsContract.test.mts
import { ok, equal } from "node:assert/strict";
import {
  escapeDrawtext, stripVoiceTags, chunkScript, evenTimings,
  buildCaptionDrawtext, buildNumberPlateDrawtext, buildRubricPlateDrawtext,
  buildReelTextLayer, buildLoopCloseArgs, CAPTION_DEFAULTS,
} from "./reelCaptions";

// экранирование drawtext: двоеточие/процент/бэкслеш экранированы, апостроф заменён
ok(escapeDrawtext("a:b").includes("\\:"), "двоеточие экранировано");
ok(escapeDrawtext("100%").includes("\\%"), "процент экранирован");
ok(!escapeDrawtext("it's").includes("'"), "апостроф убран (drawtext рвётся на ')");
ok(escapeDrawtext("a,b").includes("\\,"), "запятая экранирована");

// голосовые теги вырезаются из титров
equal(stripVoiceTags("Так [exhales] тихо [whispers] всё"), "Так тихо всё", "теги [..] вырезаны");

// чанки — короткие (≤14 симв по умолчанию), стиль авто-капшенов
const chunks = chunkScript("Так я вам сейчас кое-что расскажу тихо ладно");
ok(chunks.every((c) => c.length <= 14), "чанки ≤14 символов");
ok(chunks.length >= 3, "скрипт разбит на несколько чанков");

// тайминг: покрывает длительность, стартует с lead, монотонно растёт
const timed = evenTimings(["а", "бэ", "вэ"], 6, 0.4);
equal(timed.length, 3);
ok(timed[0].start >= 0.4, "старт после lead");
ok(timed[2].end <= 6.01, "последний чанк не выходит за длительность");
ok(timed[0].end <= timed[1].start + 0.01 && timed[1].end <= timed[2].start + 0.01, "чанки последовательны");

// КРИТИЧНО: fontsize НЕ выражение (drawtext не поддерживает expr в fontsize — ломало граф);
// анимируется только alpha
const plate = buildNumberPlateDrawtext({ text: "+2 100 000 руб", start: 0, end: 2.4, accent: "yellow" });
ok(/fontsize=\d+(:|$)/.test(plate), "fontsize — целое число, не выражение");
ok(plate.includes("alpha='"), "alpha анимируется (fade)");
ok(plate.includes("enable='between(t,0,2.4)'"), "плашка ограничена окном хука");
ok(plate.includes("fontcolor=yellow"), "акцентный цвет применён");

// субтитры: по одному drawtext на чанк, центр-низ, обводка, окно enable
const caps = buildCaptionDrawtext(timed);
equal(caps.length, 3, "по drawtext на чанк");
ok(caps.every((c) => c.includes("x=(w-text_w)/2")), "центр по горизонтали");
ok(caps.every((c) => c.includes("borderw=") && c.includes("enable='between")), "обводка + окно");

// рубрика: угловая плашка на весь клип (без enable)
const rub = buildRubricPlateDrawtext("Я посчитала #7");
ok(rub.includes("Я посчитала") && !rub.includes("enable="), "рубрика весь клип");

// полный слой: рубрика + плашка + субтитры одной цепочкой
const layer = buildReelTextLayer({ script: "Так тихо всё", durationS: 6, rubricLabel: "Закат №12", numberPlate: { text: "0 руб", start: 0, end: 2 } });
ok(layer.split("drawtext=").length - 1 >= 3, "цепочка содержит рубрику+плашку+субтитры");

// ASR-тайминг переопределяет even, если передан
const layer2 = buildReelTextLayer({ script: "x", durationS: 6, wordChunks: [{ text: "точно", start: 1.0, end: 2.0 }] });
ok(layer2.includes("точно") && layer2.includes("between(t,1,2)"), "word-timestamps из ASR используются");

// луп-концовка: xfade хвоста в первый кадр (rewatch-рычаг)
const loop = buildLoopCloseArgs("/in.mp4", "/out.mp4", 6.1, 0.4);
ok(loop.join(" ").includes("xfade=transition=fade"), "xfade склейка");
ok(loop.filter((a) => a === "/in.mp4").length === 2, "исходник как оба входа (хвост↔начало)");

console.log("reelCaptionsContract: passed");
