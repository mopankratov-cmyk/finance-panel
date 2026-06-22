// §17 Ф0 · Нормализатор параметров ноды — детерминированный гард между «что предложил ИИ/человек»
// и «что реально уйдёт в движок». Что бы Claude ни нагаллюцинировал в autofill, сюда заходит сырой
// объект, а выходит API-ВАЛИДНЫЙ: только known-поля, энумы снапнуты, числа заклэмплены к [min,max]/step,
// дефолты подставлены, вертикаль форсирована, i2v-картинка проверена. → превью/graph-run не падают с 422.
// Чистая функция, без сети/БД. Покрыта lib/factory/normalizeParams.test.mts.
import { TOOL_SCHEMAS, type ToolField } from "./toolSchemas";

export interface NormalizeResult {
  params: Record<string, unknown>;
  warnings: string[];
}

// мета-ключи студии/graphRun — НЕ поля API, но нужны логике (pickCulprit по role, captions по onscreen_text,
// грундинг промптов по emotion/visual_desc). Движки их игнорируют (берут свои api_param), потому пропускаем как есть.
const META_KEYS = new Set(["role", "onscreen_text", "emotion", "visual_desc"]);
// движки image-to-video — без стартового кадра падают; эндпоинт по маркеру needs_image даунгрейдит движок
const I2V_TOOLS = new Set(["seedance", "kling"]);

// плоская карта api_param → поле схемы (схема разложена по группам)
function fieldsOf(tool: string): Map<string, ToolField> {
  const map = new Map<string, ToolField>();
  const sch = TOOL_SCHEMAS[tool];
  if (sch) for (const g of sch.groups) for (const f of g.fields) map.set(f.api_param, f);
  return map;
}

function snapNumber(f: ToolField, n: number): number {
  if (f.min !== undefined && n < f.min) n = f.min;
  if (f.max !== undefined && n > f.max) n = f.max;
  if (f.step !== undefined && f.step > 0 && f.min !== undefined) {
    n = f.min + Math.round((n - f.min) / f.step) * f.step;
    const dec = (String(f.step).split(".")[1] || "").length; // убрать дрейф float (0.1+0.2)
    if (dec) n = Number(n.toFixed(dec));
  }
  return n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coerce(f: ToolField, v: any, warnings: string[]): unknown {
  // dropdown — ЗАКРЫТЫЙ энум: значение не из набора → снап на default/первое
  if (f.ui === "dropdown" && Array.isArray(f.values) && f.values.length) {
    const s = String(v);
    if (f.values.includes(s)) return s;
    const snap = f.default !== undefined && f.values.includes(String(f.default)) ? String(f.default) : f.values[0];
    warnings.push(`${f.api_param}=«${s}» не из набора — снап на «${snap}»`);
    return snap;
  }
  // picker — ЖИВОЙ список (voices/templates/musics): статичные values лишь встроенное подмножество, кастомные id
  // тянутся из API → валидный «чужой» id (напр. кастомный visual_style из бренд-кита) НЕ снапаем, оставляем как есть
  if (f.ui === "picker") {
    if (v == null) return undefined;
    const s = String(v);
    if (Array.isArray(f.values) && f.values.length && !f.values.includes(s)) warnings.push(`${f.api_param}=«${s}» вне встроенного набора (живой id — оставлен)`);
    return s;
  }
  // число/слайдер: clamp [min,max] + снап к step
  if (f.ui === "slider" || f.ui === "number") {
    // Number('')/Number(null)/Number(false)/Number([]) === 0 (а Number(true)===1) → клэмпнулось бы к min вместо дефолта.
    // Отсекаем «незначащие» входы ДО Number(), чтобы пустое/булево/массив уходили в дефолт схемы.
    if (v == null || typeof v === "boolean" || Array.isArray(v) || (typeof v === "string" && v.trim() === "")) {
      return f.default !== undefined ? f.default : undefined;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) {
      warnings.push(`${f.api_param}=«${v}» не число — ${f.default !== undefined ? "дефолт " + f.default : "пропуск"}`);
      return f.default !== undefined ? f.default : undefined;
    }
    return snapNumber(f, n);
  }
  // тумблер: к булю (null/undefined → «не задано» → дефолт схемы применится ниже, а НЕ false)
  if (f.ui === "toggle") {
    if (v == null) return undefined;
    if (typeof v === "boolean") return v;
    const s = String(v).toLowerCase().trim();
    return s === "true" || s === "1" || s === "yes" || s === "да";
  }
  // цвет — строго #RRGGBB или #RRGGBBAA; мусор («red», «#GGG», кириллица) → дефолт схемы или дроп
  // (иначе уходит в Creatify/Shotstack → 422 или молчаливый дефолт). Защищает и бренд-кит, и ручной ввод.
  if (f.ui === "color") {
    if (v == null || v === "") return undefined;
    const s = String(v).trim();
    if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return s;
    warnings.push(`${f.api_param}=«${s}» не hex-цвет — ${f.default !== undefined ? "дефолт " + f.default : "отброшен"}`);
    return f.default !== undefined ? f.default : undefined;
  }
  // text/textarea/file — строка как есть (null/undefined пропускаем)
  if (v == null) return v;
  return typeof v === "string" ? v : String(v);
}

// Сплющиваем вложенные объекты в dotted-ключи: схемы движков используют api_param вида
// "caption_setting.font_size" / "font.size" / "output.fps" / "caption_setting.offset.x", а Claude
// по JSON-привычке шлёт ВЛОЖЕННО ({caption_setting:{font_size:70}}). Без сплющивания весь блок
// дропался как «неизвестное поле» → стиль субтитров/титров терялся молча. nodeEngine/graphRun ждут плоские dotted-ключи.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenDotted(obj: Record<string, any>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flattenDotted(v as Record<string, unknown>, key));
    else out[key] = v;
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeParams(tool: string, raw: Record<string, any> | null | undefined): NormalizeResult {
  const warnings: string[] = [];
  const fields = fieldsOf(tool);
  const rawObj = raw && typeof raw === "object" && !Array.isArray(raw) ? flattenDotted(raw) : {};

  // у движка нет строгой схемы (напр. внешний/новый) — не валидируем, но честно говорим об этом
  if (!fields.size) {
    return { params: { ...rawObj }, warnings: [`нет схемы для движка «${tool}» — параметры не валидированы`] };
  }

  const out: Record<string, unknown> = {};
  // 1) входные ключи: мета — пропускаем, известные — валидируем/коэрсим, неизвестные — дропаем в warnings
  for (const [k, v] of Object.entries(rawObj)) {
    if (META_KEYS.has(k)) { out[k] = v; continue; }
    const f = fields.get(k);
    if (!f) { warnings.push(`движок «${tool}» не знает поле «${k}» — отброшено`); continue; }
    const c = coerce(f, v, warnings);
    if (c !== undefined) out[k] = c;
  }
  // 2) дефолты для незаданных схемных полей → нода полная, а не полупустая
  for (const [api, f] of fields) {
    if (out[api] === undefined && f.default !== undefined) out[api] = f.default;
  }
  // 3) вертикаль-гард: форсим 9:16 (creatify — формат 9x16). известный баг с горизонталью
  if (fields.has("aspect_ratio")) {
    const want = tool === "creatify" ? "9x16" : "9:16";
    const vals = fields.get("aspect_ratio")!.values || [];
    if (vals.includes(want) && out.aspect_ratio !== want) {
      warnings.push(`aspect_ratio форсирован в вертикаль ${want}`);
      out.aspect_ratio = want;
    }
  }
  // 4) i2v-гард: seedance/kling без стартового фото → маркер needs_image (эндпоинт даунгрейдит движок)
  if (I2V_TOOLS.has(tool) && fields.has("image_url") && !out.image_url) {
    warnings.push("needs_image");
  }

  return { params: out, warnings };
}
