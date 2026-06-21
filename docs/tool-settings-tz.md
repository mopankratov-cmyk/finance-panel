# ТЗ: Полный перенос настроек ВСЕХ инструментов в нод-студию (кроме Creatify)

> Компаньон к `docs/creatify-settings-tz.md` (Creatify покрыт там). Принцип владельца: **настраиваемо под капотом, просто сверху — вынести МАКСИМУМ настроек**.
> Покрывает инструменты, что плагинятся в ноды V3: **Seedance · Kling · Shotstack · изображение (Higgsfield/Gemini/FLUX) · Claude · звук · disk_real**.
> Формат как у Creatify-TZ: настройка · API-param · значения · дефолт · UI-контрол · статус (есть/частично/добавить/БАГ) · точка в коде · RU/ОТК.
> Дата: 2026-06-20. Исследовано: 3 сервиса агентами (Seedance/Kling/Claude+звук), Shotstack+изображение — по докам/коду. ⚠️ Энумы помечены «(сверить дампом)» — снять с живых доков перед кодом.

---

## 0. Сводка «что сейчас захардкожено и упускается»

| Сервис | Шлём сейчас | Доступно | Главные дыры |
|---|---|---|---|
| **Seedance** | 4 поля из ~10 | ~10 | resolution прибит к 720p; **aspect_ratio НЕ шлётся → "auto" → НЕ вертикаль (БАГ)**; duration зажат 5/10 (API 2–12с); упущены end_image_url (before/after!), camera_fixed, seed; модель прибита к pro |
| **Kling** | ~5 полей | ~12 | версия прибита v2.1, режим standard; упущены tail_image_url, special_fx, motion-маски, выбор версии/качества |
| **Shotstack** | базовый timeline | богатейшая Edit-схема | переходы/эффекты/фильтры/keyframes/transform/auto-captions/трим/громкость почти не используются |
| **Изображение** | Higgsfield частично; Gemini-image НЕ построен | Higgsfield Soul/DoP, Gemini Nano-Banana, FLUX | весь image-слой под ноды carousel/static/hook-кадр + композит товара (U4) |
| **Claude** | model+system+max_tokens | + temp/top_p/stop + грундинг-тумблеры | темп/семплинг/грундинг не в инспекторе |
| **Звук** | sound_id, volume (хардкод) | источник/fade/bpm/SFX | **нет пути скачать mp3** (узкое место); fixedBeatGrid 120 захардкожен |

---

## 1. Seedance (fal bytedance/seedance/v1/pro · i2v + t2v)

Адаптер `lib/factory/falVideo.ts` (buildInput :21 шлёт `{image_url, prompt, resolution:"720p", duration}`).

**Движок:**
| Настройка | api_param | значения | деф | UI | статус | RU/ОТК |
|---|---|---|---|---|---|---|
| Модель | `<endpoint slug>` | pro · pro-fast (×3 дешевле) · lite(deprecated→pro-fast) · v1.5-pro (сверить) | pro (хардкод) | dropdown | частично | pro=финал ($0.74/5с 1080p), pro-fast=черновик-ОТК |
| Режим | i2v · t2v | image-to-video (нужно фото) · text-to-video | i2v | dropdown | добавить | t2v=атмосфера БЕЗ товара, редко |

**Вход:**
| Фото товара | `image_url` | URL | required | file | есть | реальное фото WB, не перерисовывать |
| Конечный кадр | `end_image_url` | URL·null | null | file | **добавить** | **before/after-формат!** Только pro (pro-fast/lite игнорят) |
| Промпт | `prompt` | текст(en) | required | textarea | есть | motion пишет Claude, preservation |

**Камера/формат/контроль:**
| Фикс. камера | `camera_fixed` | true·false | false | toggle | добавить | **true для детальных товаров** (меньше искажений) |
| Разрешение | `resolution` | 480p·720p·1080p | 720p(хардкод) | dropdown | частично | 480p=черновик, 1080p=финал; цена ∝ площади |
| Соотношение | `aspect_ratio` | 21:9·16:9·4:3·1:1·3:4·9:16·auto | **не шлём→auto (БАГ)** | dropdown | **БАГ** | **форсить 9:16!** auto i2v наследует пропорции фото → обрезка в TikTok |
| Длительность | `duration` | строки "2".."12"с | "5" | dropdown | частично | у нас зажат 5/10; короткие 3-5с=хуки; цена ∝ длине |
| Число кадров | `num_frames` | int 29–289 (переопределяет duration) | — | number | добавить | ПРО-рычаг; не трогать обычно |
| Сид | `seed` | int (-1=random) | random | number | добавить | фиксировать удачный дубль / A-B промпта; output.seed сохранять |
| Safety | `enable_safety_checker` | true·false | true | toggle | добавить | оставить true |

**Цена (fal токенная):** `tokens = height×width×FPS×duration/1024`, биллинг по 1M видео-токенов; Pro≈$3/1M (сверить LIVE). **Зависимость:** num_frames переопределяет duration (не слать оба); end_image_url только на pro.

---

## 2. Kling (fal kling-video · i2v + t2v)

**Движок (выбор эндпоинта = URL-сегменты):**
| Версия | сегмент URL | v1.6·v2.1·v2.5-turbo·v2/master·v3 (сверить) | v2.1(хардкод) | dropdown | **добавить** | новее=лучше движение/форма |
| Режим | standard·pro | качество | standard(хардкод) | dropdown | **добавить** | pro=жёсткие формы/лого держит лучше |
| Тип | i2v·t2v | image/text-to-video | i2v | dropdown | добавить | i2v=товар по фото |

**Вход/промпт:**
| Фото товара | `image_url` | URL/base64 | required | text | есть | первый кадр |
| Хвост-кадр | `tail_image_url` | URL/base64 | null | text | **добавить** | before/after на Kling |
| Доп. рефы | `input_image_urls` | до 4 URL (сверить, элементы-версии) | — | file | добавить | multi-image композиция |
| Промпт | `prompt` | текст(en) | Claude | textarea | есть | preservation |
| Негатив | `negative_prompt` | текст | DEFAULT_NEG(хардкод) | textarea | частично | **сделать редактируемым** (анти-слоп) |
| CFG scale | `cfg_scale` | 0.0–1.0 (pro 0.3–0.7) | 0.5 | slider | частично | сила следования промпту |

**Формат/эффекты:**
| Длительность | `duration` | "5"·"10" | "5" | dropdown | частично | — |
| Соотношение | `aspect_ratio` | 16:9·9:16·1:1 (двоеточие!) | 9:16(форсим) | dropdown | частично | ⚠ валиден НЕ во всех версиях (нет в standard i2v) |
| Motion-маски | `static_mask_url`·`dynamic_masks` | URL/траектории (v1.6/2.1 pro) | null | file | добавить | зоны движения — ПРО |
| Спец-эффект | `special_fx` | hug·kiss·heart_gesture·squish·expansion (сверить) | — | dropdown | добавить | спец-форматы |

**Цена:** v2.1 standard i2v 5с≈$0.28; pro 5с≈$0.49, 10с≈$0.98 (сверить). **Зависимость:** версия+режим определяют эндпоинт → какие поля валидны (лишнее = 422). aspect_ratio не на всех версиях.

---

## 3. Shotstack (Edit API — сборщик графа, монтаж)

`lib/factory/shotstack.ts` buildEdit. Богатейшая схема — сейчас используем минимум. Это **настройки нод captions/transition/effect + параметры СБОРКИ всего графа**.

**Per-clip (на каждый клип в таймлайне):**
| Настройка | api_param | значения (энумы — сверить) | деф | UI | статус |
|---|---|---|---|---|---|
| Переход вход/выход | `transition.in`·`.out` | fade·reveal·wipeLeft/Right/Up/Down·slideLeft/Right/Up/Down·carouselLeft/Right/Up/Down·shuffle*·zoom + Fast/Slow | none | dropdown | добавить |
| Эффект (Ken Burns) | `effect` | zoomIn·zoomOut·slideLeft/Right/Up/Down + Fast/Slow | none | dropdown | добавить |
| Фильтр | `filter` | boost·contrast·darken·greyscale·lighten·muted·negative | none | dropdown | добавить |
| Вписывание | `fit` | crop·cover·contain·none | crop | dropdown | частично |
| Масштаб | `scale` | 0–1+ | 1 | slider | добавить |
| Позиция | `position` | center·top·topRight·right·…·bottomLeft·left·topLeft | center | dropdown | добавить |
| Смещение | `offset.x`·`.y` | -1..1 доля | 0 | slider | добавить |
| Прозрачность | `opacity` | 0–1 | 1 | slider | добавить |
| Трансформ | `transform.rotate/skew/flip` | углы/оси | — | number | добавить |
| Кадр-ключи | `keyframes` | анимация свойств по времени | — | (ПРО) | добавить |
| Трим/скорость видео | `asset.trim`·`asset.speed`·`asset.volume`·`asset.chromaKey` | сек·множитель·0-1·{color,threshold} | — | slider | добавить |

**Текст-субтитры (asset type=text/html/caption):**
| Текст | `asset.text` | строка | — | textarea | есть |
| Шрифт | `font.family` | Noto Sans Cyrillic ✓ + каталог Google (RU-whitelist) | Noto Sans | dropdown | частично |
| Размер/цвет/вес | `font.size·color·weight·lineHeight` | px·hex·100-900 | — | number/color | добавить |
| Выравнивание | `alignment.horizontal·vertical` | left/center/right · top/center/bottom | center | dropdown | частично |
| Подложка | `background.color·opacity·padding·borderRadius` | hex·0-1·px | — | color | частично |
| Обводка | `stroke.color·width` | hex·px | — | color | добавить |
| **Авто-субтитры** | asset type=`caption` (Shotstack auto-captions) | из аудио-дорожки | — | toggle | **добавить** (киллер-фича — авто-сабы из озвучки) |

**Аудио / таймлайн / output:**
| Громкость/fade трека | `asset.volume`·`effect:fadeIn/fadeOut/fadeInFadeOut` | 0-1·энум | 1·none | slider/dropdown | частично |
| Саундтрек графа | `timeline.soundtrack{src,effect,volume}` | URL | — | picker | добавить |
| Фон таймлайна | `timeline.background` | hex | #000000 | color | есть |
| Формат вывода | `output.format` | mp4·gif·webm·jpg·png·mp3 | mp4 | dropdown | частично |
| Разрешение/размер | `output.resolution`·`output.size{w,h}` | preview/sd/hd/1080/4k · {w,h} | 1080×1920 | dropdown | частично |
| FPS | `output.fps` | 12·15·24·25·30 | 25 | dropdown | добавить |
| Качество | `output.quality` | low·medium·high | medium | dropdown | добавить |
| Merge-поля (Templates) | `merge[]` | замена {{PLACEHOLDER}} | — | — | добавить (Фаза 2 — Templates) |
| Webhook | `callback` | URL | — | text | добавить |

**Цена:** ~$0.20–0.40/рендер-мин (подписка vs pay-as-you-go); concurrency 8. **Зависимость:** ОТК ДО Shotstack (не перерендеривать всю сборку из-за одного блока); семафор ≤8 на compose.

---

## 4. Изображение (ноды carousel_slide · static_post · hook-кадр · ai_product_render через img)

Higgsfield в `/api/lab/*`; Gemini-image НЕ построен (`lib/llm/gemini.ts` только текст). ⚠️ всё «добавить».

**4.1 Higgsfield Soul (text2image) + DoP (image2video):**
| Soul: промпт | `prompt` | текст | — | textarea | добавить |
| Soul: соотношение | `aspect_ratio` | 9:16·1:1·16:9·4:5·… (пресеты) | 9:16 | dropdown | добавить |
| Soul: качество | `quality` | basic·high | high | dropdown | добавить |
| Soul: число вариантов | `batch_size` | 1–4 | 1 | number | добавить |
| Soul: сид | `seed` | int | random | number | добавить |
| Soul: стиль-пресет | `style`/`preset` | каталог Soul-пресетов (сверить) | — | dropdown | добавить |
| Soul: реф (img2img) | `reference_url`+`strength` | URL·0-1 | — | file/slider | добавить |
| DoP: камера-движение | `motion`/`preset` | dolly in/out·pan·orbit·crane·zoom·tilt (операторские пресеты) | — | dropdown | добавить |
| DoP: длительность/интенсив | `duration`·`motion_intensity` | сек·0-1 | — | slider | добавить |

**4.2 Gemini 2.5 Flash Image («Nano Banana») — для композита товара (U4):**
| Промпт | `prompt` | текст (вкл. инструкции редактирования) | — | textarea | добавить |
| Входные изображения | image inputs | 1–3 (фото актёра + чистое PNG товара) | — | file | добавить |
| Режим композита | (через промпт) | «вставь товар в кадр» + «upscale product using real photo as guide» | — | preset | добавить |
| Соотношение | (через промпт/ratio) | 9:16 и др. | — | dropdown | добавить |
> ⚠️ Это U4: композит реального товара в кадр → потом анимировать через Seedance. НЕ Flux Kontext (теряет детали — arXiv 2603.02210).

**4.3 fal FLUX (резерв — flux/dev·pro·schnell·redux):**
| Промпт | `prompt` | текст | — | textarea | добавить |
| Размер | `image_size` | square·portrait_4_3·portrait_16_9·landscape_*·{width,height} | portrait_16_9 | dropdown | добавить |
| Шаги | `num_inference_steps` | 1–50 (schnell=1-4, dev=28) | 28 | slider | добавить |
| Guidance (CFG) | `guidance_scale` | 1–10 | 3.5 | slider | добавить |
| Сид/число/safety | `seed`·`num_images`·`enable_safety_checker` | int·1-4·bool | random·1·true | number/toggle | добавить |
| Img2img | `image_url`+`strength` | URL·0-1 | — | file/slider | добавить |

**Цена:** Higgsfield/Gemini/FLUX — per-image (центы); batch множит. Кэш по hash обязателен.

---

## 5. Claude (нода-сценарист) + Звук + disk_real

**5.1 Claude prompt-engineer** (`lib/agent/client.ts`):
| Модель | `model` | opus·sonnet-4-6·haiku | sonnet-4-6 | dropdown | добавить | opus=качество, haiku=дёшево/быстро |
| Temperature | `temperature` | 0–1 | 1.0(API-деф) | slider | добавить | ↓=точность, ↑=креатив |
| Max tokens | `max_tokens` | 1–8192 | 1800/4000 | number | частично | ≥1800 для покадрового JSON (иначе обрыв) |
| Top-p | `top_p` | 0–1 | — | slider | добавить | менять ОДНО из temp/top_p |
| Stop | `stop_sequences` | до 4 строк | [] | text | добавить | — |
| System-промпт | `system` | редактируемый | «режиссёр коротких видео…» | textarea | добавить | роль/правила |
| Грундинг плейбук/корпус | инъекция pbHint/corpusHint | toggle + лимиты | вкл | toggle | частично | реальные хуки/beat ниши |
| Hook-boost | инъекция | toggle | false | toggle | есть | резче первый кадр |

**5.2 Звук** (Virlo/Creatify/Kling + disk):
| Источник | source(новый) | virlo_trending·virlo_breakout·orbit_synced·creatify_music·kling_gen | orbit_synced | dropdown | добавить | — |
| ID трека | `sound_id` (Virlo music_id) | строка (подменять по title!) | — | picker | добавить | модель галлюцинирует UUID — мапить по названию |
| Commerce-safe | `is_commerce_safe` | true·false | true | toggle | есть | права |
| **Скачать mp3** | (нет провайдера) | yt-dlp по url · сторонний | **НЕТ пути (узкое место)** | — | **добавить** | без mp3 бит-синк/наложение фиктивны |
| Громкость/fade | shotstack volume·effect | 0-1·fadeIn/Out | 1·none | slider | частично | ≤0.2-0.3 под озвучку |
| BPM/бит-сетка | `bpm` (fixedBeatGrid) | 60–180 | 120(хардкод) | number | частично | реальный bpm только с mp3 |
| Kling-генерация SFX | `sound_effect_prompt`·`asmr_mode` | текст ≤200·bool | — | textarea | добавить | синтез звука (Kling v3) |

**5.3 disk_real (реальная съёмка — хребет):**
| Ссылка на клип | `url` (yaDownloadHref) | href Я.Диска | — | picker | **БАГ** (videos не отдают download href) |
| Длительность | `duration_sec` (ffprobe) | сек | null→4с | number | **БАГ** (всегда null → тайминг фиктивен) |
| Trim | trim_start/end (новый) | 0–duration | целиком | slider | добавить |
| Роль в графе | `role` | hook·scene·payoff·skip | авто | picker | частично |
| Точность по артикулу/цвету | article+niche match | exact·wb-card·group | приоритет съёмка | toggle | есть |

**Зависимости Claude:** temp XOR top_p; max_tokens ≥ объём JSON. **Зависимость звук:** bpm-сетка реальна только при mp3. **Зависимость disk:** duration_sec (ffprobe) — предусловие тайминга (общий блокер с V3-ТЗ §8).

---

## 6. Общее: инспектор, контракт, ОТК pre-flight

- **Группировка в инспекторе** (как §6 V3-ТЗ): Движок · Вход/кадры · Камера/движение · Формат · Контроль(seed/safety) · Композиция(Shotstack) · Текст-субтитры · Аудио · Грундинг(Claude). Всё открыто, сворачивается визуально (не прячется).
- **Per-tool JSON-Schema** настроек — реестр нод-типов; каждый инструмент = схема полей → инспектор рендерится из неё. Вынос захардкоженных params (falVideo.buildInput, shotstack.buildEdit) в схему.
- **Сквозной контракт** кокпит→роут→адаптер: единые имена полей (как в API), без переименований; `params: jsonb` ноды = тело API.
- **Счётчик стоимости** на каждой генерации (модель × длительность/разрешение × batch) + **кэш превью по hash(tool+prompt+params)** — non-negotiable (все ручки → больше итераций).
- **ОТК pre-flight** (до траты денег): Seedance aspect≠9:16 → форс; resolution-черновик на pro-fast; шрифт субтитров вне RU-whitelist → блок; русский текст обязателен.
- **Энумы — снять с живых доков** (fal model api-страницы, shotstack.io/docs, Higgsfield/Gemini/FLUX) перед кодом; пометить датой. Не доверять числам из этого ТЗ там, где «(сверить)».

---

## 7. Приоритеты (что вынести первым)

**P1 (ядро, даёт результат сразу):**
- Seedance: фикс БАГ aspect_ratio→9:16; resolution/duration в инспектор; end_image_url (before/after); camera_fixed.
- Kling: выбор версии/режима (pro!); negative_prompt редактируемый; cfg_scale.
- Shotstack: переходы + Ken-Burns эффект + авто-субтитры (caption-asset) + громкость/fade аудио.
- Claude: model/temperature/system в инспектор.
**P2:** изображение (Higgsfield Soul/DoP, Gemini-композит U4, FLUX); звук (источник + скачивание mp3); Seedance seed/num_frames; Kling motion-маски/special_fx.
**P3:** Shotstack keyframes/transform/Templates-merge; disk trim; Kling multi-image.
