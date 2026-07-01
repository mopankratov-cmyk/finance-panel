// Авто-привязка ассетов товара к нодам ПЕРЕД генерацией (фикс пустого автопилота: autofill выбирает
// инструмент, но источник — фото/клип — привязывал только оператор в кокпите; в батче этого шага не было →
// disk_real без клипа и seedance без image_url падали). Чистая логика выбора → юнит-тестируемо (assetBind.test.mts).
// Источник ассетов — content_assets по артикулу (real-съёмка / WB-карточка). Срабатывает ТОЛЬКО когда у ноды
// НЕТ источника (она и так упала бы) → деградирует в текущее поведение, рабочие ноды не трогает.

export interface DiskAsset { disk?: string | null; kind?: string | null; url?: string | null; analysis?: Record<string, unknown> | null; }
export interface AssetPool { canonicalImages?: string[]; preparedImages?: string[]; realVideos: string[]; realImages: string[]; wbImages: string[] }

function productTwinAssetInfo(analysis: Record<string, unknown>): Record<string, unknown> {
  const asset = analysis.product_twin_asset;
  return asset && typeof asset === "object" ? asset as Record<string, unknown> : {};
}

function isProductTwinCanonical(analysis: Record<string, unknown>): boolean {
  const asset = productTwinAssetInfo(analysis);
  return asset.broll_ready === true || asset.hero_ready === true;
}

function isProductTwinServiceAsset(analysis: Record<string, unknown>): boolean {
  const kind = String(productTwinAssetInfo(analysis).kind || "").toLowerCase();
  return kind === "object_mask" || kind === "alpha" || kind === "depth_map" || kind === "segmentation";
}

// классификация ассетов товара: Product Twin / prepared (цифровой двойник или source-prep: чистый/стейдж,
// ЛУЧШИЙ источник под i2v) > реальная съёмка (disk != wb/gen/prepared/product_twin) > фото карточки WB.
export function classifyAssets(assets: DiskAsset[]): AssetPool {
  const canonicalImages: string[] = [], preparedImages: string[] = [], realVideos: string[] = [], realImages: string[] = [], wbImages: string[] = [];
  for (const a of assets || []) {
    const url = String(a?.url || ""); if (!url) continue;
    const disk = String(a?.disk || "").toLowerCase();
    const kind = String(a?.kind || "").toLowerCase();
    const analysis = a?.analysis && typeof a.analysis === "object" ? a.analysis : {};
    if (disk === "prepared") {
      if (kind !== "video") {
        if (analysis.canonical === true) canonicalImages.push(url);
        else preparedImages.push(url);
      }
      continue;
    } // prep-рендер товара (приоритет)
    if (disk === "product_twin") {
      if (kind === "image" && !isProductTwinServiceAsset(analysis)) {
        if (isProductTwinCanonical(analysis)) canonicalImages.push(url);
        else preparedImages.push(url);
      }
      continue;
    }
    const isReal = disk !== "wb" && disk !== "gen" && disk !== "";
    if (kind === "video") { if (isReal) realVideos.push(url); }
    else if (kind === "image") {
      if (isReal) realImages.push(url);
      else if (disk === "wb") wbImages.push(url);
      // disk === "gen" (наш же вывод) или пустой/неизвестный — НЕ источник, пропускаем
    }
  }
  return { canonicalImages, preparedImages, realVideos, realImages, wbImages };
}

// фото товара по индексу, циклично — чтобы РАЗНЫЕ i2v-ноды брали РАЗНЫЕ стартовые кадры (анти-сэйминес).
// ПРИОРИТЕТ: prepared (чистый/стейдж от source-prep) → реальная съёмка → сырое WB-фото (фолбэк).
export function pickImage(p: AssetPool, idx = 0): string | undefined {
  const stable = [...(p.canonicalImages || []), ...(p.preparedImages || [])];
  if (stable.length) return stable[0];
  const imgs = [...p.realImages, ...p.wbImages];
  return imgs.length ? imgs[((idx % imgs.length) + imgs.length) % imgs.length] : undefined;
}
// лучшее (первое) фото — для обратной совместимости/простых случаев
export function bestImage(p: AssetPool): string | undefined { return pickImage(p, 0); }

// Артикул, закодированный в URL подготовленного кадра (prepared/<art>/… или i2v-src/<art>-orig). null — если
// путь артикул НЕ кодирует (сырое WB-CDN / реальная съёмка) → сверять нечего. Защита от МИСЛЕЙБЛА в каталоге.
export function articleFromAssetUrl(url?: string | null): string | null {
  const u = String(url || "");
  const m = u.match(/\/prepared\/([^/]+)\//) || u.match(/\/i2v-src\/(.+?)-orig\b/);
  try { return m ? decodeURIComponent(m[1]) : null; } catch { return m ? m[1] : null; }
}

// Можно ли привязать этот кадр к ЭТОМУ артикулу: путь кодирует тот же артикул ИЛИ не кодирует вовсе.
// Отклоняем ТОЛЬКО явное расхождение (prepared/TT… для рецепта CLR…) — это и есть «пистолет в сумке».
export function assetMatchesArticle(url: string | null | undefined, article: string): boolean {
  const a = articleFromAssetUrl(url);
  return !a || !article || a === article;
}

const I2V = new Set(["seedance", "seedance_fast", "seedance_pro", "kling", "kling_pro", "pika"]);

// Решение по ноде БЕЗ источника: чем её накормить (или null — не трогаем/нечем).
//   disk_real: есть реальное видео → asset_url; иначе фото есть → ПЕРЕВОДИМ на seedance i2v (нет съёмки → AI из фото)
//   i2v (seedance/kling/pika): нужен стартовый кадр → image_url из лучшего фото
export function chooseBinding(
  tool: string, hasSource: boolean, pool: AssetPool, imageIdx = 0,
): { image_url?: string; asset_url?: string; tool?: string; reason: string } | null {
  if (hasSource) return null; // нода уже с источником — не вмешиваемся
  const t = String(tool || "").toLowerCase();
  const img = pickImage(pool, imageIdx); // разный кадр на каждую i2v-ноду (анти-сэйминес)
  if (t === "disk_real" || t === "disk") {
    if (pool.realVideos.length) return { asset_url: pool.realVideos[0], reason: "disk_real ← реальное видео товара" };
    if (img) return { tool: "seedance", image_url: img, reason: "нет реального видео → seedance i2v из фото товара" };
    return null; // нечем — упадёт как и раньше
  }
  if (I2V.has(t)) {
    if (img) return { image_url: img, reason: `${t} ← фото товара стартовым кадром` };
    return null;
  }
  return null; // creatify/sound/captions/… — не наша забота
}
