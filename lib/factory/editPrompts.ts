// Канон промптинга завода (детерминированный сборщик). Из исследования 45 правил: для edit-стадии
// (Nano Banana / Seedream через fal) лаконичный СТРУКТУРНЫЙ промпт по формуле Lock→Change→Scope→Constraints
// бьёт LLM-простыню, а identity товара держит дисциплина шаблона (явный preserve-клозет + one-change-per-turn),
// а НЕ «умность» переписывания. Поэтому здесь — чистые функции без Claude на горячем пути (меньше латентности и
// дрейфа). i2v-скелет (motion-only, ОДИН camera move) — тоже отсюда: служит и fallback-шаблоном, и каркасом,
// поверх которого пишет Claude-инженер в video-fal. Источник правды: docs/factory-prompting-canon.md.
//
// ⚠️ НИКОГДА не формулировать «remove watermark/logo/text» — у Nano пре-инференс фильтр вернёт
// MALFORMED_FUNCTION_CALL. Формулируем СОЗИДАТЕЛЬНО: «recreate clean … showing ONLY the …» = реконструкция.
import { detectBrand } from "./brandProfiles";

export type ProductCategory = "bag" | "cosmetics" | "apparel" | "toy" | "generic";

interface CategorySpec {
  noun: string;       // дефолтное короткое имя товара, если product не задан
  lock: string;       // доп. identity-якоря (что именно НЕ двигать) — конкретика держит лого/форму
  scene: string;      // дефолтная stage-сцена (палитра/свет/реквизит подобраны под нишу)
  motion: string;     // i2v: ОДИН camera move (фраза начинается с «Camera:»/движения субъекта)
}

// Карта категорий. Сцены/движения выверены исследованием (палитра 70/20/10, свет словами, premium-камера-словарь).
const SPECS: Record<ProductCategory, CategorySpec> = {
  bag: {
    noun: "handbag",
    lock: ", stitching, leather grain, zipper pulls and metal feet",
    scene: "a sunlit minimalist café table beside a cappuccino and a folded linen napkin, warm morning side light, desaturated beige and cream palette",
    motion: "Camera: slow dolly push-in, smooth and gentle, with faint parallax in the soft background.",
  },
  cosmetics: {
    noun: "cosmetic product",
    lock: ", the cap, pump, printed shade name and ingredient text, bottle silhouette and fill level",
    scene: "a clean marble vanity surface with a single eucalyptus sprig and soft diffused daylight from the left, powder-tone palette",
    motion: "Camera: slow smooth orbital track around the product; the label stays legible and undistorted.",
  },
  apparel: {
    // для одежды чаще лучше СРАЗУ контекст-на-модели, а не изоляция на грей (находка)
    noun: "garment",
    lock: ", garment cut, seams, zipper, hood, fabric texture and any brand patch; preserve realistic fabric drape and wrinkles",
    scene: "worn by a model framed mid-thigh up, walking outdoors in soft overcast city light, autumn neutral palette",
    motion: "The model takes a relaxed step and the fabric sways naturally; camera gently tracks laterally, smooth.",
  },
  toy: {
    // детальный товар = повышенный риск дрейфа мелочей → stage минимально наполненный, движение минимальное
    noun: "toy",
    lock: ", every nozzle, trigger, tank, colour zones and printed graphics; keep all small parts intact and correctly placed",
    scene: "a bright sunny backyard with green grass bokeh and a hint of a paddling pool, joyful summer daylight, saturated playful palette",
    motion: "Camera: static locked-off shot with only a subtle push-in; keep every part crisp and unchanged.",
  },
  generic: {
    noun: "product",
    lock: "",
    scene: "a tasteful minimal interior surface with complementary lifestyle props, soft daylight, neutral palette",
    motion: "Camera: slow push-in with gentle parallax, smooth.",
  },
};

// Бренд (из brandProfiles.detectBrand) → категория. Неизвестное/без бренда → generic.
export function categoryForBrand(brand: string): ProductCategory {
  switch ((brand || "").trim()) {
    case "CLÉRIN": return "bag";
    case "ENOUGH": case "YOYO": case "ANJO": case "SADOER": case "LAMEILA": case "JOMTAM": return "cosmetics";
    case "NORVIA": return "apparel";
    case "Tim Tin": return "toy";
    default: return "generic"; // Ортопедия / Обувь / без бренда
  }
}

// Категория по артикулу+названию (используем тот же детектор бренда, что и копирайтер — единый источник).
export function categoryFor(article: string, name: string): ProductCategory {
  return categoryForBrand(detectBrand(article, name));
}

// Дефолтная stage-сцена категории (для персиста и грундинга, когда оператор сцену не задал).
export function defaultSceneFor(category: ProductCategory): string {
  return (SPECS[category] || SPECS.generic).scene;
}

// Негатив i2v как фильтр настроения (для движков, что принимают negative_prompt).
export const MOTION_NEGATIVE =
  "no warping, no melting, no extra limbs, no flicker, no label distortion, no duplicated product, no jitter";

export interface EditPromptCtx {
  category: ProductCategory;
  op: "clean" | "stage";
  product?: string;       // короткое имя товара («коричневая кожаная сумка-тоут»)
  scene?: string;         // op==='stage': произвольная сцена оператора; пусто → дефолт категории
}

// Детерминированный edit-промпт по формуле Lock→Change→Scope→Constraints (verb-first, явный preserve-клозет).
export function buildEditPrompt(ctx: EditPromptCtx): string {
  const spec = SPECS[ctx.category] || SPECS.generic;
  const product = (ctx.product || spec.noun).trim();
  if (ctx.op === "clean") {
    return (
      `Recreate this as a clean professional e-commerce studio photograph showing ONLY the ${product}. ` +
      `Lock: exact shape, proportions, colour, materials, branding, embossed or printed logo and all text, hardware${spec.lock}. ` +
      `Change: isolate the ${product} on a seamless light-grey studio backdrop. ` +
      `Scope: edit the background ONLY — do not redraw, restyle, recolour, resize, or reposition the ${product} itself (full background replacement, product pixels untouched). ` +
      `Constraints: do not relight or recolour the product; keep the logo legible and uncropped; ` +
      `no surrounding objects, no captions, no graphic overlays, no text panels, no clutter. ` +
      `Soft even studio light, photorealistic, sharp focus.`
    );
  }
  const scene = (ctx.scene || spec.scene).trim();
  return (
    `Place THIS exact ${product} into ${scene}. ` +
    `Lock: the ${product}'s shape, proportions, colour, materials, branding and logo, text, hardware and three-quarter angle${spec.lock} — do not alter, morph, or relabel it. ` +
    `Change: only the surrounding environment. ` +
    `Scope: edit the environment ONLY — keep the ${product} pixel-faithful; do not redraw, restyle, recolour, resize, or reposition it. ` +
    `Constraints: add a realistic contact shadow and subtle reflection matching the new surface; ` +
    `allow only ambient light from the scene onto the product — no new hotspots or harsh relight on the locked product; ` +
    `keep the product scale realistic; remove any seam so it reads as one naturally photographed scene; ` +
    `no clutter, no busy background, no competing colours. ` +
    `Vertical 9:16 composition with headroom around the product. Photorealistic editorial mood, shallow depth of field.`
  );
}

export interface MotionCtx { category: ProductCategory; product?: string }

// i2v MOTION-СКЕЛЕТ: ОДИН camera move + микро-движение, БЕЗ повтора внешности/света/цвета (они уже в кадре —
// дубль = competing instructions → морфинг). ~20-25 слов. Камера-инструкция в начале фразы движения.
export function buildMotionPrompt(ctx: MotionCtx): string {
  const spec = SPECS[ctx.category] || SPECS.generic;
  const noun = (ctx.product || spec.noun).trim();
  return (
    `${spec.motion} The ${noun} stays centered, stable and fully intact — ` +
    `no shape change, no morphing, crisp edges. Premium pace.`
  );
}
