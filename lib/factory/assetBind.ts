// Авто-привязка ассетов товара к нодам ПЕРЕД генерацией (фикс пустого автопилота: autofill выбирает
// инструмент, но источник — фото/клип — привязывал только оператор в кокпите; в батче этого шага не было →
// disk_real без клипа и seedance без image_url падали). Чистая логика выбора → юнит-тестируемо (assetBind.test.mts).
// Источник ассетов — content_assets по артикулу (real-съёмка / WB-карточка). Срабатывает ТОЛЬКО когда у ноды
// НЕТ источника (она и так упала бы) → деградирует в текущее поведение, рабочие ноды не трогает.

export interface DiskAsset { disk?: string | null; kind?: string | null; url?: string | null; }
export interface AssetPool { realVideos: string[]; realImages: string[]; wbImages: string[] }

// классификация ассетов товара: реальная съёмка (disk != wb/gen) vs фото карточки WB
export function classifyAssets(assets: DiskAsset[]): AssetPool {
  const realVideos: string[] = [], realImages: string[] = [], wbImages: string[] = [];
  for (const a of assets || []) {
    const url = String(a?.url || ""); if (!url) continue;
    const disk = String(a?.disk || "").toLowerCase();
    const kind = String(a?.kind || "").toLowerCase();
    const isReal = disk !== "wb" && disk !== "gen" && disk !== "";
    if (kind === "video") { if (isReal) realVideos.push(url); }
    else if (kind === "image") {
      if (isReal) realImages.push(url);
      else if (disk === "wb") wbImages.push(url);
      // disk === "gen" (наш же вывод) или пустой/неизвестный — НЕ источник, пропускаем
    }
  }
  return { realVideos, realImages, wbImages };
}

// фото товара по индексу (реальная съёмка приоритетнее WB), циклично — чтобы РАЗНЫЕ i2v-ноды
// брали РАЗНЫЕ стартовые кадры (анти-сэйминес: 5 клипов с одного фото = слоп-риск).
export function pickImage(p: AssetPool, idx = 0): string | undefined {
  const imgs = [...p.realImages, ...p.wbImages];
  return imgs.length ? imgs[((idx % imgs.length) + imgs.length) % imgs.length] : undefined;
}
// лучшее (первое) фото — для обратной совместимости/простых случаев
export function bestImage(p: AssetPool): string | undefined { return pickImage(p, 0); }

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
