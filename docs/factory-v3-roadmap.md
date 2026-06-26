# V3 Завод — дорожная карта генерации (вердикт совета советов)

**Дата:** 2026-06-21 · **Источник:** «совет советов» (11 агентов: 3 генератора вариантов + синтез → 5 советов → 2 независимых мета-синтеза). Два мета сошлись.
**Связано:** [factory-v3-tz.md](factory-v3-tz.md), [factory-viral-plan.md](factory-viral-plan.md), [factory-shotstack-tz.md](factory-shotstack-tz.md). Память: `factory-v3-node-studio`.

> Историческая заметка на 2026-06-26: документ ниже полезен как roadmap и reasoning trail, но часть исходных дыр уже закрыта в текущем runtime.
>
> - V1 больше не “голый toast”: `public/inferno/studio.html` уже шлёт `POST /api/factory/winners` и `POST /api/factory/reject` из экрана сборки.
> - V10 закрыт в текущем Studio/graph-run path: оператор закрепляет `preview_url + preview_hash`, Studio сохраняет это сразу через `node-save`, а `graph-run` сверяет `nodeHash` и берёт готовый клип без повторной оплаты FAL.
> - V8 закрыт не только промптом, но и guard-логикой: `decompose` после ответа модели принудительно переводит роли `problem|solution|proof` на `disk_real`, кроме явных AI-акцентов `talking_head|before_after|voiceover`.
> - V2 закрыт как безопасный skeleton transfer: winner-пресеты сохраняют production prompt, а decompose-перенос получает черновик с product scope и запретом дословного копирования конкурента.
> - V5 больше не “мёртвая таблица”: `public/inferno/studio.html` уже шлёт `POST /api/factory/post-metrics`, а route умеет fail-open forward в `winners`.
> - V18-1 закрыт: Studio не показывает `patrick`/`text` legacy entry points в навигации; файлы оставлены для прямого URL до отдельного V18-2.
> - V11 закрыт на UI + backend contract: запуск через библиотеку и экран сборки считает смету по нодам, блокирует старт при явном `balances.low`, а `/graph-run` и `run_plan` теперь возвращают `cost_hint` с typical/worst-case USD.
> - V7 закрыт в текущем read-back контуре: `learningHints` возвращает winners + corpus hooks + reject anti-patterns в `decompose`/`autofill`, а `video-critic` читает reject anti-patterns fail-open.
> - V20 больше не “таблицы нет совсем”: `generation_history` уже пишется из `gen-save`, `node-preview`, `graph-run` clip persistence, `reject`, `media-store` и static Remotion path; read-path и learn-screen тоже уже выдают warning/lineage-контекст. Открытый хвост V20 сейчас уже не в самом наличии истории, а в том, что repo-local `scripts/*` по-прежнему обходят БД и находятся вне Railway worker мандата.
> - V3/V4 подготовлены безопасно: OTK→culprit-regeneration и `/improve-prompt` wiring живут в `graphRun`, но включаются только через `FACTORY_OTK_REGEN=1`; default остаётся Sprint-1 fail-open, чтобы не вернуть бесконтрольные платные циклы.
> - V9 частично возвращён без риска: `/hook-judge` теперь детерминированно ранжирует уже переданные hooks по эвристике + `viral_hooks` corpus, без LLM/рендера/авто-запуска. Генератор `/variations` остаётся disabled до отдельного стабильного этапа.
> - V5 усилен без утяжеления UI: `/post-metrics` по-прежнему принимает простой ручной market-input, но в `/winners` теперь уходит полный `market_signal` (`platform`, `views`, `watch_rate`, `ctr_card`, `saves`, `posted_at`), чтобы learning loop не терял retention/CTR/save context.
> - V6 подготовлен как read-only market guard: `/ab-rank` уже ранжирует реальные `post_metrics`, но не называет “winner” до минимального порога просмотров (`min_winner_views`, default `100`), чтобы не масштабировать случайный шум.
> - V14 имеет защищённый MVP-substrate: `/winners` снимает winner-рецепт в `node_templates`, а sanitization вынесена в `winnerPreset` и тестом запрещает перенос `preview_url/preview_hash` в новые рецепты.
> - V17 частично закрыт без нового extract-сервиса: auto-bind теперь читает `content_assets.duration_sec` и переносит известную длительность real video в `RunNode.duration_sec`, чтобы сборка/trim не откатывались к дефолтным 5с там, где каталог уже знает правду.
> - V12 закрыт как честный planning preview, а не WYSIWYG-обман: экран сборки до платного `graph-run` показывает бесплатную автораскладку таймлайна по длительностям нод; guard-тест запрещает потерять этот pre-render preview.
> - V16 начат как read-only learning panel: `/api/factory/learning` отдаёт `market_summary` из `post_metrics`, Studio показывает реальные просмотры/retention/CTR/saves/top recipes и простой `ОТК vs рынок` alignment без авто-апгрейда winners.

## Диагноз (единодушный, проверен по коду)

Завод **технически почти замкнут** (self-chaining-машина graphRun работает), но **стратегически разомкнут в двух точках**:

1. **Человеческое одобрение было оборвано** на момент исходного аудита, но в текущем repo-truth уже замкнуто через `sendWinner()` / `sendReject()` в `public/inferno/studio.html`.
2. **Рыночный сигнал был не зафиксирован** на момент исходного аудита, но сейчас в студии и библиотеке уже есть ручной `post-metrics` вход. Открытый хвост здесь не “таблица мёртвая”, а “реальных метрик всё ещё мало и ввод пока в основном ручной”.

Плюс деньги текут в 3 местах: двойная оплата fal (превью платит → сборка платит снова), банк-несмотря-на-ОТК (`graphRun.ts:310-312`), слепой старт без сметы/гарда баланса.
Плюс **память итераций уже собрана частично** (см. V20), но standalone/local тестовые прогоны всё ещё могут уходить мимо БД.

## Вердикт по вариантам (now / next / later / reject)

### 🔥 СЕЙЧАС — «вернуть сигнал + закрыть течи» (готовый бэкенд, S/M, near-zero риск)
| ID | Что | Усилие | Точка в коде |
|----|-----|--------|--------------|
| **V1** | Замкнуть «Беру/Не то» → `/winners` + причины реджекта в `cf_signals` (+понижать provenance ноды-виновника) | S | Статус на 2026-06-26: **done in V3 studio** (`sendWinner()` / `sendReject()`) |
| **V10** | Превью-клип закрепляется через `preview_url + preview_hash`; `graph-run` сверяет `nodeHash` и не платит FAL повторно. | S | `public/inferno/studio.html`, `lib/factory/graphRun.ts`, `/node-save` |
| **V8** | Reality-first дефолты в `decompose`: `problem|solution|proof` принудительно становятся `disk_real`, AI остаётся только явным акцентом. | S | `lib/factory/decomposeRouting.ts`, `app/api/factory/decompose/route.ts` |
| **V2** | Предзаполнить ноды при переносе как **черновик-скелет**: product scope + reference meaning + anti-copy guard; winner prompts не трогаются. | S | `lib/factory/recipeDraft.ts`, `app/api/factory/recipes/route.ts` |
| **V11** | Смета + блок старта при `balances.low`; **демо-цифры у запуска убраны**; backend `cost_hint` возвращается из `/graph-run` и переиспользуется batch budget guard. | M · done | `public/inferno/studio.html`, `lib/factory/costEstimate.ts`, `/graph-run`, `/batch` |

### ➡️ СЛЕДУЮЩИМ
| ID | Что | Усилие |
|----|-----|--------|
| **V5** | Контур постинг→метрики: статус `posted` + ОДНО поле на карточке Библиотеки → `/post-metrics` → `/winners`. **Практический MVP закрыт**: ручной ввод уже есть, backend сохраняет/forward’ит полный market-snapshot; открытый хвост — только автоподтягивание платформенных метрик. | M · done-manual |
| **V3** | ОТК-петля regen-on-fail в graph-run: включается только флагом `FACTORY_OTK_REGEN=1`, регенерирует одну culprit-ноду и уважает `MAX_RENDERS=3`; default fail-open. | M · gated |
| **V4** | `/improve-prompt` перед регенерацией теперь сидит в `graphRun.regenCulprit`; активируется только вместе с V3-флагом. | M · gated |
| **V7** | Читать сигнал обратно в `decompose`/критика: `learningHints` = winners + corpus hooks + reject anti-patterns; `video-critic` читает reject anti-patterns fail-open. | M · done |
| **V9** | Хук-турнир: безопасный `/hook-judge` включён как deterministic ranker по переданным hooks + corpus; `/variations` и авто-превью остаются выключены до отдельного этапа. | M · partial |
| **V20** | **История генераций / память итераций** — базовый субстрат уже в коде; `media-store` и static Remotion path пишут history. Открытый хвост: repo-local `scripts/*` и richer compare/fork UX. | M · partial |
| **V18-1** | Спрятать ссылки на legacy из Studio-навигации; файлы не трогать. | S · done |

### 🕓 ПОЗЖЕ
- **V6** — реальные метрики авто-апгрейдят winner. Подготовлено read-only: `/ab-rank` ранжирует рынок с `min_winner_views`, но автоматический апгрейд оставлен на отдельный шаг с ручным подтверждением.
- **V16** — дашборд петли обучения. Частично закрыто read-only: экран `Обучение` уже показывает market summary и `ОТК vs рынок`; полный win-rate по нише, cohort-корреляции и auto-advice остаются later.
- **V14** — winner-рецепт → пресет ниши. MVP-substrate закрыт: `/winners` создаёт `from_winner` preset, transfer читает production prompt/settings, volatile preview refs очищаются тестируемой sanitization.
- **V12** — превью СБОРКИ до платного Shotstack-рендера. Закрыто в MVP как planning preview: бесплатный таймлайн по нодам до `startRun()`, без обещания pixel-perfect финала.
- **V17** — бэкфилл реальных длительностей disk_real. Частично закрыто: известный `content_assets.duration_sec` больше не теряется при auto-bind; полноценный ffprobe/fal-extract backfill остаётся later.
- **V13** — Remotion ReelV5 как финал-движок (openreels Фаза 4). ⚠️ **НЕ «параметризовать пропсы»**: `@remotion/lambda` = отдельная AWS-инфра (Vercel без ffmpeg/chromium), base-rate переписки 60%+. Только после замкнутой петли, с флагом отката на Shotstack.
- **V15** — openreels `<артикул>` один-клик (вершина пирамиды на V14+V2+V8+V3; раньше фундамента = масштабирование слопа).
- **V18-2** — удалить patrick/product.html. **Строго после V1+V4+V7** (legacy держит единственные живые вызовы winners/improve-prompt/winnersHint).

### ❌ ОТКЛОНИТЬ (пока)
- **V19** — разбор+сборка каруселей/статик. Новый формат, не лечит ни одну дыру разомкнутой видео-петли. Пересмотреть после замыкания ядра.

## V20 — История генераций / память итераций (детально)

**Статус на 2026-06-26:** базовая память итераций уже существует и работает в основном factory path.

Что уже закрыто:
- `generation_history` пишется из `gen-save` на success/dedupe/race/failure/carousel путях;
- `node-preview` пишет cache-hit, instant done и async done;
- `graph-run` пишет lineage для durable clip success/dedupe/failure;
- `reject` оставляет history row с причиной;
- `learning` и `/api/factory/generation-history` уже умеют fail-open warning contract, а learn-screen показывает lineage bits (`recipe_id`, `attempt`, `variant_idx`, `reason`, `article`).

Что всё ещё открыто:
- **Standalone мимо БД:** repo-local `scripts/render-local.mjs`, `scripts/stills.mjs` и `scripts/creatify-*.mjs` по-прежнему могут складывать артефакты в `out/` без записи в БД. Это вне текущего Railway worker мандата (`scripts/` не входит в разрешённую factory-зону), поэтому следующий шаг требует отдельного owner-approved scope.
- **Richer lineage UX:** есть лента попыток, но ещё нет полноценного compare/fork view “что изменили между try 1 → try 2”.
- **Source unification:** часть локальных/ручных render path ещё не проходит через единый `media-store` / history sink.

**Следующий шаг (M):** довести standalone/локальные render path до общего history sink (`media-store` / `generation_history`) и затем уже решать compare/fork UX поверх существующего журнала.

**Эффект:** основа для “ролик → 3 итерации → на 2-й починили руки, ОТК 4→6 → финал” уже есть. Оставшийся разрыв — не в таблице как таковой, а в консистентности записи всех ручных/standalone попыток.

## Ключевые конфликты и разрешения

1. **Сигнал-первый vs деньги-первый** — ложная дилемма (все S, разные файлы): оба в NOW.
2. **V3 рано или после метрик?** — NEXT, в связке с V7-калибровкой; `otk→submit` обязан декрементить `MAX_RENDERS`.
3. **V13 Remotion «пропсы» vs инфра-переписка** — это инфра (Lambda/раннер), base-rate 60%+ → LATER, после доказанной петли.
4. **V5 ручной ввод vs мёртвая обуза** — критичен, но успех = функция трения ввода: ОДНО поле + нудж, или авто-Virlo-tracking; сначала доказать поступление, потом надстройки.

## Девилз-адвокат (сильнейшее возражение)

> А есть ли вообще хоть один органически залетевший ролик с **этого** завода? Если нет — весь список это полировка непроверенного конвейера.

**Ответ:** V1+V5 ровно и превращают «выложи 20 роликов руками» в **измеримый эксперимент** вместо вкусовщины → поэтому V5 двигается к NOW-адъюнкту, а L-треки качества (V13) и масштаба (V15) — преждевременны.

## Связь с планом владельца (openreels, из параллельной сессии)

План владельца (#1 параметризация ReelV5 → #2 openreels-оркестратор → #3 гейт артефактов → #4 авто-ОТК → #5 хук-турнир → #6 петля обучения) = **правильный пункт назначения** (openreels Фаза 1→4), но **порядок обратный совету**: #1/#2 = это V13/V15, которые совет поставил LAST и риском. Рекомендованная склейка: дешёвый NOW-пакет (V1/V10/V8/V2/V11) + V20-субстрат + ранний V5 идут **раньше/параллельно** #1/#2; #1 как движок завода — последним (инфра-риск). #5 хук-турнир из Virlo-корпуса и #6 авто-Virlo-tracking — **сильнее** базовых V9/V5.

## Честные ограничения (заложить)
- Creatify-ключи `Sensitive` в Vercel (рантайм юзает; засвеченные перевыпустить).
- Точный синк RU-капшенов → Whisper-ASR для word-timestamps (Creatify-TTS их не даёт).
- Потолок AI-футажа → «слот реального футажа» в брифе (reality-first, V8).
- Ключи API вводит владелец в Vercel (не в гит); без ключей эндпоинты мягко деградируют.
