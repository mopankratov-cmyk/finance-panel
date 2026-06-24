# ТЗ: Полный перенос настроек Creatify в контент-завод

**Версия:** 2026-06-20 · **Под исполнителя (один программист, без доп. вопросов)** · **Ветка:** от `main`

> Цель пользователя дословно: «перенести ВСЕ настройки Creatify по максимуму». Документ покрывает **link_to_videos** (основной режим), **lipsync v1/v2**, **text_to_speech**, обогащение **link-объекта**, пикеры **голосов/музыки/индустрий**, **BYOA** и **клонирование голоса**. По каждой настройке: API-параметр, значения, дефолт, UI-контрол, статус по факту кода, точка в коде, критерий приёмки, RU/ОТК-нюанс.

---

## 0. Подтверждённое состояние кода (НЕ переписывать, только расширять)

Все факты ниже сверены чтением файлов 2026-06-20.

**Файлы:**
- Адаптер: `/Users/maksimpankratov/finance-panel/lib/factory/creatify.ts`
- Роут генерации: `/Users/maksimpankratov/finance-panel/app/api/factory/ugc-creatify/route.ts`
- Роут статуса: `/Users/maksimpankratov/finance-panel/app/api/factory/ugc-creatify-status/[id]/route.ts`
- Роут галереи аватаров: `/Users/maksimpankratov/finance-panel/app/api/factory/creatify-avatars/route.ts`
- Кокпит: `/Users/maksimpankratov/finance-panel/public/inferno/patrick.html`
- Профили брендов: `/Users/maksimpankratov/finance-panel/lib/factory/brandProfiles.ts`

**Что уже встроено (подтверждено по строкам):**

| Факт | Где | Деталь |
|---|---|---|
| Тело `link_to_videos` содержит только 6 фикс. + 3 условных поля | `creatify.ts:147-150` | `{ link, aspect_ratio:"9x16", video_length:opts.length\|\|15, target_platform:"Tiktok", language:"ru", no_cta:true }` + условно `override_script`(slice 1500), `override_avatar`, `visual_style` |
| **БАГ №1**: `model_version` НЕ в теле `link_to_videos` | `creatify.ts:147` | → летит API-дефолт `standard` (5 кред/30с). `DEFAULT_MODEL='aurora_v1_fast'` (`:7`) используется ТОЛЬКО в `creatifyLipsync` (`:167`) |
| Фото товара отдаётся напрямую | `creatify.ts:134` | `/links/link_with_params/` тело: `{ title, description, image_urls:slice(0,8), video_urls:[] }` — **нет `logo_url`, `reviews`** |
| `creatifyListAvatars` бьёт в `/personas/` | `creatify.ts:90` | query: `gender, age_range, style, location, keyword`. Пагинация `next` до 5 стр., cap 400 |
| `suitable_industries` приходит МАССИВОМ | `creatify.ts:59,74` | `toStr()` уже приводит к строке (нормализация в `normAvatar`) |
| `CREATIFY_SCENES` = **7 из ~54** | `creatify.ts:113-121` | AvatarBubble, SideBySide, TopBottom, DynamicProduct, MotionCards, Vlog, Vanilla |
| `creatifyLipsync` (v1) | `creatify.ts:162-171` | тело: `{ text:slice(1500), creator, aspect_ratio:"9:16", model_version }`. **`accent` (голос) НЕ передаётся** |
| Роут `ugc-creatify` принимает 5 контентных полей | `ugc-creatify/route.ts:38` | `creatifyLinkVideo({url,images,title,description,script,avatar,visual_style})` — 8 опций сигнатуры |
| Кокпит-состояние `avatars` | `patrick.html:1614` | `{open,loaded,busy,error,list,scenes,gender,style,search,pickedId,pickedName,scene}` — **нет age/location/voice/caption/music/format/length/model/toggle полей** |
| UI-фильтры пикера | `patrick.html:150,153` | только `gender` + `style` (адаптер поддерживает age/location, но селектов в UI нет) |
| `makeUGC` шлёт 5 полей | `patrick.html:1665` | `{ sku_art, brief, script, creator, visual_style }` |
| localStorage пресета | `patrick.html:1649` | `cf_avatar = { id, name, scene }` |

**Вывод:** сейчас переносится **~6 настроек из ~70**. Адаптер аккуратный — расширяем, не переписываем.

---

## 1. Цель, охват, анти-цели

**Построить «Панель настроек Creatify»** в кокпите (раскрывающаяся секция под кнопкой «🧑‍🎤 Аватар» / отдельная «⚙️ Настройки UGC»), повторяющую и превосходящую родной UI Creatify. Настройки:
- сохраняются как **пресет** (приоритет: товар > бренд > глобал) в localStorage с версией схемы и миграцией старого `cf_avatar`;
- сквозняком прокидываются **кокпит → роут `ugc-creatify` → `creatifyLinkVideo` → API** (расширить ВСЕ ТРИ слоя);
- по умолчанию настроены под **РУССКИЙ контент и ОТК-гейт**.

**Приоритеты охвата:**
- **P1 (обязательно):** все параметры `link_to_videos` + полный `caption_setting` + пикер голосов + пикер музыки + обогащение link-объекта (`logo_url`, `reviews`) + фикс БАГ №1 (`model_version`) + расширение `visual_style`/`script_style` до полных энумов + проброс длины/формата/ЦА.
- **P2:** `override_avatar_by_image`, BYOA (`/personas_v2/`), клонирование голоса, webhook-приёмник.
- **P3 (опционально, отдельная секция):** lipsync v2 многосегментный, lipsync v1 расширенный, text_to_speech.
- **Вердикты «не внедряем»:** AI Shorts, Custom Templates — см. §10.

**Анти-цели:**
- `language` НЕ давать менять (зашит `ru`); UI — заблокированный/скрытый, override только за флагом «тест».
- Товар WB — ВСЕГДА реальное фото (`link_with_params.image_urls`), не перерисовывать.
- Не смешивать в одном пресете модели данных `link_to_videos` и `lipsync v2` — это РАЗНЫЕ потоки (см. §6).

---

## 2. ⚠️ КРИТИЧНО ПЕРЕД РЕАЛИЗАЦИЕЙ: дамп энумов из живой схемы

Ручные списки энумов в этом ТЗ и в драфте **расходятся по числу** (script_style 50 vs 59, caption style 38/39/40, visual_style 53/54). Источник расхождения — устаревшие/неполные текстовые списки. **Не доверять числам из текста.**

**Обязательный первый шаг реализации** — снять канонические энумы напрямую из OpenAPI-схемы Creatify, а не копировать списки из ТЗ:

```bash
# схема Creatify (OpenAPI). Если доступна публично:
curl -s https://api.creatify.ai/api/schema/ -H "X-API-ID: $CREATIFY_API_ID" -H "X-API-KEY: $CREATIFY_API_KEY" -o creatify-schema.json
# извлечь нужные enum-узлы:
#  ScriptStyleEnum, VisualStyle*Enum (link_to_videos), Style*Enum (caption.style),
#  LanguageEnum, lipsync v2 visual_style enum, lipsync v1 caption_style enum
```

Если `/schema/` недоступен — снять реальные значения через попытку с заведомо неверным значением (API вернёт `400` со списком допустимых) ИЛИ из docs.creatify.ai (api-reference). **Все каталоги энумов в коде (`creatify.ts`) генерировать из этого дампа, с комментарием-датой снятия.** Числа в таблицах ниже помечены `(сверить дампом)` там, где есть риск.

**Раздельные каталоги (НЕЛЬЗЯ шарить один справочник):**
- `VISUAL_STYLES_LTV` — для `link_to_videos` (~54 имени: 21 базовый + Lego*).
- `VISUAL_STYLES_LIPSYNC_V2` — ПОЛНОСТЬЮ ДРУГИЕ имена (~13: FullAvatar, FullProduct, MagnifyingGlassCircle, ReverseMagnifyingGlassCircle, DramaticFullProduct, UpAndDown, SideBySide, GreenScreenEffect, FullAvatarScreenProductOverlay, TwitterFrame, Dramatic, Vanilla, Vlog, null).
- `CAPTION_STYLES_LTV_V2` (~40, сверить) vs `CAPTION_STYLES_V1` (~32, ПОДМНОЖЕСТВО, сверить отдельно).
- `SCRIPT_STYLES` (~59, сверить).
- `LANGUAGES` — один канонический список (не плодить 58 vs 90).

---

## 3. Группы настроек

Статусы: **есть** (в проде, не трогать) · **частично** (в адаптере есть, в UI/пробросе нет) · **добавить** (отсутствует) · **БАГ** (есть, но сломано) · **не внедрять** (deprecated/вне охвата).

### 3.1 LINK-ОБЪЕКТ (обогащение — НОВЫЙ раздел, пропущен в драфте)

Поля создаются в `POST /links/link_with_params/` (и `PUT /links/{id}/`). Сейчас шлём только `title/description/image_urls/video_urls`.

| Настройка | API-параметр | Значения | Дефолт | UI | Статус | Куда в коде | Критерий приёмки | RU/ОТК |
|---|---|---|---|---|---|---|---|---|
| Лого бренда | `logo_url` | URL изображения | null | авто из brandProfiles | **добавить** | `creatify.ts:134` тело link_with_params | logo_url уходит, виден в брендинге/CTA | подмешивать лого селлера; повышает узнаваемость |
| Отзывы (соц. доказательство) | `reviews` | строка/массив отзывов | null | авто из WB | **добавить** | `creatify.ts:134`; источник — реальные отзывы карточки WB | reviews уходят, актёр озвучивает реальный отзыв | мощный рычаг доверия; брать РЕАЛЬНЫЕ ru-отзывы карточки |
| Авто-ЦА link-объекта | `ai_target_audiences` | авто-извлекается, переопределяемо | авто | (опц.) text | **добавить (опц.)** | тело link_with_params | — | связано с `target_audience`, но это сущность link |
| Фото товара | `image_urls` | массив URL ≤8 | фото WB по nm_id | авто | **есть** | `creatify.ts:134` | — | товар = реальное фото |
| Свой b-roll | `video_urls` | массив URL видео | `[]` (пусто) | picker | **частично** | `creatify.ts:134` | наши видео уходят | реальные съёмки с Я.Диска |

### 3.2 Аватар (avatar)

| Настройка | API-параметр | Значения | Дефолт | UI | Статус | Куда в коде | Критерий приёмки | RU/ОТК |
|---|---|---|---|---|---|---|---|---|
| Выбор аватара | `override_avatar` | persona id (UUID) | пусто | picker-галерея | **есть** | `creatify.ts:149` | id уходит в body | внешность естественная для RU |
| Фильтр пол | `gender` (query) | `m\|f\|nb`, comma-sep `m,f` | любой | select | **есть** | `creatify.ts:84` | серверный фильтр | — |
| Фильтр возраст | `age_range` (query) | `child\|teen\|adult\|senior` comma-sep | любой | select | **частично** (адаптер шлёт, UI нет) | UI: добавить select `patrick.html:150-155`; проброс в loadAvatars | select меняет выдачу | baby/kids→родитель adult |
| Фильтр локация-фон | `location` (query) | `outdoor\|fantasy\|indoor\|other` comma-sep | любой | select | **частично** | UI: добавить select | фильтр работает | fantasy → ОТК-риск |
| Фильтр стиль | `style` (query) | `selfie\|presenter\|other` | любой | select | **есть** | `patrick.html:153` | — | selfie = нативный UGC, лучше залетает |
| Поиск по ключам | `keyword` (query) | свободный текст (en) | пусто | text | **есть** (на `/personas/`) | `creatify.ts:88` | — | ⚠ см. РИСК миграции ниже |
| Фильтр индустрия | `suitable_industries` (query) | массив **int-id** (см. §4 таблица id) | любой | select/auto | **добавить** (только `/personas_v2/`) | новый qp + маппинг subject→industry | авто-подбор по предмету WB | в ответе массив строк (toStr есть); в запросе — int-id |
| Свой актёр по фото | `override_avatar_by_image` | URL ≤1000 | null | text/upload | **добавить** | body link_to_videos | URL уходит, липсинк по лицу | реальная модель с Я.Диска; ОТК артефакты лица; **взаимоисключимо с override_avatar** |
| Эмоция аватара (выкл) | `no_emotion` | true\|false | false | toggle | **добавить** | body link_to_videos | — | иногда снижает «кринж»; ОТК-тест |
| Эндпоинт персон | `/personas_v2/` vs `/personas/` | — | — | — | **частично** (на `/personas/`) | `creatify.ts:90` | см. РИСК | v2 даёт industries-фильтр |

> **⚠ РИСК миграции на `/personas_v2/`:** в схеме v2 query-фильтр `keyword` **не документирован** (только gender/age_range/location/style/suitable_industries). Текущий серверный поиск (`creatify.ts:88`) на v2 может перестать работать. **План:** мигрировать на v2 ради `suitable_industries`, но `keyword` фильтровать **клиентски** (по `name`/`keywords` уже загруженного списка) ИЛИ оставить fallback на `/personas/` для текстового поиска. Также **проверить на v2-ответе**, приходит ли `suitable_industries` строкой (тогда `toStr()` избыточен) или массивом — не переносить допущение вслепую.

**BYOA — свой аватар (`POST /personas_v2/`), P2:**

| Поле | Значения | Обяз. | RU/ОТК |
|---|---|---|---|
| `creator_name` | строка ≤255 | да | имя своего диктора |
| `gender` | `m\|f\|nb` | да | — |
| `lipsync_input` | URI видеофайла | да | исходник реальной модели; права/согласие |
| `gdown_url` | URI Google Drive | да (альт. источник) | — |
| `original_voice_provider` | `elevenlabs\|minimax\|fishaudio` | нет | лучший RU-клон голоса |
| `video_scene` | строка ≤255 | нет | описание фона |
| `keywords` | строка ≤255 comma-sep | нет | поиск своей персоны |
| `labels` | массив строк | нет | **(пропущено в драфте)** метаданные персоны |
| `webhook_url` | URI ≤200 | нет | **(пропущено в драфте)** колбэк готовности BYOA |

Реализация BYOA: новый адаптер `creatifyCreatePersona()` + роут `POST /api/factory/creatify-persona`. Созданная персона появляется в пикере.

### 3.3 Голос (voice)

| Настройка | API-параметр | Значения | Дефолт | UI | Статус | Куда в коде | Критерий приёмки | RU/ОТК |
|---|---|---|---|---|---|---|---|---|
| Выбор голоса | `override_voice` | voice/accent id из `accents[].id` `/api/voices/` | пусто | picker | **добавить** | новый `creatifyListVoices()` + роут `/api/factory/creatify-voices`; body link_to_videos; пикер в кокпите | id уходит, превью слушается | **КРИТИЧНО:** у голоса НЕТ поля `language` → голос language-agnostic, русскость задаёт `language:'ru'`. Нужен **наш курируемый RU-whitelist** accent_id (см. §4) |
| Фильтр пол голоса | `voice.gender` | `male\|female\|non_binary\|null` | любой | select (клиентский) | **добавить** | пикер | в API не уходит, только группировка | — |
| Прослушивание | `accents[].preview_url` | URL аудио | — | audio-кнопка | **добавить** | пикер | играет превью | слушать на ru перед фиксацией |
| Громкость озвучки | `voiceover_volume` | 0.0–1.0 | null (авто) | slider | **добавить** | body link_to_videos | — | 0.8–1.0, выше музыки |
| Эндпоинт голосов | `/api/voices/` / `/api/voices/paginated?page&page_size` | page≥1, page_size≥1 | — | — | **добавить** | `creatifyListVoices` пагинация как personas | `{count,next,previous,results[]}` | поля голоса: `name`, `gender`, `accents[]{id,accent_name,preview_url}` |
| Клонирование голоса | `POST /api/voices/` (clone) / `GET`/`DELETE` cloned | исходный аудио/видео диктора | — | (опц.) форма | **добавить (P2)** | новый адаптер `creatifyCloneVoice()` | клонированный voice_id переиспользуется в override_voice | **(пропущено в драфте)** клонировать RU-голос один раз → стабильное произношение |

### 3.4 Сцена / визуал (scene)

| Настройка | API-параметр | Значения | Дефолт | UI | Статус | Куда в коде | Критерий приёмки | RU/ОТК |
|---|---|---|---|---|---|---|---|---|
| Композиция кадра | `visual_style` | каталог `VISUAL_STYLES_LTV` (~54, **сверить дампом**) | AvatarBubbleTemplate | dropdown/кнопки | **частично** (7 из ~54) | расширить `CREATIFY_SCENES` `creatify.ts:113` с RU-лейблами/хинтами | все шаблоны выбираемы | товарные: DynamicProduct/FeatureHighlight/SideBySide/TopBottom. НЕ Vlog/FullScreen (товар уйдёт). TwitterFrame/ResponseBubble/MotionCards тащат свой текст-оверлей → ОТК на англо-текст + `override_visual_style` |
| Без сток-broll | `no_stock_broll` | true\|false | false | toggle | **добавить** | body link_to_videos | — | **рекомендую default true** (анти-слоп: западный сток инороден для RU-карточки) |

### 3.5 Субтитры — `caption_setting` (самый большой пробел, сейчас НЕ шлётся вообще)

Передаётся вложенным объектом в `link_to_videos` и per-scene в lipsync v2.

| Настройка | API-параметр | Значения | Дефолт | UI | Статус | Критерий приёмки | RU/ОТК |
|---|---|---|---|---|---|---|---|
| Субтитры вкл/выкл | `no_caption` | true\|false | false | toggle | **добавить** | — | держать false (досматриваемость без звука) |
| Стиль | `caption_setting.style` | `CAPTION_STYLES_LTV_V2` (~40, **сверить**) | null (стиль шаблона) | dropdown | **добавить** | — | декоративные (toons/comic-shadow/hand-script) ломают кириллицу → тест |
| Шрифт | `caption_setting.font_family` | `Montserrat\|Jockey One\|Lilita One\|Mclaren\|Corben\|Dela Gothic One\|Comfortaa\|Luckiest Guy\|Quantico\|Poppins` | Montserrat | dropdown (**RU-whitelist**) | **добавить** | RU рендерится | **КРИТИЧНО:** безопасны Montserrat/Poppins/Comfortaa/Quantico; Lilita One/Luckiest Guy/Dela Gothic One/Jockey One — латиница → кириллица ломается. Зашить whitelist в коде, не как совет |
| Размер | `caption_setting.font_size` | integer px | null (≈70) | slider | **добавить** | — | RU длиннее → согласовать с max_width |
| Начертание | `caption_setting.font_style` | `font-bold\|italic\|underline` | null | dropdown | **добавить** | — | bold читаемее |
| Цвет текста | `caption_setting.text_color` | **`#RRGGBBAA`** (8 hex, с альфой!) | null | color+альфа-слайдер | **добавить** | 8-знач hex уходит | **`<input type=color>` даёт 6 hex — нужен отдельный слайдер альфы + сборка #RRGGBBAA** |
| Цвет подложки | `caption_setting.background_color` | `#RRGGBBAA` | null | color+альфа | **добавить** | — | полупрозр. тёмная (#00000066) для кириллицы на пёстром |
| Подсветка слова | `caption_setting.highlight_text_color` | `#RRGGBBAA` | null | color+альфа | **добавить** | — | karaoke → удержание |
| Смещение X | `caption_setting.offset.x` | доля кадра | 0 | slider | **добавить** | — | 0 = центр |
| Смещение Y | `caption_setting.offset.y` | доля кадра | 0.4 | slider | **добавить** | — | не под UI TikTok (нижние ~15%) |
| Макс. ширина | `caption_setting.max_width` | integer px | null | slider | **добавить** | — | длинные RU-слова не обрезались |
| Межстрочный | `caption_setting.line_height` | число | null | slider | **добавить** | — | запас под й/ё/заглавные |
| Тень текста | `caption_setting.text_shadow` | строка (CSS-подобная) | null | text | **добавить** | — | всегда задавать (светлый товар) |
| Скрыть точечно | `caption_setting.hidden` | true\|false | false | toggle | **добавить** | — | держать false |
| Перебить стиль шаблона | `caption_setting.override_visual_style` | true\|false | false | toggle | **добавить** | наши настройки перебивают шаблон | ставить **true** когда шаблон тащит свои (англо) субтитры; **авто-true при любом изменении caption_setting** (см. §5) |
| ⚠ НЕ внедрять | `caption_style` (DEPRECATED, плоское) | — | — | — | **не внедрять** | заменён на caption_setting.style | — |
| ⚠ НЕ внедрять | `caption_offset_x/y` (DEPRECATED, плоские) | — | — | — | **не внедрять** | использовать вложенный offset | — |

### 3.6 Музыка (music)

> **Структура пикера (драфт занижал):** `/api/musics/` отдаёт объекты с полями `url, category` (**массив!**), `cover_url`, `is_favorite`, `duration`. Query: `?category=&search=&page=&page_size=`. Категории — `/api/music-categories/`. Пикер: обложка (`cover_url`), длительность под `video_length`, фильтр по `is_favorite`.

| Настройка | API-параметр | Значения | Дефолт | UI | Статус | Куда в коде | RU/ОТК |
|---|---|---|---|---|---|---|---|
| Свой трек | `background_music_url` | URL ≤255; null→рандом. Каталог `/api/musics/` | null | picker (+ новый роут `/api/factory/creatify-music`) | **добавить** | body link_to_videos | тренд-саунды под RU-TikTok (Virlo `get_trending_sounds`); права из каталога |
| Громкость музыки | `background_music_volume` | 0.0–1.0 | null | slider | **добавить** | body | ≤0.2–0.3 при озвучке |
| Без музыки | `no_background_music` | true\|false | true | toggle | **добавить** | body | true → url/volume игнор; для «говорящей головы» или если звук кладём в Shotstack |

### 3.7 Формат и длина (format)

| Настройка | API-параметр | Значения | Дефолт | UI | Статус | Куда в коде | RU/ОТК |
|---|---|---|---|---|---|---|---|
| Соотношение сторон | `aspect_ratio` | `16x9\|1x1\|9x16` (через `x`!) | 9x16 (форсим) | dropdown | **частично** (захардкожен) | `creatify.ts:147` → из opts | вертикаль 9x16. **СИНТАКСИС:** link_to_videos/v2 = `9x16`, lipsync v1 = `9:16` (двоеточие!) → нормализация per-режим в адаптере (см. §5) |
| Длительность | `video_length` | `15\|30\|45\|60` (enum, сек) | 15 | dropdown | **частично** (захардкожен 15, opts.length есть) | `creatify.ts:147`; UI-селектор + проброс makeUGC | 15–30с оптимум; >45 режет досмотр; цена ∝ длине (см. §5 модель кредитов) |

### 3.8 Скрипт (script)

| Настройка | API-параметр | Значения | Дефолт | UI | Статус | Куда в коде | RU/ОТК |
|---|---|---|---|---|---|---|---|
| Наш сценарий | `override_script` | текст (slice 1500) | null | textarea | **есть** | `creatify.ts:148` | РУССКИЙ от копирайтера+ОТК. Перебивает script_style/target_audience |
| Стиль копирайтинга | `script_style` | `SCRIPT_STYLES` (~59, **сверить дампом**) | DiscoveryWriter | dropdown (fallback) | **добавить** | body (fallback-режим) | ИГНОРируется при override_script. Только «пусть Creatify напишет»; текст придёт на ru, качество ниже копирайтера |
| Язык | `language` | код (НЕ слово): `ru`,`en`,... (`LANGUAGES`, один список) | ru (форсим) | dropdown (заблок.) | **есть** | `creatify.ts:147` | **ТОЛЬКО `ru`**. Любой другой = автобрак ОТК. В UI заблокировать, override только за флагом «тест» |
| Платформа | `target_platform` | свободная строка ≤255 | **`Tiktok`** (код шлёт `Tiktok` с большой) | dropdown | **частично** | `creatify.ts:147` → dropdown | зафиксировать единый регистр `Tiktok`. TikTok/Reels вертикаль |
| Портрет ЦА | `target_audience` | свободный текст (деф `young adults`) | не шлём | text | **добавить** | body; прокидывать из niche-playbook | по-русски/нейтрально; влияет на авто-скрипт (если без override_script) |
| Без авто-CTA | `no_cta` | true\|false | **true** (форсим) | toggle (деф true) | **есть** | `creatify.ts:147` | **ДЕРЖАТЬ true**: авто-CTA = англ. «BUY NOW». RU-CTA в скрипте |
| Имя видео-задачи | `name` | строка ≤255 | **не шлётся** | text/auto | **добавить** | body link_to_videos (НЕ `title` link-объекта!) | автозаполнять `артикул + хук + дата`. **Не путать:** `title` (`:134`) = имя link-объекта, `name` в body link_to_videos = имя ВИДЕО (сейчас отсутствует) |

### 3.9 Движок (engine) — содержит БАГ №1

| Настройка | API-параметр | Значения | Дефолт | UI | Статус | Куда в коде | RU/ОТК |
|---|---|---|---|---|---|---|---|
| Модель рендера | `model_version` | `standard`(5 кред/30с) \| `aurora_v1`(1 кред/с) \| `aurora_v1_fast`(0.5 кред/с) | API-дефолт `standard` | dropdown | **БАГ** | **link_to_videos НЕ шлёт → летит standard!** Добавить `body.model_version = opts.model \|\| DEFAULT_MODEL` в `creatify.ts:147`. В lipsync уже шлётся (`:167`) | значение в body, дефолт aurora_v1_fast | финал=aurora_v1 (липсинк/лицо), черновик-ОТК=aurora_v1_fast |
| Webhook | `webhook_url` | URI ≤200 | null | text | **добавить (P2)** | body link_to_videos + lipsync; приёмник `/api/factory/creatify-webhook` | колбёк заменяет polling | контракт см. §7 |

### 3.10 lipsync v1 (запас — `creatifyLipsync`, P3)

| Настройка | API-параметр | Значения | Дефолт | Статус | Куда в коде | RU/ОТК |
|---|---|---|---|---|---|---|
| Текст | `text` | ≤8000 | — | **есть** | `creatify.ts:167` | русский |
| Аватар | `creator` | persona id | fallback `18fccce8-...` | **есть** | `creatify.ts:166` | — |
| Голос | `accent` | id из `/voices/` | дефолт аватара | **добавить** | `creatify.ts:167` | **ОБЯЗАТЕЛЬНО RU-accent**. ⚠ доки зовут поле «Avatar ID from /voices» (противоречиво) → **протестировать**, что accent меняет голос, а не аватара |
| Свой звук | `audio` | URL аудио | — | **добавить** | `creatify.ts:167` | готовая RU-озвучка (ElevenLabs/диктор) → идеальное произношение |
| Формат | `aspect_ratio` | `9:16` (двоеточие!) | **REQUIRED** (нет API-дефолта) | **есть** (шлём `9:16`) | `creatify.ts:167` | передавать всегда (обоснование «default 16x9» в драфте — неверно) |
| Зелёный фон | `green_screen` | true\|false | false | **добавить** | — | mp4 чёрный фон, БЕЗ субтитров (хромакей) |
| Прозрачный фон | `transparent_background` | true\|false | false | **добавить** | — | .webm с альфой → наложить на фото товара |
| Музыка | `no_music` | true\|false | **true** (нет музыки по умолч.!) | **добавить** | — | дефолт-ловушка |
| Субтитры v1 | `caption_style`(~32, ПОДМНОЖЕСТВО) / `caption_offset_x`(-0.5..0.5/0) / `caption_offset_y`(-0.5..0.5/**-0.4**) | плоские поля | `no_caption=true`(!) | **добавить** | — | в v1 субтитры по умолчанию ВЫКЛ → для RU явно `no_caption=false` |

> **Дефолт-ловушки v1:** `no_caption=true` И `no_music=true` по умолчанию. Если режим включат «как есть» — получат без субтитров и без музыки. **В адаптере жёстко слать `no_caption=false` для RU** (риск молчаливого брака).

### 3.11 lipsync v2 (многосегментный — `POST /api/lipsyncs/` v2, P3, ОТДЕЛЬНАЯ СЕКЦИЯ)

> **Принципиально другая модель данных:** нет link-объекта. Товар кладётся **прямой ссылкой** в `background.url` (`getWbCardImage(nm_id)`), для нескольких сцен — несколько фото. Энумы `visual_style`/caption — СВОИ. Не смешивать пресет с link_to_videos.

**Top-level:** `aspect_ratio`(`9x16\|16x9\|1x1`, деф **9x16**), `model_version`(деф standard, слать явно), `background_music{url, volume(деф 0.2)}` — **единая музыка на весь ролик**, `cta_end` (**top-level**, требует `cta_background`, `cta_duration` деф 2).

**`video_inputs[]` (каждый = сцена):**

| Группа | Поле | Значения | Дефолт |
|---|---|---|---|
| character | `type` | `avatar` | avatar |
| character | `avatar_id` | persona id | REQUIRED |
| character | `avatar_style` | `circle\|normal` (полный список) | normal |
| character | `offset.{x,y}` | доля кадра (отриц. допустимы) | 0/0 |
| character | `scale` | 0.0–2.0 | 1 |
| character | `hidden` | true\|false | false (true → закадровый голос + товар) |
| voice | `type` | `text\|silence` | REQUIRED |
| voice | `input_text` | текст ≤2000 (если text) | null |
| voice | `voice_id` | accents[].id (RU-whitelist) | null |
| voice | `duration` | 1.0–100.0 (если silence) | null |
| voice | `volume` | 0.0–1.0 | 0.8 |
| voice | `model` | `v2\|v3\|null` | null |
| background | `type` | `image\|video` | REQUIRED |
| background | `url` | URL (фото WB) | REQUIRED |
| background | `fit` | `crop\|contain` (**`cover` DEPRECATED — не предлагать!**) | crop |
| background | `effect` | `imageSlideLeft\|imageZoomIn\|imageZoomOut\|imageWobbling\|imageThrob\|null` | null (zoomIn → псевдо-видео из фото) |
| visual_style | (per-scene) | `VISUAL_STYLES_LIPSYNC_V2` (свой набор!) | null |
| caption_setting | — | те же поля что §3.5 | по шаблону |
| transition_effect | `transition_in\|out` | `fade\|leftSwipe\|rightSwipe\|topSwipe\|bottomSwipe\|null` | null |
| cta (внутри сцены) | `{cta_logo{url,offset,scale 0-1/0.25}, cta_caption{caption ≤200, caption_setting}}` | — | logo.scale=0.25 |

> **`voice.model=v3`** — единственный «эмоция»-рычаг в v2: поддерживает синтаксис эмоциональных тегов прямо в `input_text` (влияет на то, как писать RU-текст — теги-маркеры эмоций). Отдельных полей emotion/gesture/accessory в API НЕТ.

### 3.12 text_to_speech (`POST /api/text_to_speech/`, P3, ОТДЕЛЬНЫЙ МОДУЛЬ, не настройка link)

| Поле | Значения | RU/ОТК |
|---|---|---|
| `script` | ≤8000 (req) | готовый RU-скрипт после ОТК |
| `accent` | UUID голоса (nullable) | RU-whitelist accent |
| `webhook_url` | URI ≤200 | опц. |

> **`name` у TTS НЕТ** (драфт выдумал). Ответ: `id,status,output(audio url),duration,credits_used,failed_reason`. Применение: отдельная RU-озвучка → потом `audio` в lipsync v1 / `background` в v2, или диагностика голоса.

---

## 4. Справочники в коде (зашить в `creatify.ts` / `brandProfiles.ts`)

### 4.1 RU-whitelist голосов (КРИТИЧНО — у API нет поля language)
- Хранить в новой константе `CREATIFY_RU_VOICES: { voice_id, accent_id, label }[]` в `creatify.ts` (или в `brandProfiles.ts` для per-бренд дефолта).
- Процесс ведения: прослушать `preview_url` каждого голоса с RU-текстом → отобрать «нормально звучащие по-русски» → внести вручную. Пометить датой ревизии.
- Дефолтный RU-голос — один на завод + опц. override per-бренд.
- Пикер голосов по умолчанию показывает только whitelist (полный список — за тумблером «все голоса»).

### 4.2 RU-whitelist шрифтов субтитров (жёстко в коде)
- `CAPTION_RU_FONTS = ['Montserrat','Poppins','Comfortaa','Quantico']` — только эти в dropdown по умолчанию. Остальные — за предупреждением «латиница, кириллица сломается».

### 4.3 Таблица `subject_id (WB) → industry_id (Creatify)`
- Нужна для авто-подбора аватара по предмету. **Без неё авто-подбор индустрии нереализуем.**
- Сначала снять справочник industry → int-id из схемы `/personas_v2/` (~21 индустрия: Apparel & Accessories, Appliances, Apps, Baby Kids & Maternity, Beauty & Personal Care, Business Services, E-Commerce, Education, Financial Services, Food & Beverage, Games, Health, Home Improvement, Household Products, Life Services, News & Entertainment, Pets, Sports & Outdoors, Tech & Electronics, Travel, Vehicle & Transportation, Others — **число и id сверить дампом**).
- Затем составить маппинг WB subject → industry_id (использовать существующий маппинг niche/subject из `/market` модуля как основу).

---

## 5. Зависимости между настройками (правила валидации UI + адаптера)

Реализовать как реактивные правила (Alpine) + дублировать в адаптере (защита от прямого вызова):

| Правило | Поведение UI | Поведение адаптера |
|---|---|---|
| `no_caption=true` ⇒ весь `caption_setting` игнор | свернуть/дизейблить блок субтитров | не слать caption_setting |
| `caption_setting.hidden=true` | то же | — |
| `no_background_music=true` ⇒ `background_music_url/volume` игнор | гасить контролы музыки | не слать url/volume |
| `override_script` задан ⇒ `script_style`/`target_audience` не влияют | показать script_style как «fallback, игнорируется» (бейдж) | — |
| `override_avatar` ↔ `override_avatar_by_image` | **радио-логика** (одно из двух) | приоритет override_avatar; если оба — ошибка/предупреждение |
| любое изменение `caption_setting` | **авто-выставить `override_visual_style=true`** (иначе шаблон молча проигнорирует) | — |
| `aspect_ratio` UI-value → per-endpoint | один контрол `9x16` | нормализация: `9x16` для ltv/v2, `9:16` для v1 |
| lipsync v1 включён | — | принудительно `no_caption=false` для RU |

**Модель кредитов (UI-индикатор стоимости перед рендером):**
```
кредиты ≈ f(model_version, video_length):
  standard       → 5 кред / 30с  (≈0.167 кред/с)
  aurora_v1      → 1 кред / с
  aurora_v1_fast → 0.5 кред / с
оценка = коэф(model) × video_length
```
Показывать оценку рядом с кнопкой генерации + предупреждение, что `aurora_v1 + 60с` кратно дороже `aurora_v1_fast + 15с`.

---

## 6. Модель данных пресета (localStorage)

Новая схема (заменяет `cf_avatar`), с версией и слиянием **товар > бренд > глобал**:

```jsonc
// ключ: cf_creatify_preset_v2
{
  "version": 2,
  "global": { /* CreatifySettings — дефолты завода */ },
  "byBrand": { "NORVIA": { /* частичный override */ }, "Tim Tin": { ... } },
  "byProduct": { "<sku_art>": { /* частичный override */ } }
}
```

**`CreatifySettings` (полный объект, проброс кокпит→роут→адаптер):**
```ts
interface CreatifySettings {
  // engine
  model_version?: 'standard'|'aurora_v1'|'aurora_v1_fast';
  webhook_url?: string;
  // format
  aspect_ratio?: '9x16'|'1x1'|'16x9';   // нормализуется per-endpoint
  video_length?: 15|30|45|60;
  // script
  override_script?: string;
  script_style?: string;
  target_audience?: string;
  target_platform?: string;              // 'Tiktok'
  no_cta?: boolean;                       // default true
  name?: string;                          // имя видео-задачи
  // avatar
  override_avatar?: string;
  override_avatar_by_image?: string;
  no_emotion?: boolean;
  avatarFilters?: { gender?:string; age?:string; location?:string; style?:string; keyword?:string; industry?:number[] };
  // voice
  override_voice?: string;
  voiceover_volume?: number;
  // scene
  visual_style?: string;
  no_stock_broll?: boolean;              // рекомендуемый default true
  // link enrichment
  logo_url?: string;
  reviews?: string;
  // music
  background_music_url?: string;
  background_music_volume?: number;
  no_background_music?: boolean;
  // captions
  no_caption?: boolean;
  caption_setting?: CaptionSetting;      // полный объект §3.5
}
```

**Слияние при генерации:** `{...global, ...byBrand[brand], ...byProduct[sku]}` (brand определяется `detectBrand()` из `brandProfiles.ts`).
**Миграция:** при старте читать старый `cf_avatar` → если есть `{id,name,scene}`, перенести в `global.override_avatar/visual_style`, удалить старый ключ.

---

## 7. Сквозной payload-контракт кокпит → роут → адаптер → API

**Сейчас:** кокпит шлёт 5 полей → роут `ugc-creatify` → `creatifyLinkVideo` (8 опций). Перенос ~70 настроек требует расширения **всех трёх слоёв одинаковыми именами полей**.

1. **Кокпит** (`makeUGC`/`testUGC`, `patrick.html:1665`): в body POST добавить `settings: CreatifySettings` (результат слияния пресета).
2. **Роут** (`ugc-creatify/route.ts:38`): принять `body.settings`, провалидировать (pre-flight ОТК §8), передать в `creatifyLinkVideo({...resolved, ...settings})`.
3. **Адаптер** (`creatifyLinkVideo`, `creatify.ts:126`): расширить сигнатуру до `CreatifySettings`; собрать тело link_to_videos из всех полей (условно, только заданные); добавить `caption_setting`, `model_version`, `logo_url`/`reviews` в link_with_params.

**Имена полей JSON — единые на всех слоях** (как в API: `override_voice`, `caption_setting`, `no_stock_broll`, ...). Никаких переименований по дороге.

### 7.1 Webhook-контракт (P2)
Приёмник `POST /api/factory/creatify-webhook` парсит payload Creatify:
- статусы: `pending|in_queue|running|failed|done`;
- поля: `video_output`, `video_thumbnail`, `failed_reason`, `id`;
- маппинг на наш статус-роут (`ugc-creatify-status`): `done`+`video_output` → готово; `failed` → ошибка (`failed_reason`); прочее → in_progress. Совместимо с текущим polling (webhook опционален, не ломает существующий опрос).

---

## 8. ОТК pre-flight (блокировать ДО траты кредитов)

Проверки в роуте перед вызовом адаптера — если не прошли, вернуть `400` без рендера:

1. `language !== 'ru'` → блок (кроме явного флага «тест»).
2. `caption_setting.font_family` вне RU-whitelist → блок/предупреждение.
3. `visual_style` с встроенным англо-оверлеем (TwitterFrame/ResponseBubble/MotionCards) И `caption_setting.override_visual_style !== true` → предупреждение (риск англо-текста).
4. `no_cta !== true` → предупреждение (риск англ. CTA).
5. `override_voice` вне RU-whitelist → предупреждение.
6. lipsync v1 без явного `no_caption=false` → авто-фикс.

---

## 9. Изменения по файлам

| Файл | Изменения |
|---|---|
| `lib/factory/creatify.ts` | (1) Фикс БАГ №1: `model_version` в тело link_to_videos. (2) Расширить сигнатуру `creatifyLinkVideo` до `CreatifySettings`; собрать полное тело + `caption_setting`. (3) В `link_with_params` добавить `logo_url`, `reviews`. (4) Расширить `CREATIFY_SCENES`→ полный `VISUAL_STYLES_LTV` из дампа; добавить `SCRIPT_STYLES`, `CAPTION_STYLES_LTV_V2`, `LANGUAGES`, `VISUAL_STYLES_LIPSYNC_V2`, `CAPTION_STYLES_V1`. (5) Новые адаптеры: `creatifyListVoices()`, (опц.) `creatifyListMusic()`, `creatifyCreatePersona()`, `creatifyCloneVoice()`, `creatifyLipsyncV2()`, `creatifyTTS()`. (6) Мигрировать `creatifyListAvatars` на `/personas_v2/` (+ клиентский keyword, проверка suitable_industries). (7) В `creatifyLipsync` добавить `accent`, `audio`, `no_caption=false`, `no_music`. (8) Константы `CREATIFY_RU_VOICES`, `CAPTION_RU_FONTS`. |
| `app/api/factory/ugc-creatify/route.ts` | Принять `body.settings`, ОТК pre-flight (§8), пробросить в адаптер. |
| `app/api/factory/creatify-avatars/route.ts` | Прокинуть `age`/`location`/`industry` query (уже частично). |
| **Новые роуты** | `creatify-voices` (GET, read-only), `creatify-music` (GET, read-only), `creatify-credits` (GET, read-only), `creatify-persona` (POST, BYOA), `creatify-webhook` (POST, приёмник). `creatify-voices`/`creatify-music`/`creatify-credits` уже добавлены в код. |
| `public/inferno/patrick.html` | (1) Панель «⚙️ Настройки UGC» со всеми контролами по группам §3. (2) Расширить состояние `avatars`→ полный `CreatifySettings` + пикер голосов/музыки. (3) Реактивные правила-зависимости §5 + индикатор кредитов. (4) Color+альфа контрол для #RRGGBBAA. (5) Пресет v2 §6 + миграция `cf_avatar`. (6) `makeUGC`/`testUGC` шлют `settings`. |
| `lib/factory/brandProfiles.ts` | (опц.) per-бренд дефолтный `override_voice`/`logo_url`. |

---

## 10. Вердикты по непокрытым модулям (для полноты «максимума»)

| Модуль | Вердикт | Обоснование |
|---|---|---|
| **AI Shorts** (`/api/ai_shorts/` preview/render) | **НЕ внедряем сейчас** | Альтернативный генератор без показа реального товара WB как фото; дублирует link_to_videos, но хуже под наш кейс «товар = фото». Зафиксировать в коде комментарием. Пересмотреть, если понадобится чисто-нарративный формат. |
| **Custom Templates** (`/api/custom_template_jobs/`) | **НЕ внедряем сейчас** | Требует заранее созданных брендовых шаблонов на стороне Creatify; высокая стоимость поддержки. Кандидат на P3+ после стабилизации основного потока. |
| **lipsync v2 / TTS / voice-cloning / BYOA** | **P2–P3** | Внедряем после P1, отдельными секциями (см. §3). |

---

## 11. Фазы реализации

- **Фаза 0 (полдня):** снять дамп энумов из схемы (§2); собрать каталоги в `creatify.ts`; составить RU-whitelist голосов (прослушать preview) и шрифтов.
- **Фаза 1 — P1 (ядро):** фикс БАГ №1; полный `caption_setting`; пикер голосов (новый роут + адаптер + UI); пикер музыки; обогащение link (`logo_url`/`reviews`); расширение visual_style/script_style; проброс длины/формата/ЦА/имени; сквозной контракт §7; пресет v2 §6; зависимости §5; ОТК pre-flight §8.
- **Фаза 2 — P2:** миграция на `/personas_v2/` (+ industries-фильтр, subject→industry маппинг); `override_avatar_by_image`; BYOA; клонирование голоса; webhook-приёмник.
- **Фаза 3 — P3:** lipsync v2 многосегментный (отдельная секция UI); lipsync v1 расширенный; TTS-модуль.

---

## 12. Чек-лист приёмки

- [ ] Энумы в коде сгенерированы из живой схемы (не из текста ТЗ), с датой снятия.
- [ ] БАГ №1 закрыт: `model_version` уходит в теле link_to_videos (проверить в `debug.create.body`).
- [ ] `caption_setting` уходит целиком; RU-субтитры рендерятся выбранным RU-шрифтом (визуальная проверка кириллицы).
- [ ] Color-контролы выдают валидный 8-знач `#RRGGBBAA`.
- [ ] Пикер голосов показывает RU-whitelist, превью играет, `override_voice` уходит в body.
- [ ] Пикер музыки: обложка/длительность/категории; `background_music_url`/volume уходят.
- [ ] `logo_url` и `reviews` уходят в link_with_params.
- [ ] Пресет: товар > бренд > глобал; миграция `cf_avatar` отработала; перезагрузка сохраняет настройки.
- [ ] Все зависимости §5 работают (дизейбл/авто-override_visual_style/нормализация aspect_ratio).
- [ ] Индикатор кредитов меняется при смене model_version × video_length.
- [ ] ОТК pre-flight блокирует `language!=ru` и не-RU шрифт ДО рендера.
- [ ] Сквозной контракт: настройка из UI долетает до тела API (проверить через `debug:true`).
- [ ] (P2) `/personas_v2/` мигрирован, keyword-поиск работает (клиентски), industries-фильтр работает.
- [ ] (P3) lipsync v2: фото WB в background.url, сцены собираются, `cover` нигде не предлагается.

## 13. Что проверить LIVE (на проде, с реальным ключом)

1. Дамп схемы / реальные энумы (число script_style/visual_style/caption_style/language).
2. `/personas_v2/`: приходит ли `suitable_industries` строкой или массивом; работает ли `keyword` как query.
3. lipsync v1 `accent`: меняет ГОЛОС, а не аватара (доки противоречивы).
4. RU-голоса: прослушать `preview_url` с русским текстом → собрать whitelist.
5. RU-шрифты субтитров: отрендерить тестовый ролик с каждым из whitelist → подтвердить кириллицу.
6. `caption_setting.override_visual_style`: убедиться, что без него шаблон игнорирует наши субтитры.
7. Webhook payload: реальный набор статусов/полей для приёмника.
8. Маппинг `subject_id → industry_id`: получить industry int-id из схемы v2.
