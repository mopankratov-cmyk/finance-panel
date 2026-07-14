> ## ⚠️ СВЕРКА С РЕАЛЬНОСТЬЮ (2026-07-15, после заземления)
>
> Это ТЗ было заземлено в worktree `bold-margulis-1c3a67` на ветке
> `claude/pinterest-privacy-policy-dc4ece` — **до-чисточной линии**. В живом `main`
> finance-panel завода нет (вынесен в репо `content-factory`), пути §3/Приложения A
> здесь больше не существуют. Живая статик-линия — в **content-factory**, и она дальше,
> чем предполагает это ТЗ:
>
> - **P0 банк + SEO — СДЕЛАНО** в content-factory: `static-generate` банкует pending-строку
>   c SEO/гейтами, `static-status` доводит до durable URL + Яндекс-архива.
> - **P0.5 брендбук NORVIA — СДЕЛАНО**: `NORVIA_CANON.locked` в `staticCanon.ts`
>   (lowercase-лого, #161616/#F6F6F6, photoReality).
> - **P2 публикация — НЕ СТРОИТЬ**: паблишер Pinterest уже живёт в content-factory
>   (Pinterest Studio: автопилот, слоты/капы/дедуп, ждёт токен владельца). Статик-финалы
>   pin_2x3 стыкованы с ним (PR content-factory#75) + автономный доводчик processing-строк.
> - **Остаётся** (в content-factory): статик-критик по пикселям, петля замера по заказам
>   (deeplink — решение владельца), карусель/новые архетипы, `REMOTION_RENDER_URL` в prod.
>
> Живой документ линии: `content-factory/docs/factory-pinterest-studio.md`. Текст ниже
> сохранён как стратегическая база (дропы/замер по заказам/каноны) — пути не использовать.

# ТЗ: агент Pinterest / статик-линия завода

> **Тип:** ТЗ для агентного исполнителя (GLM-5.2 через cc-glm / Codex).
> **Репозиторий:** `finance-panel` (worktree `bold-margulis-1c3a67`), ветка от `main`.
> **Дата заземления:** 2026-07-15. Все пути/функции/таблицы/команды сверены с реальным кодом.
> **Принцип:** делать механически по разделу §6, не изобретать. Числа канона — брать из `lib/factory/staticCanon.ts`, не выдумывать.

---

## 0. Ground truth и честное состояние

Заземлено через карту 6 подсистем Pinterest-конвейера + gap-синтез.

**Работает:** линия рендера статики (пин 2:3 и карточка WB 3:4) = **код на Remotion, не AI-картинка**.
**Не работает / отсутствует в этом репо:** автопубликация в Pinterest, банк готовых пинов, невидимый SEO-слой, пин-критик, оркестрация пинов, авто-петля замера.

> ⚠️ **Проверить перед стартом P2:** автопубликации в Pinterest в `finance-panel` нет вообще (ни `/api/post/pinterest`, ни `PINTEREST_*`, ни OAuth-хранилища). Возможно, «pin loop / автопилот» из прежних PR живут в отдельном репо **`content-factory`** — исполнитель обязан сверить там пути перед доработкой публикации. ТЗ ниже заземлено в `finance-panel`.

---

## 1. Роль и зона

**Мандат (1 строка):** агент превращает товар (артикул) в пачку статичных ассетов по канону завода, прогоняет через пин-критик, банкует, публикует малыми дропами и замыкает петлю по **заказам через deeplink** — не по лайкам/сохранениям.

- **Является:** оператором статик-линии завода для брендов на WB/Ozon (первый — NORVIA, верхняя одежда). Источник правды по дизайну: `docs/factory-pin-canon.md` + `lib/factory/staticCanon.ts`.
- **НЕ является:** дженерик-маркетологом из `.agents/skills/pinterest-posts/SKILL.md` (v1.0.1) — тот про рецепты/абстрактный SEO, не знает про архетипы/форматы/renderStill. → **Решение владельца:** переписать под завод или пометить deprecated.
- **Файловая зона (жёстко):** `app/api/factory/**`, `lib/factory/**`, `remotion/**`, `render-service/**`, `public/inferno/**`, `docs/factory-*`.
- **НЕ трогать:** вкладку «Финансы», общие `app/api/{wb,ozon,supplies}`, авторизацию/`middleware`, миграции вне своей фичи, `.env*`, `package.json`/локи, CI (`.gitea/`, `.github/`), видео-движок.

---

## 2. Стратегия (из разведки конкурентов 14.07 + `docs/factory-static-content-intel.md`)

1. **Малые дропы, не конвейер.** Разведка: OUTFITSWB — 68 пинов → ~11k показов/пин; godmood — 80k пинов → 55 показов/пин (×200). **Дроп = 15–30 ассетов на одну тему**, 1–2 раза/нед, каждый ассет = свой поисковый ключ.
2. **Замер по заказам, не по saves** (в РФ saves = vanity). Успех = заказы на WB/Ozon через deeplink. Winner-loop убивает нижние 80% через 1–2 нед и догенеривает винеров.
3. **Pinterest — бонус-канал; тот же движок кормит карточку WB/Ozon 3:4 (ROI #1, +30–50%).** Заводской intel ставит Pinterest 4-м (~2000 кликов/мес → 4–6 продаж, трафик через 3–4 мес). Принцип «одно дизайн-намерение → N экспортов» уже в коде. **Не давать Pinterest диктовать дизайн-систему.**
4. **Подписчики игнорировать.** Лидер ниши — 8,2 млн показов при 509 подписчиках; весь охват — рекомендательный граф. Всё усилие — в свежесть + SEO + fresh-variant-мультипликатор (топ-1% пинов берут >50% показов).

---

## 3. Что уже работает `READY` (опираться как на данность)

| Возможность | Реальная точка входа | Статус |
|---|---|---|
| **Рендер пина/карточки** (код, не AI) | `POST /api/factory/static-generate` → `remotionSubmit('StaticV1',inputProps,1,{still:true})` → render-service `renderStill→PNG` → Storage `factory-media/renders/{id}.png`; поллинг `GET /api/factory/static-status?id=` | работает |
| **Кнопка в UI** | `public/inferno/studio.html` (≈L670) зовёт static-generate (формат `pin_2x3`), поллит static-status | до «PNG на экране» |
| **Канон (единый источник)** | `lib/factory/staticCanon.ts`: `FORMATS.pin_2x3` 1000×1500 (Lens-зона), `accentFor(objective)` warm=reach/cool=saves, `fitHeadline(≤7)`, `clampDesc(220–232)`, `pickTextColor(≥4.5:1)`, `SEO{titleMax:100,descMin:220,descMax:232,keywordsMax:5}`. Тест: `staticCanon.test.mts` | работает |
| **Архетипы** | `remotion/StaticV1.tsx`: `headline_hero`·`product_color`·`social_proof`·`collage`·`card_benefits` | 5 из 8 |
| **Источники ассетов** | таблица `content_assets` (disk: `norvia`/`design`/`wb`/`prepared`/`gen`), наполняет `POST /api/factory/content-index` (Яндекс.Диски, `lib/factory/contentDisks.ts`); выбор товара `GET /api/factory/products`; приоритет фото `assetBind.pickImage` (prepared>real>wb) | наполнено |
| **Бренд NORVIA** | голос `brandProfiles.PROFILES['NORVIA']`, `detectBrand` (nv*/ht*); машинная айдентика — таблица `brand_kits` (`resolveBrandKit`) | kit может быть пуст |
| **Ревью-контур (человек)** | `app/api/factory/telegram` — бот ✓Беру/✕Не то (голос/текст) → `applyVerdict` → winners/reject; петля `is_winner` на `content_assets` | работает |
| **Рельсы публикации (шаблон!)** | `POST /api/post/vk` (wall.post), `POST /api/post/telegram` (`sendMediaGroup` кладёт пин-сет в TG); `/api/factory/media-store` (base64→public URL) | VK/TG |
| **Очереди/крон (для видео)** | `factory_jobs` FSM (`lib/factory/jobs.ts` `createJob`, `jobs/tick`+`hasStuck`), `node_recipes`+`graph-run/cron` */2 | каркас есть |

---

## 4. Что блокирует автономность `BLOCKED` (= очередь §6)

| Пробел | Что именно отсутствует |
|---|---|
| **Публикация в Pinterest** | Ноль кода к `api.pinterest.com`; нет `/api/post/pinterest`, `PINTEREST_*`, OAuth-хранилища token/board_id. UI `patrick-legacy.html postNow()` хардкодит «только VK/Telegram». |
| **Банк готовых пинов** | TODO в `static-generate`: не поллит статус и не пишет PNG в `content_assets(kind='image', analysis:{format,archetype,platform,seo})`. Нет инвентаря пинов. |
| **Невидимый SEO-слой** | Хелперы есть (`clampDesc/fitHeadline/SEO`), но никто не генерит title/desc/alt из листинга WB/Ozon (MPStats) и не вешает на рендер. |
| **Пин-критик** | Нет авто-гейта качества статики (оси hook/brand/читаемость/CTA, *без* retention). |
| **Оркестрация пинов** | Обе очереди про видео и не ставят `static-generate`. Нет цикла generate→bank→seo→critic→publish→measure. |
| **Петля метрик** | `post_metrics` заполняется руками. Нет deeplink-атрибуции заказов и авто-чтения аналитики. |
| **Карусель + 3 архетипа** | `ig_carousel` принимается роутом, но у `StaticV1` нет мульти-слайд-тела. Нет before_after/timeline, listicle, multipack. |
| **Прод-риск рендера** | `render-service authed()`=true при пустом `REMOTION_RENDER_TOKEN` (открытый эндпоинт); `render_jobs`-статус best-effort (без миграции → 404 после рестарта VM). |

---

## 5. Операционный цикл агента (что делает в каждом дропе)

1. **Выбор темы дропа** — 1 SKU-герой или 1 тема (все цвета модели / «N ветровок на осень»). Товары: `GET /api/factory/products`. Сезон на 2–3 мес вперёд.
2. **Роутинг архетипа по нише** — куртки/ветровки → `collage` + `product_color`; карточка WB → `card_benefits`. Цель→цвет: reach → warm, saves → cool (`accentFor`).
3. **Резолв фото** — `assetBind.pickImage`: prepared > реальная съёмка (disk=norvia/design) > WB. Нет фото → не рендерить плейсхолдер в прод.
4. **SEO-обвязка** — title keyword-first ≤100 (ключ в первых 40), desc 220–232, ≤5 ключей, keyword-rich ALT. Ключи из листинга WB/Ozon (MPStats). Один пин = один ключ.
5. **Рендер** — `POST /api/factory/static-generate` → поллить `static-status` до PNG. Fresh-variant: N вариантов/SKU (архетип×угол×кроп×уник. тексты), все на один WB-URL, perceptual-hash дедуп.
6. **Пин-критик (гейт)** — оси hook / brand-читаемость / контраст ≥4.5:1 / CTA / текст ≤25%. Ниже порога — не банковать, переген.
7. **Банк** — PNG + метаданные в `content_assets(kind='image', analysis:{format,archetype,platform,seo})`.
8. **Публикация малым дропом** — пока нет Pinterest API: в TG через `sendMediaGroup` + ручная выкладка. После §6-P2 — авто `/api/post/pinterest` на доску.
9. **Замер по заказам** — deeplink с атрибуцией WB/Ozon → `post_metrics` → форвард в `/api/factory/winners`.
10. **Winner-loop** — через 1–2 нед: убить нижние 80%, `is_winner`, снять пресет в `node_templates`, догенерить винеров.

---

## 6. Инженерная очередь (механически, для исполнителя)

Порядок = зависимости петли. Приоритет = «нужно для автономности», не «важно для бизнеса» (это §8).

### P0 — Банк пинов `блокирует всё ниже`
- **Файл:** `app/api/factory/static-generate/route.ts` (реализовать существующий TODO).
- **Задача:** после сабмита — поллить `static-status` (или отдельный воркер-тик), при `done` — upsert PNG в `content_assets` по паттерну `gen-save` (для видео уже есть — найти и повторить).
- **Пишем:** `content_assets{ disk:'gen', kind:'image', url, article, niche, analysis:{format,archetype,platform:'pinterest', seo:{title,desc,alt}} }`.
- **Приёмка:** после рендера строка появляется в `content_assets`; `GET /api/factory/studio?niche=` и `/api/factory/products` её видят; повтор того же кадра дедупится по perceptual-hash.
- **Проверка:** `npm run dev` зелёный; `curl -X POST $BASE/api/factory/static-generate -d '{...}'` → строка в БД.

### P0 — Невидимый SEO-слой
- **Файлы:** `app/api/factory/static-generate/route.ts` (+ хелпер в `lib/factory/`), скилл `mpstats`.
- **Задача:** тянуть ключи листинга WB/Ozon → через `fitHeadline`/`clampDesc` + константы `SEO` собрать `{title,desc,alt}`, положить в `inputProps` рендера и в банк (P0).
- **Приёмка:** каждый забанкованный пин имеет непустые title (≤100, ключ в первых 40), desc (220–232, ≤5 ключей), ALT.
- **Проверка:** расширить `lib/factory/staticCanon.test.mts`; `npx tsx lib/factory/staticCanon.test.mts` зелёный.

### P1 — Пин-критик
- **Файл:** новый `app/api/factory/pin-critic/route.ts` (по образцу видео-критика, но БЕЗ retention).
- **Оси:** hook / brand-читаемость / контраст (из `pickTextColor` — уже даёт `{ratio, ok}`) / CTA / бюджет текста ≤25%.
- **Вход:** PNG-URL + inputProps. **Выход:** скор + вердикт `pass/fail` + причины.
- **Приёмка:** пин ниже порога не банкуется (или банкуется с флагом `rejected`); гейт стоит между рендером и банком.

### P1 — Оркестрация пинов (очередь)
- **Файлы:** `lib/factory/jobs.ts` (расширить FSM) **или** новый лёгкий крон-воркер под статику.
- **Задача:** шаги `pick → render → poll → seo → critic → bank → (publish)`. Использовать паттерн self-chaining `jobs/tick` + `hasStuck`; для надёжности — синхронный крон по образцу `graph-run/cron` */2 (Vercel `after()` ненадёжен server-to-server — это диагностировано вживую).
- **Приёмка:** один POST ставит дроп из N SKU; крон доводит каждый до банка без человека; зависшие воскресают.

### P2 — Публикация в Pinterest `нужен app-review владельца`
- **Файлы:** новый `app/api/post/pinterest/route.ts` (по образцу `app/api/post/vk/route.ts`); снять хардкод-гард в `public/inferno/patrick-legacy.html` `postNow()`.
- **Задача:** Pinterest API v5 `POST /pins` {image, title, description, link(deeplink), alt_text, board_id}, rate-limit. Хранилище OAuth-токена/board_id (новая таблица или `PINTEREST_*` ENV).
- **Блокер (владелец):** Pinterest-приложение со scope `pins:write, boards:read` + Standard-access app-review (Trial ~1000 req/сут). Без этого пункт не стартует (§8).
- **Приёмка:** забанкованный пин публикуется на доску с deeplink и ALT; `pin_id` сохраняется.

### P2 — Петля замера по заказам
- **Файлы:** `app/api/factory/post-metrics/route.ts`, `app/api/factory/winners/route.ts`.
- **Задача:** формат deeplink с атрибуцией WB/Ozon (решение владельца) + авто-чтение метрик (Pinterest analytics / заказы) в `post_metrics` и форвард в `/winners`, заменяя ручной ввод.
- **Приёмка:** winner-detection крутится без человека: через 1–2 нед нижние 80% авто-помечены, винеры → новый дроп.

### P3 — Карусель + 3 архетипа + fal-кроп
- **Файлы:** `remotion/StaticV1.tsx` (+ `Root.tsx`).
- **Задача:** мульти-слайд-тело для `ig_carousel` (N стиллов hook→value→CTA); архетипы `before_after`/timeline (косметика), `listicle` «X трендов» (куртки), `multipack`. Продукт-кадр через Nano/`sourcePrep` — **ждёт баланса fal** (сейчас фолбэк prepared/wb).
- **Приёмка:** карусель рендерит N PNG; новые архетипы проходят критик и юнит-фикстуры канона.

---

## 7. Гейты качества (канон — не выдумывать, всё из `staticCanon.ts`)

- **Холст:** pin 2:3 = `1000×1500`; карточка 3:4 = `1080×1440`. Safe-зоны пина: L/R 100, top/bottom 150. **Bottom-right — мёртвая зона** (Lens): лого/бейдж туда нельзя, лого — верх-центр.
- **Контраст:** текст НИКОГДА на сыром фото → на solid/scrim; ≥4.5:1 (large ≥3:1). Не проходит — затемнять scrim + сигнал `pin_low_contrast`.
- **Текст:** бюджет ≤20–25% площади; хедлайн ≤7 слов (benefit-framed); один фокус + один хук + макс 1 подзаг. Шрифты Unbounded + Montserrat (кириллица-safe), без script/decorative (Pinterest не OCR-ит → теряет ключи).
- **Цена:** first-class — tabular-nums, Black-вес, крупнейший токен; старая цена зачёркнута легче; скидка-pill (не bottom-right).
- **Дедуп:** perceptual-hash — дубли спам-флагаются; свежие варианты ≠ репины.
- **Бренд NORVIA — ВНИМАНИЕ:** заявленные lowercase-лого, палитра `#161616`/`#F6F6F6`, промис «фото=реальность» **в коде НЕ закодированы** (палитра пина сейчас графит `#0e0f12`). Если это канон бренда — занести в `brand_kits` (caption_color/visual_style) и `staticCanon`, иначе агент их не соблюдёт.

---

## 8. Решения владельца (гейтят стройку)

| Решение | Почему это вызов владельца |
|---|---|
| Строить ли Pinterest-публикацию сейчас | Intel ставит Pinterest 4-м. Альтернатива — забанковать пины + отгрузить карточку WB 3:4 (ROI #1), Pinterest-постинг отложить. Меняет приоритет P2. |
| Pinterest API app-review | Приложение со scope pins:write + Standard-access ревью — только владелец. Взвесить платформенный риск (РФ-охват −20–29%, AI-пины даун-ранк/лейбл, возможен бан). |
| Авто-пост или человек-в-петле | `postNow()` намеренно отказывает всему кроме VK/TG. Выбор: Pinterest авто-канал или ручное одобрение; board/keyword-таксономия. |
| Валидировать цифры до масштаба | +30–50% аплифт карточки и collage 73/87/81% — непроверенные. Санкционировать A/B до массовой генерации. |
| Формат deeplink-атрибуции | Какой deeplink сохраняет заказ-атрибуцию WB/Ozon — без этого §6-P2 не строится. |
| Финансировать ли fal | Продукт-кадр через Nano/fal заблокирован балансом. Фондировать или остаться на prepared/wb. |
| Судьба дженерик-скилла | Переписать `.agents/skills/pinterest-posts/SKILL.md` под завод или deprecated. |

---

## 9. Guardrails и порядок работы

- **Ветка → PR, не в `main`.** `feat/<коротко>` или `fix/<коротко>` → правки только в зоне §1 → `npm run dev` без ошибок → маленькие коммиты → PR в `main`. Прямой push в main и мёрж в обход запрещены.
- **AI-гейт** (`.gitea/workflows/ai-gate.yml`): мелкие безопасные правки ИИ-ревьюер вливает сам; рискованное (миграции, `.env`/секреты, зависимости, авторизация, оплата, CI, удаление) → владельцу. Pinterest-публикация, новые ENV/таблицы, OAuth — заведомо эскалация.
- **Секреты** не коммитить; Pinterest OAuth-токен — в ENV/защищённое хранилище.
- **Не трогать видео-движок** и общий код кабинетов. Статик-линия — отдельная плоская ветка (renderStill, без fal).
- **Прод-гигиена перед автономным режимом:** закрыть открытый `render-service authed()` (задать `REMOTION_RENDER_TOKEN`); применить миграцию `render_jobs`.
- **Журнал** работы (образец `docs/factory-railway-night-log.md`), PR с чеклистом результата.

---

## 10. Definition of Done

1. Один POST ставит дроп из N SKU и без человека доводит каждый до **забанкованного пина** с непустым SEO (title/desc/alt) и вердиктом пин-критика.
2. Забанкованные пины публикуются (авто в Pinterest после P2 или полу-авто через TG) малыми дропами с deeplink.
3. Через 1–2 нед **winner-loop сам** помечает `is_winner` по заказам, убивает нижние 80%, догенеривает винеров.
4. Всё — в зоне завода, зелёный `npm run dev`, PR через AI-гейт, ноль правок вне зоны.

---

## Приложение A — Реальные точки входа, таблицы, ENV, команды

**Роуты (существуют):**
- `POST /api/factory/static-generate` — рендер статики; body `{article, niche?, format?(card_3x4|pin_2x3|ig_4x5|ig_carousel), archetype?, headline(REQUIRED), subhead?, bullets?, price?, oldPrice?, badge?, brand?, proof?, productImage?, productImages?, objective?(reach|saves), accent?, bg?}` → `{ok, task_id, format, archetype, size, platform, image_used}`.
- `GET /api/factory/static-status?id=` → `{status:in_progress|done|error, videoUrl?(PNG), error?, progress?, retryable?}`.
- `POST /api/factory/content-index {disk?}` — индекс Яндекс.Дисков → `content_assets`.
- `GET /api/factory/products` — список товаров с картинками.
- `GET/POST /api/factory/brand-kit` — бренд-кит (в т.ч. NORVIA).
- `POST /api/post/vk`, `POST /api/post/telegram` — рельсы публикации (шаблон для Pinterest).
- `POST /api/factory/winners`, `POST /api/factory/post-metrics` — петля винеров/метрик.
- render-service: `POST {REMOTION_RENDER_URL}/render`, `GET /status/:id`, `GET /health`.

**Таблицы (Supabase):**
- `content_assets` — мастер-каталог (disk, path, name, kind, niche, article, color, url, analyzed, analysis jsonb, is_winner, winner_at, winner_learnings). UNIQUE(disk,path).
- `brand_kits` — айдентика бренда (brand UNIQUE, voice_id, persona_id, visual_style, caption_font, caption_color, caption_highlight, cta, ban_words, hashtags).
- `niche_visual_profiles` — визуальный рецепт ниши (ближайший аналог reference-library).
- `render_jobs` — статус рендера (id, status, progress, video_url, error). Миграция `supabase/migrations/20260622_render_jobs.sql`.
- `factory_jobs` — очередь генераций (FSM). Миграция `20260619_factory_jobs.sql`.
- `post_metrics` — рыночные метрики публикаций.
- **НЕТ:** таблиц Pinterest (OAuth-токен/board_id/pin_id).

**ENV (существуют):** `REMOTION_RENDER_URL`, `REMOTION_RENDER_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `YANDEX_PUBLIC_KEY`, `CRON_SECRET`, `VK_TOKEN`, `VK_GROUP_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL`, `FACTORY_TG_BOT_TOKEN`, `FACTORY_TG_CHAT_ID`.
**ENV (нужно завести для P2):** `PINTEREST_*` (OAuth access_token, board_id).

**Команды проверки:**
```bash
npm run dev                                   # локальный запуск, должен подняться без ошибок
npx tsx lib/factory/staticCanon.test.mts      # юнит-фикстуры канона
node scripts/static-derisk.mjs                # локальный рендер стиллов out/static-*.png (без VM/fal)
curl -X POST $BASE/api/factory/static-generate -H 'content-type: application/json' \
  -d '{"article":"NV-08","format":"pin_2x3","archetype":"product_color","headline":"..."}'
curl "$BASE/api/factory/static-status?id=<task_id>"
```

**Baseline-гочи (не путать с ошибками своей правки):** в git-worktree `next dev` может падать по symlink node_modules (лечится `--webpack`), а `npm run build` красный по отсутствию `.env`/Supabase — оба baseline-красные, НЕ код-ошибки.

---

*Заземление: карта 6 подсистем (agent-canon · static-pipeline · studio/autopilot · review/metrics · distribution · asset-sources) + gap-синтез, 2026-07-15. Стратегия — разведка конкурентов Pinterest 14.07 + `docs/factory-static-content-intel.md`.*
