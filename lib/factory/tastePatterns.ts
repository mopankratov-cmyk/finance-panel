export type TastePattern = {
  id: string;
  title: string;
  hook_structure: string;
  retention_rhythm: string;
  visual_beats: string;
  curiosity_gap: string;
  payoff: string;
  failure_signs: string[];
  niches: string[];
  goals: string[];
};

export const TASTE_PATTERNS: TastePattern[] = [
  {
    id: "problem_solution",
    title: "Problem solution",
    hook_structure: "Сначала боль, потом быстрый ответ, потом причина остаться",
    retention_rhythm: "Каждые 2-4 секунды добавляет новый слой проблемы или выгоды",
    visual_beats: "Хук в лоб, крупный план проблемы, демонстрация решения, подтверждение в быту",
    curiosity_gap: "Почему это не работало раньше и что именно меняет товар",
    payoff: "Показывает, как конкретная боль закрывается в жизни покупателя",
    failure_signs: ["слишком общий старт", "нет реальной боли", "слишком гладкий рекламный тон"],
    niches: ["default", "cosmetics", "clothing", "toys"],
    goals: ["sell", "retention"],
  },
  {
    id: "shock_fact",
    title: "Shock fact",
    hook_structure: "Неожиданный факт или цифра, которая ломает ожидание",
    retention_rhythm: "Факт → короткое пояснение → второй факт → визуальное подтверждение",
    visual_beats: "Цифра на экране, контрастный кадр, предметное доказательство, вывод",
    curiosity_gap: "Почему это работает не так, как думает большинство",
    payoff: "Переводит удивление в практическую пользу товара",
    failure_signs: ["цифра без доказательства", "спорный кликбейт", "пустой вау-эффект"],
    niches: ["default", "cosmetics", "toys"],
    goals: ["attention", "sell"],
  },
  {
    id: "myth_busting",
    title: "Myth busting",
    hook_structure: "Сначала частая ошибка, потом разрушение мифа, потом что делать вместо этого",
    retention_rhythm: "Миф → разворот → доказательство → практический вывод",
    visual_beats: "Сравнение, контраст до/после, конкретный товар в использовании, финальный вывод",
    curiosity_gap: "Что на самом деле важно в выборе",
    payoff: "Снимает возражение и упрощает выбор",
    failure_signs: ["поучающий тон", "слишком много абстракций", "нет реального контраста"],
    niches: ["default", "cosmetics", "clothing"],
    goals: ["sell", "education"],
  },
  {
    id: "before_after",
    title: "Before after",
    hook_structure: "Было → стало → почему это возможно именно с этим товаром",
    retention_rhythm: "Показывает разницу максимально рано и не тянет объяснение",
    visual_beats: "До/после, деталь, которая изменилась, финальный close-up результата",
    curiosity_gap: "Какой именно шаг сделал разницу заметной",
    payoff: "Сразу понятный результат без долгих рассуждений",
    failure_signs: ["результат не виден", "слишком много воды", "нет контраста состояний"],
    niches: ["default", "cosmetics", "clothing", "toys"],
    goals: ["sell", "retention"],
  },
  {
    id: "story_twist",
    title: "Story twist",
    hook_structure: "Обычная бытовая сцена, которая резко поворачивает в неожиданную находку",
    retention_rhythm: "Наблюдение → сбой ожидания → находка → короткий вывод",
    visual_beats: "Живая сцена, поворот сюжета, реакция, доказательство в руках",
    curiosity_gap: "Что именно пошло не по шаблону",
    payoff: "Даёт ощущение открытия, а не очередной рекламы",
    failure_signs: ["слишком постановочно", "нет поворота", "сцена выглядит как студийный ролик"],
    niches: ["default", "cosmetics", "clothing"],
    goals: ["attention", "retention"],
  },
  {
    id: "top_list",
    title: "Top list",
    hook_structure: "Короткий список с явной причиной, почему именно эти варианты попали в подборку",
    retention_rhythm: "Каждый пункт решает отдельную задачу и двигает к выбору",
    visual_beats: "Нумерация, быстрые смены, сильная обложка для каждого пункта, общий итог",
    curiosity_gap: "Что в списке неожиданно лучше ожиданий",
    payoff: "Упрощает выбор между похожими товарами",
    failure_signs: ["слишком длинный список", "нет основания для отбора", "пункты выглядят одинаково"],
    niches: ["default", "toys", "clothing", "cosmetics"],
    goals: ["sell", "education"],
  },
  {
    id: "ugc_confession",
    title: "UGC confession",
    hook_structure: "Честное признание о проблеме, которую товар реально решил",
    retention_rhythm: "Признание → подробность → демонстрация → спокойный вывод",
    visual_beats: "Личный контекст, рука в кадре, конкретный сценарий использования, короткая реакция",
    curiosity_gap: "Почему этот опыт оказался лучше обычного",
    payoff: "Даёт доверие и ощущение живого опыта",
    failure_signs: ["слишком театрально", "много рекламных клише", "нет бытовой конкретики"],
    niches: ["default", "cosmetics", "clothing"],
    goals: ["sell", "trust"],
  },
];

function scorePattern(pattern: TastePattern, niche: string, format: string, goal: string): number {
  let score = 0;
  const n = (niche || "default").toLowerCase();
  const f = (format || "").toLowerCase();
  const g = (goal || "").toLowerCase();
  if (pattern.niches.includes(n) || pattern.niches.includes("default")) score += pattern.niches.includes(n) ? 3 : 1;
  if (f && (pattern.title.toLowerCase().includes(f) || pattern.id.includes(f))) score += 2;
  if (g && pattern.goals.includes(g)) score += 2;
  return score;
}

export function pickTastePatterns(input: { niche?: string; format?: string; goal?: string; limit?: number } = {}): TastePattern[] {
  const limit = Math.max(1, Math.min(5, Number(input.limit) || 3));
  return [...TASTE_PATTERNS]
    .sort((a, b) => scorePattern(b, input.niche || "", input.format || "", input.goal || "") - scorePattern(a, input.niche || "", input.format || "", input.goal || ""))
    .slice(0, limit);
}

export function tastePatternHints(input: { niche?: string; format?: string; goal?: string; limit?: number } = {}): string[] {
  return pickTastePatterns(input).map((p) =>
    `${p.title}: hook=${p.hook_structure}; retention=${p.retention_rhythm}; beats=${p.visual_beats}; gap=${p.curiosity_gap}; payoff=${p.payoff}`
  );
}
