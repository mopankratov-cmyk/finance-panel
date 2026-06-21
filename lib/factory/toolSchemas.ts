// Реестр настроек инструментов нод-студии V3 — источник для рендера ИНСПЕКТОРА ноды (§6 ТЗ).
// Принцип «настраиваемо под капотом, просто сверху»: ВСЕ поля открыты, сгруппированы по смыслу.
// Полные таблицы — docs/tool-settings-tz.md + docs/creatify-settings-tz.md. Здесь — машинная форма для UI.
// Энумы помечены «(сверить)» там, где брать живой дамп до прода. ui_control → как рисует инспектор.

import { CREATIFY_SCENES } from "./creatify";

export type UiControl = "dropdown" | "slider" | "toggle" | "text" | "textarea" | "color" | "number" | "picker" | "file";

export interface ToolField {
  name: string;            // RU-лейбл
  api_param: string;       // точное имя поля API
  ui: UiControl;
  values?: string[];       // для dropdown — МАШИННЫЕ значения (то, что уходит в API)
  valueLabels?: string[];  // опц. человекочитаемые подписи (параллельно values); если нет — показываем values
  min?: number; max?: number; step?: number; // для slider/number
  default?: string | number | boolean;
  group_note?: string;
  hint?: string;           // RU/ОТК-подсказка
}
export interface ToolGroup { group: string; fields: ToolField[] }
export interface ToolSchema { tool: string; label: string; node_types: string[]; groups: ToolGroup[]; available?: boolean }

export const TOOL_SCHEMAS: Record<string, ToolSchema> = {
  seedance: {
    tool: "seedance", label: "Seedance (AI-видео)", node_types: ["ai_product_render", "b_roll", "pov", "before_after"],
    groups: [
      { group: "Движок", fields: [
        { name: "Модель", api_param: "model", ui: "dropdown", values: ["seedance", "seedance_fast"], valueLabels: ["Seedance Pro (финал)", "Seedance fast (×3 дешевле)"], default: "seedance", hint: "pro=финал, fast=черновик-ОТК" },
      ] },
      { group: "Вход / кадры", fields: [
        { name: "Фото товара (старт)", api_param: "image_url", ui: "file", hint: "реальное фото карточки WB" },
        { name: "Конечный кадр (до/после)", api_param: "end_image_url", ui: "file", hint: "before/after — только pro" },
        { name: "Промпт движения", api_param: "prompt", ui: "textarea", hint: "preservation: товар не плывёт" },
      ] },
      { group: "Камера / формат", fields: [
        { name: "Фикс. камера", api_param: "camera_fixed", ui: "toggle", default: false, hint: "true для детальных товаров — меньше искажений" },
        { name: "Разрешение", api_param: "resolution", ui: "dropdown", values: ["480p", "720p", "1080p"], default: "720p", hint: "480p черновик, 1080p финал" },
        { name: "Соотношение", api_param: "aspect_ratio", ui: "dropdown", values: ["9:16", "1:1", "16:9", "3:4", "4:3", "21:9", "auto"], default: "9:16", hint: "форсим вертикаль (был БАГ)" },
        { name: "Длительность, с", api_param: "duration", ui: "slider", min: 2, max: 12, step: 1, default: 5, hint: "цена ∝ длине" },
      ] },
      { group: "Контроль", fields: [
        { name: "Сид", api_param: "seed", ui: "number", hint: "-1 = случайно; фиксировать удачный дубль" },
        { name: "Число кадров", api_param: "num_frames", ui: "number", min: 29, max: 289, hint: "29–289; ПЕРЕБИВАЕТ длительность" },
        { name: "Safety-чек", api_param: "enable_safety_checker", ui: "toggle", default: true },
      ] },
    ],
  },
  kling: {
    tool: "kling", label: "Kling (AI-видео, жёсткие формы)", node_types: ["ai_product_render", "before_after"],
    groups: [
      { group: "Движок", fields: [
        { name: "Версия", api_param: "version", ui: "dropdown", values: ["v2.1", "v1.6"], default: "v2.1", hint: "v2.5-turbo — когда зарегаем эндпоинт" },
        { name: "Режим", api_param: "mode", ui: "dropdown", values: ["standard", "pro"], default: "standard", hint: "pro=лучше держит лого/форму" },
      ] },
      { group: "Вход / промпт", fields: [
        { name: "Фото товара", api_param: "image_url", ui: "file" },
        { name: "Хвост-кадр (до/после)", api_param: "tail_image_url", ui: "file" },
        { name: "Промпт", api_param: "prompt", ui: "textarea" },
        { name: "Негатив (анти-слоп)", api_param: "negative_prompt", ui: "textarea", hint: "редактируемый" },
        { name: "CFG (сила промпта)", api_param: "cfg_scale", ui: "slider", min: 0, max: 1, step: 0.05, default: 0.5 },
      ] },
      { group: "Формат / эффекты", fields: [
        { name: "Длительность", api_param: "duration", ui: "dropdown", values: ["5", "10"], default: "5" },
        { name: "Соотношение", api_param: "aspect_ratio", ui: "dropdown", values: ["9:16", "1:1", "16:9"], default: "9:16", hint: "невалидно на standard i2v — может дать 422" },
        { name: "Спец-эффект (1.6)", api_param: "special_fx", ui: "dropdown", values: ["none", "hug", "kiss", "heart_gesture", "squish", "expansion", "fuzzyfuzzy", "bloombloom", "dizzydizzy", "jelly_press", "jelly_slice", "jelly_squish", "jelly_jiggle", "pixelpixel", "yearbook", "instant_film", "anime_figure"], default: "none", hint: "нужен effects-эндпоинт (1.6) — пока не применяется в i2v" },
      ] },
      { group: "Контроль", fields: [
        { name: "Сид", api_param: "seed", ui: "number", hint: "фиксировать удачный дубль" },
      ] },
    ],
  },
  creatify: {
    tool: "creatify", label: "Creatify (UGC-актёр)", node_types: ["hook_ugc", "talking_head", "prank"],
    groups: [
      { group: "Актёр / сцена", fields: [
        { name: "Аватар", api_param: "override_avatar", ui: "picker", hint: "галерея персон" },
        { name: "Композиция", api_param: "visual_style", ui: "picker", values: CREATIFY_SCENES.map((s) => s.id), valueLabels: CREATIFY_SCENES.map((s) => s.label), default: "AvatarBubbleTemplate", hint: "встроенные + твои кастомные шаблоны (живой список)" },
        { name: "Голос (RU)", api_param: "override_voice", ui: "picker", hint: "RU-whitelist; у API нет language" },
        { name: "Громкость озвучки", api_param: "voiceover_volume", ui: "slider", min: 0, max: 1, step: 0.05, default: 1 },
        { name: "Без эмоции аватара", api_param: "no_emotion", ui: "toggle", default: false },
        { name: "Без сток-broll", api_param: "no_stock_broll", ui: "toggle", default: true, hint: "анти-слоп — держать true" },
      ] },
      { group: "Скрипт", fields: [
        { name: "Наш сценарий", api_param: "override_script", ui: "textarea", hint: "русский, после ОТК" },
        { name: "Стиль (fallback)", api_param: "script_style", ui: "dropdown", values: ["DiscoveryWriter", "DontWorryWriter", "EnthusiasticWriter", "BenefitsV2", "ProblemSolutionV2", "ThreeReasonsHook", "NegativeHook"], default: "DiscoveryWriter", hint: "подтв. по docs; полный enum ~59 в API; игнор при override_script" },
      ] },
      { group: "Движок / формат", fields: [
        { name: "Модель", api_param: "model_version", ui: "dropdown", values: ["aurora_v1_fast", "aurora_v1", "standard"], default: "aurora_v1_fast", hint: "БАГ был — не слался" },
        { name: "Длительность", api_param: "video_length", ui: "dropdown", values: ["15", "30", "45", "60"], default: "15" },
        { name: "Соотношение", api_param: "aspect_ratio", ui: "dropdown", values: ["9x16", "1x1", "16x9", "4x3", "3x4"], default: "9x16", hint: "ltv формат XxY (подтв. по API-клиенту)" },
        { name: "Платформа", api_param: "target_platform", ui: "dropdown", values: ["Tiktok", "Instagram", "Youtube"], default: "Tiktok" },
        { name: "Без англо-CTA", api_param: "no_cta", ui: "toggle", default: true, hint: "держать true" },
      ] },
      { group: "Субтитры", fields: [
        { name: "Без субтитров", api_param: "no_caption", ui: "toggle", default: false },
        { name: "Шрифт (RU-safe)", api_param: "caption_setting.font_family", ui: "dropdown", values: ["Montserrat", "Poppins", "Comfortaa", "Quantico"], default: "Montserrat", hint: "только эти держат кириллицу" },
        { name: "Кегль", api_param: "caption_setting.font_size", ui: "slider", min: 20, max: 120, step: 2, default: 70 },
        { name: "Начертание", api_param: "caption_setting.font_style", ui: "dropdown", values: ["", "font-bold", "italic", "underline"], valueLabels: ["обычное", "жирное", "курсив", "подчёркнутое"], default: "", hint: "Creatify: только bold/italic/underline; пусто = без декора" },
        { name: "Цвет текста", api_param: "caption_setting.text_color", ui: "color", hint: "#RRGGBBAA с альфой" },
        { name: "Цвет фона", api_param: "caption_setting.background_color", ui: "color", hint: "#RRGGBBAA (подложка)" },
        { name: "Цвет подсветки (karaoke)", api_param: "caption_setting.highlight_text_color", ui: "color" },
        { name: "Смещение X", api_param: "caption_setting.offset.x", ui: "slider", min: -1, max: 1, step: 0.05, default: 0 },
        { name: "Смещение Y", api_param: "caption_setting.offset.y", ui: "slider", min: -1, max: 1, step: 0.05, default: 0.4 },
        { name: "Макс. ширина, px", api_param: "caption_setting.max_width", ui: "slider", min: 400, max: 1080, step: 20, default: 900, hint: "Creatify: пиксели, не доля (кадр 9×16 = 1080px)" },
        { name: "Межстрочный", api_param: "caption_setting.line_height", ui: "slider", min: 0.8, max: 2, step: 0.05, default: 1.2 },
      ] },
      { group: "Музыка", fields: [
        { name: "Фоновая музыка", api_param: "background_music_url", ui: "picker", hint: "живой список из Creatify /musics/ (▶ прослушать)" },
        { name: "Громкость музыки", api_param: "background_music_volume", ui: "slider", min: 0, max: 1, step: 0.05, default: 0.2, hint: "≤0.2–0.3 под озвучку" },
        { name: "Без фоновой музыки", api_param: "no_background_music", ui: "toggle", default: false },
      ] },
    ],
  },
  shotstack: {
    tool: "shotstack", label: "Shotstack (монтаж/субтитры)", node_types: ["captions", "transition", "effect"],
    groups: [
      { group: "Переходы / эффекты", fields: [
        { name: "Переход вход", api_param: "transition.in", ui: "dropdown", values: ["none", "fade", "reveal", "wipeLeft", "wipeRight", "slideLeft", "slideRight", "slideUp", "slideDown", "carouselLeft", "carouselRight", "carouselUp", "carouselDown", "shuffleTopRight", "zoom"], default: "none" },
        { name: "Эффект (Ken Burns)", api_param: "effect", ui: "dropdown", values: ["none", "zoomIn", "zoomInSlow", "zoomOut", "zoomOutSlow", "slideLeft", "slideLeftSlow", "slideRight", "slideRightSlow", "slideUp", "slideDown"], default: "none" },
        { name: "Фильтр", api_param: "filter", ui: "dropdown", values: ["none", "boost", "contrast", "darken", "greyscale", "lighten", "muted", "negative"], default: "none" },
      ] },
      { group: "Текст-субтитры", fields: [
        { name: "Шрифт", api_param: "font.family", ui: "dropdown", values: ["Noto Sans", "Montserrat"], default: "Noto Sans", hint: "кириллица ✓ (смоук пройден)" },
        { name: "Размер", api_param: "font.size", ui: "slider", min: 20, max: 80, step: 2, default: 48 },
        { name: "Цвет", api_param: "font.color", ui: "color", default: "#ffffff" },
        { name: "Авто-субтитры из озвучки", api_param: "asset.caption", ui: "toggle", default: false, hint: "киллер-фича" },
      ] },
      { group: "Аудио", fields: [
        { name: "Громкость трека", api_param: "asset.volume", ui: "slider", min: 0, max: 1, step: 0.05, default: 1 },
        { name: "Fade", api_param: "asset.effect", ui: "dropdown", values: ["none", "fadeIn", "fadeOut", "fadeInFadeOut"], default: "none" },
      ] },
      { group: "Композиция", fields: [
        { name: "Вписывание", api_param: "fit", ui: "dropdown", values: ["cover", "contain", "crop", "none"], default: "cover" },
        { name: "Фон таймлайна", api_param: "timeline.background", ui: "color", default: "#000000" },
      ] },
      { group: "Формат / вывод", fields: [
        { name: "Формат", api_param: "output.format", ui: "dropdown", values: ["mp4", "gif"], default: "mp4", hint: "mp4 — основной (gif niche); webm/mp3 Shotstack для этого пайплайна не валиден" },
        { name: "Соотношение", api_param: "aspect_ratio", ui: "dropdown", values: ["9:16", "1:1", "16:9"], default: "9:16", hint: "→ output.size (не отдельное поле)" },
        { name: "FPS", api_param: "output.fps", ui: "dropdown", values: ["12", "15", "24", "25", "30"], default: "25" },
        { name: "Качество", api_param: "output.quality", ui: "dropdown", values: ["low", "medium", "high"], default: "medium" },
      ] },
    ],
  },
  higgsfield: {
    tool: "higgsfield", label: "Higgsfield (изображение/камера)", node_types: ["carousel_slide", "static_post", "ai_product_render"], available: false,
    groups: [
      { group: "Soul (text2image)", fields: [
        { name: "Промпт", api_param: "prompt", ui: "textarea" },
        // width_and_height — реальное поле Soul API (WH-строки из нашего WH_BY_RATIO), не «соотношение»
        { name: "Размер (соотношение)", api_param: "width_and_height", ui: "dropdown", values: ["1536x2048", "2048x2048", "1152x2048", "2048x1152", "2048x1536"], valueLabels: ["3:4", "1:1", "9:16", "16:9", "4:3"], default: "1536x2048" },
        { name: "Качество", api_param: "quality", ui: "dropdown", values: ["720p", "1080p"], default: "1080p", hint: "Soul: строка-разрешение" },
        { name: "Вариантов", api_param: "batch_size", ui: "number", min: 1, max: 4, default: 1 },
        { name: "Реф (img2img)", api_param: "reference_url", ui: "file", hint: "→ image_reference{type:image_url}" },
        { name: "Сила рефа", api_param: "reference_strength", ui: "slider", min: 0, max: 1, step: 0.05, default: 0.6 },
      ] },
    ],
  },
  gemini: {
    tool: "gemini", label: "Gemini Nano-Banana (композит товара)", node_types: ["ai_product_render", "static_post"], available: false,
    groups: [
      { group: "Композит (U4)", fields: [
        { name: "Промпт", api_param: "prompt", ui: "textarea", hint: "«вставь товар + upscale by real photo»" },
        { name: "Входные изображения", api_param: "images", ui: "file", hint: "→ contents.parts.inlineData (фото актёра + PNG товара)" },
        { name: "Соотношение", api_param: "aspect_ratio", ui: "dropdown", values: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], default: "9:16", hint: "image_config.aspectRatio" },
        { name: "PNG товара (guide)", api_param: "product_image_url", ui: "file" },
      ] },
    ],
  },
  claude: {
    tool: "claude", label: "Claude (сценарист)", node_types: ["scenarist"], available: false,
    groups: [
      { group: "Модель / сэмплинг", fields: [
        { name: "Модель", api_param: "model", ui: "dropdown", values: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5"], default: "claude-sonnet-4-6" },
        { name: "Temperature", api_param: "temperature", ui: "slider", min: 0, max: 1, step: 0.05, default: 1, hint: "temperature ИЛИ top_p, не оба" },
        { name: "Top-p", api_param: "top_p", ui: "slider", min: 0, max: 1, step: 0.05, hint: "альтернатива temperature" },
        { name: "Top-k", api_param: "top_k", ui: "number", min: 1, hint: "≥1 (0 невалиден)" },
        { name: "Max tokens", api_param: "max_tokens", ui: "number", min: 1800, max: 8192, default: 1800, hint: "флор 1800 (нужно сценарию)" },
        { name: "Stop-последовательности", api_param: "stop_sequences", ui: "textarea", hint: "до 4 строк, по одной на строку" },
        { name: "Расширенное мышление, токенов", api_param: "thinking_budget", ui: "number", min: 1024, hint: "≥1024, <max_tokens; отключает temp/top_p/top_k" },
        { name: "Service tier", api_param: "service_tier", ui: "dropdown", values: ["auto", "standard_only"], default: "auto" },
      ] },
      { group: "Промпт / грундинг", fields: [
        { name: "System-промпт", api_param: "system", ui: "textarea" },
        { name: "Грундинг плейбук ниши", api_param: "ground_playbook", ui: "toggle", default: true },
        { name: "Грундинг корпус", api_param: "ground_corpus", ui: "toggle", default: true },
      ] },
    ],
  },
  sound: {
    tool: "sound", label: "Звук / музыка", node_types: ["sound", "music"],
    groups: [
      { group: "Трек", fields: [
        { name: "URL трека (mp3)", api_param: "url", ui: "picker", hint: "прямой mp3 — доходит до сборки; sound_id без url не играет" },
        { name: "Источник", api_param: "source", ui: "dropdown", values: ["virlo_trending", "virlo_breakout", "orbit_synced", "creatify_music"], default: "orbit_synced" },
        { name: "ID трека", api_param: "sound_id", ui: "picker", hint: "подменять по title (модель галлюцинирует UUID)" },
        { name: "Название", api_param: "title", ui: "text", hint: "маппится на sound_id" },
        { name: "Commerce-safe", api_param: "is_commerce_safe", ui: "toggle", default: true },
        { name: "Громкость", api_param: "volume", ui: "slider", min: 0, max: 1, step: 0.05, default: 0.3, hint: "≤0.3 под озвучку" },
      ] },
    ],
  },
  disk_real: {
    tool: "disk_real", label: "Реальная съёмка (Я.Диск)", node_types: ["b_roll", "scene"],
    groups: [
      { group: "Клип", fields: [
        { name: "Кадр/клип", api_param: "url", ui: "picker", hint: "по артикулу/цвету" },
        { name: "Trim старт, с", api_param: "trim_start", ui: "slider", min: 0, max: 30, step: 0.5, default: 0 },
        { name: "Trim конец, с", api_param: "trim_end", ui: "slider", min: 0, max: 30, step: 0.5, hint: "0 = до конца; длина клипа = end−start" },
        { name: "Длительность, с", api_param: "duration_sec", ui: "number", hint: "ffprobe / ручками" },
        { name: "Роль в графе", api_param: "role", ui: "dropdown", values: ["scene", "hook", "payoff", "skip"], default: "scene" },
      ] },
      { group: "Формат", fields: [
        { name: "Вписывание", api_param: "asset.fit", ui: "dropdown", values: ["cover", "contain", "crop", "none"], default: "cover" },
        { name: "Громкость клипа", api_param: "asset.volume", ui: "slider", min: 0, max: 1, step: 0.05, default: 0 },
      ] },
    ],
  },
};

export function toolSchema(tool: string): ToolSchema | null {
  return TOOL_SCHEMAS[tool] || null;
}
export function allToolKeys(): string[] {
  return Object.keys(TOOL_SCHEMAS);
}
