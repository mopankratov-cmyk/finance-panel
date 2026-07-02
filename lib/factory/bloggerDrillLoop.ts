// Drill Loop: петля обучения «идеальный блогер» (план: docs/factory-blogger-drill-loop-plan.md).
// Планировщик батчей: каждый батч сверлит ОДНУ ось глубоко + контрольные клипы
// с лучшими известными параметрами (регрессия-чек). Леджер живёт в РЕПО.
// Отличие от Катиного лупа: скоры пишутся ПО РЕЗУЛЬТАТУ (vision-критик + вердикты
// владельца), а не по плану; уроки промоутятся в канон-код.

import { buildDeglossPrompt } from "@/lib/factory/productComposite";

export type DrillAxis = "light_scene" | "motion" | "delivery" | "script_style" | "framing" | "post_params";

export interface DrillClipPlan {
  clip_id: string;
  batch: number;
  axis: DrillAxis;
  role: "explore" | "control";
  look_name: string;
  degloss_hint: string | null;
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

const CANON_MOTION =
  "lively casual selfie video message, natural head turns while speaking, normal blinking, animated facial expressions following the speech, a tiny thoughtful reaction before the first phrase and a small sincere smirk after the last phrase";

// лучший известный сетап (обновляется промоутами после батчей)
// Батч 1 (свет/сцена): победил золотой час (42/50); уроки — селфи-дистанция обязательна,
// слишком тёмное ломает identity, зеркальное селфи = ugc-рычаг (леджер: batch_analysis.b1)
export const DRILL_BEST_KNOWN = {
  look_name: "look__manya__07__soft_window",
  degloss_hint: "golden hour low warm sunlight through the window, long soft shadows, selfie distance framing",
  motion_prompt: CANON_MOTION,
  expressiveness: "medium" as const,
  voice: { style: 0.4, speed: 1.05 },
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

export function buildDrillBatch(batch: number, axis: DrillAxis): DrillBatchPlan {
  if (axis !== "light_scene") {
    return { ok: false, batch, axis, persona: "manya", clips: [], warnings: [`ось ${axis} будет добавлена после анализа батча 1 — оси добавляются по мере прохождения петли`] };
  }
  const script = BATCH_SCRIPT[batch] || BATCH_SCRIPT[1];
  const clips: DrillClipPlan[] = LIGHT_SCENE_ROWS.map((row, i) => ({
    clip_id: `drill_b${String(batch).padStart(2, "0")}_${String(i + 1).padStart(2, "0")}_${row.id}`,
    batch,
    axis,
    role: "explore",
    look_name: row.look,
    degloss_hint: row.hint,
    script,
    voice_emotion_speed: DRILL_BEST_KNOWN.voice,
    motion_prompt: DRILL_BEST_KNOWN.motion_prompt,
    expressiveness: DRILL_BEST_KNOWN.expressiveness,
    hypothesis: row.hypothesis,
  }));
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

export function drillDeglossPrompt(hint: string): string {
  return buildDeglossPrompt(hint);
}
