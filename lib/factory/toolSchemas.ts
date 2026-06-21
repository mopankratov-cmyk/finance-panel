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
        { name: "Соотношение", api_param: "aspect_ratio", ui: "dropdown", values: ["9:16", "1:1", "16:9", "3:4", "4:3"], default: "9:16", hint: "форсим вертикаль (был БАГ)" },
        { name: "Длительность, с", api_param: "duration", ui: "slider", min: 2, max: 12, step: 1, default: 5, hint: "цена ∝ длине" },
      ] },
      { group: "Контроль", fields: [
        { name: "Сид", api_param: "seed", ui: "number", hint: "фиксировать удачный дубль" },
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
      { group: "Формат", fields: [
        { name: "Длительность", api_param: "duration", ui: "dropdown", values: ["5", "10"], default: "5" },
        { name: "Соотношение", api_param: "aspect_ratio", ui: "dropdown", values: ["9:16", "1:1", "16:9"], default: "9:16", hint: "невалидно на standard i2v — может дать 422" },
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
        { name: "Композиция", api_param: "visual_style", ui: "dropdown", values: CREATIFY_SCENES.map((s) => s.id), valueLabels: CREATIFY_SCENES.map((s) => s.label), default: "AvatarBubbleTemplate", hint: "API ждёт *Template-id" },
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
        { name: "Шрифт (RU-safe)", api_param: "caption_setting.font_family", ui: "dropdown", values: ["Montserrat", "Poppins", "Comfortaa", "Quantico"], default: "Montserrat", hint: "только эти держат кириллицу" },
        { name: "Цвет текста", api_param: "caption_setting.text_color", ui: "color", hint: "#RRGGBBAA с альфой" },
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
    ],
  },
  higgsfield: {
    tool: "higgsfield", label: "Higgsfield (изображение/камера)", node_types: ["carousel_slide", "static_post", "ai_product_render"], available: false,
    groups: [
      { group: "Soul (text2image)", fields: [
        { name: "Промпт", api_param: "prompt", ui: "textarea" },
        { name: "Соотношение", api_param: "aspect_ratio", ui: "dropdown", values: ["9:16", "1:1", "16:9", "4:5"], default: "9:16" },
        { name: "Качество", api_param: "quality", ui: "dropdown", values: ["basic", "high"], default: "high" },
        { name: "Вариантов", api_param: "batch_size", ui: "number", min: 1, max: 4, default: 1 },
        { name: "Реф (img2img)", api_param: "reference_url", ui: "file" },
      ] },
    ],
  },
  gemini: {
    tool: "gemini", label: "Gemini Nano-Banana (композит товара)", node_types: ["ai_product_render", "static_post"], available: false,
    groups: [
      { group: "Композит (U4)", fields: [
        { name: "Промпт", api_param: "prompt", ui: "textarea", hint: "«вставь товар + upscale by real photo»" },
        { name: "Входные изображения", api_param: "images", ui: "file", hint: "фото актёра + PNG товара" },
      ] },
    ],
  },
  claude: {
    tool: "claude", label: "Claude (сценарист)", node_types: ["scenarist"], available: false,
    groups: [
      { group: "Модель / сэмплинг", fields: [
        { name: "Модель", api_param: "model", ui: "dropdown", values: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5"], default: "claude-sonnet-4-6" },
        { name: "Temperature", api_param: "temperature", ui: "slider", min: 0, max: 1, step: 0.05, default: 1 },
        { name: "Max tokens", api_param: "max_tokens", ui: "number", min: 256, max: 8192, default: 3000 },
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
        { name: "Длительность, с", api_param: "duration_sec", ui: "number", hint: "ffprobe" },
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
