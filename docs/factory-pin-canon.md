# Канон статичного контента завода (пины / карточки / IG)

Спека для доработки линии статики. Код-источник правды: **`lib/factory/staticCanon.ts`** (константы) +
**`remotion/StaticV1.tsx`** (композиция). Стратегия/разведка: **`docs/factory-static-content-intel.md`**.
Принцип: **одно дизайн-намерение → N экспортов** (карточка WB/Ozon 3:4 · Pinterest-пин 2:3 · IG/VK 4:5 · карусель).
Линия — **новая ветка завода** рядом с видео-рилсами: общий «мозг» (бренд/ниши/winners/каталог), своя плоская
синхронная рендер-линия (renderStill→PNG, БЕЗ fal), свой пин-критик. Видео-движок не трогаем.

## Архитектура (что уже построено)
- **`lib/factory/staticCanon.ts`** — форматы/safe-зоны, тайп-скейл, бюджет текста, хедлайн ≤7 слов, SEO-clamp,
  контраст (`luminance`/`contrastRatio`/`pickTextColor` ≥4.5:1), `accentFor(objective)` (warm=reach/cool=saves). Тест: `staticCanon.test.mts`.
- **`remotion/StaticV1.tsx`** — композиция (1 кадр, renderStill). 5 архетипов: `headline_hero` · `product_color` ·
  `social_proof` · `collage` · `card_benefits`. Холст по формату (Root `calculateMetadata`).
- **`render-service/server.mjs`** — `still:true` → `renderStill`→PNG (рядом с видео `renderMedia`).
- **`app/api/factory/static-generate`** — роут линии: резолв фото(prepared>wb)+бренд+акцент → submit StaticV1 still.
- ДЕ-РИЗ пройден: `scripts/static-derisk.mjs` рендерит стиллы локально (без fal/VM).

## Жёсткие дизайн-правила (из разведки рынка)
- **Холст:** pin 2:3 **1000×1500** (non-negotiable, +67% engagement vs square) · карточка WB/Ozon **3:4 1080×1440** · IG/VK **4:5 1080×1350**. PNG для текста, JPG для фото, <5MB.
- **Safe-зоны (pin):** L/R 100px, top/bottom 150px; **bottom-right — мёртвая зона** (иконка Pinterest Lens) → лого/бейдж туда НЕ ставить (лого — верх-центр). Фото может уходить в край, текст/бейджи — нет.
- **Бюджет текста ≤20-25%** площади. Один фокус (товар) + ОДИН хук + макс 1 подзаг.
- **Хедлайн ≤7 слов** (`fitHeadline`), benefit-framed. RU-тайтлы длинные → обрезать.
- **Тайп-скейл** (ступень 1.25): hero/price 120-150 · headline 72-96 · subhead 48-56 · body 32-36 · **caption не <24px**. Макс 2-3 шрифта (Unbounded display + Montserrat sans, кириллица-safe; **без script/decorative** — Pinterest не OCR-ит → теряет ключи).
- **Контраст:** текст НИКОГДА на сыром фото → на solid/scrim плашке; порог **≥4.5:1** (large ≥3:1). `pickTextColor` подбирает ink/inkDark; если не проходит — затемнять scrim + сигнал `pin_low_contrast`.
- **Цена = first-class слот:** tabular figures (`fontVariantNumeric:"tabular-nums"`), Black-вес, крупнейший токен; старая цена зачёркнута на вес легче; бейдж-скидка в pill (не bottom-right).
- **Цвет→цель:** warm (red/orange/pink) → reach/repins; cool (blue/green) → saves. Дефолт фон тёплый/насыщенный.

## Архетипы (библиотека «хороший пин») и роутинг по нишам
| Архетип | Где | Под ниши |
|---|---|---|
| `collage` (2×2 + хедлайн-полоса) | Pinterest топ-перформер (кураторский «N штук») | сумки, косметика, куртки |
| `card_benefits` (3:4 + буллеты) | **карточка WB/Ozon — highest RU ROI** | все (первые 5 «слайдов» несут всё) |
| `product_color` (cut-out на тёплом фоне) | максимум scroll-stop | все |
| `social_proof` (фото + «12 000+ отзывов») | соц-пруф из WB-данных | косметика, игрушки |
| `headline_hero` (full-bleed + scrim + хук) | нативный, не «баннер» | Tim Tin, филлер |
| _ещё из разведки (доделать):_ `before_after`+timeline (косметика) · `listicle` «X трендов» (куртки) · `multipack` (Tim Tin) | | |

## Дистрибуция/SEO (рычаг роста — без него пин мёртв)
- Дистрибуция = лотерея с толстым хвостом (топ-1% пинов берут >50% показов) → **fresh-variant multiplier**: N разных вариантов на SKU (архетип×угол×кроп×уникальные title/desc/alt), все на один WB/Ozon-URL; perceptual-hash дедуп (дубли спам-флагаются).
- **Невидимый SEO-слой** на каждом рендере: title keyword-first ≤100, desc 220-232 (≤5 ключей — стаффинг ↓виральность), keyword-rich ALT. Ключи — из листинга WB/Ozon через MPStats.
- Пины **evergreen ~13 мес** → один батч компаундит.
- **Winner-loop по ЗАКАЗАМ через deeplink** (НЕ по saves — в РФ vanity): через 1-2 нед убить нижние 80%, доген винеров.

## Очередь доработки (помощнице) — приоритет
1. Поллинг render-status + **банк PNG** в `content_assets(kind='image', analysis:{format,archetype,platform,seo})` (паттерн `gen-save` slides).
2. **Невидимый SEO-слой** (title/desc/alt из MPStats-листинга) на каждый рендер.
3. **Карусель** `ig_carousel`: рендер N слайдов как N стиллов (hook→value→CTA).
4. **Fresh-variant multiplier** + perceptual-hash дедуп.
5. Кнопка «Сделать пины» в студии (`public/inferno/studio.html`); per-niche роутинг архетипов.
6. Пин-критик (оси hook/brand/читаемость/CTA — БЕЗ retention; не видео-ОТК).
7. Продукт-кадр через Nano edit (`sourcePrep`) под пин-кроп — когда баланс fal будет (сейчас prepared/wb).
8. (P2) Pinterest API постинг + board/keyword + аналитика обратно в loop.
