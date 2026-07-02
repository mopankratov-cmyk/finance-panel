# ТЗ: VFX-креативы для бирол-студии — батч по 4 категориям

> Основа: глубокое исследование 2026-07-02 (21 источник, 25 утверждений проверено адверсарно: 22 подтверждено, 3 опровергнуто).
> Цель: прогнать сумки / косметику / игрушки / одежду через батч VFX-промптов (5–10 сек), отобрать креативы по ОТК + просмотрам.

## 0. Что подтверждено исследованием (кратко)

**Каталоги пресетов существуют и дают готовый словарь** (всё — живые fetch 2026-07-02):
- Higgsfield Camera Controls — 65 именованных camera-пресетов (Bullet Time, Crash Zoom, Super Dolly, 360 Orbit, Through Object, Whip Pan, Crane, Overhead, Snorricam, Lazy Susan, Robo Arm, Hero Cam, Object POV…).
- Higgsfield Viral Presets — 60 VFX (Earth Zoom Out/In, Disintegration, Still World, CGI Breakdown, 3D Render, Free Fall, Neon City…; самые сюрреальные — в Premium).
- Higgsfield Ads & Products — 20 пресетов ровно под товарку: Bullet Time Scene/White/Splash, Giant Product, Volcano Ad, Chameleon, Macro Scene, Macroshot product, Packshot, Poster, ASMR Classic/Host/Add-On, Magic button, Billboard/Graffiti/Fridge/Truck/Kick Ad, Click to Ad.
- Kling Effects на FAL: `fal-ai/kling-video/v1.6/standard/effects` — фиксированный enum `effect_scene` (squish, expansion, fuzzyfuzzy, bloombloom, dizzydizzy, jelly_press/slice/squish/jiggle, pixelpixel, felt_felt, plushcut, bullet_time, bullet_time_360, zoom_out), duration строго `5|10`, **текстовый промпт этот endpoint НЕ принимает**. Произвольные VFX — только через обычный i2v endpoint с `prompt`.
- Через PiAPI у Kling ~80 эффектов (icesculptrans, colormixing, whitemodel, figure, jellycat…) — их наличие на FAL не подтверждено, в ТЗ не закладываем.

**Проверенная механика i2v-промпта** (официальные доки Kling + fal.ai):
1. Стартовый кадр — якорь: модель сохраняет форму товара, лого и текст этикетки; промпт описывает ТОЛЬКО эволюцию сцены, не пересказывает картинку.
2. Формула: **Prompt = Subject + Movement, Background + Movement**. Простые слова, простые конструкции.
3. Движение — физически правдоподобное для данного кадра.
4. Kling 3.0: «режиссёрский» стиль, камера-лексика во времени (tracking, freezing, panning, orbit) — короткой инструкцией ближе к началу промпта.

**Документированные фейлы (вшить в правила генерации):**
- Промпт, сильно отклоняющийся от кадра → нежелательная склейка/смена плана. Держать эффект «вокруг» товара, не переносить его в другой мир одним клипом.
- Сложная физика (отскоки мяча, траектории броска) не генерится → для игрушек НЕ просить bounce/throw.
- Расплывчатый промпт без называния субъекта → статичное видео или бессмысленная панорама. Всегда явно называть товар («the black quilted handbag…»).

**Опровергнуто (0-3, НЕ использовать как правила):** жёсткая 4-блочная структура Camera/Subject/Environment/Light; «consistency lock» одной строкой; негатив-промпт с капом 5–7 исключений. Негативы (`warped label, mirrored text`) — можно, но как гипотеза, не догма.

**Хук:** официально подтверждено только окно TikTok — хук в первые 6 секунд (90% ad recall). Для наших 5–10-сек клипов это значит: эффект должен читаться с ПЕРВОГО кадра, никаких медленных подводок.

**НЕ подтверждено данными (закрываем собственным A/B):** категорийная эффективность VFX, приёмы монтажа (beat-sync, match cut, speed ramp), CTR-кейсы сюрреал-креативов. Это не повод не делать — это повод мерить.

## 1. Объект: артикулы и стартовые кадры

Стартовый кадр каждого артикула — из `lib/factory/twinSourceManifest.ts` (проверенные глазами чистые кадры), для каталожных SKU — через vision-скрин (`twinSourceScreen`). Кадр: товар целиком, без вшитого текста, перёд/три-четверти.

| Категория | Артикулы | Примечание |
|---|---|---|
| bag | CLR00716, CLR00715, CLR001101, CLR001102 | CLR00715 — сначала сверить фактуру (замша vs гладкая) |
| cosmetics | TT04101, TT05101, TT05102 | TT04102 blocked (нет чистых кадров) |
| toy | YYS0101 | водная игрушка |
| apparel | NV-01, NV-08, NV-816, NV-836 (+32 цвето-SKU каталога) | NV-01: бан AI-рендеров IMG_1718/1720 уже в манифесте |

## 2. Трек A — дешёвый: Kling v1.6 Effects (фиксированные пресеты, без промпта)

Endpoint: `fal-ai/kling-video/v1.6/standard/effects`, вход: `input_image_urls` + `effect_scene` + `duration:"5"`.

| effect_scene | bag | cosmetics | toy | apparel | зачем |
|---|---|---|---|---|---|
| bullet_time_360 | ✅ | ✅ | ✅ | ✅ | 360-фриз, аналог Higgsfield Bullet Time |
| bullet_time | ✅ | ✅ | — | ✅ | классический матричный фриз |
| zoom_out | ✅ | ✅ | ✅ | ✅ | раскрытие сцены, хук-кадр |
| squish / jelly_squish | — | — | ✅ | — | тактильная деформация — только игрушки |
| felt_felt / plushcut | — | — | ✅ | — | материал-морф в фетр/плюш |
| expansion | — | ✅ | ✅ | — | «распухание» — осторожно, может исказить форму |
| bloombloom / fuzzyfuzzy | — | гипотеза | ✅ | — | декоративные, смотреть на первом прогоне |

⚠️ Деформационные эффекты (squish/jelly/felt) ИСКАЖАЮТ товар — для WB-карточек это риск misleading; использовать только как хук-кадр в связке с честным packshot-клипом, и только для игрушек.

Объём трека A: ~15 вызовов × $0.2–0.35 ≈ **$3–5**.

## 3. Трек B — основной: i2v промпт-пак (Kling i2v на FAL, duration 5s)

Шаблон каждого варианта (по проверенной формуле, камера — в начале, субъект назван явно):

```
Camera: {движение из словаря Higgsfield}. {Товар — явно, с цветом/материалом} + {движение товара/материала}. Background: {фон} + {движение среды}.
```

Подстановка `{PRODUCT}` per артикул: "the black quilted leather handbag", "the amber glass serum bottle", "the bright orange water blaster toy", "the black hooded windbreaker jacket" и т.д.

### 3.1 bag — сумки (CLR*)

| id | промпт (motion) |
|---|---|
| ice-emerge | Camera: slow push-in. {PRODUCT} stands inside a clear block of ice; the ice slowly cracks and melts, thin streams of water run down its surface, the bag inside stays still and dry. Background: dark studio with soft rim light, faint cold mist drifting. |
| bullet-splash | Camera: 360 orbit with a freeze in the middle. {PRODUCT} floats motionless while a ring of water droplets hangs frozen around it, then droplets slowly resume falling. Background: black studio, single spotlight. |
| silk-reveal | Camera: static close-up. A sheet of flowing silk slides off {PRODUCT}, revealing it; the silk billows slowly to the floor. Background: warm beige studio, soft daylight. |
| leather-macro | Camera: slow macro glide across the leather surface of {PRODUCT}; a soft light sweep travels along the grain, stitches in sharp focus. Background: blurred dark vignette. |
| levitate-orbit | Camera: slow orbit. {PRODUCT} floats above a stone pedestal, rotating gently, its strap drifting as if weightless; fine dust particles float in a light beam. Background: minimal concrete gallery. |
| giant-street | Camera: slow crane up. A giant version of {PRODUCT} stands on a city square like a monument; tiny pedestrians walk around it. Background: morning city haze, soft sun. |
| gravity-set | Camera: locked close-up. {PRODUCT} descends slowly onto a marble table and settles; a soft ring of dust glides outward from the impact point. Background: luxury interior bokeh. |
| neon-runway | Camera: low-angle dolly forward. {PRODUCT} stands on a wet reflective floor; neon signs pulse slowly, reflections glide across the surface. Background: night street, cyan and magenta neon. |

### 3.2 cosmetics — косметика (TT*)

| id | промпт (motion) |
|---|---|
| water-crown | Camera: locked macro. A crown of water rises around {PRODUCT} and hangs mid-air for a beat, droplets glittering, the bottle stays dry and sharp. Background: pale blue gradient. |
| ice-cube | Camera: slow push-in. {PRODUCT} sits embedded in a melting ice cube; meltwater beads roll down the glass, label stays readable. Background: bright clinical white. |
| powder-burst | Camera: static wide close-up. A cloud of soft pastel powder bursts gently behind {PRODUCT} and drifts down like snow; the bottle stays untouched in sharp focus. Background: seamless pastel studio. |
| droplet-rain | Camera: slow tilt down. Fine mist droplets settle on the surface of {PRODUCT}, condensation slowly forming, one drop slides down the label edge. Background: fresh green leaves out of focus, morning light. |
| liquid-swirl | Camera: slow orbit. A ribbon of cream-colored liquid swirls around {PRODUCT} in slow motion without touching it. Background: dark glossy studio. |
| still-world | Camera: slow dolly through the scene. Everything around {PRODUCT} is frozen — splashing water hangs in the air, a leaf stopped mid-fall — only the camera moves. Background: bathroom shelf at golden hour. |
| macro-texture | Camera: extreme macro glide from the cap down the label of {PRODUCT}; light sweep reveals glass texture, focus stays razor sharp. Background: blurred warm vignette. |
| shelf-hero-vfx | Camera: slow push-in. {PRODUCT} stands centered as soft god-rays move across it; fine dust sparkles drift through the light. Background: minimal stone shelf. |

### 3.3 toy — игрушки (YYS0101)

Помнить: НЕ просить отскоки/броски (подтверждённый фейл-мод физики).

| id | промпт (motion) |
|---|---|
| water-freeze | Camera: bullet-time style half-orbit with a freeze. {PRODUCT} sprays an arc of water that freezes mid-air into glittering droplets, then motion resumes. Background: sunny backyard. |
| giant-backyard | Camera: slow low-angle crane up. A giant version of {PRODUCT} towers over a backyard like a playground attraction; grass sways gently. Background: bright summer sky. |
| splash-ring | Camera: locked close-up. A ring of water splashes up around {PRODUCT} standing on a wet table, droplets sparkle in sunlight, the toy stays sharp. Background: pool water bokeh. |
| color-smoke | Camera: slow push-in. Bright orange and blue smoke plumes rise slowly behind {PRODUCT}, curling like ink in water. Background: clean white studio. |
| assembly | Camera: static wide. Parts of {PRODUCT} float in the air and slowly assemble themselves into the complete toy, settling gently on the table. Background: kids room, warm light. |
| pool-glide | Camera: smooth side track. {PRODUCT} glides slowly along the pool edge on its reflection, water ripples softly. Background: turquoise pool, summer sun. |

### 3.4 apparel — куртки/ветровки (NV*)

| id | промпт (motion) |
|---|---|
| wind-fill | Camera: slow dolly-in. {PRODUCT} on an invisible mannequin fills with wind: the hood rises, sleeves ripple, fabric flutters steadily. Background: studio fog drifting slowly. |
| rain-shield | Camera: locked medium shot. Heavy rain streams down {PRODUCT}; water beads roll off the fabric, the jacket underneath stays visibly dry. Background: dark stormy studio, backlit rain. |
| freeze-storm | Camera: slow orbit with a freeze. {PRODUCT} stands in a swirl of autumn leaves frozen mid-air; the orbit continues through the motionless storm. Background: moody grey sky. |
| zipper-macro | Camera: extreme macro glide up the front zipper of {PRODUCT}; the slider catches a glint of light, stitching in sharp focus. Background: blurred dark vignette. |
| levitate-rotate | Camera: slow push-in. {PRODUCT} floats and rotates slowly as if worn by an invisible person, fabric settling naturally. Background: minimal concrete space, single spotlight. |
| snow-burst | Camera: static wide. A burst of powder snow sweeps past {PRODUCT}, flakes settling on the shoulders and hood; the jacket holds its shape. Background: winter dusk, cold blue light. |
| cloth-reveal | Camera: slow crane down. Wind pulls a grey cloth off {PRODUCT}, the fabric flies away in slow motion revealing the jacket. Background: rooftop at sunrise. |
| city-billboard | Camera: slow zoom out. {PRODUCT} appears as a giant image on a city billboard; light traffic moves below, the billboard glows at dusk. Background: rainy evening street. |

## 4. Общие правила генерации (вшить в раннер)

1. Формула промпта — как в §3, камера в начале, товар назван явно, среда движется, товар — минимально.
2. Негатив-промпт (гипотеза, не догма): `warped logo, mirrored text, deformed product, extra straps, morphing`.
3. Duration 5s на отбор; 10s — только для победителей (второй прогон).
4. Модель: текущая Kling через `falVideo` (как в остальном b-roll); duration/model — параметры варианта, как уже сделано в `productBrollBatch`.
5. Каждый клип должен читаться как эффект с ПЕРВОГО кадра (хук-окно 6с подтверждено TikTok; в 5-сек клипе подводок нет).
6. Сюрреал не должен врать о товаре: искажение форм/цвета/размера в финальном кадре — брак для WB-карточки (misleading). Финальный кадр каждого клипа = товар в честном виде.

## 5. Сборка рила (монтаж) — рабочие гипотезы

Верифицированных данных по монтажу нет (см. §0), поэтому минимальный жёсткий каркас + A/B:
- Структура: **VFX-хук (2–4с) → честный кадр/деталь (2–4с) → артикул-эндкард (~1.5–2с)** — согласуется с нашими Wibes-правилами (reelFormats: без звука, эндкард с артикулом).
- Альтернатива для теста: чистый seamless-loop одного VFX-клипа 5с без эндкарда (для ленты Wibes).
- Beat-sync/speed-ramp — вторая волна, только если базовая структура покажет досмотры.

## 6. Объём, экономика, волны

- **Волна 1 (отбор):** трек A (~15 клипов) + трек B: 30 промптов × 1 артикул-представитель категории = ~45 клипов × 5с. Ориентир бюджета FAL: ~$20–35.
- **Волна 2 (тираж):** топ-3 промпта каждой категории × все артикулы категории + duration 10s для лучших.
- Прогон — после пополнения FAL (кошелёк в минусе на 2026-07-02).

## 7. Отбор

1. Авто-ОТК (vision): товар не деформирован, лого/этикетка читаемы, нет лишних объектов/рук, финальный кадр честный.
2. Ручной вердикт владельца по шорт-листу (как в бейкоффе аниматоров).
3. Публикация победителей в Wibes → смотреть досмотры/CTR по нашей аналитике — это закрывает открытый вопрос эффективности собственными данными.

## 8. Открытые вопросы исследования (закрываем A/B-тестом)

- Категорийная эффективность VFX-приёмов — данных нет, только гипотезы §3.
- Количественные кейсы CTR сюрреал-VFX vs обычный b-roll — не подтверждены.
- Воспроизводимость Higgsfield-пресетов голым промптом на Kling — логичная, но нетестированная экстраполяция (проверится волной 1).
- Паритет каталога эффектов PiAPI vs FAL — на FAL подтверждён только v1.6 effects-endpoint.

## Источники (верифицированные)

- https://higgsfield.ai/camera-controls · https://higgsfield.ai/viral-presets · https://higgsfield.ai/apps/ads-products
- https://fal.ai/models/fal-ai/kling-video/v1.6/standard/effects/api
- https://blog.fal.ai/kling-3-0-prompting-guide/
- https://kling.ai/quickstart/image-to-video-guide
- https://piapi.ai/docs/kling-api/kling-effects
- https://ads.tiktok.com/help/article/creative-best-practices
