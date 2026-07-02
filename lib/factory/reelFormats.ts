// Реестр исполнимых видео-форматов завода: добыт 2026-07-02 из трёх источников —
// собственный корпус Reels Brain (37 хуков Virlo-орбит, таксономия hook/structure),
// RU-рынок 2026 (Wibes/VK Клипы; IG запрещён, YT заблокирован, TikTok не грузится с RU)
// и реальные возможности сборки (Shotstack / fal timeline / Remotion).
// Правило то же, что у METRIC_REGISTRY: список форматов НЕ хардкодить нигде, кроме этого файла.

export type ReelNiche = "cosmetics" | "clothing" | "toys";
export type ReelPlatform = "wibes" | "vk_clips" | "telegram";
export type ReelAssemblyLane = "shotstack" | "fal_timeline" | "remotion";
export type ReelSlotKind = "face" | "broll" | "text_card" | "endcard";

export interface ReelBeat {
  beat_id: string;
  start_sec: number;
  end_sec: number;
  slot: ReelSlotKind;
  direction: string;
  text_overlay?: string;
}

export interface ReelFormatSpec {
  format_id: string;
  name_ru: string;
  retention_mechanic: string;
  niche_fit: Record<ReelNiche, number>;
  platform_fit: Record<ReelPlatform, number>;
  duration_target_sec: [number, number];
  works_without_sound: boolean;
  requires_blogger: boolean;
  assembly_lane: ReelAssemblyLane;
  beats: ReelBeat[];
  hook_examples: string[];
  guards: string[];
  evidence: string;
}

// Инварианты площадок (рынок 2026): Wibes = 15-30с, хук ≤2с, УТП читается БЕЗ звука,
// артикул крупно с первых 2 секунд; 15с ролика ≈ 40-50 слов.
export const REEL_PLATFORM_RULES = {
  wibes: {
    duration_sec: [15, 30] as [number, number],
    hook_deadline_sec: 2,
    must_read_without_sound: true,
    article_on_screen_from_sec: 2,
    posts_per_week: [3, 5] as [number, number],
  },
  vk_clips: {
    duration_sec: [15, 60] as [number, number],
    hook_deadline_sec: 3,
    must_read_without_sound: false,
    article_on_screen_from_sec: 3,
    posts_per_week: [3, 7] as [number, number],
  },
  telegram: {
    duration_sec: [15, 60] as [number, number],
    hook_deadline_sec: 3,
    must_read_without_sound: false,
    article_on_screen_from_sec: 3,
    posts_per_week: [2, 5] as [number, number],
  },
} as const;

const ARTICLE_ENDCARD: ReelBeat = {
  beat_id: "endcard_article",
  start_sec: -3,
  end_sec: 0,
  slot: "endcard",
  direction: "финальная плашка: артикул крупным шрифтом + один CTA («ищи на WB по артикулу»); один CTA на ролик, не несколько",
  text_overlay: "Артикул: {article} — ищи на WB",
};

export const REEL_FORMAT_REGISTRY: readonly ReelFormatSpec[] = [
  {
    format_id: "skeptic_proof",
    name_ru: "Скептик («я не верила, что это работает»)",
    retention_mechanic: "proof_wait — зритель ждёт доказательства",
    niche_fit: { cosmetics: 5, toys: 4, clothing: 2 },
    platform_fit: { wibes: 5, vk_clips: 5, telegram: 4 },
    duration_target_sec: [18, 28],
    works_without_sound: false,
    requires_blogger: true,
    assembly_lane: "shotstack",
    beats: [
      { beat_id: "hook_face", start_sec: 0, end_sec: 2.5, slot: "face", direction: "лицо в камеру, товар в руке виден сразу, хук-сомнение", text_overlay: "{hook_short}" },
      { beat_id: "doubt_context", start_sec: 2.5, end_sec: 6, slot: "broll", direction: "контекст сомнения: скрин отзывов/корзины WB, товар крупно, голос продолжает за кадром" },
      { beat_id: "proof_process", start_sec: 6, end_sec: 16, slot: "broll", direction: "процесс использования крупным планом, 2-3 склейки по 2-3с, живая речь с оговорками, без глянца", text_overlay: "{proof_caption}" },
      { beat_id: "verdict_face", start_sec: 16, end_sec: 17.5, slot: "face", direction: "короткий честный вердикт лицом, полторы секунды (суммарное лицо ровно 4с)" },
      ARTICLE_ENDCARD,
    ],
    hook_examples: [
      "Я не верила, что это работает",
      "Вы неправильно используете санскрин",
      "Отзывы подозрительно хорошие — проверила",
      "Дерматолог сказала бы — это не совсем так",
    ],
    guards: [
      "суммарное лицо ≤4с жёстко (ugcStoryboard clamp) — здесь 2.5с + 3с НЕ превышать за счёт verdict",
      "каждое утверждение в речи должно иметь визуальный пруф-кадр (proof discipline)",
      "b-roll только source_tier canonical|prepared|product_lane",
    ],
    evidence: "corpus: warning_pattern_break viability 5 (SPF Orbit 1.6M views, viral_hooks_seed.sql); market: UGC-скептик = базовый бриф-формат посевов",
  },
  {
    format_id: "before_after",
    name_ru: "До/После (результат первым кадром)",
    retention_mechanic: "transformation_wait — результат показан сразу, зритель ждёт «как»",
    niche_fit: { cosmetics: 5, clothing: 4, toys: 1 },
    platform_fit: { wibes: 5, vk_clips: 4, telegram: 4 },
    duration_target_sec: [18, 30],
    works_without_sound: true,
    requires_blogger: false,
    assembly_lane: "shotstack",
    beats: [
      { beat_id: "result_first", start_sec: 0, end_sec: 3, slot: "broll", direction: "СНАЧАЛА финальный результат — он и есть хук", text_overlay: "Это заняло {n} минут" },
      { beat_id: "before_state", start_sec: 3, end_sec: 7, slot: "broll", direction: "исходное состояние «до» — максимальный контраст" },
      { beat_id: "process_fast", start_sec: 7, end_sec: 18, slot: "broll", direction: "ускоренный процесс: джампкаты по 1.5-2.5с, товар в кадре, текст-подписи этапов", text_overlay: "{step_caption}" },
      { beat_id: "side_by_side", start_sec: 18, end_sec: 24, slot: "broll", direction: "до/после рядом или свайпом — пик ролика" },
      ARTICLE_ENDCARD,
    ],
    hook_examples: [
      "Нанесла тональный — посмотри через 8 часов",
      "До/после: куртка с маркетплейса vs оффлайн",
      "Это было сделано за 10 минут",
    ],
    guards: [
      "результат в первых 3 секундах, НЕ тянуть до конца",
      "работает без блогера — чистый b-roll формат, лицо опционально",
      "текст-плашки обязательны: формат должен читаться без звука (Wibes)",
    ],
    evidence: "corpus: before_after hook-тип + transformation_wait; market: формат №1 для косметики, результат-первым-кадром = хук",
  },
  {
    format_id: "versus_test",
    name_ru: "Тест/Сравнение head-to-head",
    retention_mechanic: "delayed_payoff — замер/вердикт в конце",
    niche_fit: { toys: 5, cosmetics: 4, clothing: 3 },
    platform_fit: { wibes: 5, vk_clips: 5, telegram: 4 },
    duration_target_sec: [18, 30],
    works_without_sound: true,
    requires_blogger: false,
    assembly_lane: "shotstack",
    beats: [
      { beat_id: "battle_hook", start_sec: 0, end_sec: 2.5, slot: "text_card", direction: "анонс батла текстом поверх обоих товаров в кадре", text_overlay: "{x} против {y}: кто победит?" },
      { beat_id: "side_by_side_demo", start_sec: 2.5, end_sec: 12, slot: "broll", direction: "параллельная демонстрация по измеримому критерию (дальность/стойкость/тепло), склейки 2-3с", text_overlay: "{criterion_caption}" },
      { beat_id: "measurement", start_sec: 12, end_sec: 18, slot: "broll", direction: "замер/результат — отложенная развязка", text_overlay: "{result_caption}" },
      { beat_id: "verdict_card", start_sec: 18, end_sec: 22, slot: "text_card", direction: "вердикт + прайс-якорь текстом", text_overlay: "Победил {winner} за {price}₽" },
      ARTICLE_ENDCARD,
    ],
    hook_examples: [
      "Кто стреляет дальше — тест водяных пистолетов",
      "Игрушка за 300₽ против 3000₽: честно",
      "Корейский тональный за 600₽ vs дорогой: разница?",
      "WB куртка vs известный бренд — разница?",
    ],
    guards: [
      "критерий сравнения должен быть ИЗМЕРИМЫМ и показанным, не заявленным",
      "смена динамики каждые 2-3с",
      "чужой бренд не называть в тексте плашек (юр. риск) — «дорогой аналог»",
    ],
    evidence: "corpus: challenge/сравнение viability 5 toys (viral_hooks_seed.sql), bake-off control «cheap vs expensive»; market: батл = сильнейший toys-формат",
  },
  {
    format_id: "wb_unboxing",
    name_ru: "Распаковка WB-пакета (реакция)",
    retention_mechanic: "surprise_hold — каждый предмет = микро-сюрприз",
    niche_fit: { toys: 5, clothing: 3, cosmetics: 3 },
    platform_fit: { wibes: 5, vk_clips: 4, telegram: 3 },
    duration_target_sec: [18, 28],
    works_without_sound: false,
    requires_blogger: true,
    assembly_lane: "shotstack",
    beats: [
      { beat_id: "package_hook", start_sec: 0, end_sec: 2, slot: "broll", direction: "руки с фирменным пакетом WB — пакет сам по себе триггер узнавания", text_overlay: "Смотри, что пришло с WB" },
      { beat_id: "opening", start_sec: 2, end_sec: 8, slot: "broll", direction: "вскрытие в реальном времени, шуршание как ASMR-слой" },
      { beat_id: "reaction_face", start_sec: 8, end_sec: 11, slot: "face", direction: "реакция лицом на увиденное — единственный face-слот, ≤3с" },
      { beat_id: "first_look", start_sec: 11, end_sec: 19, slot: "broll", direction: "осмотр: деталь, комплектация, «ожидание vs реальность» текстом", text_overlay: "{expectation_caption}" },
      { beat_id: "in_action", start_sec: 19, end_sec: 24, slot: "broll", direction: "товар сразу в действии" },
      ARTICLE_ENDCARD,
    ],
    hook_examples: [
      "Смотри, что мне пришло с WB",
      "Дети в шоке: что внутри этой коробки?",
      "Распаковка минималиста: всё в одной сумочке",
      "Что внутри сумки за 1500₽?",
    ],
    guards: [
      "реакция ≤3с и только после вскрытия — не спойлерить лицом до reveal",
      "детские лица НЕ генерить синтетикой — только реальные съёмки или без детей",
    ],
    evidence: "corpus: unboxing viability 5 toys + mini-bags Orbit avg virality 0.673 (лучший); market: пакет WB = триггер, ASMR-слой",
  },
  {
    format_id: "silent_test_drive",
    name_ru: "Тест-драйв без слов (под титры, Wibes-native)",
    retention_mechanic: "surprise_hold — каждые 3-4с новое свойство с плашкой",
    niche_fit: { toys: 5, cosmetics: 4, clothing: 4 },
    platform_fit: { wibes: 5, vk_clips: 4, telegram: 3 },
    duration_target_sec: [15, 25],
    works_without_sound: true,
    requires_blogger: false,
    assembly_lane: "fal_timeline",
    beats: [
      { beat_id: "action_hook", start_sec: 0, end_sec: 2, slot: "broll", direction: "товар уже В ДЕЙСТВИИ (не лежит — работает) + крупный заголовок-УТП", text_overlay: "{usp_headline}" },
      { beat_id: "property_1", start_sec: 2, end_sec: 6, slot: "broll", direction: "демонстрация свойства 1", text_overlay: "{property_1}" },
      { beat_id: "property_2", start_sec: 6, end_sec: 10, slot: "broll", direction: "демонстрация свойства 2", text_overlay: "{property_2}" },
      { beat_id: "property_3", start_sec: 10, end_sec: 14, slot: "broll", direction: "стресс-тест/краш-тест как пик", text_overlay: "{property_3}" },
      { beat_id: "best_shot", start_sec: 14, end_sec: 18, slot: "broll", direction: "главное свойство ещё раз самым эффектным кадром" },
      ARTICLE_ENDCARD,
    ],
    hook_examples: [
      "Не течёт. Проверили.",
      "Держит 8 часов — смотри",
      "Выдерживает вес взрослого",
    ],
    guards: [
      "НЕ требует ни блогера, ни голоса — самый дешёвый формат завода, чистые твины + плашки",
      "каждая плашка ≤5 слов, читается за 1.5с",
      "полностью читается без звука — обязательное условие Wibes",
    ],
    evidence: "corpus: demo/review структура + список retention-механик; market: формат специально под Wibes (УТП без звука)",
  },
  {
    format_id: "top_n_finds",
    name_ru: "Топ-N находок / примерка-подборка",
    retention_mechanic: "open_loop — нумерация до конца + «какой номер лучший?»",
    niche_fit: { clothing: 5, cosmetics: 4, toys: 4 },
    platform_fit: { wibes: 4, vk_clips: 5, telegram: 5 },
    duration_target_sec: [25, 55],
    works_without_sound: true,
    requires_blogger: true,
    assembly_lane: "shotstack",
    beats: [
      { beat_id: "count_hook", start_sec: 0, end_sec: 2.5, slot: "face", direction: "анонс с числом и порогом цены (число + порог обязательны)", text_overlay: "Топ-{n} находок с WB до {price}₽" },
      { beat_id: "item_block_1", start_sec: 3, end_sec: 11, slot: "broll", direction: "блок товара: использование/примерка 2-3с → деталь крупно 2с → плашка цена+артикул 2с", text_overlay: "№1 · {price_1}₽ · арт. {article_1}" },
      { beat_id: "item_block_2", start_sec: 11, end_sec: 19, slot: "broll", direction: "тот же блок, смена по биту звука", text_overlay: "№2 · {price_2}₽ · арт. {article_2}" },
      { beat_id: "item_block_3", start_sec: 19, end_sec: 27, slot: "broll", direction: "тот же блок", text_overlay: "№3 · {price_3}₽ · арт. {article_3}" },
      { beat_id: "favorite_face", start_sec: 27, end_sec: 28.5, slot: "face", direction: "фаворит + вопрос «какой номер лучший?» — кормит комменты (суммарное лицо ровно 4с)", text_overlay: "Пиши номер в комменты" },
      ARTICLE_ENDCARD,
    ],
    hook_examples: [
      "Топ-5 находок с WB до 1000₽",
      "Собрала 4 образа с WB до 2000₽",
      "Что занять ребёнка: 5 игрушек до 500₽",
      "Бьюти-находки до 700₽, о которых молчат",
    ],
    guards: [
      "каждый блок товара — одинаковая структура (ритм) и своя плашка цена+артикул",
      "суммарное лицо ≤4с: 3с хук + ≤1с фаворит ИЛИ фаворит текстом",
      "мультитоварный формат = мультиартикульный endcard (артикулы в описании)",
    ],
    evidence: "market: подборки = двигатель посевов (CPV 0.09-0.6₽), вопрос номера кормит алгоритм; corpus: list_promise hook-тип",
  },
] as const;

export function listReelFormats(): ReelFormatSpec[] {
  return REEL_FORMAT_REGISTRY.map((f) => ({ ...f, beats: f.beats.map((b) => ({ ...b })) }));
}

export function getReelFormat(formatId: string): ReelFormatSpec | null {
  return REEL_FORMAT_REGISTRY.find((f) => f.format_id === formatId) || null;
}

export function pickReelFormatsForNiche(niche: ReelNiche, platform: ReelPlatform = "wibes"): ReelFormatSpec[] {
  return listReelFormats()
    .filter((f) => f.niche_fit[niche] >= 3 && f.platform_fit[platform] >= 3)
    .sort((a, b) => b.niche_fit[niche] * 10 + b.platform_fit[platform] - (a.niche_fit[niche] * 10 + a.platform_fit[platform]));
}

export interface ReelFormatValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateReelFormat(spec: ReelFormatSpec): ReelFormatValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const positional = spec.beats.filter((b) => b.start_sec >= 0);
  const sorted = [...positional].sort((a, b) => a.start_sec - b.start_sec);
  for (const beat of positional) {
    if (beat.end_sec <= beat.start_sec) errors.push(`${beat.beat_id}: end <= start`);
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start_sec < sorted[i - 1].end_sec) errors.push(`${sorted[i].beat_id}: overlaps ${sorted[i - 1].beat_id}`);
  }
  const faceTotal = positional.filter((b) => b.slot === "face").reduce((s, b) => s + (b.end_sec - b.start_sec), 0);
  if (spec.requires_blogger && faceTotal > 4 + 1e-9) {
    errors.push(`total face time ${faceTotal.toFixed(1)}s exceeds the hard 4s cap (ugcStoryboard invariant)`);
  }
  if (!spec.requires_blogger && faceTotal > 0) warnings.push("format claims no blogger but has face beats");
  const lastPositional = sorted[sorted.length - 1];
  if (lastPositional && lastPositional.end_sec > spec.duration_target_sec[1]) {
    errors.push(`beats run to ${lastPositional.end_sec}s beyond duration target ${spec.duration_target_sec[1]}s`);
  }
  if (!spec.beats.some((b) => b.slot === "endcard" && (b.text_overlay || "").includes("{article}"))) {
    errors.push("missing article endcard — артикул обязателен для WB-трафика");
  }
  if (spec.works_without_sound) {
    const overlays = positional.filter((b) => b.text_overlay).length;
    if (overlays < Math.max(2, Math.floor(positional.length / 2))) {
      errors.push("works_without_sound requires text overlays on most beats (Wibes: УТП без звука)");
    }
  }
  if (spec.platform_fit.wibes >= 4 && spec.duration_target_sec[0] < REEL_PLATFORM_RULES.wibes.duration_sec[0]) {
    warnings.push("wibes-first format shorter than 15s floor");
  }
  const hookBeat = sorted[0];
  if (hookBeat && hookBeat.start_sec > 0) errors.push("first beat must start at 0 — hook deadline is 2s");
  return { ok: errors.length === 0, errors, warnings };
}

export function describeReelFormats(): Array<Pick<ReelFormatSpec, "format_id" | "name_ru" | "retention_mechanic" | "niche_fit" | "platform_fit" | "requires_blogger" | "works_without_sound">> {
  return listReelFormats().map(({ format_id, name_ru, retention_mechanic, niche_fit, platform_fit, requires_blogger, works_without_sound }) => ({
    format_id, name_ru, retention_mechanic, niche_fit, platform_fit, requires_blogger, works_without_sound,
  }));
}
