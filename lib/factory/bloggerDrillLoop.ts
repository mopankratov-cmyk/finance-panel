// Drill Loop: петля обучения «идеальный блогер» (план: docs/factory-blogger-drill-loop-plan.md).
// Планировщик батчей: каждый батч сверлит ОДНУ ось глубоко + контрольные клипы
// с лучшими известными параметрами (регрессия-чек). Леджер живёт в РЕПО.
// Отличие от Катиного лупа: скоры пишутся ПО РЕЗУЛЬТАТУ (vision-критик + вердикты
// владельца), а не по плану; уроки промоутятся в канон-код.

import { buildDeglossPrompt } from "@/lib/factory/productComposite";

export type DrillAxis = "light_scene" | "motion" | "start_pose" | "script_style" | "quiet_register" | "start_face" | "delivery" | "register_fix" | "framing" | "post_params";

export interface DrillClipPlan {
  clip_id: string;
  batch: number;
  axis: DrillAxis;
  role: "explore" | "control";
  look_name: string;
  degloss_hint: string | null;
  pose_hint?: string;
  script: string;
  voice_emotion_speed: { style: number; speed: number };
  motion_prompt: string;
  expressiveness: "low" | "medium";
  hypothesis: string;
}

export interface DrillBatchPlan {
  ok: boolean;
  batch: number;
  axis: DrillAxis;
  persona: "manya";
  clips: DrillClipPlan[];
  warnings: string[];
}

// Батч 2 (моушены): жесты промптом НЕ управляются (поза = стартовый кадр!); исполняются
// взгляд/брови/голова. Победитель: interrupted-бит (43/50) — вшит в канон ниже.
const CANON_MOTION =
  "lively casual selfie video message, natural head turns while speaking, normal blinking, animated facial expressions following the speech, a tiny thoughtful reaction before the first phrase, near the end she briefly glances off-camera with an unposed half-smile as if someone caught her attention, then a small sincere smirk";

// лучший известный сетап (обновляется промоутами после батчей)
// Батч 1 (свет/сцена): победил золотой час (42/50); уроки — селфи-дистанция обязательна,
// слишком тёмное ломает identity, зеркальное селфи = ugc-рычаг (леджер: batch_analysis.b1)
// Батч 3 (позы): реквизит с действием побеждает (кружка 40/50 — «дует на чай»);
// транзитные жесты (прядь) в стоп-листе; скрещенные руки приговорены (liveness 5).
export const DRILL_BEST_KNOWN = {
  look_name: "look__manya__07__soft_window",
  degloss_hint: "golden hour low warm sunlight through the window, long soft shadows, selfie distance framing",
  pose_hint: "holding a warm mug with both hands below her chin" as string | undefined,
  motion_prompt: CANON_MOTION,
  expressiveness: "medium" as const,
  voice: { style: 0.4, speed: 1.05 },
};

export const GESTURE_STOP_LIST = [
  "транзитные жесты в стартовом кадре (заправляет прядь, тянется к чему-то) — рука замерзает мёртвым грузом",
] as const;

// ЗАКОН РЕГИСТРА (батч 6, гипотеза ПОДТВЕРЖДЕНА, в обе стороны — b06_08):
// 1. Букенды (первый/последний кадр) ВСЕГДА наследуют выражение лица стартового кадра.
// 2. Середина клипа управляется моушен-промптом/скриптом и может восстановить энергию (b06_07).
// 3. Порог: любой НАМЁК на улыбку в стилле → полный smile-регистр (b06_05: полуулыбка → оскал).
//    Для тихого регистра стилл должен быть полностью нейтральным/серьёзным/с опущенным взглядом.
// 4. Взгляд на предмет (вниз на кружку) — самый надёжный тихий якорь (b06_02: 9/10,
//    первый полностью тихий клип петли).
// 5. Один стилл ≈ детерминированный рендер (ctrl1≈ctrl2 покадрово): вариативность
//    добывается ВАРИАЦИЕЙ СТИЛЛОВ, а не ре-рендерами.
export const DRILL_QUIET_CANON = {
  look_name: "look__manya__07__soft_window",
  degloss_hint: "golden hour low warm sunlight through the window, long soft shadows, selfie distance framing",
  pose_hint: "holding a warm mug with both hands below her chin, pensive soft expression gazing slightly down toward the mug, lips closed, no smile",
  script: "[whispers] Так… я вам сейчас кое-что расскажу. Только тихо, ладно? [whispers] Слушайте.",
  voice: { style: 0.5, speed: 0.95 },
  motion_prompt: "calm quiet intimate video message, soft subdued facial expressions, small gentle mouth movements, slow blinks, minimal head movement, no big smiles",
  expressiveness: "low" as const,
};

const BATCH_SCRIPT: Record<number, string> = {
  1: "Так… я вам сейчас кое-что расскажу. [exhales] Только между нами, ладно? Короче, слушайте.",
};

// Батч 1: ось света и сцены — 8 семей света на Мане + 2 контроля
const LIGHT_SCENE_ROWS: Array<{ id: string; look: string; hint: string; hypothesis: string }> = [
  { id: "lamp_sofa", look: "look__manya__03__sofa_evening", hint: "evening, single warm table lamp as the only light source, uneven light with soft shadows on one side of the face", hypothesis: "Вечерняя лампа — семья победителей (Оля, Вика v2)." },
  { id: "kitchen_sun", look: "look__manya__01__kitchen_counter", hint: "morning sun patches through the window, uneven light, slightly underexposed corners", hypothesis: "Солнечные пятна — семья Мани-чемпиона." },
  { id: "street_overcast", look: "look__manya__11__street_entrance", hint: "overcast soft daylight outdoors, flat but dim light", hypothesis: "Пасмурная улица: свет мягкий, но не яркий — обойдёт ли провал яркого дня Вики v1?" },
  { id: "window_golden", look: "look__manya__07__soft_window", hint: "golden hour low warm sunlight through the window, long soft shadows", hypothesis: "Золотой час: тёплый низкий свет — макс. living-фактор?" },
  { id: "bathroom_vanity", look: "look__manya__05__mirror_close", hint: "even but slightly dim bathroom vanity light, small shadows under chin", hypothesis: "Ровный тусклый свет ванной — распространённая UGC-сцена." },
  { id: "car_dim", look: "look__manya__10__car_close", hint: "overcast day inside the car, dim soft light through windows, no direct sun", hypothesis: "Машина в пасмурный день: спасёт ли тусклость провал яркой машины?" },
  { id: "bedroom_dim_morning", look: "look__manya__12__bed_morning", hint: "dim early morning light, curtains half closed, soft blue-grey tint", hypothesis: "Сонное утро: минимальная энергия света." },
  { id: "hallway_dusk", look: "look__manya__14__plain_wall", hint: "dusk indoor light, single ceiling bulb far away, noticeably dim", hypothesis: "Сумерки коридора: нижняя граница освещённости." },
];

// Батч 2: ось моушенов — 8 подач на выигранном золотом свете (варьируется ТОЛЬКО motion_prompt)
const MOTION_ROWS: Array<{ id: string; prompt: string; hypothesis: string }> = [
  { id: "voice_message", prompt: "talks like recording a casual voice message to a friend, natural micro head bobs following speech rhythm, one quick glance aside and back, subtle handheld sway", hypothesis: "Голосовуха — выигрышная рамка бейкоффа клипов." },
  { id: "story_lean", prompt: "leans slightly closer to the camera as if sharing something semi-private, conspiratorial energy, small pause before the key phrase, tiny eyebrow raise, then settles back", hypothesis: "Заговорщицкая подача под «только между нами»." },
  { id: "disbelief_shake", prompt: "starts with a barely visible head shake of disbelief, honest slightly amused expression, then calms into direct delivery, natural blink", hypothesis: "«Сама не верила» — микро-покачивание." },
  { id: "interrupted_real", prompt: "briefly looks off-camera mid-sentence as if someone distracted her, half-second pause, then returns to the camera and continues naturally, imperfect timing feel", hypothesis: "Отвлеклась и вернулась — самый живой приём." },
  { id: "calm_still", prompt: "calm quiet delivery, minimal head movement, natural blinking only, steady gaze", hypothesis: "Нижняя граница движения: достаточно ли одних глаз?" },
  { id: "hands_talk", prompt: "gestures naturally with one hand visible in frame while explaining, animated storytelling energy, natural head turns", hypothesis: "Руки в кадре — расширяют живость или ломают?" },
  { id: "hair_touch", prompt: "tucks a loose strand of hair behind her ear mid-sentence, relaxed posture, natural head turns while speaking", hypothesis: "Жест из победного клипа Вики v2." },
  { id: "laugh_mid", prompt: "small genuine laugh in the middle of the speech, eyes squeeze briefly, then continues warmly, natural head movement", hypothesis: "Смешок в середине — пик человечности или риск артефакта зубов?" },
];

// Батч 5: тихий регистр — направленный тест асимметрии b4 (низкая энергия не пробивает
// мимику текстом). Факторы: expressiveness low/medium × тихий моушен-промпт × взгляд вниз.
const QUIET_MOTION = "calm quiet intimate video message, soft subdued facial expressions, small gentle mouth movements, slow blinks, minimal head movement, no big smiles";
const QUIET_ROWS: Array<{ id: string; script: string; voice: { style: number; speed: number }; motion: string; expr: "low" | "medium"; hypothesis: string }> = [
  { id: "whisper_low", script: "[whispers] Так… я вам сейчас кое-что расскажу. Только тихо, ладно? [whispers] Слушайте.", voice: { style: 0.5, speed: 0.95 }, motion: "", expr: "low", hypothesis: "Шёпот + expressiveness low (изоляция фактора low)." },
  { id: "confession_low", script: "Честно?… Я долго молчала. [exhales] Но всё. Рассказываю.", voice: { style: 0.6, speed: 0.9 }, motion: "", expr: "low", hypothesis: "Признание + low." },
  { id: "whisper_low_qmotion", script: "[whispers] Так… я вам сейчас кое-что расскажу. Только тихо, ладно? [whispers] Слушайте.", voice: { style: 0.5, speed: 0.95 }, motion: QUIET_MOTION, expr: "low", hypothesis: "Шёпот + low + тихий моушен (полный тихий стек)." },
  { id: "confession_low_qmotion", script: "Честно?… Я долго молчала. [exhales] Но всё. Рассказываю.", voice: { style: 0.6, speed: 0.9 }, motion: QUIET_MOTION, expr: "low", hypothesis: "Признание + low + тихий моушен." },
  { id: "whisper_med_qmotion", script: "[whispers] Так… я вам сейчас кое-что расскажу. Только тихо, ладно? [whispers] Слушайте.", voice: { style: 0.5, speed: 0.95 }, motion: QUIET_MOTION, expr: "medium", hypothesis: "Шёпот + medium + тихий моушен (изоляция моушена без low)." },
  { id: "neutral_low", script: "Так… я вам сейчас кое-что расскажу. [exhales] Только между нами, ладно? Короче, слушайте.", voice: { style: 0.4, speed: 1.05 }, motion: "", expr: "low", hypothesis: "Канон-скрипт + low: что даёт low сам по себе." },
  { id: "confession_downgaze", script: "Честно?… Я долго молчала. [exhales] Но всё. Рассказываю.", voice: { style: 0.6, speed: 0.9 }, motion: "calm intimate confession, she occasionally lowers her gaze away from the camera and back, soft subdued expressions, slow gentle mouth movements, no smiles", expr: "low", hypothesis: "Взгляд вниз промптится (b2) — добавит ли исповедальности?" },
  { id: "asmr_closer", script: "[whispers] Тсс… подойди ближе. Я расскажу то, что никому не говорила. [whispers] Слушай внимательно.", voice: { style: 0.55, speed: 0.9 }, motion: QUIET_MOTION, expr: "low", hypothesis: "ASMR-крайность: нижняя граница энергии стека." },
];

// Батч 5 (тихий регистр, факторный) — ИТОГИ: expressiveness=low сам по себе — ПЛАЦЕБО
// (b05_06 покадрово ≈ medium-контроли); low+qmotion глушит только СЕРЕДИНУ клипа (+1-2);
// скрипт «признание» — АНТИ-рычаг (стабильно тянет игривый/смеющийся регистр);
// «взгляд вниз» промптом модель конвертирует в закрытые глаза (b05_07 — лучший, 6/10).
// СИСТЕМНОЕ: улыбчивые букенды (интро/аутро) во ВСЕХ клипах — мимика Avatar IV
// наследует СТАРТОВЫЙ КАДР (канон-стилл с кружкой улыбается). Регистр, как и жесты (b2),
// живёт в стартовом кадре → следующая ось start_face.
const QUIET_BEST_STACK = {
  script: "[whispers] Так… я вам сейчас кое-что расскажу. Только тихо, ладно? [whispers] Слушайте.",
  voice: { style: 0.5, speed: 0.95 },
  motion: QUIET_MOTION,
  expr: "low" as const,
};

// Батч 6: ось start_face — выражение лица СТАРТОВОГО КАДРА (pose_hint деглянца).
// Ряды 1-6: тихий стек b05_03 зафиксирован, варьируется ТОЛЬКО лицо стилла;
// baseline сравнения = b05_03 (улыбчивый стилл, register-fit 5).
// Ряды 7-8: спокойный стилл × канон-энергия — двусторонний тест «стилл задаёт регистр».
const MUG_POSE = "holding a warm mug with both hands below her chin";
const START_FACE_ROWS: Array<{ id: string; face: string; canonEnergy?: boolean; hypothesis: string }> = [
  { id: "calm_neutral_quiet", face: "calm relaxed face with lips gently closed, neutral quiet expression, no smile", hypothesis: "Главная гипотеза b5: спокойный стилл убирает улыбчивые букенды." },
  { id: "pensive_mug_quiet", face: "pensive soft expression gazing slightly down toward the mug, lips closed, no smile", hypothesis: "Взгляд вниз В СТИЛЛЕ (промптом не исполнялся — конвертился в закрытые глаза)." },
  { id: "tired_soft_quiet", face: "slightly tired soft expression, relaxed heavy eyelids, lips closed, no smile", hypothesis: "Усталая мягкость — нижняя граница энергии лица." },
  { id: "serious_direct_quiet", face: "serious calm expression looking directly into the camera, lips closed", hypothesis: "Серьёзный прямой взгляд — максимальный контраст к улыбке." },
  { id: "halfsmile_closed_quiet", face: "very subtle closed-lip half-smile, soft relaxed eyes", hypothesis: "Полуулыбка без зубов — верхняя допустимая граница тепла в тихом регистре." },
  { id: "midword_quiet", face: "lips slightly parted as if caught mid-word, candid unposed expression", hypothesis: "Старт «посреди слова» — пропустит ли аниматор интро-улыбку вовсе?" },
  { id: "calm_neutral_canon", face: "calm relaxed face with lips gently closed, neutral quiet expression, no smile", canonEnergy: true, hypothesis: "Обратный тест: утянет ли спокойный стилл ВНИЗ проверенный живой канон?" },
  { id: "serious_direct_canon", face: "serious calm expression looking directly into the camera, lips closed", canonEnergy: true, hypothesis: "Жёсткая версия обратного теста: серьёзный стилл × канон-энергия." },
];

// Батч 7: ось delivery = ПАЛИТРА РЕГИСТРОВ. Применяем закон регистра (b6) конструктивно:
// каждый ряд — согласованная пара стилл↔стек (лицо стартового кадра + скрипт + голос +
// моушен + expressiveness под ОДНУ эмоцию). Гипотеза: согласованность даёт чистый регистр
// по всей длине; выход — эмоциональный дайал Мани для продакшна.
const REGISTER_PALETTE_ROWS: Array<{ id: string; face: string; script: string; voice: { style: number; speed: number }; motion: string; expr: "low" | "medium"; hypothesis: string }> = [
  { id: "excited_news", face: "eyes wide with excitement, big open smile, eyebrows raised", script: "[excited] Так, СТОП. Я не могу молчать! Вы должны это знать. Короче, слушайте!", voice: { style: 0.55, speed: 1.15 }, motion: "energetic selfie video message, expressive face following the speech, quick natural head movements, animated eyebrows", expr: "medium", hypothesis: "Верх палитры: восторженный стилл × excited-стек — согласованный максимум энергии." },
  { id: "warm_friend", face: "warm gentle expression, soft kind eyes, relaxed closed-lip smile", script: BATCH_SCRIPT[1], voice: { style: 0.4, speed: 1.05 }, motion: "", expr: "medium", hypothesis: "Середина палитры: тёплая подруга — рабочая лошадка UGC." },
  { id: "serious_expert", face: "serious calm expression looking directly into the camera, lips closed", script: "Так. Смотрите. Я разобралась и объясню по фактам. Без воды.", voice: { style: 0.35, speed: 1.0 }, motion: "calm confident delivery, steady direct gaze, minimal head movement, occasional slow nod, no smiles", expr: "low", hypothesis: "Экспертный регистр для обзоров: серьёзный стилл держит весь клип (закон b06_08)." },
  { id: "conspiratorial", face: "leaning slightly toward the camera, sly knowing look, one eyebrow slightly raised, lips closed", script: "Тсс… никому, ладно? Я кое-что нашла. Такое не рассказывают.", voice: { style: 0.5, speed: 0.95 }, motion: "leans slightly closer to the camera as if sharing something semi-private, conspiratorial energy, small pause before the key phrase, tiny eyebrow raise, then settles back", expr: "medium", hypothesis: "Заговорщицкий: хитрый стилл × story_lean-моушен (b2)." },
  { id: "tired_evening", face: "slightly tired soft expression, relaxed heavy eyelids, lips closed, no smile", script: "Уф… ну и день. [exhales] Ладно. Слушайте, пока не забыла.", voice: { style: 0.5, speed: 0.9 }, motion: QUIET_MOTION, expr: "low", hypothesis: "Усталый вечер: искренность нижней энергии (стилл b06_03 + согласованный скрипт)." },
  { id: "playful_tease", face: "playful teasing expression, slight smirk, head tilted a little", script: "А вот и не скажу!… [laughs] Ладно-ладно. Слушайте, уговорили.", voice: { style: 0.55, speed: 1.1 }, motion: "playful teasing energy, small head tilts, bright eyes, a short genuine laugh, lively expressions", expr: "medium", hypothesis: "Игривый дразнящий: смирк-стилл × [laughs]-стек (b4: теги исполняются)." },
  { id: "skeptic_review", face: "skeptical appraising expression, slightly narrowed eyes, lips pressed together", script: "Честно? Я не верила. Вообще не верила. …Ну и зря, как оказалось.", voice: { style: 0.45, speed: 1.0 }, motion: "starts with a barely visible head shake of disbelief, honest slightly amused expression, then calms into direct delivery, natural blink", expr: "medium", hypothesis: "Скептик: прищур-стилл × disbelief-моушен (b2) — регистр честного обзора." },
  { id: "surprised_discovery", face: "genuinely surprised expression, raised eyebrows, mouth slightly open", script: "Так, СТОП. Вы это видели?… Я, если честно, в шоке.", voice: { style: 0.5, speed: 1.1 }, motion: "briefly looks off-camera mid-sentence as if someone distracted her, half-second pause, then returns to the camera and continues naturally, imperfect timing feel", expr: "medium", hypothesis: "Удивление-находка: 'о'-стилл × interrupted-моушен (канон b2)." },
];

// Батч 7 (палитра) — ИТОГИ: 6/8 регистров чистые (excited 9, warm 8, playful 8, skeptic 8,
// surprised 7, conspiratorial 7); оба канона держат 9/10, тихий рецепт b06_02 воспроизвёлся
// точно (рецепты детерминированы). Провалены: serious_expert (4 — серьёзность не попала
// в стилл, дефолт-улыбка) и tired_evening (5 — «тяжёлые веки» Seedream размыл к дефолту).
// Уроки: слабые эмоции лица требуют СИЛЬНЫХ формулировок или физического якоря позой;
// слова про камеру в pose_hint («leaning toward the camera») могут перевернуть композицию
// в кадр третьим лицом — селфи-POV усиливать явно.
// Батч 8: ремонт двух регистров + селфи-фикс заговорщицы. Каждый ряд задаёт ПОЛНЫЙ pose_hint.
const REGISTER_FIX_ROWS: Array<{ id: string; pose: string; script: string; voice: { style: number; speed: number }; motion: string; expr: "low" | "medium"; hypothesis: string }> = [
  { id: "expert_stern_nomug", pose: "sitting upright facing the camera, one forearm resting on the table, stern focused expression, slightly furrowed brow, lips firmly closed, absolutely no smile", script: "Так. Смотрите. Я разобралась и объясню по фактам. Без воды.", voice: { style: 0.35, speed: 1.0 }, motion: "calm confident delivery, steady direct gaze, minimal head movement, occasional slow nod, no smiles", expr: "low", hypothesis: "Эксперт-фикс 1: жёсткая формулировка (stern+furrowed) вместо мягкой + убрана кружка (физика селфи)." },
  { id: "expert_stern_mug_onehand", pose: "holding a warm mug in one hand at chest level, stern focused expression, slightly furrowed brow, lips firmly closed, absolutely no smile", script: "Так. Смотрите. Я разобралась и объясню по фактам. Без воды.", voice: { style: 0.35, speed: 1.0 }, motion: "calm confident delivery, steady direct gaze, minimal head movement, occasional slow nod, no smiles", expr: "low", hypothesis: "Эксперт-фикс 2: stern + кружка в ОДНОЙ руке (реквизит остаётся, физика сходится)." },
  { id: "expert_notes_downgaze", pose: "glancing down at handwritten notes on the table in front of her, focused serious expression, lips closed, no smile", script: "Так. Смотрите. Я разобралась и объясню по фактам. Без воды.", voice: { style: 0.35, speed: 1.0 }, motion: "calm confident delivery, occasionally glances down at her notes and back to the camera, no smiles", expr: "low", hypothesis: "Эксперт-фикс 3: взгляд-на-предмет (записи) — проверенный якорь b06_02, перенесённый на серьёзный регистр." },
  { id: "expert_stern_medium", pose: "sitting upright facing the camera, one forearm resting on the table, stern focused expression, slightly furrowed brow, lips firmly closed, absolutely no smile", script: "Так. Смотрите. Я разобралась и объясню по фактам. Без воды.", voice: { style: 0.35, speed: 1.0 }, motion: "confident assertive delivery, deliberate emphatic head movements following the arguments, no smiles", expr: "medium", hypothesis: "Эксперт-фикс 4: stern-стилл × MEDIUM — вернёт ли напор в середину (b07_03 был вял на low)?" },
  { id: "tired_exhausted_strong", pose: "holding a warm mug with both hands below her chin, visibly exhausted face, droopy half-closed heavy eyelids, faint dark circles under her eyes, slack relaxed features, no smile", script: "Уф… ну и день. [exhales] Ладно. Слушайте, пока не забыла.", voice: { style: 0.5, speed: 0.9 }, motion: QUIET_MOTION, expr: "low", hypothesis: "Усталость-фикс 1: агрессивная формулировка лица (droopy half-closed + dark circles)." },
  { id: "tired_head_on_hand", pose: "resting her head heavily on one hand, elbow on the table, eyes half closed with visible tiredness, no smile", script: "Уф… ну и день. [exhales] Ладно. Слушайте, пока не забыла.", voice: { style: 0.5, speed: 0.9 }, motion: QUIET_MOTION, expr: "low", hypothesis: "Усталость-фикс 2: ФИЗИЧЕСКИЙ якорь позой (голова на руке) — тело продаёт эмоцию вместо лица." },
  { id: "tired_downgaze_mug", pose: "holding a warm mug with both hands, gazing down into the tea with a tired absent look, heavy eyelids, no smile", script: "Уф… ну и день. [exhales] Ладно. Слушайте, пока не забыла.", voice: { style: 0.5, speed: 0.9 }, motion: QUIET_MOTION, expr: "low", hypothesis: "Усталость-фикс 3: взгляд-в-кружку (якорь b06_02) + усталое лицо." },
  { id: "consp_selfie_fix", pose: "phone selfie POV at close selfie distance, holding a warm mug in one hand, sly knowing look directly into the camera, one eyebrow slightly raised, lips closed in a subtle smirk", script: "Тсс… никому, ладно? Я кое-что нашла. Такое не рассказывают.", voice: { style: 0.5, speed: 0.95 }, motion: "leans slightly closer to the camera as if sharing something semi-private, conspiratorial energy, small pause before the key phrase, tiny eyebrow raise, then settles back", expr: "medium", hypothesis: "Заговорщица-фикс: явный селфи-POV в pose_hint против сползания композиции в b-roll (b07_04)." },
];

// Батч 4: ось скрипт-стиля — 8 манер речи на канон-сетапе (кружка+золотой час),
// варьируются ТОЛЬКО текст и голосовые параметры. Уроки b2: теги v3 исполняются.
const SCRIPT_STYLE_ROWS: Array<{ id: string; script: string; voice: { style: number; speed: number }; hypothesis: string }> = [
  { id: "filler_heavy", script: "Так, ну короче… я вам щас кое-что расскажу. [exhales] Ну, только между нами, ладно? Слушайте.", voice: { style: 0.4, speed: 1.05 }, hypothesis: "Максимум филлеров — разговорная небрежность." },
  { id: "minimal_clean", script: "Я вам сейчас кое-что расскажу. Только между нами.", voice: { style: 0.35, speed: 1.0 }, hypothesis: "Чистый минимум — контраст к филлерам." },
  { id: "question_hook", script: "Знаете, что я вчера узнала?… [exhales] Никому не говорите, ладно? Короче.", voice: { style: 0.45, speed: 1.05 }, hypothesis: "Вопрос-хук — вовлечение с первой секунды." },
  { id: "whisper_secret", script: "[whispers] Так… я вам сейчас кое-что расскажу. Только тихо, ладно? [whispers] Слушайте.", voice: { style: 0.5, speed: 0.95 }, hypothesis: "Шёпот — интимность, тест v3-тега." },
  { id: "excited_burst", script: "[excited] Так, СТОП. Я не могу молчать! Вы должны это знать. Короче, слушайте!", voice: { style: 0.55, speed: 1.15 }, hypothesis: "Восторг+скорость — верх энергии." },
  { id: "slow_confession", script: "Честно?… Я долго молчала. [exhales] Но всё. Рассказываю.", voice: { style: 0.6, speed: 0.9 }, hypothesis: "Медленное признание — низ энергии, драматургия пауз." },
  { id: "laugh_tag", script: "Так… я вам сейчас кое-что расскажу. [laughs] Не могу. Ладно, слушайте, только между нами.", voice: { style: 0.5, speed: 1.05 }, hypothesis: "Смех тегом v3 — синхронится ли лицо со смехом в голосе?" },
  { id: "caps_accent", script: "Так… я вам СЕЙЧАС кое-что расскажу. Только МЕЖДУ НАМИ, ладно? Слушайте.", voice: { style: 0.4, speed: 1.05 }, hypothesis: "КАПС-ударения — работает ли приём редактора пауз." },
];

// Батч 3: ось стартовых поз — жесты живут в СТАРТОВОМ КАДРЕ (урок батча 2), не в промпте
const START_POSE_ROWS: Array<{ id: string; pose: string; hypothesis: string }> = [
  { id: "hand_near_face", pose: "one hand gently resting near her cheek, elbow on the windowsill", hypothesis: "Рука у лица = тёплая доверительная поза." },
  { id: "tucking_hair", pose: "one hand frozen mid-motion tucking a strand of hair behind her ear", hypothesis: "Замороженный жест Вики v2 — оживёт ли из стилла?" },
  { id: "holding_phone", pose: "holding a phone loosely in one hand at chest level, not looking at it", hypothesis: "Телефон = нативный UGC-реквизит." },
  { id: "mid_gesture", pose: "one hand raised in a natural mid-explanation gesture in front of her", hypothesis: "Пол-жест: продолжит ли аниматор движение руки?" },
  { id: "holding_mug", pose: "holding a warm mug with both hands below her chin", hypothesis: "Кружка — выигрышный реквизит канона." },
  { id: "chin_on_hand", pose: "chin resting on one hand, elbow on the windowsill, relaxed", hypothesis: "Подбородок на ладони: уют + асимметрия." },
  { id: "arms_free", pose: "arms relaxed and free at her sides, open posture, NOT crossed", hypothesis: "Свободные руки: даст ли аниматор спонтанный жест (голосовуха b2 дала)?" },
  { id: "leaning_sill", pose: "leaning sideways on the windowsill with one shoulder, casual weight shift", hypothesis: "Асимметричный вес — анти-манекен." },
];

export function buildDrillBatch(batch: number, axis: DrillAxis): DrillBatchPlan {
  if (axis === "start_face") {
    const clips: DrillClipPlan[] = START_FACE_ROWS.map((row, i) => ({
      clip_id: `drill_b${String(batch).padStart(2, "0")}_${String(i + 1).padStart(2, "0")}_${row.id}`,
      batch, axis, role: "explore" as const,
      look_name: DRILL_BEST_KNOWN.look_name,
      degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
      pose_hint: `${MUG_POSE}, ${row.face}`,
      script: row.canonEnergy ? BATCH_SCRIPT[1] : QUIET_BEST_STACK.script,
      voice_emotion_speed: row.canonEnergy ? DRILL_BEST_KNOWN.voice : QUIET_BEST_STACK.voice,
      motion_prompt: row.canonEnergy ? DRILL_BEST_KNOWN.motion_prompt : QUIET_BEST_STACK.motion,
      expressiveness: row.canonEnergy ? DRILL_BEST_KNOWN.expressiveness : QUIET_BEST_STACK.expr,
      hypothesis: row.hypothesis,
    }));
    for (let c = 1; c <= 2; c++) {
      clips.push({
        clip_id: `drill_b${String(batch).padStart(2, "0")}_ctrl${c}`,
        batch, axis, role: "control" as const,
        look_name: DRILL_BEST_KNOWN.look_name,
        degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
        pose_hint: DRILL_BEST_KNOWN.pose_hint,
        script: BATCH_SCRIPT[1],
        voice_emotion_speed: DRILL_BEST_KNOWN.voice,
        motion_prompt: DRILL_BEST_KNOWN.motion_prompt,
        expressiveness: DRILL_BEST_KNOWN.expressiveness,
        hypothesis: "Контроль: канон (улыбчивый стилл, medium).",
      });
    }
    return { ok: true, batch, axis, persona: "manya", clips, warnings: ["Варьируется ТОЛЬКО лицо стартового кадра; ряды 1-6 сравнивать с b05_03, ряды 7-8 — с контролями."] };
  }
  if (axis === "register_fix") {
    const clips: DrillClipPlan[] = REGISTER_FIX_ROWS.map((row, i) => ({
      clip_id: `drill_b${String(batch).padStart(2, "0")}_${String(i + 1).padStart(2, "0")}_${row.id}`,
      batch, axis, role: "explore" as const,
      look_name: DRILL_BEST_KNOWN.look_name,
      degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
      pose_hint: row.pose,
      script: row.script,
      voice_emotion_speed: row.voice,
      motion_prompt: row.motion,
      expressiveness: row.expr,
      hypothesis: row.hypothesis,
    }));
    for (let c = 1; c <= 2; c++) {
      clips.push({
        clip_id: `drill_b${String(batch).padStart(2, "0")}_ctrl${c}`,
        batch, axis, role: "control" as const,
        look_name: DRILL_BEST_KNOWN.look_name,
        degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
        pose_hint: c === 1 ? DRILL_BEST_KNOWN.pose_hint : DRILL_QUIET_CANON.pose_hint,
        script: c === 1 ? BATCH_SCRIPT[1] : DRILL_QUIET_CANON.script,
        voice_emotion_speed: c === 1 ? DRILL_BEST_KNOWN.voice : DRILL_QUIET_CANON.voice,
        motion_prompt: c === 1 ? DRILL_BEST_KNOWN.motion_prompt : DRILL_QUIET_CANON.motion_prompt,
        expressiveness: c === 1 ? DRILL_BEST_KNOWN.expressiveness : DRILL_QUIET_CANON.expressiveness,
        hypothesis: c === 1 ? "Контроль: живой канон." : "Контроль: тихий канон.",
      });
    }
    return { ok: true, batch, axis, persona: "manya", clips, warnings: ["Ремонт провальных регистров b7: полные pose_hint на ряд; сравнивать с b07_03 (эксперт 4) и b07_05 (усталость 5)."] };
  }
  if (axis === "delivery") {
    const clips: DrillClipPlan[] = REGISTER_PALETTE_ROWS.map((row, i) => ({
      clip_id: `drill_b${String(batch).padStart(2, "0")}_${String(i + 1).padStart(2, "0")}_${row.id}`,
      batch, axis, role: "explore" as const,
      look_name: DRILL_BEST_KNOWN.look_name,
      degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
      pose_hint: `${MUG_POSE}, ${row.face}`,
      script: row.script,
      voice_emotion_speed: row.voice,
      motion_prompt: row.motion || DRILL_BEST_KNOWN.motion_prompt,
      expressiveness: row.expr,
      hypothesis: row.hypothesis,
    }));
    for (let c = 1; c <= 2; c++) {
      clips.push({
        clip_id: `drill_b${String(batch).padStart(2, "0")}_ctrl${c}`,
        batch, axis, role: "control" as const,
        look_name: DRILL_BEST_KNOWN.look_name,
        degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
        pose_hint: c === 1 ? DRILL_BEST_KNOWN.pose_hint : DRILL_QUIET_CANON.pose_hint,
        script: c === 1 ? BATCH_SCRIPT[1] : DRILL_QUIET_CANON.script,
        voice_emotion_speed: c === 1 ? DRILL_BEST_KNOWN.voice : DRILL_QUIET_CANON.voice,
        motion_prompt: c === 1 ? DRILL_BEST_KNOWN.motion_prompt : DRILL_QUIET_CANON.motion_prompt,
        expressiveness: c === 1 ? DRILL_BEST_KNOWN.expressiveness : DRILL_QUIET_CANON.expressiveness,
        hypothesis: c === 1 ? "Контроль: живой канон." : "Контроль: тихий канон (b06_02) — регрессия-чек обоих полюсов.",
      });
    }
    return { ok: true, batch, axis, persona: "manya", clips, warnings: ["Палитра регистров: каждый ряд — согласованная пара стилл↔стек; контроли = оба канона (живой + тихий)."] };
  }
  if (axis === "quiet_register") {
    const clips: DrillClipPlan[] = QUIET_ROWS.map((row, i) => ({
      clip_id: `drill_b${String(batch).padStart(2, "0")}_${String(i + 1).padStart(2, "0")}_${row.id}`,
      batch, axis, role: "explore" as const,
      look_name: DRILL_BEST_KNOWN.look_name,
      degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
      pose_hint: DRILL_BEST_KNOWN.pose_hint,
      script: row.script,
      voice_emotion_speed: row.voice,
      motion_prompt: row.motion || DRILL_BEST_KNOWN.motion_prompt,
      expressiveness: row.expr,
      hypothesis: row.hypothesis,
    }));
    for (let c = 1; c <= 2; c++) {
      clips.push({
        clip_id: `drill_b${String(batch).padStart(2, "0")}_ctrl${c}`,
        batch, axis, role: "control" as const,
        look_name: DRILL_BEST_KNOWN.look_name,
        degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
        pose_hint: DRILL_BEST_KNOWN.pose_hint,
        script: BATCH_SCRIPT[1],
        voice_emotion_speed: DRILL_BEST_KNOWN.voice,
        motion_prompt: DRILL_BEST_KNOWN.motion_prompt,
        expressiveness: DRILL_BEST_KNOWN.expressiveness,
        hypothesis: "Контроль: канон (medium).",
      });
    }
    return { ok: true, batch, axis, persona: "manya", clips, warnings: ["Факторный тест: low/medium × тихий моушен × взгляд вниз."] };
  }
  if (axis === "script_style") {
    const clips: DrillClipPlan[] = SCRIPT_STYLE_ROWS.map((row, i) => ({
      clip_id: `drill_b${String(batch).padStart(2, "0")}_${String(i + 1).padStart(2, "0")}_${row.id}`,
      batch, axis, role: "explore" as const,
      look_name: DRILL_BEST_KNOWN.look_name,
      degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
      pose_hint: DRILL_BEST_KNOWN.pose_hint,
      script: row.script,
      voice_emotion_speed: row.voice,
      motion_prompt: DRILL_BEST_KNOWN.motion_prompt,
      expressiveness: DRILL_BEST_KNOWN.expressiveness,
      hypothesis: row.hypothesis,
    }));
    for (let c = 1; c <= 2; c++) {
      clips.push({
        clip_id: `drill_b${String(batch).padStart(2, "0")}_ctrl${c}`,
        batch, axis, role: "control" as const,
        look_name: DRILL_BEST_KNOWN.look_name,
        degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
        pose_hint: DRILL_BEST_KNOWN.pose_hint,
        script: BATCH_SCRIPT[1],
        voice_emotion_speed: DRILL_BEST_KNOWN.voice,
        motion_prompt: DRILL_BEST_KNOWN.motion_prompt,
        expressiveness: DRILL_BEST_KNOWN.expressiveness,
        hypothesis: "Контроль: канон-скрипт на канон-сетапе.",
      });
    }
    return { ok: true, batch, axis, persona: "manya", clips, warnings: ["Голос генерится на каждый клип (скрипты разные)."] };
  }
  if (axis === "start_pose") {
    const script = BATCH_SCRIPT[batch] || BATCH_SCRIPT[1];
    const clips: DrillClipPlan[] = START_POSE_ROWS.map((row, i) => ({
      clip_id: `drill_b${String(batch).padStart(2, "0")}_${String(i + 1).padStart(2, "0")}_${row.id}`,
      batch, axis, role: "explore" as const,
      look_name: DRILL_BEST_KNOWN.look_name,
      degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
      pose_hint: row.pose,
      script,
      voice_emotion_speed: DRILL_BEST_KNOWN.voice,
      motion_prompt: DRILL_BEST_KNOWN.motion_prompt,
      expressiveness: DRILL_BEST_KNOWN.expressiveness,
      hypothesis: row.hypothesis,
    }));
    for (let c = 1; c <= 2; c++) {
      clips.push({
        clip_id: `drill_b${String(batch).padStart(2, "0")}_ctrl${c}`,
        batch, axis, role: "control" as const,
        look_name: DRILL_BEST_KNOWN.look_name,
        degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
        pose_hint: DRILL_BEST_KNOWN.pose_hint,
        script,
        voice_emotion_speed: DRILL_BEST_KNOWN.voice,
        motion_prompt: DRILL_BEST_KNOWN.motion_prompt,
        expressiveness: DRILL_BEST_KNOWN.expressiveness,
        hypothesis: "Контроль: канон-сетап.",
      });
    }
    return { ok: true, batch, axis, persona: "manya", clips, warnings: ["Позы меняются в стартовом кадре (Seedream edit), моушен канонический."] };
  }
  if (axis !== "light_scene" && axis !== "motion") {
    return { ok: false, batch, axis, persona: "manya", clips: [], warnings: [`ось ${axis} будет добавлена после прохождения предыдущих — оси добавляются по мере петли`] };
  }
  const script = BATCH_SCRIPT[batch] || BATCH_SCRIPT[1];
  const exploreRows: DrillClipPlan[] = axis === "light_scene"
    ? LIGHT_SCENE_ROWS.map((row, i) => ({
        clip_id: `drill_b${String(batch).padStart(2, "0")}_${String(i + 1).padStart(2, "0")}_${row.id}`,
        batch,
        axis,
        role: "explore" as const,
        look_name: row.look,
        degloss_hint: row.hint,
        script,
        voice_emotion_speed: DRILL_BEST_KNOWN.voice,
        motion_prompt: DRILL_BEST_KNOWN.motion_prompt,
        expressiveness: DRILL_BEST_KNOWN.expressiveness,
        hypothesis: row.hypothesis,
      }))
    : MOTION_ROWS.map((row, i) => ({
        clip_id: `drill_b${String(batch).padStart(2, "0")}_${String(i + 1).padStart(2, "0")}_${row.id}`,
        batch,
        axis,
        role: "explore" as const,
        look_name: DRILL_BEST_KNOWN.look_name,
        degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
        script,
        voice_emotion_speed: DRILL_BEST_KNOWN.voice,
        motion_prompt: `${row.prompt}. Natural blinking, animated facial expressions following the speech.`,
        expressiveness: DRILL_BEST_KNOWN.expressiveness,
        hypothesis: row.hypothesis,
      }));
  const clips: DrillClipPlan[] = [...exploreRows];
  // контроль: лучший известный сетап ×2 (стабильность/дисперсия рендера)
  for (let c = 1; c <= 2; c++) {
    clips.push({
      clip_id: `drill_b${String(batch).padStart(2, "0")}_ctrl${c}`,
      batch,
      axis,
      role: "control",
      look_name: DRILL_BEST_KNOWN.look_name,
      degloss_hint: DRILL_BEST_KNOWN.degloss_hint,
      script,
      voice_emotion_speed: DRILL_BEST_KNOWN.voice,
      motion_prompt: DRILL_BEST_KNOWN.motion_prompt,
      expressiveness: DRILL_BEST_KNOWN.expressiveness,
      hypothesis: "Контроль: канон-сетап, регрессия-чек и мера дисперсии рендера.",
    });
  }
  return {
    ok: true,
    batch,
    axis,
    persona: "manya",
    clips,
    warnings: [
      "Один скрипт на весь батч — чистое сравнение визуальной оси.",
      "После критики и вердиктов владельца победитель оси промоутится в DRILL_BEST_KNOWN.",
    ],
  };
}

export function drillDeglossPrompt(hint: string, poseHint?: string): string {
  return buildDeglossPrompt(hint, poseHint);
}
