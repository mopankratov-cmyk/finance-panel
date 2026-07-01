# HeyGen UGC-блогер — бэклог: эпики и таски (handoff для кодер-агента)

**Дата:** 2026-07-01
**Роль этого документа:** постановка задач. ТЗ и критерии — здесь; **код пишет другой агент.**
**Ветка:** `feat/factory-v2-product-broll`
**Опорные доки:**
- Research: [factory-ugc-heygen-ui-avatar-settings-research.md](./factory-ugc-heygen-ui-avatar-settings-research.md)
- Build-spec (детальное ТЗ, типы, эндпоинты): [factory-ugc-heygen-integration-spec.md](./factory-ugc-heygen-integration-spec.md)

---

## Как это читать / правила для кодер-агента

- Порядок работы: ветка `feat/<коротко>` → правки **только в зоне завода** → `npm run dev` без ошибок → каждый эпик = маленький коммит + контракт-тест → PR в `main`.
- **Зона (можно трогать):** `lib/factory/*`, `app/api/factory/*`, `app/inferno/*` (только про блогера), `docs/factory-*`.
- **НЕЛЬЗЯ без владельца:** `package.json`/зависимости (в т.ч. `zod` — не добавлять), `.env*`/секреты, миграции/`.sql` вне согласования, авторизация/`middleware`, CI, общий код вне завода, `app/agent/page.tsx` пока с незакоммиченными правками владельца.
- **Секреты** — только через env, никогда в код/логи/коммиты.
- **Деньги/credits:** любые платные вызовы (generate/train/look/video/cinematic) — за budget-guard; Cinematic (60 cr) — только вручную/по флагу. Не жать «в проде» без подтверждения.
- **Каждый эпик закрывается контракт-тестом** `lib/factory/*Contract.test.mts` (стиль репо: `readFileSync` + `node:assert` + при возможности runtime-импорт). Запуск: `npx tsx <файл>`.
- Definition of Done эпика: код + контракт-тест зелёный + `npx tsc --noEmit` без новых ошибок + `npm run dev` поднимается.

**⚠️ Блокер на весь API-слой (сделать первым):** сверить реальные пути/поля HeyGen v2 (идёт миграция v2→v3, до 31.10.2026) и зафиксировать в фикстурах. Пока не сверено — все «endpoint» в спеке считать reference-shape.

---

## EPIC 0 — Control Plane & Config ✅ ГОТОВО (не переделывать)

Уже написано и проверено (контракт-тест зелёный, `tsc` чисто, dev поднимается). Кодер-агент **использует это как фундамент**, не переписывает.

| Артефакт | Что даёт |
|---|---|
| `lib/factory/heygenBlogger.ts` | `METRIC_REGISTRY` (единый источник метрик), типы `BloggerConfig`/`LookSpec`, `DEFAULT_BLOGGER_CONFIG` + `DEFAULT_LOOKS`, `validateBloggerConfig`, `describeMetrics`, `dimensionFor` |
| `lib/factory/heygenAgentTool.ts` | `HEYGEN_BLOGGER_TOOL`, `applyBloggerPatch`, `configToHeygenPayloads`, `isAutoRunAllowed` |
| `app/inferno/heygen-blogger/HeygenBloggerStudio.tsx` + `page.tsx` | schema-driven панель (рендер из registry), роут `307→/login` как все inferno |
| `lib/factory/heygenBloggerContract.test.mts` | контракт control-plane |

**Правило:** список метрик расширять **только** в `METRIC_REGISTRY` — UI и агент подхватят через `describeMetrics()`.

---

## EPIC 1 — HeyGen API client & catalog (S0) — фундамент интеграции

**Цель:** инертный (без ключа) HTTP-клиент к HeyGen + подтянуть каталог. Образец стиля — `lib/factory/creatify.ts`.

| Task | ТЗ / Acceptance | Файлы | Зависит |
|---|---|---|---|
| **HG-1.0 Verify endpoints** | Сверить по живым докам пути/поля v2 для: list avatars, list voices, upload asset, photo/generate, avatar_group/create+add, train(+status), look/generate, video/generate, Avatar IV, video_status, webhook. Зафиксировать в `lib/factory/__fixtures__/heygen/*.json`. Acceptance: фикстуры + короткий `docs`-changelog «что реально в v2». | `docs/…`, fixtures | — |
| **HG-1.1 Client core** | `lib/factory/heygen.ts`: `heygenReady()`, `headers()` (env `HEYGEN_API_KEY`, `null` без ключа → модуль инертен), `jget/jpost` с таймаутами и терпимым парсингом (по образцу `creatify.ts`). Никаких бросков — возвращать `{ok,status,json,error}`. | `lib/factory/heygen.ts` | HG-1.0 |
| **HG-1.2 Catalog** | `listAvatars()` → `GET /v2/avatars` (+ talking_photos), `listVoices()` → `GET /v2/voices`. Нормализовать в `{avatar_id,name,gender,age,…}` / `{voice_id,language,emotion_support}`. `heygenBalance()`/usage если есть. | `lib/factory/heygen.ts` | HG-1.1 |
| **HG-1.3 Upload Asset** | `uploadAsset(bytes, contentType)` → `image_key` (для own-face). Инертно без ключа. | `lib/factory/heygen.ts` | HG-1.1 |
| **HG-1.4 Contract test** | `heygenClientContract.test.mts`: экспорты, инертность без ключа (не падает), маппинг из фикстур. | `lib/factory/heygenClientContract.test.mts` | HG-1.2/1.3 |

---

## EPIC 2 — Identity: создание/загрузка личности (S1)

**Цель:** из `BloggerConfig.identity` собрать аватар-группу (upload / prompt / mixed) и обучить.

| Task | ТЗ / Acceptance | Файлы | Зависит |
|---|---|---|---|
| **HG-2.1 Upload group** | `source=upload_own_face/mixed`: `avatar_group/create` из `faceImageKeys[0]` + `avatar_group/add` остальными. Вернуть `group_id`. | `lib/factory/heygenIdentity.ts` | EPIC 1 |
| **HG-2.2 Prompt group** | `source=prompt_design_ai`: `photo/generate` (name/age/gender/ethnicity/orientation/pose/style/appearance) → poll генерации → создать группу. | `lib/factory/heygenIdentity.ts` | EPIC 1 |
| **HG-2.3 Train** | `train(group_id)` + poll `train/status` до `ready`. Гейт: `identity.train===true`. | `lib/factory/heygenIdentity.ts` | HG-2.1/2.2 |
| **HG-2.4 Consent gate** | Перед любым S1-вызовом с загрузкой лица требовать `identity.consentConfirmed===true`, иначе отказ с понятной ошибкой. | `lib/factory/heygenIdentity.ts` | — |
| **HG-2.5 Persist** | Таблица `heygen_blogger(group_id,name,source,trained_at,config_json)`. Идемпотентность по хэшу identity. | миграция(*), `lib/factory/…` | HG-2.3 |
| **HG-2.6 Contract test** | сценарии upload/prompt/mixed на фикстурах; consent-gate срабатывает. | `*Contract.test.mts` | выше |

(*) миграции/`.sql` — согласовать с владельцем перед применением.

---

## EPIC 3 — Looks: 10 сцен (S2)

**Цель:** сгенерить looks под обученную группу; связать `look → сцена`.

| Task | ТЗ / Acceptance | Файлы | Зависит |
|---|---|---|---|
| **HG-3.1 Generate looks (api)** | Для `looks[].mode==='api'`: `look/generate {group_id,prompt,orientation,pose,image_keys?}` → poll → `look_id`. | `lib/factory/heygenLooks.ts` | EPIC 2 |
| **HG-3.2 Persist looks** | `heygen_look(look_id,blogger_id,scene,prompt,status)`; проставить `LookSpec.lookId`. | `lib/factory/…` | HG-3.1 |
| **HG-3.3 Manual looks** | Для `mode==='manual'` (Cinematic/UI): поле в панели, куда оператор вносит готовый `look_id`; в пайплайне пропускать авто-генерацию. | `app/inferno/heygen-blogger/*`, `lib/factory/…` | EPIC 6 |
| **HG-3.4 Motion/upscale (опц.)** | `add_motion` / `upscale` для отобранных looks. | `lib/factory/heygenLooks.ts` | HG-3.1 |
| **HG-3.5 Contract test** | генерация + маппинг look→scene; manual-режим пропускается. | `*Contract.test.mts` | выше |

---

## EPIC 4 — Video generation (S3)

**Цель:** из look + скрипт + голос собрать видео (Avatar IV / Presenter) с budget-guard.

| Task | ТЗ / Acceptance | Файлы | Зависит |
|---|---|---|---|
| **HG-4.1 Avatar IV** | `engine='avatar_iv'`: photo→video (`image_key/look + script + voice_id + custom_motion_prompt + enhance`). Использовать `configToHeygenPayloads`. | `lib/factory/heygenVideo.ts` | EPIC 3 |
| **HG-4.2 Presenter** | `engine='presenter_v'`: `POST /v2/video/generate` (character/voice/background/dimension/aspect/caption). | `lib/factory/heygenVideo.ts` | EPIC 3 |
| **HG-4.3 Budget guard** | Перед вызовом — `isAutoRunAllowed(config)` + оценка credits; блок Cinematic-авто; лимит `budget.maxCreditsPerRun`; сверка с остатком аккаунта. | `lib/factory/heygenBudget.ts` | EPIC 1 |
| **HG-4.4 Persist jobs** | `heygen_video_job(video_id,look_id,engine,status,credits_est,video_url,external_ref)`; идемпотентность по `external_ref`. | `lib/factory/…` | HG-4.1/4.2 |
| **HG-4.5 Contract test** | оба движка → корректные тела; guard режет превышение/Cinematic. | `*Contract.test.mts` | выше |

---

## EPIC 5 — Status, webhooks, delivery (S4)

**Цель:** довести job до `completed`, скачать, связать с продуктом.

| Task | ТЗ / Acceptance | Файлы | Зависит |
|---|---|---|---|
| **HG-5.1 Poll status** | `video_status.get` → обновлять `heygen_video_job.status/video_url`. | `lib/factory/heygenStatus.ts` | EPIC 4 |
| **HG-5.2 Webhook receiver** | `app/api/factory/heygen/webhook/route.ts` — приём события, проверка подписи `HEYGEN_WEBHOOK_SECRET`, апдейт job. (Регистрацию вебхука в аккаунте — вручную/владелец.) | `app/api/factory/heygen/webhook/route.ts` | EPIC 4 |
| **HG-5.3 Delivery** | На `completed`: скачать `video_url` в стор завода; связать `look→сцена→продукт` через `productTwinStudioContract`. | `lib/factory/…` | HG-5.1/5.2 |
| **HG-5.4 Contract test** | poll/webhook доводят до completed; подпись проверяется. | `*Contract.test.mts` | выше |

---

## EPIC 6 — Control Plane wiring: панель ↔ API ↔ агент ↔ пресеты

**Цель:** оживить панель и agent-путь поверх EPIC 1–5 (реестр уже есть из EPIC 0).

| Task | ТЗ / Acceptance | Файлы | Зависит |
|---|---|---|---|
| **HG-6.1 Presets CRUD** | Таблица `heygen_blogger_preset(id,name,config_json,version,updated_by,updated_at)` + API `app/api/factory/heygen/preset/*` (list/get/save). | `app/api/factory/heygen/preset/*`, `lib/factory/…` | EPIC 0 |
| **HG-6.2 Панель ↔ API** | В `HeygenBloggerStudio.tsx` добавить load/save пресетов и кнопки-триггеры (create identity / gen looks / gen video) → вызовы API-роутов; логи выполнения. | `app/inferno/heygen-blogger/*`, `app/api/factory/heygen/*` | HG-6.1, EPIC 2–5 |
| **HG-6.3 Agent enqueue** | Зарегистрировать `configure_heygen_blogger` в механике флота (claude_runs/worker) — путь «агент патчит конфиг и запускает прогон» (см. память fleet-codex-dispatch). | `lib/factory/…` (+ согласование) | EPIC 0 |
| **HG-6.4 Hub link** | Добавить `href="/inferno/heygen-blogger"` в `app/agent/page.tsx` (по образцу Product Twin Studio). ⚠️ у файла были незакоммич. правки владельца — согласовать. | `app/agent/page.tsx` | — |
| **HG-6.5 Contract test** | пресет-CRUD + панель дергает нужные роуты. | `*Contract.test.mts` | выше |

---

## EPIC 7 — Ops: бюджет, drift-guard, QA

| Task | ТЗ / Acceptance | Файлы | Зависит |
|---|---|---|---|
| **HG-7.1 Usage/alert** | Метрика потраченных credits + предупреждение при приближении к балансу/лимиту прогона. | `lib/factory/heygenBudget.ts` | EPIC 4 |
| **HG-7.2 Drift-guard** | Тест сверяет enum'ы `METRIC_REGISTRY` с фикстурами живого API; падает при рассинхроне → правим registry осознанно. | `*Contract.test.mts`, fixtures | HG-1.0 |
| **HG-7.3 Operator QA** | Флоу отбора годных looks/видео (пометка approved/rejected) перед публикацией. | `app/inferno/heygen-blogger/*` | EPIC 3–5 |

---

## Порядок / зависимости (критический путь)

```
HG-1.0 (verify)  →  EPIC 1 (client)  →  EPIC 2 (identity)  →  EPIC 3 (looks)  →  EPIC 4 (video)  →  EPIC 5 (delivery)
                                    ╲                                   ╲
                                     EPIC 6 (wiring, поверх 1–5)         EPIC 7 (ops, параллельно с 4–5)
EPIC 0 — ГОТОВО (фундамент для всех)
```

**Рекомендуемый первый спринт:** HG-1.0 → HG-1.1 → HG-1.2 → HG-6.4 (линк) → HG-6.1 (пресеты). Даёт живой каталог + сохранение конфигов, ещё без платных генераций.

---

## Что нужно от владельца (разблокировать таски)
- Доступ к API-ключу «для завода» кодер-агенту (env). [все API-таски]
- Решение по этносу/внешности Alina, языку/`voice_id`. [EPIC 2/4]
- Ок на миграции БД (`heygen_*` таблицы). [HG-2.5, 3.2, 4.4, 6.1]
- Ок на top-up бюджета перед первыми платными прогонами. [EPIC 2–4]
- Ок на правку `app/agent/page.tsx`. [HG-6.4]

## Оценки (грубо, для планирования; S≈полдня, M≈1–2 дня, L≈3+)
EPIC 1: M · EPIC 2: M · EPIC 3: M · EPIC 4: M · EPIC 5: M · EPIC 6: L · EPIC 7: S–M · HG-1.0: S (но блокер).
