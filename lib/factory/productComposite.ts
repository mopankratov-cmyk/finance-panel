// «Товар в руки» для AI-блогеров (стек выбран бейкоффом 2026-07-02):
// композит = fal-ai/bytedance/seedream/v4.5/edit (этикетка пиксельно, $0.04),
// анимация = fal-ai/bytedance/omnihuman/v1.5 (товар в исходном кадре => не морфит, $0.14/с),
// одежда = fal-ai/fashn/tryon/v1.6 (принты/текст на ткани).
// Уроки итераций ревьюера v1→v4 зашиты в промпты ниже — НЕ упрощать формулировки.

export type CompositeFraming = "chest_up_selfie" | "half_body";
export type LivenessLevel = "restrained" | "natural" | "energetic";

export interface ProductCompositeInput {
  lookImageUrl: string;
  productImageUrl: string;
  labelText: string;
  framing?: CompositeFraming;
  wardrobeHint?: string;
  productGeometryHint?: string;
}

export const PRODUCT_COMPOSITE_MODEL = "fal-ai/bytedance/seedream/v4.5/edit";
export const PRODUCT_ANIMATE_MODEL = "fal-ai/bytedance/omnihuman/v1.5";
export const GARMENT_TRYON_MODEL = "fal-ai/fashn/tryon/v1.6";

// Известные тел-артефакты композиторов (ревью v1-v4) — QC-гейт обязан их искать
export const COMPOSITE_QC_CHECKLIST = [
  "этикетка совпадает с эталоном буква в букву (OCR; Seedream «исправляет» опечатки брендов!)",
  "мелкий подстрочный текст НЕ доверять генерации — только крупный заголовок либо оверлей после",
  "нет оранжевого глоу/бэклайта за товаром (продуктовый hero-light палит генерацию)",
  "матовость/прозрачность материала как у эталона (сквозь товар ничего не просвечивает)",
  "хват: точки контакта пальцев, без лишних/длинных пальцев",
  "один источник света на сцену: товар освещён тем же светом, что и лицо",
  "геометрия товара не «дышит» (крышка/пропорции стабильны)",
  "нет рамок телефона и вотермарок (Seedream/nano-banana любят дорисовывать)",
] as const;

// Канонический деглянц-промпт (вердикты владельца: «глянцевый», «больше артефактов на лице»).
// Кожа должна быть ЖИВОЙ: поры, мелкие несовершенства, неровность — не гладкий рендер.
export function buildDeglossPrompt(sceneHint: string): string {
  return [
    "Same woman, same face identity, same pose.",
    `Re-render as a candid amateur smartphone photo: ${sceneHint},`,
    "noticeably underexposed corners, ordinary muted colors.",
    "Skin must look real and imperfect: natural matte texture with visible pores, a few tiny blemishes, slight uneven redness on cheeks and nose, faint under-eye shadows, no glossy highlights, no smoothing.",
    "Slightly imperfect framing.",
  ].join(" ");
}

export function buildProductCompositePrompt(input: ProductCompositeInput): string {
  const framing = input.framing === "half_body"
    ? "Casual phone photo, half-body framing"
    : "Casual phone selfie, chest-up close framing";
  return [
    `${framing}: the woman from image 1 holds the exact product from image 2 in one hand at shoulder level next to her face, label facing the camera, natural relaxed grip with visible finger contact shadows, elbow bent.`,
    `The product fills at least 25% of the frame width.${input.productGeometryHint ? ` Product geometry exactly as reference: ${input.productGeometryHint}.` : ""}`,
    `CRITICAL: reproduce the label text «${input.labelText}» pixel-perfect, sharp Cyrillic, no warping, no respelling, no extra text.`,
    `${input.wardrobeHint ? `Change her top to ${input.wardrobeHint}. ` : ""}Background from image 1 IN FOCUS (deep depth of field, phone front camera look, no bokeh), keep small lived-in details.`,
    "Single light source: the product is lit by the same soft window light as her face, no glow or backlight behind or under the product, no studio-white highlights on the label. Material finish (frosted/matte/gloss) exactly as the reference. Slightly imperfect handheld crop, amateur selfie feel. No phone frame, no watermark.",
  ].join(" ");
}

// Урок v4 (label_stability 2.5): движение товара ЛОМАЕТ этикетку и геометрию.
// Декаплинг: живость набираем ТОЛЬКО головой/мимикой/камерой; товар квази-статичен.
const LIVENESS_PROMPTS: Record<LivenessLevel, string> = {
  restrained:
    "calm selfie video message, small head movements, natural blinking, subtle handheld sway",
  natural:
    "lively casual selfie video message: natural head turns of 10-15 degrees while speaking, normal blinking, animated facial expressions following the speech, gentle handheld camera sway with slight background parallax",
  energetic:
    "energetic selfie video message: expressive face following the speech, quick natural head movements, handheld camera moves with her energy",
};

export function buildProductAnimatePrompt(liveness: LivenessLevel = "natural"): string {
  return [
    LIVENESS_PROMPTS[liveness],
    // жёсткая дисциплина товара (ревью v2-v4): неподвижен, вертикален, текст горизонтален
    "The product stays completely still and upright in her hand for the whole video: label horizontal and facing the camera at all times, no product movement, no tilt, no rotation, product never covered by her hand, never leaves the frame.",
  ].join(". ");
}

export function buildGarmentTryonPayload(modelImageUrl: string, garmentImageUrl: string, category: "tops" | "bottoms" | "one-pieces" | "auto" = "auto"): Record<string, unknown> {
  return {
    model_image: modelImageUrl,
    garment_image: garmentImageUrl,
    category,
    garment_photo_type: "auto",
  };
}
