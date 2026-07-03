// VFX-креативы бирол-студии (ТЗ: docs/factory-broll-vfx-creatives-tz.md, исследование
// 2026-07-02: 21 источник, 25 утверждений, 22 подтверждено адверсарно).
// Трек A — фиксированные Kling Effects (без промпта, дёшево). Трек B — i2v промпт-пак
// по проверенной формуле «Camera → Subject+Movement → Background+Movement».
// НЕ применять (опровергнуто §0): жёсткую 4-блочную структуру, consistency-lock одной
// строкой, кап негативов 5-7. Негатив — гипотеза, не догма.

export type VfxCategory = "bag" | "cosmetics" | "toy" | "apparel";

// §2: effects-endpoint НЕ принимает текстовый промпт; enum и duration "5"|"10" фиксированы
export const KLING_EFFECTS_ENDPOINT = "fal-ai/kling-video/v1.6/standard/effects";
export type KlingEffectScene =
  | "squish" | "expansion" | "fuzzyfuzzy" | "bloombloom" | "dizzydizzy"
  | "jelly_press" | "jelly_slice" | "jelly_squish" | "jelly_jiggle"
  | "pixelpixel" | "felt_felt" | "plushcut"
  | "bullet_time" | "bullet_time_360" | "zoom_out";

// §1: артикулы по категориям + {PRODUCT}-дескрипторы и предохранители
export interface VfxArticle {
  article: string;
  product: string; // подстановка {PRODUCT} — явное имя товара (фейл-мод: без субъекта → статичное видео)
  note?: string;
  blocked?: boolean;
}
// ВНИМАНИЕ: в §1 ТЗ была опечатка привязки — TT* стояли под cosmetics, YYS0101 под toy.
// Здесь исправлено по ФАКТИЧЕСКОЙ категории: CLR=bag, TT=toy (водные бластеры/винтовки),
// YYS=cosmetics (крем SPF). Дескрипторы {PRODUCT} тоже приведены к реальному товару.
export const VFX_ARTICLES: Record<VfxCategory, VfxArticle[]> = {
  bag: [
    { article: "CLR00716", product: "the taupe leather crossbody handbag with a suede flap" },
    { article: "CLR00715", product: "the dark chocolate suede-flap crossbody bag", note: "сверить фактуру (замша vs гладкая) до прогона" },
    { article: "CLR001101", product: "the black leather trapeze shoulder bag" },
    { article: "CLR001102", product: "the brown leather trapeze shoulder bag" },
  ],
  cosmetics: [
    { article: "YYS0101", product: "the YOYO SPF50 sunscreen bottle" },
  ],
  toy: [
    { article: "TT04101", product: "the black water blaster toy gun" },
    { article: "TT05101", product: "the white water rifle toy" },
    { article: "TT05102", product: "the sand-colored water rifle toy" },
    { article: "TT04102", product: "", blocked: true, note: "зелёный бластер — нет чистых кадров, blocked" },
  ],
  apparel: [
    { article: "NV-01", product: "the black hooded windbreaker jacket", note: "бан AI-рендеров IMG_1718/1720 уже в манифесте" },
    { article: "NV-08", product: "the olive green hooded jacket" },
    { article: "NV-816", product: "the lightweight beige windbreaker jacket" },
    { article: "NV-836", product: "the dark blue hooded windbreaker jacket" },
  ],
};

// §2: матрица трека A. deform=true → искажает товар: только игрушки и только как
// хук-кадр в связке с честным packshot (WB misleading-риск).
export interface TrackARow { effect: KlingEffectScene; categories: VfxCategory[]; deform?: boolean; note: string }
export const TRACK_A_MATRIX: TrackARow[] = [
  { effect: "bullet_time_360", categories: ["bag", "cosmetics", "toy", "apparel"], note: "360-фриз, аналог Higgsfield Bullet Time" },
  { effect: "bullet_time", categories: ["bag", "cosmetics", "apparel"], note: "классический матричный фриз" },
  { effect: "zoom_out", categories: ["bag", "cosmetics", "toy", "apparel"], note: "раскрытие сцены, хук-кадр" },
  { effect: "squish", categories: ["toy"], deform: true, note: "тактильная деформация — только игрушки" },
  { effect: "jelly_squish", categories: ["toy"], deform: true, note: "тактильная деформация — только игрушки" },
  { effect: "felt_felt", categories: ["toy"], deform: true, note: "материал-морф в фетр" },
  { effect: "plushcut", categories: ["toy"], deform: true, note: "материал-морф в плюш" },
  // ТЗ §2 таблица ставила expansion и на cosmetics, но правило безопасности §2 (деформирующие
  // эффекты искажают товар → только игрушки) сильнее для WB-карточки (misleading = хард-реджект).
  { effect: "expansion", categories: ["toy"], deform: true, note: "«распухание» искажает форму — только игрушки (безопасность §2 > таблица §2)" },
  { effect: "bloombloom", categories: ["toy"], note: "декоративный, cosmetics — гипотеза первого прогона" },
  { effect: "fuzzyfuzzy", categories: ["toy"], note: "декоративный, смотреть на первом прогоне" },
];

// §3: трек B — 30 дословных motion-промптов. size_distort=true → финальный кадр
// искажает РАЗМЕР (гиганты/билборды): в одиночку для WB-карточки брак (§4.6),
// использовать только как хук в связке с честным кадром.
export interface TrackBPrompt { id: string; motion: string; size_distort?: boolean }
export const TRACK_B_PROMPTS: Record<VfxCategory, TrackBPrompt[]> = {
  bag: [
    { id: "ice-emerge", motion: "Camera: slow push-in. {PRODUCT} stands inside a clear block of ice; the ice slowly cracks and melts, thin streams of water run down its surface, the bag inside stays still and dry. Background: dark studio with soft rim light, faint cold mist drifting." },
    { id: "bullet-splash", motion: "Camera: 360 orbit with a freeze in the middle. {PRODUCT} floats motionless while a ring of water droplets hangs frozen around it, then droplets slowly resume falling. Background: black studio, single spotlight." },
    { id: "silk-reveal", motion: "Camera: static close-up. A sheet of flowing silk slides off {PRODUCT}, revealing it; the silk billows slowly to the floor. Background: warm beige studio, soft daylight." },
    { id: "leather-macro", motion: "Camera: slow macro glide across the leather surface of {PRODUCT}; a soft light sweep travels along the grain, stitches in sharp focus. Background: blurred dark vignette." },
    { id: "levitate-orbit", motion: "Camera: slow orbit. {PRODUCT} floats above a stone pedestal, rotating gently, its strap drifting as if weightless; fine dust particles float in a light beam. Background: minimal concrete gallery." },
    { id: "giant-street", motion: "Camera: slow crane up. A giant version of {PRODUCT} stands on a city square like a monument; tiny pedestrians walk around it. Background: morning city haze, soft sun.", size_distort: true },
    { id: "gravity-set", motion: "Camera: locked close-up. {PRODUCT} descends slowly onto a marble table and settles; a soft ring of dust glides outward from the impact point. Background: luxury interior bokeh." },
    { id: "neon-runway", motion: "Camera: low-angle dolly forward. {PRODUCT} stands on a wet reflective floor; neon signs pulse slowly, reflections glide across the surface. Background: night street, cyan and magenta neon." },
  ],
  cosmetics: [
    { id: "water-crown", motion: "Camera: locked macro. A crown of water rises around {PRODUCT} and hangs mid-air for a beat, droplets glittering, the bottle stays dry and sharp. Background: pale blue gradient." },
    { id: "ice-cube", motion: "Camera: slow push-in. {PRODUCT} sits embedded in a melting ice cube; meltwater beads roll down the glass, label stays readable. Background: bright clinical white." },
    { id: "powder-burst", motion: "Camera: static wide close-up. A cloud of soft pastel powder bursts gently behind {PRODUCT} and drifts down like snow; the bottle stays untouched in sharp focus. Background: seamless pastel studio." },
    { id: "droplet-rain", motion: "Camera: slow tilt down. Fine mist droplets settle on the surface of {PRODUCT}, condensation slowly forming, one drop slides down the label edge. Background: fresh green leaves out of focus, morning light." },
    { id: "liquid-swirl", motion: "Camera: slow orbit. A ribbon of cream-colored liquid swirls around {PRODUCT} in slow motion without touching it. Background: dark glossy studio." },
    { id: "still-world", motion: "Camera: slow dolly through the scene. Everything around {PRODUCT} is frozen — splashing water hangs in the air, a leaf stopped mid-fall — only the camera moves. Background: bathroom shelf at golden hour." },
    { id: "macro-texture", motion: "Camera: extreme macro glide from the cap down the label of {PRODUCT}; light sweep reveals glass texture, focus stays razor sharp. Background: blurred warm vignette." },
    { id: "shelf-hero-vfx", motion: "Camera: slow push-in. {PRODUCT} stands centered as soft god-rays move across it; fine dust sparkles drift through the light. Background: minimal stone shelf." },
  ],
  toy: [
    // §3.3: НЕ просить отскоки/броски — подтверждённый фейл-мод физики
    { id: "water-freeze", motion: "Camera: bullet-time style half-orbit with a freeze. {PRODUCT} sprays an arc of water that freezes mid-air into glittering droplets, then motion resumes. Background: sunny backyard." },
    { id: "giant-backyard", motion: "Camera: slow low-angle crane up. A giant version of {PRODUCT} towers over a backyard like a playground attraction; grass sways gently. Background: bright summer sky.", size_distort: true },
    { id: "splash-ring", motion: "Camera: locked close-up. A ring of water splashes up around {PRODUCT} standing on a wet table, droplets sparkle in sunlight, the toy stays sharp. Background: pool water bokeh." },
    { id: "color-smoke", motion: "Camera: slow push-in. Bright orange and blue smoke plumes rise slowly behind {PRODUCT}, curling like ink in water. Background: clean white studio." },
    { id: "assembly", motion: "Camera: static wide. Parts of {PRODUCT} float in the air and slowly assemble themselves into the complete toy, settling gently on the table. Background: kids room, warm light." },
    { id: "pool-glide", motion: "Camera: smooth side track. {PRODUCT} glides slowly along the pool edge on its reflection, water ripples softly. Background: turquoise pool, summer sun." },
  ],
  apparel: [
    { id: "wind-fill", motion: "Camera: slow dolly-in. {PRODUCT} on an invisible mannequin fills with wind: the hood rises, sleeves ripple, fabric flutters steadily. Background: studio fog drifting slowly." },
    { id: "rain-shield", motion: "Camera: locked medium shot. Heavy rain streams down {PRODUCT}; water beads roll off the fabric, the jacket underneath stays visibly dry. Background: dark stormy studio, backlit rain." },
    { id: "freeze-storm", motion: "Camera: slow orbit with a freeze. {PRODUCT} stands in a swirl of autumn leaves frozen mid-air; the orbit continues through the motionless storm. Background: moody grey sky." },
    { id: "zipper-macro", motion: "Camera: extreme macro glide up the front zipper of {PRODUCT}; the slider catches a glint of light, stitching in sharp focus. Background: blurred dark vignette." },
    { id: "levitate-rotate", motion: "Camera: slow push-in. {PRODUCT} floats and rotates slowly as if worn by an invisible person, fabric settling naturally. Background: minimal concrete space, single spotlight." },
    { id: "snow-burst", motion: "Camera: static wide. A burst of powder snow sweeps past {PRODUCT}, flakes settling on the shoulders and hood; the jacket holds its shape. Background: winter dusk, cold blue light." },
    { id: "cloth-reveal", motion: "Camera: slow crane down. Wind pulls a grey cloth off {PRODUCT}, the fabric flies away in slow motion revealing the jacket. Background: rooftop at sunrise." },
    { id: "city-billboard", motion: "Camera: slow zoom out. {PRODUCT} appears as a giant image on a city billboard; light traffic moves below, the billboard glows at dusk. Background: rainy evening street.", size_distort: true },
  ],
};

// §4.2: негатив — гипотеза, не догма
export const VFX_NEGATIVE = "warped logo, mirrored text, deformed product, extra straps, morphing";
// §4.6: честный финальный кадр (WB-модерация, misleading). Для size_distort-промптов
// клауза НЕ добавляется (противоречила бы сцене) — такие клипы идут только в связке.
export const HONEST_FINAL_FRAME = "The final frame shows {PRODUCT} at its true size, shape and colors, sharp and undistorted.";

export function substituteProduct(template: string, product: string): string {
  return template.replaceAll("{PRODUCT}", product);
}

// §2: полезная нагрузка трека A (effects-endpoint: input_image_urls + effect_scene, БЕЗ промпта)
export function buildTrackAPayload(imageUrl: string, effect: KlingEffectScene, duration: "5" | "10" = "5"): Record<string, unknown> {
  return { input_image_urls: [imageUrl], effect_scene: effect, duration };
}

// §3+§4: промпт трека B — формула, товар назван явно, честный финал где совместимо
export function buildTrackBPrompt(category: VfxCategory, promptId: string, product: string): { prompt: string; negative_prompt: string; size_distort: boolean } {
  const row = TRACK_B_PROMPTS[category].find((p) => p.id === promptId);
  if (!row) throw new Error(`нет промпта ${category}/${promptId}`);
  const base = substituteProduct(row.motion, product);
  const honest = row.size_distort ? "" : ` ${substituteProduct(HONEST_FINAL_FRAME, product)}`;
  return { prompt: `${base}${honest}`, negative_prompt: VFX_NEGATIVE, size_distort: !!row.size_distort };
}

// §6: волна 1 — трек A (~15) + трек B (30 × артикул-представитель категории), duration 5s.
// §4.3: 10s — только победителям во второй волне.
export interface VfxJob {
  clip_id: string;
  track: "A" | "B";
  category: VfxCategory;
  article: string;
  product: string;
  effect?: KlingEffectScene;
  prompt_id?: string;
  deform_or_distort: boolean;
  duration: "5";
}
export function planWave1(): { jobs: VfxJob[]; warnings: string[] } {
  const warnings: string[] = [];
  const jobs: VfxJob[] = [];
  const rep: Record<VfxCategory, VfxArticle> = {
    bag: VFX_ARTICLES.bag[0],
    cosmetics: VFX_ARTICLES.cosmetics[0],
    toy: VFX_ARTICLES.toy[0],
    apparel: VFX_ARTICLES.apparel[0],
  };
  for (const [cat, art] of Object.entries(rep) as [VfxCategory, VfxArticle][]) {
    if (art.note) warnings.push(`${art.article}: ${art.note}`);
  }
  // трек A: по матрице, представитель категории; deform-эффекты только для toy (уже в матрице)
  for (const row of TRACK_A_MATRIX) {
    for (const cat of row.categories) {
      const art = rep[cat];
      jobs.push({
        clip_id: `vfx_a_${cat}_${row.effect}`,
        track: "A", category: cat, article: art.article, product: art.product,
        effect: row.effect, deform_or_distort: !!row.deform, duration: "5",
      });
    }
  }
  // трек B: все 30 промптов × представитель
  for (const [cat, prompts] of Object.entries(TRACK_B_PROMPTS) as [VfxCategory, TrackBPrompt[]][]) {
    const art = rep[cat];
    for (const p of prompts) {
      jobs.push({
        clip_id: `vfx_b_${cat}_${p.id}`,
        track: "B", category: cat, article: art.article, product: art.product,
        prompt_id: p.id, deform_or_distort: !!p.size_distort, duration: "5",
      });
    }
  }
  warnings.push(`волна 1: ${jobs.length} клипов (~$${Math.round(jobs.length * 0.28)}–${Math.round(jobs.length * 0.5)}) — прогон только по команде владельца`);
  return { jobs, warnings };
}
