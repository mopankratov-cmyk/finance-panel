# ТЗ: HeyGen UGC-блогер — интеграция и конфиг «по всем метрикам»

**Дата:** 2026-07-01
**Статус:** ТЗ для реализации (Codex / разработчики завода)
**Зона:** контент-завод → `lib/factory/*`, `app/api/factory/*` (правки только в зоне завода; вне зоны — согласование владельца)
**Основание:** research → [docs/factory-ugc-heygen-ui-avatar-settings-research.md](./factory-ugc-heygen-ui-avatar-settings-research.md)
**Персонаж:** «Alina / UGC friend» (см. §7 research)

> **Цель ТЗ:** сделать так, чтобы весь блогер настраивался из ОДНОГО типизированного конфига, где каждая метрика (лицо, look, голос, камера, формат, эмоция, длительность, бюджет и т.д.) — явное поле с дефолтом и валидацией. Ручные шаги в HeyGen UI — минимизированы и явно помечены.

> ⚠️ **Дисклеймер по API:** идёт миграция HeyGen v2 → v3 (v2 поддерживается до **31.10.2026**). Пути/поля ниже — reference-shape v2; перед реализацией **сверить с живыми доками** (`developers.heygen.com`, `docs.heygen.com`) и зафиксировать реальные ответы в фикстурах. Ключ уже есть: Production «для завода» (активен с 30.06.2026).

---

## 0. Scope / Non-scope

**In scope (автоматизируем через API):**
- bootstrap каталога (avatars/voices), создание/загрузка личности, train, генерация looks, генерация видео (Avatar IV / Avatar V Presenter), поллинг/вебхуки, скачивание и хранение.
- единый конфиг «по всем метрикам» + валидация + пресеты.

**Out of scope (пока руками в UI / отдельная задача):**
- Cinematic / Seedance 2 «режиссура» (камера/свет/product-directing) — публичного API не видно → ручной UI-режим (флаг `manual`).
- Curation/визуальный QA сгенерённых looks — оператор.
- Digital twin реального актёра (consent + видео) — только по решению владельца.

---

## 1. Архитектура и файлы (предложение)

```
lib/factory/
  heygen/
    heygenClient.ts        // низкоуровневый HTTP-клиент (auth, retв, rate-limit, poll)
    heygenTypes.ts         // все enum/типы «по метрикам» (из §4)
    bloggerConfig.ts       // схема конфига блогера + defaults + zod-валидация
    bloggerConfig.schema.ts// zod/json-schema
    stages/
      s0-bootstrap.ts      // list avatars/voices → кэш
      s1-identity.ts       // upload+train ИЛИ prompt-generate личности
      s2-looks.ts          // генерация looks по сценам
      s3-video.ts          // генерация видео (IV / Presenter)
      s4-status.ts         // poll + webhook + download
    heygenBudget.ts        // guard по credits/лимитам
  productTwinStudioContract.ts   // существующий контракт — сюда мапим look→сцена→продукт
app/api/factory/heygen/
  route.ts                 // триггеры/вебхук-приёмник (если нужен HTTP)
docs/
  factory-ugc-heygen-integration-spec.md   // этот файл
  factory-ugc-heygen-ui-avatar-settings-research.md
```

Хранилище состояния — в БД завода (та же, где `claude_runs` / контент-пайплайн): таблицы/поля `heygen_blogger`, `heygen_look`, `heygen_video_job` (см. §5.6).

### 1.1 Control Plane внутри фабрики (registry → UI + agent) ⭐

Идея: **все настройки блогера («по всем метрикам») крутятся из самой фабрики — и вручную оператором, и агентом. Но НЕ дублируются руками.** Единственный источник правды — **Metric Registry**; из него растут и панель, и agent-tool, и валидация.

```
        ┌──────────────────────────────────────────────┐
        │  Metric Registry  (lib/factory/heygenBlogger) │  ← ЕДИНЫЙ источник
        │  METRIC_REGISTRY: {id,label,type,options,     │
        │  default,min,max,stage,api,credits}           │
        └───────────┬─────────────────────┬─────────────┘
       describeMetrics()            describeMetrics() + tool-schema
        ┌───────────▼──────────┐   ┌───────▼───────────────────────┐
        │ Ручная панель        │   │ Agent-tool                    │
        │ app/inferno/         │   │ lib/factory/heygenAgentTool   │
        │ heygen-blogger/*     │   │ configure_heygen_blogger      │
        │ (форма из registry)  │   │ applyBloggerPatch()           │
        └───────────┬──────────┘   └───────┬───────────────────────┘
                    └──── BloggerConfig (пресет в БД) ────┘
                                 │ configToHeygenPayloads()  → push (S1–S4)
                                 ▼
                              HeyGen API
                                 ▲  pull каталог (S0: avatars/voices/looks) → кэш в БД
```

**Правило №1 (анти-дубль):** список метрик и их значения нигде не хардкодятся, кроме `METRIC_REGISTRY`. UI и агент читают его через `describeMetrics()`. Добавили метрику → правим registry **в одном месте**, оба потребителя обновляются.

**Правило №2 (sync, не копипаста):** наша БД = источник правды для *настроек*; HeyGen = downstream (туда `push` конфиг). Реальные `avatar_id/voice_id/look_id` мы `pull`-им из HeyGen (S0) и кэшируем — панель и агент выбирают из настоящих значений, а не из захардкоженного списка.

**Файлы control-plane (все в зоне завода):**
| Файл | Роль |
|---|---|
| `lib/factory/heygenBlogger.ts` | Registry + типы `BloggerConfig` + `DEFAULT_BLOGGER_CONFIG` + `validateBloggerConfig()` + `describeMetrics()` (единый источник) |
| `lib/factory/heygenAgentTool.ts` | `HEYGEN_BLOGGER_TOOL` (tool-схема из registry) + `applyBloggerPatch()` (валидируемый patch) + `configToHeygenPayloads()` (маппинг в API) |
| `app/inferno/heygen-blogger/HeygenBloggerStudio.tsx` | Schema-driven панель: рендерит контролы из `describeMetrics()`, показывает итоговый `BloggerConfig` |
| `app/inferno/heygen-blogger/page.tsx` | Динамический роут (`connection()` + `force-dynamic`) |
| `lib/factory/heygenBloggerContract.test.mts` | Drift-guard: сверяет enum'ы registry, дефолты, wiring UI/agent |

**Пресеты в БД:** `heygen_blogger_preset(id, name, config_json, version, updated_by 'human'|'agent', updated_at)` — именованные конфиги («Alina base», форки под кампанию), diff и fork одинаково доступны человеку и агенту.

**Контракт agent-tool** (одинаковый вход для человека и агента):
- `describeMetrics()` → массив метрик (агент видит, что можно крутить и в каких пределах).
- `applyBloggerPatch(config, patch)` → `{config, errors}` (валидируется той же схемой, что и UI).
- `configToHeygenPayloads(config)` → тела запросов S1–S4 (identity/train/look/video) — оба пути дают идентичные API-вызовы.

**Drift-guard:** `heygenBloggerContract.test.mts` падает, если registry разошёлся с ожидаемыми enum'ами/дефолтами → при апдейте HeyGen меняем registry осознанно, в одном месте.

> Интеграция в хаб: `app/agent/page.tsx` должен получить ссылку `href="/inferno/heygen-blogger"` (по аналогии с Product Twin Studio). Не правил автоматически — у файла есть незакоммиченные изменения владельца.

---

## 2. Конфиг и секреты (env)

| Env | Назначение | Пример |
|---|---|---|
| `HEYGEN_API_KEY` | Production-ключ «для завода» (НЕ коммитить, `.env`) | `••••XYSi` |
| `HEYGEN_API_BASE` | базовый URL | `https://api.heygen.com` |
| `HEYGEN_UPLOAD_BASE` | upload asset endpoint | `https://upload.heygen.com` |
| `HEYGEN_WEBHOOK_SECRET` | подпись вебхуков (если включаем) | — |
| `HEYGEN_MAX_CREDITS_PER_RUN` | budget-guard на прогон | `50` |
| `HEYGEN_DEFAULT_RESOLUTION` | потолок вывода | `720p` (free-план) |

Все ключи — только через env; в код/логи/коммиты не попадают (см. AGENTS.md).

---

## 3. Доменная модель / контракт (TypeScript)

```ts
// lib/factory/heygen/heygenTypes.ts — «все метрики» как enum

export type Age = 'Young Adult' | 'Early Middle Age' | 'Late Middle Age' | 'Senior' | 'Unspecified';
export type Gender = 'Woman' | 'Man' | 'Unspecified';
export type Ethnicity =
  | 'White' | 'Black' | 'Asian American' | 'East Asian' | 'South East Asian'
  | 'South Asian' | 'Middle Eastern' | 'Pacific' | 'Hispanic' | 'Unspecified';
export type Orientation = 'square' | 'horizontal' | 'vertical';   // API; UI: Landscape/Portrait/Square
export type Pose = 'full_body' | 'half_body' | 'close_up';         // UI: Full Body / Upper Body / Face
export type AvatarStyle = 'Realistic' | 'Pixar' | 'Cinematic' | 'Vintage' | 'Noir' | 'Cyberpunk';

export type AspectRatio = '9:16' | '16:9' | '4:5' | '1:1' | 'auto';
export type Resolution = '720p' | '1080p' | '4k';
export type VideoEngine = 'avatar_iv' | 'presenter_v' | 'cinematic_seedance'; // последний = manual
export type VoiceEmotion = 'Excited' | 'Friendly' | 'Serious' | 'Soothing' | 'Broadcaster' | 'Default';

export type IdentitySource = 'upload_own_face' | 'prompt_design_ai' | 'mixed';
```

```ts
// lib/factory/heygen/bloggerConfig.ts — ЕДИНЫЙ конфиг блогера

export interface BloggerIdentity {
  workingName: string;                 // "Alina"
  source: IdentitySource;              // рекоменд: 'upload_own_face'
  // при source=upload_own_face / mixed:
  faceImageKeys?: string[];            // 5–8 ракурсов, из Upload Asset
  train: boolean;                      // рекоменд: true (консистентность)
  // при source=prompt_design_ai / mixed:
  prompt?: {
    age: Age; gender: Gender; ethnicity: Ethnicity;
    style: AvatarStyle; orientation: Orientation; pose: Pose;
    appearance: string;                // free-text persona prompt
  };
  consentConfirmed: boolean;           // явная галочка прав на лицо
}

export interface LookSpec {
  id: string;                          // "kitchen_daylight"
  scene: string;                       // человекочит. описание
  prompt: string;                      // look-prompt
  orientation: Orientation;            // 'vertical'
  pose: Pose;
  referenceImageKeys?: string[];       // доп. референсы (outfit/scene)
  optional?: boolean;
  mode: 'api' | 'manual';              // manual → делаем в UI (Cinematic)
  // результат:
  lookId?: string;                     // выдаёт HeyGen после генерации
}

export interface VoiceSpec {
  voiceId: string;                     // из GET /v2/voices
  language: string;                    // "ru"/"en"
  speed: number;                       // 0.5–1.5 (1.0)
  pitch: number;                       // -50..50 (0)
  emotion: VoiceEmotion;               // 'Friendly'
  locale?: string;
}

export interface VideoRenderSpec {
  engine: VideoEngine;                 // 'avatar_iv' | 'presenter_v'
  aspectRatio: AspectRatio;            // '9:16'
  resolution: Resolution;              // '720p' (free cap)
  dimension: { width: number; height: number }; // 720x1280
  captions: boolean;                   // false
  background: { type: 'transparent' | 'color' | 'image' | 'video'; value?: string };
  music?: { assetId?: string; volume?: number } | null;
  durationMode: 'auto' | 'custom';
  durationSec?: number;                // при custom (напр. 3 для face-intro)
  motion: {
    customMotionPrompt?: string;       // Avatar IV/V
    enhanceMotionPrompt: boolean;      // true
    cameraPrompt?: string;             // только cinematic (manual)
  };
  template: null | string;             // null = без шаблона
  outputFormat: 'mp4' | 'webm';        // webm → прозрачный фон
}

export interface ProductBrollSpec {   // §4.6 — Cinematic (manual)
  enabled: boolean;
  referenceImageKeys: string[];        // до 3+ (продукт/сцена/люди)
  shotPrompt: string;
  mode: 'manual';                      // пока только UI
}

export interface BloggerConfig {
  identity: BloggerIdentity;
  looks: LookSpec[];                   // 10 сцен (§7 research)
  voice: VoiceSpec;
  render: VideoRenderSpec;
  broll?: ProductBrollSpec;
  budget: { maxCreditsPerRun: number; blockCinematicAuto: boolean };
}
```

Валидация: **zod-схема** обязательна; отклонять неизвестные enum-значения и out-of-range (speed/pitch/duration). Дефолты — из §9.

---

## 4. Полная матрица параметров «по всем метрикам»

### 4.1 Личность (identity)
| Метрика | Значения | Default (Alina) | API? |
|---|---|---|---|
| source | upload_own_face / prompt_design_ai / mixed | **upload_own_face** | ✅ |
| faceImageKeys | 5–8 ракурсов | наш image-gen | ✅ upload asset |
| age | Young Adult…Senior | Young Adult | ✅ |
| gender | Woman/Man/Unspecified | Woman | ✅ |
| ethnicity | White…Hispanic | *владелец* | ✅ |
| style | Realistic…Cyberpunk | Realistic | ✅ |
| orientation | vertical/horizontal/square | vertical | ✅ |
| pose | full_body/half_body/close_up | half_body | ✅ |
| appearance | free text | persona prompt (§7 research) | ✅ |
| train | bool | true | ✅ |
| consentConfirmed | bool | *владелец* | (галочка) |

### 4.2 Look (образ/сцена) — 10 сцен
| Метрика | Значения | Default | API? |
|---|---|---|---|
| prompt | free text | per-scene (§7 research) | ✅ |
| orientation | vertical/… | vertical | ✅ |
| pose | close_up/half_body/full_body | зависит от сцены | ✅ |
| referenceImageKeys | доп. картинки | опц. | ✅ (image_keys[]) |
| inspiration | из библиотеки | — | ✅ |
| mode | api / manual | api (manual для нативных cinematic) | — |

### 4.3 Голос (voice)
| Метрика | Значения | Default | API? |
|---|---|---|---|
| voiceId | из `GET /v2/voices` | *подобрать «подруга»* | ✅ |
| language | ru/en/… (175+) | ru | ✅ |
| speed | 0.5–1.5 | 1.0 | ✅ |
| pitch | -50..50 | 0 | ✅ |
| emotion | Excited/Friendly/Serious/Soothing/Broadcaster | Friendly | ✅ (если voice поддерживает) |
| pause/pronunciation | SSML-подобно | — | ✅ |

### 4.4 Видео / рендер
| Метрика | Значения | Default | API? |
|---|---|---|---|
| engine | avatar_iv / presenter_v / cinematic_seedance | avatar_iv (talking) | ✅ / cinematic=manual |
| aspectRatio | 9:16 / 16:9 / 4:5 / 1:1 / auto | 9:16 | ✅ |
| resolution | 720p / 1080p / 4k | 720p (free cap) | ✅ |
| dimension | напр. 720×1280 | 720×1280 | ✅ |
| captions | on/off | off | ✅ |
| background | transparent/color/image/video | transparent (webm) | ✅ |
| music | asset + volume | null | ✅ |
| durationMode | auto/custom | auto (custom для интро) | ✅ |
| durationSec | число | 3 (face-intro) | ✅ |
| template | null / id | null | ✅ |
| outputFormat | mp4 / webm | mp4 (webm для композа) | ✅ |

### 4.5 Motion / camera
| Метрика | Значения | Default | API? |
|---|---|---|---|
| customMotionPrompt | free text | «casual, natural gestures» | ✅ (IV/V) |
| enhanceMotionPrompt | bool | true | ✅ |
| cameraPrompt (360°) | free text | — | ❌ cinematic manual |

### 4.6 Product b-roll (Cinematic / manual)
| Метрика | Значения | Default | API? |
|---|---|---|---|
| referenceImageKeys | до 3+ (продукт/сцена/люди) | продукт-фото | ❌ manual (UI) |
| shotPrompt | free text | «holds product, natural light» | ❌ manual |
| duration | ≤15 сек | 5–8 сек | ❌ manual |
| стоимость | **60 credits/шот** | — | — |

---

## 5. Пайплайн (этапы, эндпоинты, вход/выход)

> Все запросы: заголовок `X-Api-Key: $HEYGEN_API_KEY`. Асинхронные шаги — poll ИЛИ webhook. Идемпотентность — через `external_ref` в нашей БД (см. §5.6).

### S0 — Bootstrap каталога
- `GET /v2/avatars` → `avatars[] {avatar_id, ...}`, `talking_photos[]`.
- `GET /v2/voices` → `voices[] {voice_id, language, gender, emotion_support, support_pause}`.
- Кэшируем в БД; отсюда подбираем `voiceId` для «подруги».

### S1 — Личность (identity)
**Вариант A (рекоменд, own face):**
1. Upload каждого фото: `POST $HEYGEN_UPLOAD_BASE/v1/asset` (binary, Content-Type) → `image_key`.
2. Создать группу: `POST /v2/photo_avatar/avatar_group/create` `{ name, image_key }` → `group_id`.
3. Добить ракурсы: `POST /v2/photo_avatar/avatar_group/add` `{ group_id, image_keys[] }`.
4. **Train:** `POST /v2/photo_avatar/train` `{ group_id }` → poll `GET /v2/photo_avatar/train/status/{group_id}` до `ready`.

**Вариант B (prompt):**
1. `POST /v2/photo_avatar/photo/generate` `{ name, age, gender, ethnicity, orientation, pose, style, appearance }` → `generation_id`.
2. Poll `GET /v2/photo_avatar/generation/{generation_id}` → фото → создать/train группу (как в A).

**Mixed:** залить свои фото + добавить AI-вариации в ту же группу, затем train.

### S2 — Looks (10 сцен)
- Для каждой `LookSpec.mode==='api'`: `POST /v2/photo_avatar/look/generate` `{ group_id, prompt, orientation, pose, style, image_keys?[] }` → `generation_id` → poll → `lookId`.
- (опц.) `POST /v2/photo_avatar/add_motion { id }`, `POST /v2/photo_avatar/{id}/upscale`.
- `mode==='manual'` → создаём в UI (Cinematic), `lookId` вносим руками в конфиг.

### S3 — Видео
**Avatar IV (photo→video, talking, default):**
- `POST` Create Avatar IV Video (⚠ путь свериться) `{ image_key | look reference, video_title, script, voice_id, custom_motion_prompt, enhance_custom_motion_prompt, dimension, aspect_ratio }` → `video_id`.

**Avatar V Presenter (длинные, дешевле — 0.3 credit/сек):**
- `POST /v2/video/generate`:
```json
{
  "video_inputs": [{
    "character": { "type": "avatar", "avatar_id": "<lookId|avatar_id>", "avatar_style": "normal" },
    "voice": { "type": "text", "input_text": "<script>", "voice_id": "<voiceId>",
               "speed": 1.0, "pitch": 0, "emotion": "Friendly" },
    "background": { "type": "transparent" }
  }],
  "dimension": { "width": 720, "height": 1280 },
  "aspect_ratio": "9:16",
  "caption": false
}
```
→ `video_id`.

### S4 — Статус / скачивание
- Poll: `GET /v1/video_status.get?video_id=<id>` → `status: processing|completed|failed`, `video_url`.
- ИЛИ **Webhook**: зарегистрировать endpoint (раздел Webhook в аккаунте) → приёмник `app/api/factory/heygen/route.ts`, проверка подписи `HEYGEN_WEBHOOK_SECRET`.
- На `completed`: скачать `video_url`, положить в стор завода, привязать `look → сцена → продукт` через `productTwinStudioContract`.

### 5.6 Хранение / идемпотентность
- Таблицы: `heygen_blogger(group_id, name, trained_at, config_json)`, `heygen_look(look_id, blogger_id, scene, prompt, status)`, `heygen_video_job(video_id, look_id, engine, status, credits_est, video_url, external_ref)`.
- `external_ref` = детерминированный хэш(config-fragment) → не пере-генерить одно и то же; ret600 идемпотентны.

---

## 6. Guardrails (бюджет / лимиты / ошибки)

- **Budget-guard:** перед каждым платным вызовом считать `credits_est` и сверять с `HEYGEN_MAX_CREDITS_PER_RUN` и остатком аккаунта. Presenter ≈ `0.3 * durationSec`. Avatar IV ≈ по минутам ($4/мин 1080p). Cinematic = 60/шот → **по умолчанию `blockCinematicAuto=true`** (руками).
- **Rate-limit / retв:** экспоненциальный backoff на 429/5xx; максимум N попыток; poll-интервал 5–10 сек с таймаутом.
- **Партиал-фейлы:** статусы `failed` логировать с причиной, не ретраить бесконечно; помечать job как `failed` в БД.
- **Идемпотентность:** см. §5.6.

---

## 7. Consent / legal

- `identity.consentConfirmed` обязателен перед S1, если `source` включает загрузку лица.
- Если HeyGen на аплоаде запросит подтверждение прав/ownership — это **UI-гейт**, отметить в чек-листе оператора; авто-обход запрещён.
- Синтетическое (наше) лицо — наш ассет; но политику проверяем на первом реальном аплоаде и фиксируем результат в этом ТЗ.

---

## 8. Ручные шаги (UI-only) — чек-лист оператора

1. (если нужно) Подтверждение прав на лицо при аплоаде.
2. **Cinematic / Seedance** сцены и product b-roll — собираются в UI (Avatar Shots → Cinematic → «+ → Media»), `lookId`/готовый клип вносится в конфиг.
3. Визуальный QA сгенерённых looks (отбор годных).
4. Первая платная генерация — только после подтверждения владельца.

---

## 9. Решения владельца (defaults + флаги)

| Вопрос | Рекоменд. default | Нужно решение |
|---|---|---|
| Источник лица | own face + train (mixed) | да/нет |
| Этнос/внешность Alina | — | ✅ выбрать |
| Основной движок talking-видео | Avatar IV (реализм) / Presenter (длинные, дёшево) | подтвердить |
| Язык/голос | ru, «дружелюбная подруга» | подтвердить voiceId |
| Разрешение | 720p (free) | апать план? |
| Cinematic product b-roll | manual, off-by-default | когда включаем |
| Top-up бюджета | — | ✅ ($3.71/$9.99) |

---

## 10. Acceptance criteria (Definition of Done)

- [ ] Один `BloggerConfig` (zod-валидный) полностью описывает Alina + 10 looks + голос + рендер.
- [ ] S0–S4 реализованы; unit-фикстуры на ответы HeyGen; интеграционный dry-run без реальных списаний (mock).
- [ ] Budget-guard блокирует превышение `maxCreditsPerRun` и Cinematic-авто.
- [ ] Идемпотентность: повторный прогон того же конфига не пере-генерит и не тратит credits.
- [ ] Хранение look→сцена→продукт связано с `productTwinStudioContract`.
- [ ] Webhook ИЛИ poll доводит job до `completed` + скачивание видео.
- [ ] Все секреты — только env; ничего не в коде/логах/коммитах.
- [ ] Ручные шаги (§8) вынесены в чек-лист, не в авто-пайплайн.

---

## 11. Открытые вопросы / риски

1. Точные пути/поля v2 (миграция v3) — **сверить и зафиксировать фикстуры**.
2. Есть ли публичный API у Cinematic/Seedance — если появится, перенести product b-roll из manual в api.
3. Политика consent для загруженного синтетического лица — проверить на 1-м аплоаде.
4. Лимиты free-плана (720p, объём) и реальная цена Avatar IV на нашем тарифе.
5. Стабильность идентичности между роликами при 1 фото vs train-группе — прогнать A/B.

---

## Приложение A — пример end-to-end конфига «Alina» (черновик)

```ts
const alina: BloggerConfig = {
  identity: {
    workingName: 'Alina',
    source: 'upload_own_face',
    faceImageKeys: [/* 5–8 image_key от нашего image-gen */],
    train: true,
    prompt: {
      age: 'Young Adult', gender: 'Woman', ethnicity: 'White',
      style: 'Realistic', orientation: 'vertical', pose: 'half_body',
      appearance: 'Ordinary young woman 25–34, minimal makeup, casual clothes, ' +
        'friendly but slightly skeptical, amateur selfie vibe, soft daylight, not a model, not a studio presenter.'
    },
    consentConfirmed: false, // владелец
  },
  looks: [
    { id: 'kitchen_daylight', scene: 'кухня, дневной свет', prompt: 'home kitchen, morning daylight from window, leaning on counter, selfie', orientation: 'vertical', pose: 'half_body', mode: 'api' },
    { id: 'bedroom_cardigan', scene: 'спальня, кардиган', prompt: 'cozy bedroom, soft light, knit cardigan', orientation: 'vertical', pose: 'half_body', mode: 'api' },
    { id: 'living_room_couch', scene: 'диван в гостиной', prompt: 'living-room couch, relaxed', orientation: 'vertical', pose: 'half_body', mode: 'api' },
    { id: 'bathroom_skincare', scene: 'ванная/скинкер', prompt: 'bathroom mirror, skincare context, modest framing', orientation: 'vertical', pose: 'close_up', mode: 'api' },
    { id: 'store_aisle', scene: 'магазин', prompt: 'retail store aisle, shopping, phone selfie', orientation: 'vertical', pose: 'half_body', mode: 'api' },
    { id: 'desk_corner', scene: 'уголок стола', prompt: 'home desk corner, NO monitor, NO microphone, casual', orientation: 'vertical', pose: 'half_body', mode: 'api' },
    { id: 'hallway', scene: 'прихожая', prompt: 'apartment hallway/entryway, about to go out', orientation: 'vertical', pose: 'half_body', mode: 'api' },
    { id: 'window_closeup', scene: 'у окна close-up', prompt: 'close-up by a window, natural backlight', orientation: 'vertical', pose: 'close_up', mode: 'api' },
    { id: 'balcony', scene: 'балкон (опц.)', prompt: 'small balcony, daytime', orientation: 'vertical', pose: 'half_body', optional: true, mode: 'api' },
    { id: 'car_passenger', scene: 'в машине (опц.)', prompt: 'passenger seat of a parked car, daylight, casual', orientation: 'vertical', pose: 'close_up', optional: true, mode: 'api' },
  ],
  voice: { voiceId: '<подобрать>', language: 'ru', speed: 1.0, pitch: 0, emotion: 'Friendly' },
  render: {
    engine: 'avatar_iv', aspectRatio: '9:16', resolution: '720p',
    dimension: { width: 720, height: 1280 }, captions: false,
    background: { type: 'transparent' }, music: null,
    durationMode: 'custom', durationSec: 3,
    motion: { customMotionPrompt: 'casual, natural gestures, slight skepticism', enhanceMotionPrompt: true },
    template: null, outputFormat: 'mp4',
  },
  broll: { enabled: false, referenceImageKeys: [], shotPrompt: '', mode: 'manual' },
  budget: { maxCreditsPerRun: 50, blockCinematicAuto: true },
};
```
