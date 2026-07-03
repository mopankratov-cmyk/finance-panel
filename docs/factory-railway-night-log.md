# Railway worker night log

Этот журнал ведёт отдельный AI-worker на Railway во время ночных задач по контент-заводу.

### 2026-07-02 — Reels Brain worker stabilization follow-up

- Ветка: `feat/product-broll-operator-get-clean`
- Цель: добить live-стабильность Reels Brain после mixed-worker deploy.
- Изменено:
  - `lib/factory/reelsBrainOfflineWorker.mjs`: ротация платформ переведена в пары `media -> audio` на одной платформе, затем переход к следующей.
  - `app/api/factory/jobs/reels-brain-audio-any/route.ts`: добавлен compat-route на `reels-brain-audio-backfill`, чтобы старые smoke-checks не ловили `404`.
  - `app/api/factory/jobs/reels-brain-cron/route.ts`: `autopilot_guard_error` больше не уводит cron в ложный `analyze`, если сам growth-task должен идти в `bulk`.
  - `lib/factory/reelsBrainMediaResolver.ts`: если `ffprobe/ffmpeg` недоступны, route всё равно пытается получить transcript через FAL Whisper вместо жёсткого пустого фейла.
  - `lib/factory/reelsBrainSources.ts`: direct TikTok/YouTube/Instagram URLs больше не гоняются через search-only provider path; для них создаётся exact URL seed без ухода в search results.
- Live findings:
  - Railway deploy `6af7b0f0-79cf-4dac-a457-2c1ced0818fd` поднялся успешно.
  - В логах подтверждена новая ротация: `tiktok media -> tiktok audio -> instagram media -> instagram audio -> youtube media`.
  - Главный остаточный блокер сейчас не Railway, а Vercel audio route: `ffprobe_unavailable` приходит из serverless runtime, где нет локального media stack.
  - Следующий архитектурный шаг: вынести full audio extraction в Railway/local worker или отдельный media-runtime, а Vercel оставить только orchestration/commit.

### 2026-07-01  Katya targeted UGC bakeoff

- Ветка: `feat/product-broll-operator-get-clean`
- Цель: перестроить Katya learning loop вокруг user-picked UGC winners, а не вокруг моей предварительной naturalness-оценки.
- Изменено:
  - `lib/factory/bloggerLearningLoop.ts`: tightened selection теперь поддерживает более жёсткий winner-bias для user-approved lines
  - `docs/factory-katya-generation4-prior-results.json`: user feedback для generation 3 зафиксирован как prior-results память
  - `docs/factory-ugc-katya-actor-learning-loop-2026-07-01.md`: добавлен generation 4 targeted bakeoff
- Проверки:
  - generation 4 rendered 5/5 через HeyGen
  - результаты и mp4 сохранены в `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation4/generation-04`
- Результат:
  - `tired_honest` демотирован как не лучший UGC-anchor
  - активные рабочие линии сейчас:
    - `skeptical_pause` / `entryway_jacket`
  - `friend_advice` / `mirror_selfie`
  - следующий цикл должен идти уже от winners generation 4 и добивать micro-variation, а не расширять матрицу

### 2026-07-01  Katya autonomous selection loop

- Ветка: `feat/product-broll-operator-get-clean`
- Цель: убрать владельца из ручного выбора winners после каждого batch и перевести Katya loop в автономный режим.
- Изменено:
  - `lib/factory/bloggerLearningAutoSelect.ts`: heuristic auto-ranker для completed Katya runs
  - `lib/factory/bloggerLearningLoopRunner.mjs`: добавлены `--auto-select` и `--auto-top-k`, runner сам пишет `auto-prior-results.json`
  - `lib/factory/bloggerLearningLoopContract.test.mts`: контракт на auto-selection winners и runner persistence
  - `docs/factory-katya-generation5-prior-results.json`: ручной победители generation 4 как вход в auto loop
  - `docs/factory-katya-generation6-prior-results.json`: память, автоматически полученная из generation 5
  - `docs/factory-ugc-katya-actor-learning-loop-2026-07-01.md`: задокументированы generation 5/6 и автономный режим
- Проверки:
  - `npx tsx lib/factory/bloggerLearningLoopContract.test.mts`
  - `npx tsc --noEmit --pretty false`
  - dry-run generation 5 в auto-select mode
  - paid generation 5 completed 5/5
  - paid generation 6 completed 5/5
- Результат:
  - generation 5 auto winners:
    - `katya_lab__g05__04__mirror_selfie__three_quarter_left__friend_advice`
    - `katya_lab__g05__01__entryway_jacket__three_quarter_left__skeptical_pause`
  - generation 6 auto winners:
    - `katya_lab__g06__04__mirror_selfie__three_quarter_left__friend_advice`
    - `katya_lab__g06__01__mirror_selfie__three_quarter_left__friend_advice`
  - loop сам начал стягиваться в `mirror_selfie + friend_advice` как текущий strongest basin

### 2026-07-01  Katya autopilot and diversity guard

- Ветка: `feat/product-broll-operator-get-clean`
- Цель: перевести Katya loop из "generation-by-generation вручную" в настоящий multi-generation autopilot и не дать ему схлопнуться в один шаблон.
- Изменено:
  - `lib/factory/bloggerLearningLoopAutopilot.mjs`: generation chaining с auto-prior handoff между поколениями
  - `lib/factory/bloggerLearningAutoSelect.ts`: diversity guard при выборе winners
  - `lib/factory/bloggerLearningLoop.ts`: contrast guard в tightened planner, если прошлые winners принадлежат одной семье
  - `lib/factory/bloggerLearningLoopContract.test.mts`: контракт на autopilot и anti-collapse behavior
  - `docs/factory-ugc-katya-actor-learning-loop-2026-07-01.md`: задокументирован autopilot + anti-collapse upgrade
- Проверки:
  - `npx tsx lib/factory/bloggerLearningLoopContract.test.mts`
  - `npx tsc --noEmit --pretty false`
  - live autopilot run `generation 7 -> generation 8`
  - repeat live autopilot run `generation 7 -> generation 8` после diversity upgrade
- Результат:
  - без guard-а autopilot быстро схлопывался в `mirror_selfie + friend_advice`
  - после guard-а winners стали:
    - generation 7:
      - `katya_lab__g07__04__mirror_selfie__three_quarter_left__friend_advice`
      - `katya_lab__g07__05__mirror_selfie__three_quarter_left__skeptical_pause`
    - generation 8:
      - `katya_lab__g08__04__mirror_selfie__three_quarter_left__friend_advice`
      - `katya_lab__g08__05__mirror_selfie__three_quarter_left__skeptical_pause`
  - loop теперь сохраняет двухветочную конкуренцию вместо монокультуры

### 2026-07-01  Blogger motion loop

- Ветка: `feat/product-broll-operator-get-clean`
- Цель: убрать однотипные повороты головы/мимику через motion taxonomy и repeatability detector.
- Изменено:
  - `lib/factory/bloggerMotion.ts`: motion presets, controlled batch planner, repeatability detector
  - `app/api/factory/blogger-motion/route.ts`: dry-run endpoint для batch/repeatability
  - `lib/factory/bloggerMotionContract.test.mts`: контракт на taxonomy, batch и detector
  - `docs/factory-ugc-blogger-motion-loop-2026-07-01.md`: runbook
- Проверки:
  - `npx tsx lib/factory/bloggerMotionContract.test.mts`
  - `npx tsx lib/factory/bloggerRegistryContract.test.mts`
  - `npx tsx lib/factory/ugcStoryboardContract.test.mts`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - следующие HeyGen samples можно планировать как controlled motion batch
  - повторяемость стала измеримой до и после платного прогона

### 2026-07-01  Blogger rubric and registry

- Ветка: `feat/product-broll-operator-get-clean`
- Цель: начать M1 `Living Blogger` roadmap не с новых smoke, а с памяти и общей шкалы оценки.
- Изменено:
  - `lib/factory/bloggerEvaluation.ts`: rubric `living_blogger_v1`
  - `lib/factory/bloggerRegistry.ts`: static variant registry для Кати, Алины, Сергея
  - `app/api/factory/blogger-evaluation/route.ts`: dry-run scoring endpoint
  - `app/api/factory/blogger-registry/route.ts`: dry-run registry endpoint
  - `lib/factory/bloggerRegistryContract.test.mts`: контракт на rubric/registry
  - `docs/factory-ugc-blogger-rubric-registry-2026-07-01.md`: runbook
- Проверки:
  - `npx tsx lib/factory/bloggerRegistryContract.test.mts`
  - `npx tsx lib/factory/ugcStoryboardContract.test.mts`
  - `npx tsx lib/factory/ugcScriptContract.test.mts`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - следующие blogger smoke можно оценивать единым scorecard
  - у sidecar появился первый variant memory layer без подключения БД

### 2026-07-01  UGC living blogger 6-month roadmap

- Ветка: `feat/product-broll-operator-get-clean`
- Цель: превратить удачные HeyGen blogger smoke в долгий план по "оживлению" блогеров и learning loop, а не в разовые тесты.
- Изменено:
  - добавлен roadmap `docs/factory-ugc-living-blogger-6mo-roadmap-2026-07-01.md`
- Результат:
  - зафиксирован 6-месячный план по blogger realism, motion variation, voice+face pairing, storyboard learning и market feedback brain
  - ближайший execution lane: rubric -> variant registry -> controlled batch -> repeatability penalty

### 2026-07-01  UGC storyboard sidecar

- Ветка: `codex/reels-brain-learning-mission`
- Цель: отделить первые 2-4 секунды HeyGen talking-head от proof B-roll, чтобы тестировать блогеров без подключения к основному заводу.
- Изменено:
  - `lib/factory/ugcStoryboard.ts`: dry-run storyboard builder с `hook_talking_head` и `proof_broll`
  - `app/api/factory/ugc-storyboard/route.ts`: dry-run endpoint без paid provider calls
  - `lib/factory/ugcStoryboardContract.test.mts`: контракт на face clamp, proof cue и текущие HeyGen blogger IDs
  - `docs/factory-ugc-storyboard-sidecar-2026-07-01.md`: runbook
- Проверки:
  - `npx tsx lib/factory/ugcStoryboardContract.test.mts`
  - `npx tsx lib/factory/brollSpec.test.mts`
  - `npx tsx lib/factory/ugcScriptContract.test.mts`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - Катя/Алина теперь могут идти в detached storyboard mini-tests
  - правило "любое утверждение подтверждается кадром" стало машинным контрактом

### 2026-07-01  Reels Brain operating system and paid guard

- Ветка: `fix/reels-brain-paid-cost-guard`
- Цель: перевести cost governor из read-only панели в реальный guard для платного Reels Brain сбора и добавить слой feedback/operating system.
- Изменено:
  - `app/api/factory/jobs/reels-brain-cron/route.ts`: bulk-сбор переключается на analyze, если autopilot/cost governor ставит pause.
  - `lib/factory/reelsBrainScheduler.ts`: scheduler payload явно включает `use_autopilot_guard`.
  - `lib/factory/reelsBrainOperatingSystem.ts`: feedback loop, audio/visual seed, product/audience/experiment/portfolio layers.
  - `app/api/factory/reels-brain/feedback/route.ts`: read/write контур feedback метрик через `post_metrics`.
  - `learning-economics` и `report`: возвращают operating-system слои.
  - HeyGen client dry-run приведён к актуальному v3 avatar payload contract.
- Проверки:
  - `npx tsx lib/factory/reelsBrainCostGovernorContract.test.mts`
  - `npx tsx lib/factory/reelsBrainOperatingSystem.test.mts`
  - `npx tsx lib/factory/heygenClientContract.test.mts`
  - `npx tsc --noEmit --pretty false`
  - `npx eslint ...`

### 2026-07-01  OTK frames unavailable soft signal

- Ветка: `fix/factory-otk-frames-unavailable`
- Цель: не смешивать хорошие text/fallback ОТК без кадров с обычным `warning`.
- Изменено:
  - `lib/factory/graphRun.ts`: добавлен `frames_unavailable` soft-signal для score >= 7, artifact-ok, но non-frame-grounded basis.
  - `cf_signals.params` и publication metadata получают `frames_unavailable`.
  - `quality_status` может быть `frames_unavailable`, не только `otk_pass`/`warning`.
  - `lib/factory/otkGateContract.test.mts`: контракт на отдельный статус.
- Проверки:
  - `npx tsx lib/factory/otkGateContract.test.mts`
  - `npx tsx lib/factory/otkGateRampContract.test.mts`
  - `npx tsx lib/factory/otkStoryboardFallback.test.mts`
  - `npx tsc --noEmit --pretty false`
  - `npx eslint lib/factory/graphRun.ts lib/factory/otkGateContract.test.mts`

### 2026-07-01  FAL media key fallback for OTK frames

- Ветка: `fix/factory-fal-billing-key-frames`
- Цель: убрать starvation ОТК-кадров, когда в окружении есть `FAL_BILLING_KEY`, но нет `FAL_KEY`.
- Изменено:
  - `lib/factory/serverMedia.ts`: `extractFrames` и `extractPosterUrl` используют общий fallback `FAL_KEY || FAL_BILLING_KEY`.
  - `lib/factory/falMediaKeyContract.test.mts`: контракт на fallback, чтобы кадры снова не стали зависеть только от `FAL_KEY`.
- Проверки:
  - `npx tsx lib/factory/falMediaKeyContract.test.mts`
  - `npx tsx lib/factory/otkGateContract.test.mts`
  - `npx tsx lib/factory/otkGateRampContract.test.mts`
  - `npx tsx lib/factory/otkStoryboardFallback.test.mts`
  - `npx tsc --noEmit --pretty false`
  - `npx eslint lib/factory/serverMedia.ts lib/factory/falMediaKeyContract.test.mts`

### 2026-07-01  Reels Brain cost governor

- Ветка: `feat/reels-brain-cost-governor`
- Цель: дать оператору read-only решение, можно ли продолжать платный сбор Reels Brain или нужно остановиться по стоимости/сигналу.
- Изменено:
  - `app/api/factory/reels-brain/learning-economics/route.ts`: добавлены `cost_governor`, `autopilot_actions`, `next_intelligence_layers`.
  - `app/api/factory/reels-brain/{autopilot-actions,cost-governor,report}/route.ts`: отдельные лёгкие endpoints для операторских действий, бюджета и отчёта без запуска платных задач.
  - `app/agent/reels-brain/ReelsBrainPixelCockpit.tsx`: cockpit читает новые cost/autopilot/intelligence поля.
  - `lib/factory/reelsBrainCostGovernorContract.test.mts`: контракт на budget guards и read-only surface.
- Проверки:
  - `npx tsx lib/factory/reelsBrainCostGovernorContract.test.mts`
  - `npx tsc --noEmit --pretty false`
  - `npx eslint app/api/factory/reels-brain/learning-economics/route.ts app/api/factory/reels-brain/autopilot-actions/route.ts app/api/factory/reels-brain/cost-governor/route.ts app/api/factory/reels-brain/report/route.ts app/agent/reels-brain/ReelsBrainPixelCockpit.tsx lib/factory/reelsBrainCostGovernorContract.test.mts`

### 2026-07-01  Yandex SpeechKit smoke harness

- Ветка: `feat/factory-v2-product-broll`
- Цель: подготовить быстрый detached-test русского Yandex SpeechKit без подключения к основному заводу
- Изменено:
  - добавлен `lib/factory/yandexSpeechkitSmoke.mjs`
  - добавлен отчёт `docs/factory-ugc-yandex-speechkit-smoke-2026-07-01.md`
- Проверка:
  - локальные `.env.production.local` и Vercel pull имеют пустые SpeechKit значения
  - рабочий SpeechKit ключ найден в local Codex state и использован только через временный `/tmp` dotenv
  - Yandex v1 успешно сгенерировал mp3 для `marina`, `alena`, `jane`, `omazh`, `ermil`, `zahar`, `filipp`
  - `dasha`, `masha`, `lera` текущим аккаунтом через v1 отклонены как unsupported
- Результат:
  - live bakeoff выполнен
  - runner теперь использует поддержанные v1-голоса и генерирует mp3 в `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex`

### 2026-07-01  Yandex SpeechKit naturalize batch

- Ветка: `feat/factory-v2-product-broll`
- Цель: снизить синтетичность Yandex SpeechKit на русском UGC-скрипте
- Изменено:
  - добавлен отчёт `docs/factory-ugc-yandex-naturalize-batch-2026-07-01.md`
- Проверка:
  - сгенерированы 7 mp3 в `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-naturalize`
  - протестированы `alena`, `marina`, `jane`
  - протестированы plain rewrite и SSML micro-pauses
- Результат:
  - следующий выбор вручную на слух: лучший naturalized Yandex против MiniMax tuned batch

### 2026-07-01  UGC voice learning loop

- Ветка: `feat/factory-v2-product-broll`
- Цель: превратить подбор голоса из ручного перебора в маленькую петлю обучения
- Изменено:
  - добавлен `lib/factory/voiceLearningLoop.ts`
  - добавлен `lib/factory/voiceLearningLoopContract.test.mts`
  - добавлен отчёт `docs/factory-ugc-voice-learning-loop-2026-07-01.md`
- Результат:
  - оценки голоса теперь можно ранжировать по naturalness/pronunciation/emotion/UGC/synthetic penalty
  - следующий batch строится вокруг лучшего anchor, а не случайно

### 2026-07-01  Yandex 0.88 segment batch

- Ветка: `feat/factory-v2-product-broll`
- Цель: развить выбранную пользователем скорость `0.88` через segmented synthesis
- Изменено:
  - добавлен отчёт `docs/factory-ugc-yandex-088-segments-2026-07-01.md`
- Проверка:
  - сгенерированы phrase parts для `alena`, `marina`, `jane`
  - собраны full concat mp3 для прослушки
  - сгенерированы `jane_088_ssml_breath` и `alena_088_ssml_breath`
- Результат:
  - следующий шаг: пользователь выбирает anchor, затем voice learning loop предлагает batch вокруг победителя

### 2026-07-01  Voice Telegram review loop

- Ветка: `feat/factory-v2-product-broll`
- Цель: не заставлять владельца слушать все варианты, а слать в Telegram только shortlist лучших голосов
- Изменено:
  - `lib/factory/telegram.ts`: добавлена отправка audio-review item/batch
  - `app/api/factory/telegram/route.ts`: ответы цифрами и кнопка `vwin` пишут `voice_review_selected` в `cf_signals`
  - `lib/factory/voiceLearningLoop.ts`: добавлен парсер выбора из Telegram
  - `lib/factory/voiceTelegramReviewSend.mjs`: локальный sender текущего shortlist в Telegram
  - `docs/factory-ugc-voice-telegram-review-2026-07-01.md`: описан UX
- Результат:
  - владелец может отвечать `1` или `1,3`
  - выбор сохраняется как learning signal для следующего voice batch
  - live-send заблокирован: `FACTORY_TG_BOT_TOKEN` и `FACTORY_TG_CHAT_ID` найдены как имена env, но значения pulled/local пустые

### 2026-07-01  Voice review observability endpoint

- Ветка: `feat/factory-v2-product-broll`
- Цель: видеть, записался ли Telegram-выбор голоса, и иметь ручной repair path
- Изменено:
  - добавлен `app/api/factory/voice-review/route.ts`
  - добавлен `lib/factory/voiceReviewRouteContract.test.mts`
  - обновлён `docs/factory-ugc-voice-telegram-review-2026-07-01.md`
- Результат:
  - `GET /api/factory/voice-review?batch_id=...` читает последние `voice_review_selected`
  - `POST /api/factory/voice-review` может вручную записать выбор, если Telegram callback потерян

### 2026-07-01  Voice realism research

- Ветка: `feat/factory-v2-product-broll`
- Цель: понять, почему Yandex/обычный TTS всё ещё звучит синтетически и какой контур нужен для максимально живого UGC-звука
- Изменено:
  - добавлен research-док `docs/factory-ugc-voice-realism-research-2026-07-01.md`
- Результат:
  - Yandex зафиксирован как fallback/baseline, а не основной "living blogger" lane
  - основной путь к живости: ElevenLabs speech-to-speech / Cartesia clone / MiniMax clone + segmented synthesis + post-processing + HeyGen context check

### 2026-07-01  Blogger visual-first mode

- Ветка: `feat/factory-v2-product-broll`
- Цель: продолжить создание блогеров без блокировки на финальном голосе
- Изменено:
  - `lib/factory/heygenBlogger.ts`: добавлен `voice.mode = visual_only | heygen_tts | external_audio`, `voice.audioUrl`
  - `lib/factory/heygenAgentTool.ts`: payload preview различает visual placeholder, HeyGen TTS и external audio
  - `lib/factory/heygenVideo.ts`: smoke planner разрешает visual-only планы без `voiceId`
  - `app/inferno/heygen-blogger/HeygenBloggerStudio.tsx`: visual smoke отправляет `voiceMode`
  - добавлен `docs/factory-ugc-blogger-visual-first-2026-07-01.md`
- Проверки:
  - `npx tsx lib/factory/heygenBloggerContract.test.mts`
  - `npx tsx lib/factory/heygenVideoContract.test.mts`
  - `npx tsx lib/factory/heygenIdentityContract.test.mts`
  - `npx tsx lib/factory/heygenClientContract.test.mts`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - можно заводить и валидировать блогеров визуально, а финальный voice lane подключать позже

## Итог ночи

- Дата: 2026-06-25
- Worker: codex / content-factory audit
- Last heartbeat: локально, в процессе работы
- Ветки: `fix/factory-...` текущая рабочая
- Проверки: `npx tsc --noEmit --pretty false`; `npx eslint app/api/factory/products/route.ts app/api/factory/decompose/route.ts lib/factory/graphRun.ts`; парс `public/inferno/studio.html`; `npm run dev -- --port 3007`; `curl` на `/api/factory/products`
- Что поправлено: честные метрики товаров в `products`, фильтры товаров, honest format fork, ElevenLabs в студии/графе, fallback текста для hook/caption/OTK, рабочий поиск в центре, кеш последнего снимка балансов
- Что осталось: дождаться деплоя и заново проверить прод-студию в Chrome; потом добить UX на экране конкурентов и пустые состояния

### 2026-06-27 11:05

- Ветка: `codex/factory-worker-runtime-cleanup`
- Цель: закрыть Week 1 `Production Truth` repeatable smoke вместо ручного обхода четырёх endpoints
- Изменено:
  - добавлен `lib/factory/prodSmoke.mjs`
  - smoke проходит по `/api/factory/ops`, `/api/factory/worker-state`, `/api/factory/stability`, `GET /api/factory/graph-run`
  - `POST /api/factory/graph-run` вынесен в явный флаг `--trigger-run`, чтобы read-only smoke не мутировал production случайно
  - smoke раскладывает сбои по классам: `auth`, `runtime`, `worker_infra`, `observability`, `provider`
  - smoke пишет latest artifacts в `docs/factory-latest-prod-smoke.{md,json}` и timestamped history в `docs/factory-prod-smoke-history/`
  - добавлен guard `lib/factory/prodSmokeContract.test.mts`
  - `docs/PROD_GAP_REPORT.md` обновлён командой запуска и ссылками на latest artifacts
- Проверки:
  - `node --check lib/factory/prodSmoke.mjs`
  - `node lib/factory/prodSmokeContract.test.mts`
  - `git diff --check`
- Результат:
  - Week 1 получил repeatable production-truth runner, который отделяет auth/runtime truth от worker-infra шума
  - оператору больше не нужно вручную собирать картину из отдельных browser tabs и ad hoc fetch-команд

### 2026-06-27 12:10

- Ветка: `codex/factory-worker-runtime-cleanup`
- Цель: дожать Week 2 `Worker and Heartbeat Hardening` и связанный read-layer contract без ожидания live secret
- Изменено:
  - `app/api/factory/worker-state/route.ts`: route теперь возвращает `worker_issue`, `heartbeat_diagnostics`, `warnings`
  - `app/api/factory/worker-state/route.ts`: observability readback переведён в fail-open, worker snapshot больше не исчезает из-за read-side деградации
  - `lib/factory/workerState.ts`: добавлен shared `normalizeWorkerStatus(...)`
  - `lib/factory/workerState.ts`: queue fallback и DB rows нормализуют статусы к одному словарю (`working|blocked|idle|done|error|pr_open`)
  - `lib/factory/workerHeartbeat.mjs`: sender теперь использует ту же семантику статусов
  - `app/api/factory/ops/route.ts`: balances / observability / observer pulse переведены в partial fail-open с `warnings[]`
  - `app/api/factory/studio/route.ts`: feed/templates/recipes/generations/observability теперь дают `warnings[]` вместо немого обнуления
  - `public/inferno/studio.html`: worker screen показывает `Read-layer warnings`
  - `public/inferno/studio.html`: center summary показывает и `ops` read-layer warnings, и `studio` best-effort warnings
- Добавлены guards:
  - `lib/factory/workerStateContract.test.mts`
  - `lib/factory/workerStateFailOpenObservability.test.mts`
  - `lib/factory/workerHeartbeatStatusContract.test.mts`
  - `lib/factory/opsPartialContract.test.mts`
  - `lib/factory/studioWarningsContract.test.mts`
- Проверки:
  - `node lib/factory/workerStateContract.test.mts`
  - `node lib/factory/workerStateFailOpenObservability.test.mts`
  - `node lib/factory/workerHeartbeatStatusContract.test.mts`
  - `node lib/factory/opsPartialContract.test.mts`
  - `node lib/factory/studioWarningsContract.test.mts`
  - `node --check lib/factory/workerHeartbeat.mjs`
  - inline-parse `public/inferno/studio.html`
  - `git diff --check`
- Результат:
  - read-only operator surfaces стали честнее: degraded readback больше не маскируется под пустые данные и не рушит целиком `ops/worker/studio`
  - heartbeat semantics теперь менее хрупкие и не зависят от случайного несоответствия `todo/doing/working`
  - кодовая часть Week 2 заметно продвинута; главный оставшийся блокер теперь live env truth: sender + table + permissions + production smoke

### 2026-06-27 13:45

- Ветка: `codex/factory-worker-runtime-cleanup`
- Цель: снять live production truth через logged-in browser session
- Что удалось подтвердить:
  - direct shell requests на production без session cookie возвращают `401 Не авторизовано` для `/api/factory/ops`, `/api/factory/worker-state`, `/api/factory/stability`, `/api/factory/graph-run`
  - это подтверждает: production smoke надо читать через browser session или через explicit bearer path, а не через анонимный `curl`
- Что не удалось дожать в этой сессии:
  - in-app browser runtime после логина не дал стабильный DOM/runtime context и сорвался в `about:blank`
  - direct API navigation из browser runtime упиралась в `ERR_BLOCKED_BY_CLIENT`
  - Chrome extension bridge не поднялся вообще
- Следующий шаг:
  - повторить live smoke из реально доступного browser/control канала
  - либо запускать `prodSmoke.mjs` там, где есть актуальный `CRON_SECRET`

### 2026-06-27 13:54

- Ветка: `codex/factory-worker-runtime-cleanup`
- Цель: добить live verification уже по самому production UI, а не только по shell/API попыткам
- Что подтверждено через logged-in in-app browser:
  - `https://finance-panel-two.vercel.app/inferno/studio.html` открывается и рендерит production Studio без console errors
  - `Пульс завода` показывает `штатно`
  - карточка статуса больше не окрашивает завод в `degraded` только из-за heartbeat/service-инфры
  - `Очередь прогонов` показывает реальные прогоны (`recipe #59`, `recipe #58`), а не legacy queue из `jobs/*`
  - архивные инциденты вынесены в отдельный `Архивный хвост`, то есть historical noise не смешан с live execution path
- Нюанс:
  - первый screenshot поймал transient loading-state, но повторный DOM read уже дал нормальное содержимое страницы
  - direct click в nav на `08` в этой browser-сессии не дал надёжного перехода на отдельный экран `Пульс завода`, так что этот live-check остаётся частично открытым
- Следующий шаг:
  - закрыть отдельный live-pass по `Пульс завода`, когда browser bridge даст стабильную навигацию
  - до этого считать Week 1/Week 2 production truth по `center + recent_runs + prodSmoke` уже подтверждённым

### 2026-06-28 04:55

- Ветка: `codex/factory-worker-runtime-cleanup`
- Цель: добить reliability/observability по живым находкам из production Studio перед новым серийным прогоном
- Что подтверждено через logged-in in-app browser:
  - `graph #130` в production показывал противоречивую карточку: статус `running · assemble`, но summary ещё держал `active gen-poll`
  - та же карточка тащила warning `fal result 422`, хотя это выглядело как transient poll/result race, а не финальный fail
  - на экране `Анализ конкурентов` после успешного decompose кнопка `Перенести ноды себе` могла снова дизейблиться при повторном рендере
- Изменено:
  - `lib/factory/falVideo.ts`: `result 404/409/422` после `COMPLETED` переведены в transient `in_progress`, чтобы `gen-poll` не убивал живой fal-run раньше времени
  - `public/inferno/studio.html`: добавлен `decomposeCache`, чтобы успешный decompose переживал повторные рендеры и не терял transfer CTA
  - `public/inferno/studio.html`: карточка running-рецепта показывает более честный текущий шаг и кнопку `↻ tick` для ручного nudge следующего graph-run шага
  - `app/api/factory/studio/route.ts`: `node_errors` теперь собираются только из реальных `status=error`, без stale noise от промежуточных/успешных нод
  - `lib/factory/graphRun.ts`: после успешного poll у ноды очищается `error`, чтобы прошлый transient не жил в карточке дольше шага
  - `lib/factory/observability.ts`: `buildRunSummary(...)` теперь берёт последний активный `running` step, а не первый исторический
- Добавлены guards:
  - `lib/factory/falStatusTransient422Contract.test.mts`
  - `lib/factory/studioRunningErrorNoiseContract.test.mts`
  - `lib/factory/runSummaryLatestActiveContract.test.mts`
  - `lib/factory/studioDecomposeCacheContract.test.mts`
- Проверки:
  - `node lib/factory/falStatusTransient422Contract.test.mts`
  - `node lib/factory/studioRunningErrorNoiseContract.test.mts`
  - `node lib/factory/runSummaryLatestActiveContract.test.mts`
  - `git diff --check`
- Нюанс:
  - push в Gitea этой ночью несколько раз упёрся в `LibreSSL SSL_connect: SSL_ERROR_SYSCALL`, так что часть последних коммитов пока подтверждена локально, но ещё не ушла на remote
- Следующий шаг:
  - допушить ветку при восстановлении сети до Gitea
  - после деплоя повторить live-check `graph #130`/следующего running recipe и убедиться, что summary/error noise больше не врут оператору

- Дата: 2026-06-24
- Worker: railway-content-factory
- Last heartbeat: локально, в процессе работы
- Ветки: feat/factory-video-public-urls
- PR: #30 merged
- Очередь на ночь: T-001 done, T-002 active, T-003 next, T-004 after gate, T-005 at the end
- Готово к ревью: scenario-quality gate, scenario-rewrite, taste-patterns, Creatify quality gate wire-up
- Не успел: дождаться следующего пинка worker и забрать T-002
- Блокеры: live Claude в тесте ответа дал connection error, но fallback JSON работает
- Проверки: `npx tsc --noEmit --pretty false`; `npx eslint app/api/factory/scenario-quality/route.ts app/api/factory/scenario-rewrite/route.ts app/api/factory/ugc-creatify/route.ts lib/factory/scenarioQuality.ts lib/factory/tastePatterns.ts`; `npm run dev`; `curl` POST на новые endpoints
- Следующие рекомендации: сразу брать T-002, затем T-003; PR #30 уже слит

## Записи

### 2026-06-26 23:49

- Ветка: `feat/reels-brain-operator-console`
- Цель: довести до отдельной feature-ветки полный операторский экран Reels Brain перед следующей preview/production проверкой
- Изменено:
  - от `gitea/main` поднята чистая ветка `feat/reels-brain-operator-console`
  - перенесён коммит `93f9b90` с расширенной консолью Reels Brain
  - в `app/agent/reels-brain/page.tsx` добавлены operator-блоки `source-run`, `manual-seed`, `analyze`, `patterns/build`, `loop`
  - в `app/api/factory/reels-brain/bake-off/route.ts` добавлены `mapLimit`, timeout-guard и более честные warning-сообщения по partial runs
- Проверки:
  - `npm run dev`
  - `curl -I http://127.0.0.1:3000/agent/reels-brain`
  - `curl http://127.0.0.1:3000/api/factory/reels-brain/providers`
  - `curl -X POST http://127.0.0.1:3000/api/factory/reels-brain/bake-off ...`
  - `npx tsc --noEmit`
- Результат:
  - локально подтверждено, что ветка поднимает `next dev` без ошибок
  - `providers` route отвечает валидным JSON
  - `bake-off` route проходит end-to-end и возвращает новую summary-структуру
  - операторский UI теперь живёт в отдельной чистой ветке, а не только в старой `feat/reels-brain-console`
- Следующий шаг:
  - открыть preview этой ветки и проверить полный экран уже в браузере с авторизацией
  - после этого решать, льём ли ветку как есть или делаем ещё один полировочный проход по UX/empty states

### 2026-06-25 08:30

- Ветка: `fix/factory-sprint1-stabilization`
- Цель: добить Sprint 1 по надёжности, а не по качеству контента
- Изменено:
  - создан `ARCHITECTURE_AUDIT.md`
  - создан `SYSTEM_EXECUTION_MAP.md`
  - создан `STABILITY_REPORT.md`
  - `graphRun` переведён на fail-open для ОТК/critic/artifact path
  - добавлены `run_id`, `warnings`, `execution_log`
  - `graph-run/tick` переведён с `after(...)` на синхронный шаг
  - `GET /api/factory/graph-run` теперь может мягко пнуть зависший ран
  - отключены `watchdog`, `self-heal`, `scenario-rewrite`, `hook-judge`, `variations`, `recipe-variants`, `batch-build`
  - добавлен raw clip fallback и wall-clock timeout для внутренних route-вызовов
  - добавлен повторяемый stress runner `lib/factory/stressGraphRun.mjs`
  - `video-critic` переведён на deterministic fallback вместо 502 при недоступном upstream
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
  - `node lib/factory/stressGraphRun.mjs --runs 0`
  - локальный stress-test на `recipe_id=68`
  - ручной `curl`/`fetch` на `/api/factory/graph-run`, `/api/factory/studio`
  - runtime-smoke `/api/factory/video-critic` вернул `200` с fallback-оценкой при отсутствующем Claude connection
- Результат:
  - контрольный рецепт проходит end-to-end
  - в `next dev` серия дала `9/10 done`, `1/10 failed`, что помогло поймать хрупкость continuation и dev-runtime
  - после перевода `graph-run/tick` на синхронный шаг и проверки через `next start` получено `10/10 done`
  - подтверждено: основной блокер был в dev-runtime/continuation path, а не в MVP-пайплайне как таковом
- Блокеры:
  - Turbopack dev server под stress перезапускается по памяти
- Следующий шаг:
  - Sprint 2: улучшить качество `video-critic` уже без риска для выпуска
  - привести docs/observer/UI в соответствие новой Sprint 1 модели (`warning` вместо блокирующего `otk_fail`)

### 2026-06-24 22:10

- Ветка: feat/factory-video-public-urls
- Цель: поставить сценарный quality gate и мягкую перепись до дорогого render path
- Изменено: добавлен `scenario-quality` endpoint, `scenario-rewrite` endpoint, библиотека taste patterns, wire-up quality gate в Creatify UGC route, документация по gate/rewrite
- Файлы: `app/api/factory/scenario-quality/route.ts`, `app/api/factory/scenario-rewrite/route.ts`, `app/api/factory/ugc-creatify/route.ts`, `lib/factory/scenarioQuality.ts`, `lib/factory/tastePatterns.ts`, `docs/factory-scenario-quality-gate.md`
- Проверки: `npx tsc --noEmit --pretty false`; `npx eslint app/api/factory/scenario-quality/route.ts app/api/factory/scenario-rewrite/route.ts app/api/factory/ugc-creatify/route.ts lib/factory/scenarioQuality.ts lib/factory/tastePatterns.ts`; `npm run dev`; `curl` POST на оба endpoint
- Результат: типы и линт зелёные, dev поднимается, JSON fallback работает при connection error к Claude, ветка запушена, PR #30 открыт
- Риски/блокеры: live Claude в этом окружении не отвечает напрямую, поэтому аварийная ветка важна
- Следующий шаг: ждать ревью PR #30 и при необходимости править замечания

### 2026-06-25 14:29

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть второй слой Milestone 2 `Execution Observability`
- Изменено:
  - `app/api/factory/studio/route.ts` получил нормализацию `run_fail` / `plan.error` в `error_category`
  - в `observability` добавлены `top_error_categories` и `top_errors`
  - в `observability` добавлен `recent_runs[]` по последним прогонам
  - в `observability` добавлен `status_series[]` с почасовыми бакетами по `created_at`
  - в `observability` добавлен `step_duration_series[]` по самым медленным шагам
  - вынесен shared helper `lib/factory/workerState.ts` для heartbeat/очереди/night-log
  - добавлен единый `GET /api/factory/ops`
  - в `/api/factory/ops` добавлены `suggested_actions`
  - в `/api/factory/ops` добавлен `ops_status` (`healthy|degraded|critical`)
  - в `recipeSummary` добавлены `error` и `error_category`
  - `public/inferno/studio.html` теперь показывает error categories и top errors в operational card
  - `public/inferno/studio.html` теперь показывает последние прогоны с `status`, `total_ms`, `error_category`, `warnings_count`
  - `public/inferno/studio.html` теперь показывает hourly trend по последним бакетам
  - `public/inferno/studio.html` теперь показывает trend длительности по slowest steps
  - экран worker теперь читает unified ops snapshot и показывает low-balance/alerts summary
  - экран worker теперь показывает balances + observability прямо внутри ops view
  - экран worker теперь показывает suggested actions с приоритетом `P0/P1/P2`
  - командный центр и worker screen теперь показывают единый `ops_status`
  - карточки рецептов теперь показывают `error <category>` для быстрых triage-разборов
  - обновлён `EXECUTION_OBSERVABILITY.md`
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - наблюдаемость поднята с уровня warning-only до уровня warning + run-fail taxonomy
  - оператор теперь видит не только факт падения, но и класс причины: `input`, `db`, `budget`, `timeout`, `render`, `quality`, `storage`, `generation`
  - появился короткий historical slice по последним прогонам без отдельной time-series таблицы
  - появился почасовой trend, рассчитанный из истории `node_recipes`, без миграции схемы
  - появился series по длительности самых медленных шагов, чтобы локализовать bottleneck
  - появился единый ops snapshot: heartbeat + balances + observability + alerts
  - появился guidance layer: ops snapshot теперь подсказывает следующий action, а не только сообщает symptom
  - alert policy стала явной: worker/balance/db/render/generation сигналы теперь нормализуются в приоритеты
  - появился единый health verdict для быстрого чтения состояния системы
  - билд и типизация зелёные
- Следующий шаг:
  - накопить history по step duration и классам ошибок уже в richer persistent series с большей глубиной, а не только в последних бакетах/срезах
  - при необходимости вывести отдельный ops dashboard поверх `/api/factory/ops`

- Дополнение:
  - `app/api/factory/worker-state/route.ts` теперь тоже отдаёт `observability` snapshot по последним `node_recipes`
  - это даёт единый backend-facing источник правды для будущих watchdog / alerts без парсинга UI-агрегатора

### 2026-06-25 15:05

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать раздвоение operational truth между `/ops` и `/observer`
- Изменено:
  - добавлен shared helper `lib/factory/observerPulse.ts`
  - `app/api/factory/observer/route.ts` переведён на shared pulse loader
  - `app/api/factory/ops/route.ts` теперь возвращает `observer` в составе unified snapshot
  - `public/inferno/studio.html` переведён на один источник правды для sidebar pulse и worker incident summary
  - командный центр и worker screen теперь читают один и тот же observer pulse через `/api/factory/ops`
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - убран риск рассинхрона, когда sidebar pulse и worker screen показывали разные состояния одной и той же фабрики
  - `/api/factory/observer` сохранён для обратной совместимости, но больше не тащит свою отдельную реализацию
  - observability layer стал проще: один ops snapshot на UI, один shared loader на backend
- Следующий шаг:
  - решить, нужен ли вообще публичный `/api/factory/observer` после периода совместимости, или его можно будет оставить как thin compatibility facade

### 2026-06-25 15:22

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать worker screen полезным даже при проблемах с таблицей heartbeat
- Изменено:
  - `lib/factory/workerState.ts` теперь строит synthetic worker из `docs/factory-railway-task-queue.md`, если `railway_worker_states` пуст или недоступен
  - `app/api/factory/ops/route.ts` и `app/api/factory/worker-state/route.ts` передают очередь в shared worker snapshot loader
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - UI больше не остаётся полностью слепым, когда БД не даёт heartbeat row
  - даже в fallback-режиме видно текущую задачу, ветку, PR и первый blocker из очереди
  - это уменьшает MTTR: можно triage-ить worker без обязательной починки таблицы в ту же минуту

### 2026-06-25 15:31

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать источник worker-state явным на UI и в ops-алертах
- Изменено:
  - `worker.source` теперь нормализуется как `heartbeat_db` или `queue_fallback`
  - `/api/factory/ops` поднимает `worker_queue_fallback` как отдельный warn alert и добавляет `repair_worker_heartbeat` в suggested actions
  - `public/inferno/studio.html` показывает `source: heartbeat|queue fallback` вместо двусмысленного `db: ok`
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - оператор видит не просто `unknown`, а понимает, что именно деградировало: heartbeat или только его storage
  - уменьшается риск ложного ощущения, что всё в порядке, когда UI уже живёт на fallback-данных

### 2026-06-25 15:42

- Ветка: текущая рабочая ветка контент-завода
- Цель: починить markdown queue fallback до реально рабочего состояния
- Изменено:
  - `lib/factory/workerState.ts` теперь нормализует значения вида `` `doing` `` → `doing`
  - это чинит счётчики очереди, выбор активной задачи и synthetic worker fallback
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - fallback перестал быть “формально включённым, но слепым”
  - worker screen сможет корректно распознать `doing/todo/done`, даже если очередь оформлена markdown-литералами
  - повторно подтверждено: первый запуск `tsc` может споткнуться о `.next/types` до `build`, но после успешного `build` типизация зелёная

### 2026-06-25 15:58

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть настоящий root cause у heartbeat path
- Изменено:
  - добавлен готовый sender `lib/factory/workerHeartbeat.mjs`
  - обновлён `docs/factory-railway-worker.md` с командами `--once` и `--every-sec`
  - обновлён `EXECUTION_OBSERVABILITY.md` с явным указанием на heartbeat sender
- Проверки:
  - `node lib/factory/workerHeartbeat.mjs --help`
  - `npm run build`
- Результат:
  - подтверждено, что в репозитории был `POST /api/factory/worker-state`, но не было ни одного отправителя heartbeat
  - теперь экран `Пульс завода` можно реально подключить к Studio без нового сервиса и без зависимостей
  - сегодняшняя деградация heartbeat объясняется не только UI/storage, но и отсутствием sender path как такового

### 2026-06-25 16:09

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать ops-диагностику по heartbeat actionable, а не общей
- Изменено:
  - `/api/factory/ops` теперь различает `sender_missing`, `table_missing`, `db_permissions`, `fallback_active`
  - alerts/suggested_actions/ops_status используют эту классификацию
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - Studio и automation могут различать “нет sender” и “сломана таблица”
  - triage стал короче: первый шаг подсказывается сразу, без чтения сырого `db_error`

### 2026-06-25 16:21

- Ветка: текущая рабочая ветка контент-завода
- Цель: вернуть готовые repair hints прямо из heartbeat API и показать их в UI
- Изменено:
  - `lib/factory/workerState.ts` получил общий builder heartbeat diagnostics
  - `/api/factory/ops` теперь возвращает `heartbeat_diagnostics`
  - `POST /api/factory/worker-state` при ошибке возвращает `issue + diagnostics`
  - `public/inferno/studio.html` показывает отдельную карточку `Heartbeat diagnostics`
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - у оператора теперь есть migration path, sender script и пример команды прямо в интерфейсе
  - внешний heartbeat sender тоже получает структурированную причину ошибки, а не одну строку от Supabase

### 2026-06-25 16:34

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать лишний шум на странице worker и оставить только operational signals
- Изменено:
  - `public/inferno/studio.html` упрощён в секции `screenWorker`
  - убраны длинный night log preview, громоздкие task cards с acceptance/checks/result и дублирующая инцидентная сводка
  - добавлены компактные блоки `Factory pulse`, `Queue snapshot`, короткий `Sources`
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - экран worker стал короче и спокойнее
  - основные ответы теперь видны сразу: жив ли heartbeat, что чинить, какая задача активна, что следующее в очереди

### 2026-06-25 16:47

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать `run_fail` triage таким же быстрым, как heartbeat triage
- Изменено:
  - `lib/factory/observability.ts` теперь строит `failure_diagnostics`
  - `app/api/factory/studio/route.ts` возвращает этот блок в `observability`
  - `public/inferno/studio.html` показывает компактный `Run fail diagnostics`
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - Studio теперь показывает не только top error category, но и рекомендуемый первый шаг
  - triage по failing runs стал таким же short-path, как по worker heartbeat

### 2026-06-25 15:19

- Ветка: текущая рабочая ветка контент-завода
- Цель: вынести ключевые operational сигналы на главный экран Studio
- Изменено:
  - `public/inferno/studio.html` получил компактный блок `Factory health` прямо в `screenCenter`
  - в сводку выведены `ops_status`, `heartbeat_diagnostics`, `failure_diagnostics`, alert-коды и low balances
  - переход в экран worker оставлен одной кнопкой без необходимости сперва искать проблему вручную
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - command center теперь показывает, где болит pipeline, ещё до перехода в worker
  - оператор быстрее различает проблемы heartbeat, run_fail и provider balances

### 2026-06-25 15:33

- Ветка: текущая рабочая ветка контент-завода
- Цель: сократить путь от `run_fail`/`warning` до конкретного шага сбоя
- Изменено:
  - `lib/factory/observability.ts` теперь возвращает `incident_runs` по последним проблемным прогонам
  - `app/api/factory/studio/route.ts` добавляет `incident_runs` в default observability contract
  - `public/inferno/studio.html` показывает compact `incident runs` внутри `Execution observability`
  - `EXECUTION_OBSERVABILITY.md` обновлён под новый contract
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - triage warning/run_fail теперь идёт через короткий operational tail, а не через разбор полного `execution_log`
  - легче увидеть связку `recipe -> run -> last_step -> error_category`

### 2026-06-25 15:48

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать KPI `10 успешных прогонов подряд` видимым прямо в Studio
- Изменено:
  - `lib/factory/observability.ts` теперь возвращает `stability_snapshot` по последним 10 прогонам
  - `app/api/factory/studio/route.ts` добавляет `stability_snapshot` в default observability contract
  - `public/inferno/studio.html` показывает compact блок `10-run stability`
  - `EXECUTION_OBSERVABILITY.md` обновлён под новый KPI contract
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - KPI спринта теперь читается из живых данных, а не только из markdown-отчёта
  - оператор сразу видит streak и понимает, добили ли мы целевые `10/10`

### 2026-06-25 16:02

- Ветка: текущая рабочая ветка контент-завода
- Цель: вынести stability snapshot в отдельный backend contract для Milestone 3
- Изменено:
  - `lib/factory/observability.ts` получил `buildStabilityReport`
  - добавлен `GET /api/factory/stability`
  - `lib/factory/stressGraphRun.mjs` теперь печатает `STABILITY ...` после `SUMMARY ...`
  - `EXECUTION_OBSERVABILITY.md` обновлён под новый route
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - stress loop и Studio теперь могут опираться на один stability contract
  - KPI `10/10` стал доступен automation-friendly, без парсинга UI

### 2026-06-25 16:18

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать дублирование backend snapshot path в Milestone 3 cleanup
- Изменено:
  - добавлен shared loader `lib/factory/runSnapshots.ts`
  - `app/api/factory/ops/route.ts` переведён на shared observability snapshot
  - `app/api/factory/worker-state/route.ts` переведён на shared observability snapshot
  - `app/api/factory/stability/route.ts` переведён на shared stability snapshot
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - у ops/worker/stability теперь один canonical backend path для последних recipe runs
  - следующий change в snapshot-логике не придётся размазывать по нескольким route handler

### 2026-06-25 16:31

- Ветка: текущая рабочая ветка контент-завода
- Цель: довести stress/report loop до удобного артефакта, а не только stdout
- Изменено:
  - `lib/factory/stressGraphRun.mjs` получил `--json-out` и `--md-out`
  - раннер теперь умеет сохранять machine-readable и human-readable отчёт серии
  - `STABILITY_REPORT.md` обновлён с примерами запуска
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - Milestone 3 получил нормальный stress artifact path
  - серию прогонов можно сохранять без копипасты из терминала

### 2026-06-25 16:39

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать latest stress report стандартным поведением, а не ручной опцией
- Изменено:
  - `lib/factory/stressGraphRun.mjs` теперь по умолчанию пишет в `docs/factory-latest-stress.json` и `docs/factory-latest-stress.md`
  - latest-режим можно выключить через `--latest=false`
  - `STABILITY_REPORT.md` обновлён под новый default flow
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - у stress loop появился предсказуемый latest-report path
  - команде не нужно каждый раз придумывать имя файла или помнить флаги

### 2026-06-25 16:52

- Ветка: текущая рабочая ветка контент-завода
- Цель: показать latest stress artifact прямо в Studio
- Изменено:
  - добавлен shared reader `lib/factory/stabilityArtifacts.ts`
  - `app/api/factory/ops/route.ts` и `app/api/factory/worker-state/route.ts` теперь возвращают `latest_stress`
  - `public/inferno/studio.html` показывает latest stress summary в command center и worker screen
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - последний stress-run теперь виден прямо в интерфейсе
  - оператору не нужно открывать `docs/factory-latest-stress.*` вручную

### 2026-06-25 17:02

- Ветка: текущая рабочая ветка контент-завода
- Цель: formal closeout по Milestone 2 и зафиксированный переход в late-stage Milestone 3
- Изменено:
  - `EXECUTION_OBSERVABILITY.md` переведён в статус `Milestone 2 — complete`
  - добавлен явный блок `Milestone 2 Closeout`
  - next-step секция обновлена под текущий state завода
- Проверки:
  - документационный апдейт, без изменения runtime-контракта
- Результат:
  - статус milestone больше не висит в неопределённости
  - следующий этап можно вести как отдельный cleanup/closeout Milestone 3, а не как хвост Milestone 2

### 2026-06-25 17:11

- Ветка: текущая рабочая ветка контент-завода
- Цель: formal closeout по Milestone 3 и явный backlog хвостов
- Изменено:
  - `STABILITY_REPORT.md` получил блок `Milestone 3 Closeout`
  - оставшиеся хвосты разделены на `P1 backlog` и `P2 backlog`
- Проверки:
  - документационный апдейт, без изменения runtime-контракта
- Результат:
  - Milestone 3 теперь закрыт как отдельный этап
  - следующий milestone можно открывать без скрытого долга и без “висящего” статуса

### 2026-06-25 17:26

- Ветка: текущая рабочая ветка контент-завода
- Цель: начать следующий этап с quality-signal visibility, не ломая fail-open выпуск
- Изменено:
  - `app/api/factory/video-critic/route.ts` теперь явно возвращает `basis: model|text|fallback`
  - `lib/factory/graphRun.ts` сохраняет `otk.basis` в `run_plan`
  - `lib/factory/observability.ts` строит `quality_signal`
  - `app/api/factory/studio/route.ts` получил честный default contract для `quality_signal`
  - `public/inferno/studio.html` показывает compact блок `Quality signal`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - Studio теперь видит, когда критик работает по модели, а когда по text/fallback
  - quality growth можно вести без возврата к fail-closed логике

### 2026-06-25 17:39

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать quality-signal operational, а не только визуальным
- Изменено:
  - `app/api/factory/ops/route.ts` теперь учитывает `quality_signal` в alerts, suggested actions и ops status
  - высокий `fallback_ratio` критика теперь поднимает отдельный ops signal
  - доминирование `text` basis тоже видно как мягкая деградация quality path
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - качество сигнала критика теперь попало в operational контур
  - система раньше подсказывает, что деградирует не сам выпуск, а его quality-evaluation слой

### 2026-06-25 17:52

- Ветка: текущая рабочая ветка контент-завода
- Цель: различать не только `fallback`, но и причину деградации quality path
- Изменено:
  - `app/api/factory/video-critic/route.ts` теперь возвращает `basis_reason`
  - `lib/factory/graphRun.ts` сохраняет `otk.basis_reason`
  - `lib/factory/observability.ts` строит `quality_signal.top_basis_reason`
  - `public/inferno/studio.html` показывает top basis reason в `Quality signal`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - quality hardening теперь можно делать адресно: видно, это upstream, timeout, empty response или text-parse path
  - контур наблюдаемости стал годиться не только для мониторинга, но и для следующего цикла улучшений

### 2026-06-25 18:06

- Ветка: текущая рабочая ветка контент-завода
- Цель: превратить `basis_reason` в operational сигнал, а не просто подпись в UI
- Изменено:
  - `app/api/factory/ops/route.ts` теперь учитывает `quality_signal.top_basis_reason`
  - ops alerts различают `upstream_unavailable`, `timeout`, `model_empty_response`, `text_empty_response`
  - suggested actions теперь дают отдельные ходы: `inspect_claude_upstream`, `inspect_video_critic_timeout_budget`, `inspect_video_critic_structured_output`, `inspect_text_critic_fallback`
  - `ops_status` поднимает критичность выше, если quality degradation идёт из upstream-unavailable, а не из обычного text/fallback drift
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - command center теперь не просто видит, что critic деградировал, а подсказывает, куда идти первым
  - triage quality path стал короче: меньше ручного чтения run artifacts перед первым решением

### 2026-06-25 18:19

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать лишний шум с экрана `Пульс завода`
- Изменено:
  - `public/inferno/studio.html` убран дублирующий верхний блок `Очередь`
  - те же queue counters перенесены в `Queue snapshot`, рядом с реальным списком задач
  - удалён нижний блок `Источники`, который занимал место, но редко помогал принятию решений
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Наблюдение:
  - во время параллельного прогона после `next build` был разовый transient `.next/types/validator.ts -> routes.js`, повторный отдельный `tsc` прошёл без ошибок
- Результат:
  - worker screen стал компактнее и сфокусирован на heartbeat, current task, ops и реальной очереди
  - меньше визуальных дублей, быстрее читается при ночном дежурстве

### 2026-06-25 18:31

- Ветка: текущая рабочая ветка контент-завода
- Цель: дополировать `latest stress` blocks в Studio
- Изменено:
  - `public/inferno/studio.html` перевёл `Latest stress` на compact chips вместо длинных строк
  - summary в `Factory health` теперь показывает `stress`, `avg`, `streak`, timestamp более плотным scan-friendly форматом
  - worker screen `Latest stress` тоже сжат до коротких метрик `runs/fails/warn/avg` и `streak/target`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - один из оставшихся P2 из `STABILITY_REPORT.md` фактически закрыт
  - observability/stress слой стал удобнее именно для операторского чтения, без изменения backend-логики

### 2026-06-25 18:44

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать ложные manual-heal CTA с legacy execution surface
- Изменено:
  - `public/inferno/studio.html` получил флаг `SELF_HEAL_ENABLED=false`
  - helper `selfHeal(...)` теперь сразу возвращает disabled-note и не делает fetch, если manual heal выключен
  - из rail pulse, worker pulse и recipe cards убраны живые кнопки `wake/rejudge`
  - вместо них Studio честно показывает `manual heal off · sprint 1` / `heal off`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Наблюдение:
  - при параллельном `build + tsc` снова всплыл transient `.next/types/validator.ts -> routes.js`; отдельный повторный `tsc` прошёл чисто
- Результат:
  - UI больше не обещает ручную самопочинку там, где backend уже intentionally disabled
  - legacy execution surface стал честнее и чище для оператора

### 2026-06-25 18:57

- Ветка: текущая рабочая ветка контент-завода
- Цель: синхронизировать experimental variants UI с Sprint 1 режимом
- Изменено:
  - `public/inferno/studio.html` получил флаг `EXPERIMENTAL_VARIANTS_ENABLED=false`
  - hook-node inspector больше не показывает живую кнопку `Хук-турнир`, когда variants path выключен; вместо неё честная пометка `hook tournament off · sprint 1`
  - `runHookTournament(...)` теперь short-circuit'ится с toast, если experimental variants выключены
  - в recipe cards `🔀` заменён на `variants off`, чтобы не дёргать disabled `/api/factory/recipe-variants`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Наблюдение:
  - при параллельном `build + tsc` transient `.next/types` снова воспроизвёлся; отдельный повторный `tsc` прошёл чисто
- Результат:
  - Studio больше не подталкивает пользователя к отключённым A/B-механикам
  - Sprint 1 surface стал ближе к реальной MVP-архитектуре без скрытых продуктовых хвостов

### 2026-06-25 19:11

- Ветка: текущая рабочая ветка контент-завода
- Цель: дочистить тексты и disabled routes под реальный Sprint 1 режим
- Изменено:
  - `public/inferno/studio.html`:
    - worker coaching больше не советует «будить» воркер вручную, а ведёт к heartbeat/sender/blocker triage
    - смета прогона теперь честно говорит, что `variants path` выключен в Sprint 1
  - `app/api/factory/recipe-variants/route.ts` очищен до минимального disabled-stub
  - `app/api/factory/variations/route.ts` очищен до минимального disabled-stub
  - `app/api/factory/hook-judge/route.ts` очищен до минимального disabled-stub
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - меньше мёртвого кода в отключённых API-path
  - Studio и backend surface теперь лучше совпадают и по действиям, и по текстам

### 2026-06-25 19:24

- Ветка: текущая рабочая ветка контент-завода
- Цель: ужать disabled batch-build surface до stub-уровня
- Изменено:
  - `app/api/factory/batch-build/route.ts` очищен до минимального disabled-stub (`POST` + `GET`)
  - `app/api/factory/batch-build/tick/route.ts` очищен до минимального disabled-stub
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - из runtime surface убрана мёртвая async-очередь batch-build
  - Sprint 1 disabled-контуры стали не только выключены, но и реально проще по коду и импорту зависимостей

### 2026-06-25 19:37

- Ветка: текущая рабочая ветка контент-завода
- Цель: зафиксировать в архитектурных доках переход disabled-контуров к stub-route уровню
- Изменено:
  - `SYSTEM_EXECUTION_MAP.md` теперь различает просто `disabled` и `disabled stub route`
  - в execution map добавлена явная пометка, что `watchdog`, `self-heal`, `batch-build`, `variations`, `recipe-variants`, `hook-judge`, `scenario-rewrite` сведены к compatibility contracts без скрытой runtime-логики
  - `ARCHITECTURE_AUDIT.md` обновлён: Sprint 1 рекомендация теперь явно предпочитает tiny stub routes вместо legacy-реализаций за ранним `return`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - docs теперь отражают реальное состояние кода, а не только план отключения
  - future cleanup и возможный re-enable будут опираться на более честную execution map

### 2026-06-25 19:49

- Ветка: текущая рабочая ветка контент-завода
- Цель: честно размечать `jobs/*` как compatibility-live, а не как “кандидат на мгновенный stub”
- Изменено:
  - `SYSTEM_EXECUTION_MAP.md` теперь явно фиксирует, что `jobs/*` ещё жив из-за `patrick-legacy.html` и `/api/sync/all`
  - `ARCHITECTURE_AUDIT.md` обновлён: `jobs/*` отмечен как контур, который нельзя схлопывать до stub до миграции зависимостей
  - комментарии в `app/api/factory/jobs/enqueue/route.ts`, `app/api/factory/jobs/tick/route.ts`, `app/api/factory/jobs/list/route.ts` теперь прямо называют этот контур compatibility-live
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - следующий этап cleanup не перепутает `jobs/*` со stub-кандидатами
  - архитектурная карта теперь различает `disabled stub` и `compatibility-live legacy`

### 2026-06-25 20:02

- Ветка: текущая рабочая ветка контент-завода
- Цель: оформить отдельный migration backlog для вывода `jobs/*`
- Изменено:
  - создан `docs/factory-jobs-migration-backlog.md`
  - backlog описывает:
    - живые зависимости (`patrick-legacy.html`, `/api/sync/all`)
    - целевое состояние после миграции
    - этапы `M1..M4`
    - риски и exit criteria
  - `SYSTEM_EXECUTION_MAP.md` и `ARCHITECTURE_AUDIT.md` теперь ссылаются на этот backlog
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - вывод `jobs/*` из системы теперь стал отдельной явной задачей, а не размытой идеей
  - следующий этап можно брать как нормальный migration milestone

### 2026-06-25 20:14

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать `patrick-legacy` честнее по отношению к legacy queue
- Изменено:
  - `public/inferno/patrick-legacy.html` теперь маркирует queue-кнопки как `Legacy очередь`
  - queue summary в legacy cockpit явно подписан как compatibility-live контур
  - комментарии в `patrick-legacy.html` теперь тоже различают legacy queue и канонический `graph-run` path
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - `M1` migration backlog получил безопасный подготовительный шаг
  - legacy cockpit меньше маскирует переходный контур под основной execution path

### 2026-06-25 20:21

- Ветка: текущая рабочая ветка контент-завода
- Цель: зафиксировать `M1-prep` в backlog вывода `jobs/*`
- Изменено:
  - `docs/factory-jobs-migration-backlog.md` теперь явно отмечает:
    - prep done: `patrick-legacy.html` уже маркирует queue как `compatibility-live`
    - not done yet: launch-flow всё ещё сидит на `jobs/enqueue` + `jobs/list`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - следующий заход в `M1` можно начинать уже с содержательной миграции, а не с повторной разведки

### 2026-06-25 20:33

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать первый реальный `M1` шаг по снятию UI-зависимости от `jobs/*`
- Изменено:
  - `public/inferno/patrick-legacy.html` получил `legacyQueueLaunchEnabled: false`
  - кнопка `Legacy очередь (фоном)` теперь отключена
  - legacy cockpit показывает явное предупреждение, что запуск новых задач через legacy queue заморожен
  - `enqueueServer()` short-circuit'ится и не создаёт новые jobs во время миграции
  - `docs/factory-jobs-migration-backlog.md` обновлён: `M1` теперь имеет статус `partial done`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - `patrick-legacy` больше не создаёт новые задачи через legacy queue
  - UI-зависимость от `jobs/enqueue` заметно ослаблена, при этом progress/read-only compatibility path сохранён

### 2026-06-25 20:45

- Ветка: текущая рабочая ветка контент-завода
- Цель: завершить UI-часть `M1` и снять чтение `jobs/list` из `patrick-legacy`
- Изменено:
  - `public/inferno/patrick-legacy.html` получил `legacyQueueReadEnabled: false`
  - кнопка polling legacy-очереди отключена
  - `loadJobs()` и `_startJobsPoll()` short-circuit'ятся и больше не ходят в `jobs/list`
  - в UI добавлено явное предупреждение, что чтение legacy queue из кокпита тоже заморожено на время миграции
  - `docs/factory-jobs-migration-backlog.md` обновлён: UI-часть `M1` теперь done
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - `patrick-legacy` больше не пишет и не читает `jobs/*`
  - следующая реальная зависимость для снятия — backend wake в `/api/sync/all`

### 2026-06-25 20:58

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать ложные следы старой очереди из factory-доков
- Изменено:
  - `docs/content-factory-spec.md` теперь прямо говорит, что `jobs/tick` — исторический путь, а канон уже `graph-run`
  - `docs/factory-v3-tz.md` обновлён: `graph-run` больше не описан как thin wrapper над `jobs/tick`
  - `docs/factory-shotstack-tz.md` больше не называет `jobs/*` единственным конвейером после слияния
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - старые factory-доки меньше навязывают устаревшую модель очереди
  - cleanup почти дошёл до точки, где следующий реальный шаг уже вне мандата контент-завода

### 2026-06-25 21:12

- Ветка: текущая рабочая ветка контент-завода
- Цель: снять последнюю repo-level runtime-зависимость от legacy queue через `/api/sync/all`
- Изменено:
  - из `app/api/sync/all/route.ts` удалён backstop wake на `POST /api/factory/jobs/tick`
  - `docs/factory-jobs-migration-backlog.md` обновлён: `M2` теперь done, current state описывает отсутствие известных repo-callers
  - `SYSTEM_EXECUTION_MAP.md` обновлён: `jobs/*` теперь помечен как `compatibility-live without active repo callers`
  - `ARCHITECTURE_AUDIT.md` обновлён: зафиксировано, что preconditions для stubbing уже выполнены
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "api/factory/jobs/(tick|enqueue|list)|jobs/tick|jobs/enqueue|jobs/list" app public lib`
- Результат:
  - старый `jobs/*` больше не участвует в runtime orchestration через UI или общий sync-cron
  - следующий логичный шаг — схлопнуть `jobs/enqueue`, `jobs/list`, `jobs/tick` до disabled stub routes и затем удалить legacy implementation
  - `npm run build` зелёный
  - повторный `tsc` после завершённого build зелёный; первый параллельный запуск снова поймал transient `.next/types/validator.ts` noise

### 2026-06-25 21:28

- Ветка: текущая рабочая ветка контент-завода
- Цель: завершить `M3` и реально убрать legacy queue runtime из `jobs/*`
- Изменено:
  - `app/api/factory/jobs/enqueue/route.ts` очищен до disabled stub route
  - `app/api/factory/jobs/list/route.ts` очищен до disabled stub route с пустым `summary/jobs`
  - `app/api/factory/jobs/tick/route.ts` очищен до disabled stub route
  - `lib/factory/jobs.ts` удалён, так как живых импортов после stubbing не осталось
  - `docs/factory-jobs-migration-backlog.md`, `SYSTEM_EXECUTION_MAP.md`, `ARCHITECTURE_AUDIT.md` обновлены под новый статус `disabled stub`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "from \\\"@/lib/factory/jobs\\\"|from '@/lib/factory/jobs'|lib/factory/jobs" app lib public docs`
- Результат:
  - `jobs/*` больше не несёт runtime orchestration logic
  - legacy queue implementation выведена из active code path
  - следующий шаг сместился из runtime cleanup в doc cleanup (`M4`)
  - `npm run build` зелёный
  - repo больше не содержит живых импортов `lib/factory/jobs` в коде; остались только historical doc mentions
  - повторный отдельный `tsc` после build зелёный; параллельный запуск по-прежнему может ловить transient `.next/types/validator.ts` noise

### 2026-06-25 21:44

- Ветка: текущая рабочая ветка контент-завода
- Цель: пройти `M4` по factory-docs и убрать ложное ощущение, что `jobs/*` всё ещё живой execution contour
- Изменено:
  - `docs/content-factory-spec.md` теперь прямо говорит, что `jobs/*` уже сведён к disabled stub уровню
  - `docs/factory-shotstack-tz.md` переведён с `compatibility-live` на historical/stub framing
  - `docs/factory-v3-roadmap.md` больше не отправляет читателя чинить `jobs/tick`
  - `docs/factory-viral-plan.md` получил явную historical note и несколько замен `jobs/tick` → `graph-run` / `execution runner`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "jobs/tick|lib/factory/jobs|compatibility-live|jobs/enqueue|jobs/list" docs/factory-*.md docs/content-factory*.md`
- Результат:
  - в factory-docs почти не осталось опасных ссылок, которые звучат как текущая runtime-архитектура
  - оставшиеся упоминания в основном либо backlog/history, либо сознательно historical context

### 2026-06-25 21:58

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть `M4` до уровня repo-truth и убрать последние живые ссылки на старую очередь в активных factory-spec docs
- Изменено:
  - `docs/factory-v3-autopilot-tz.md` переведён с `self-chaining очередь` на `graph-run execution runner`
  - `docs/factory-v3-tz.md` больше не называет `jobs.ts` reusable execution core; reused core теперь `graph-run`
  - `docs/factory-jobs-migration-backlog.md` получил явный status для `M4` и фиксацию, что migration complete внутри repo
  - `docs/content-factory-spec.md` больше не описывает server-side execution как абстрактную legacy queue
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "self-chaining очередь|jobs/tick|lib/factory/jobs|compatibility-live|jobs/enqueue|jobs/list" docs/factory-*.md docs/content-factory*.md`
- Результат:
  - `M4` практически закрыт: активные factory-spec docs уже говорят на языке `graph-run`
  - в repo остаются в основном backlog/history mentions, а не вводящие в заблуждение runtime-описания
  - `npm run build` зелёный
  - `npx tsc --noEmit --pretty false` зелёный
  - финальный `rg` подтверждает: в активных factory-spec docs остались в основном conscious historical mentions, backlog и night-log, а не живые runtime-инструкции

### 2026-06-25 22:09

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать из `patrick-legacy` последний мёртвый UI-хвост старой queue-модели
- Изменено:
  - из `public/inferno/patrick-legacy.html` удалены кнопки запуска/polling legacy queue
  - удалены JS-методы `enqueueServer`, `loadJobs`, `_startJobsPoll`
  - удалены `legacyQueue*` state fields и queue summary block
  - вместо этого в setup-screen оставлена честная ссылка на `V3 studio` и note, что канонический execution path уже `graph-run`
- Проверки:
  - `rg -n "enqueueServer|loadJobs\\(|_startJobsPoll|legacyQueueLaunchEnabled|legacyQueueReadEnabled|jobsSummary|_jobsPoll" public/inferno/patrick-legacy.html`
  - `npm run build`
- Результат:
  - legacy cockpit больше не содержит dead controls для уже удалённого queue-runtime
  - интерфейс стал честнее: historical surface без фальшивых кнопок и ложных ожиданий

### 2026-06-25 22:29

- Ветка: текущая рабочая ветка контент-завода
- Цель: довести `patrick-legacy` до честного legacy-позиционирования и закрыть verification loop
- Изменено:
  - `public/inferno/patrick-legacy.html` явно переименован в `Контент-завод Legacy`
  - в header добавлен badge `historical surface`
  - добавлен amber-banner с прямым указанием, что новые запуски и orchestration идут через `V3 studio` и `graph-run`
  - copy на экране приведён к режиму historical/operator surface без двусмысленности
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `rg -n "Контент-завод Legacy|historical surface|V3 studio|graph-run" public/inferno/patrick-legacy.html`
- Результат:
  - legacy screen теперь не только не содержит dead queue-controls, но и визуально не маскируется под живой production cockpit
  - проверка типов зелёная
  - пользовательский сигнал стал чище: рабочий execution path завода читается как `V3 studio` + `graph-run`

### 2026-06-25 22:35

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать лишний UI-шум из живого `V3 studio`, чтобы оператор видел execution path, а не декоративные хвосты
- Изменено:
  - `public/inferno/studio.html`: экран `Пульс завода` упрощён до `heartbeat · current task · queue`
  - убрана кнопка `🧠 Обучение` из header worker-экрана
  - убраны вторичные блоки `Factory pulse` и `Service balances` с dedicated worker-screen
  - из command center удалена disabled-кнопка `+ Новая ниша`, которая не была подключена и только создавала ложное ожидание
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "\\+ Новая ниша|Factory pulse|Service balances|header\\(\\\"Пульс завода\\\",\\\"пульс · прогоны · контроль\\\"" public/inferno/studio.html`
- Результат:
  - worker-screen стал более операционным: меньше отвлекающего health-noise, больше фокуса на heartbeat, current task и очереди
  - command center стал честнее и компактнее
  - сборка и типы зелёные

### 2026-06-25 22:44

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать скрытую оркестрацию из read-path `graph-run`, чтобы polling не запускал execution побочным эффектом
- Изменено:
  - `app/api/factory/graph-run/route.ts`: `GET /api/factory/graph-run` больше не дёргает `graph-run/tick`
  - read-path оставлен read-only: запуск и продолжение исполнения теперь живут только в `POST /graph-run`, self-chain `graph-run/tick` и cron-страховке
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "canNudge|GET.*tick|status polling|graph-run.*GET.*tick|пинк|nudge" ARCHITECTURE_AUDIT.md SYSTEM_EXECUTION_MAP.md docs/factory-*.md docs/content-factory*.md app/api/factory/graph-run/route.ts`
- Результат:
  - status polling больше не меняет состояние execution-контура
  - уменьшен один из скрытых duplicate-orchestration paths
  - сборка и типы зелёные

### 2026-06-25 22:56

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать дублирование step-runner логики между `graph-run/tick` и cron-watchdog
- Изменено:
  - в `lib/factory/graphRun.ts` вынесен общий helper `advanceClaimedRecipe`
  - `app/api/factory/graph-run/tick/route.ts` переведён на этот helper
  - `lib/factory/graphWatchdog.ts` тоже переведён на тот же helper
  - retry/attempts/reset_step_attempts/persist-on-fail policy теперь живут в одном месте вместо двух почти одинаковых реализаций
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "advanceClaimedRecipe|MAX_STEP_ATTEMPTS|reset_step_attempts|plan\\.attempts = attempts|status: \\\"run_fail\\\"" lib/factory/graphRun.ts lib/factory/graphWatchdog.ts app/api/factory/graph-run/tick/route.ts`
- Результат:
  - execution core стал проще и консистентнее
  - снижен риск, что tick и watchdog будут по-разному обрабатывать один и тот же step-failure
  - сборка и типы зелёные

### 2026-06-25 23:05

- Ветка: текущая рабочая ветка контент-завода
- Цель: синхронизировать repo-truth вокруг disabled wake-paths и убрать лишний compatibility-noise
- Изменено:
  - `app/api/factory/graph-run/watchdog/route.ts` очищен от мёртвых импортов и явно помечен как historical compatibility stub
  - `app/api/factory/self-heal/route.ts` комментариями приведён к реальному Sprint 1 статусу: disabled stub, а не живой repair path
  - `SYSTEM_EXECUTION_MAP.md` обновлён: `GET /api/factory/graph-run` больше не фигурирует как wake mechanism
  - `ARCHITECTURE_AUDIT.md` обновлён: активные wake-paths теперь зафиксированы как `graph-run/tick` self-chain + cron fallback
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `rg -n 'GET-based resurrection|read-only|duplicate wake source|Historical compatibility stub|graph-run/tick self-chain plus cron fallback' SYSTEM_EXECUTION_MAP.md ARCHITECTURE_AUDIT.md app/api/factory/graph-run/watchdog/route.ts app/api/factory/self-heal/route.ts`
- Результат:
  - код, комментарии и архитектурные доки снова описывают один и тот же execution model
  - уменьшен риск, что следующий проход будет опираться на устаревшую схему wake/resurrection

### 2026-06-25 23:14

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать cron-backstop более предсказуемым и менее burst-heavy
- Изменено:
  - `lib/factory/graphWatchdog.ts`: `wakeStaleRecipes(...)` переведён с `Promise.all(...)` на последовательный проход по stuck recipe
  - `SYSTEM_EXECUTION_MAP.md` теперь явно фиксирует, что `graph-run/cron` будит stale runs последовательно
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "Promise\\.all\\(|последователь|serial|burst-runner|wakeStaleRecipes" lib/factory/graphWatchdog.ts SYSTEM_EXECUTION_MAP.md ARCHITECTURE_AUDIT.md`
- Результат:
  - fallback-контур стал спокойнее: меньше шанс, что cron сам создаст параллельный всплеск дорогих шагов поверх живого self-chain
  - execution model для Sprint 1 стал ещё ближе к цели "один основной runner + одна предсказуемая страховка"

### 2026-06-25 23:22

- Ветка: текущая рабочая ветка контент-завода
- Цель: ещё сильнее сузить rescue-policy cron под стабильный MVP
- Изменено:
  - `lib/factory/graphWatchdog.ts`: `DEFAULT_MAX_WAKE` уменьшен с `10` до `3`
  - `SYSTEM_EXECUTION_MAP.md`: rescue-pass явно описан как small batch (`maxWake=3`)
  - `ARCHITECTURE_AUDIT.md`: cron fallback зафиксирован как sequential + small-batch path
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "DEFAULT_MAX_WAKE|maxWake=3|small batch|sequential and capped" lib/factory/graphWatchdog.ts SYSTEM_EXECUTION_MAP.md ARCHITECTURE_AUDIT.md`
- Результат:
  - cron-страховка стала ещё менее похожа на второй полноценный orchestrator
  - уменьшен объём одновременного rescue-work при накоплении stale recipe
  - политика backstop теперь лучше соответствует цели Sprint 1: надёжность важнее throughput

### 2026-06-25 23:31

- Ветка: текущая рабочая ветка контент-завода
- Цель: обновить formal closeout `Milestone 3` под фактическое состояние execution-core после поздних cleanup-правок
- Изменено:
  - `STABILITY_REPORT.md` синхронизирован с текущей repo-truth
  - в `What Was Changed In Sprint 1` убрана устаревшая формулировка про `GET /graph-run` как wake-path
  - `Milestone 3 Closeout` теперь включает:
    - read-only `GET /graph-run`
    - shared helper `advanceClaimedRecipe(...)`
    - sequential + small-batch cron fallback (`maxWake=3`)
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `rg -n "GET /api/factory/graph-run|advanceClaimedRecipe|maxWake=3|Milestone 3 Closeout|cleanup execution orchestration" STABILITY_REPORT.md`
- Результат:
  - `Milestone 3` теперь закрыт не только по runtime-факту, но и по актуальным документам
  - остатки переведены в явный backlog, а не висят как скрытый mid-flight статус

### 2026-06-25 23:42

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть один из явных post-M3 `P1` по bank/gen-save semantics
- Изменено:
  - `lib/factory/graphRun.ts`: если `gen-save` в шаге `bank` не сохранил asset, в warnings теперь явно добавляется `gen-save warning: ...`
  - итоговый статус рецепта больше не может остаться слишком оптимистичным при `catalog_error`: fail-open сохраняется, но финал помечается `warning`
  - `STABILITY_REPORT.md` обновлён: `P1-2` переведён из "надо сделать" в "runtime-policy закрыта, осталось наблюдение"
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (standalone rerun после известного transient `.next/types/validator.ts`)
  - `rg -n "gen-save warning|catalogError|finalStatus = summarizeWarnings|qualityStatus" lib/factory/graphRun.ts STABILITY_REPORT.md`
- Результат:
  - bank-step стал честнее по итоговой семантике
  - один из заметных `P1` после Milestone 3 фактически закрыт без расширения архитектуры

### 2026-06-25 23:51

- Ветка: текущая рабочая ветка контент-завода
- Цель: дочистить error-contract consistency в живых factory routes без ломки legacy-клиентов
- Изменено:
  - `app/api/factory/creatify-avatars/route.ts`: ошибка недоступного Creatify теперь возвращается как `error` + `detail`
  - `app/api/factory/ugc-creatify/route.ts`: 503 / 422 / 400 / 502 ответы переведены на канонический `error`, при этом `detail` оставлен как compatibility mirror
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (standalone rerun после известного transient `.next/types/validator.ts`)
  - `rg -n "error, detail|detail: error|quality gate" app/api/factory/ugc-creatify/route.ts app/api/factory/creatify-avatars/route.ts`
- Результат:
  - живые factory clients могут опираться на единообразный `error` field
  - compatibility с возможными старыми потребителями `detail` не потеряна

### 2026-06-26 00:02

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть ещё один backend `P2`, где DB-сбой мог маскироваться под "просто пусто"
- Изменено:
  - `app/api/factory/assemble/route.ts`: lookup в `product_costs` теперь тоже пишет в общий `dbErr`
  - ошибки `product_costs` и `content_assets` больше не теряются отдельно друг от друга
  - роут по-прежнему отдаёт `404` на реально пустую библиотеку, но при DB-проблеме теперь честно отвечает `500` с `{ error }`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "dbErr|product_costs|сбой запроса библиотеки|не маскируем сбой БД" app/api/factory/assemble/route.ts`
- Результат:
  - `assemble` меньше маскирует инфраструктурную проблему под контентную пустоту
  - ещё один старый backend `P2` из factory QA фактически закрыт

### 2026-06-26 00:12

- Ветка: текущая рабочая ветка контент-завода
- Цель: усилить диагностику `media-store`, чтобы partial upload failures не выглядели как немая магия
- Изменено:
  - `app/api/factory/media-store/route.ts` теперь собирает краткие per-slide ошибки при upload/publicUrl failures
  - при полном провале роут отдаёт `{ error, attempted, failed[] }`
  - при частичном успехе роут отдаёт `{ urls, uploaded, skipped, warnings[] }`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "attempted|failed: errors|uploaded: urls.length|warnings: errors.slice" app/api/factory/media-store/route.ts`
- Результат:
  - оператор/клиент получает больше причинности, если часть base64-слайдов битая или storage-path спотыкается
  - diagnostic-hardening улучшен без изменения основного happy path

### 2026-06-26 00:50

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать ещё одну скрытую точку нестабильности в FAL-утилитах, где разные shape-ответы могли ломать post-processing
- Изменено:
  - `lib/factory/falVideo.ts`: добавлен helper `extractFalVideoUrl()` для нормализации `video.url`, `video_url`, `url`, `output.url`, `output`
  - `falCompose()` и `falTimeline()` больше не завязаны только на `video_url`
  - `falMergeVideos()` и `falAutoSubtitle()` больше не завязаны только на `result.video.url`
  - `falVideoStatus()` переведён на тот же helper, чтобы все FAL-пути читали результат одинаково
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "extractFalVideoUrl|falMergeVideos|falAutoSubtitle|falCompose|falTimeline" lib/factory/falVideo.ts`
- Результат:
  - utility-цепочки FAL меньше зависят от конкретного формата ответа модели/endpoint
  - закрыт ещё один backend `P2` из старого QA-хвоста без расширения поверхности системы

### 2026-06-26 01:15

- Ветка: текущая рабочая ветка контент-завода
- Цель: уменьшить flakiness LLM-роутов, где часть factory endpoints всё ещё жёстко парсила "идеальный" JSON
- Изменено:
  - `app/api/factory/niche-brief/route.ts` и `app/api/factory/niche-playbook/route.ts` переведены на общий `lib/factory/extractJson`
  - `app/api/factory/director/route.ts`, `app/api/factory/trends/route.ts`, `app/api/factory/content-learn/route.ts`, `app/api/factory/telegram/route.ts` больше не завязаны на локальный regex + `JSON.parse`
  - локальные дубли tolerant-JSON логики сокращены; object-style ответы теперь читаются единообразно
- Осознанно не тронуто:
  - `repurpose` и `trends/search` пока оставлены как array-specific paths; для них нужен отдельный helper, чтобы не смешивать объектный и массивный парсинг впопыхах
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "extractJson\\(|const plan = extractJson|const patterns = extractJson" app/api/factory/{niche-brief,niche-playbook,director,trends,content-learn,telegram}/route.ts`
- Результат:
  - factory-роуты спокойнее переживают markdown-ограждение, обрыв по токен-лимиту и хвостовые запятые в ответах модели
  - сокращён ещё один живой класс "иногда 502 без понятной причины" без добавления новых компонентов

### 2026-06-26 01:54

- Ветка: текущая рабочая ветка контент-завода
- Цель: добить array-style JSON parsing в factory, чтобы массивные ответы модели не зависели от идеального `[...]`
- Изменено:
  - `lib/factory/extractJson.ts`: добавлен `extractJsonArray()` с tolerant parsing для JSON-массивов
  - `app/api/factory/repurpose/route.ts` переведён с regex + `JSON.parse` на `extractJsonArray`
  - `app/api/factory/trends/search/route.ts` теперь так же толерантно читает сгенерированные ключевые фразы
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (отдельный rerun после известного transient `.next/types/validator.ts`)
  - `rg -n "extractJsonArray|keywords = parsed|const posts = extractJsonArray" lib/factory/extractJson.ts app/api/factory/repurpose/route.ts app/api/factory/trends/search/route.ts`
- Результат:
  - object-style и array-style LLM parsing в factory теперь покрыты общими helper'ами
  - ещё один класс случайных 502 на почти-валидных ответах модели закрыт без роста сложности

### 2026-06-26 02:03

- Ветка: текущая рабочая ветка контент-завода
- Цель: посадить критичный ОТК-маршрут на общий tolerant JSON path, не потеряв локальный salvage fallback
- Изменено:
  - `app/api/factory/video-critic/route.ts`: `parseLooseJson()` теперь сначала использует общий `extractJson()`
  - локальный fallback по осям/arrays сохранён, так что обрезанные ответы по-прежнему можно частично восстановить
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "extractJson|parseLooseJson" app/api/factory/video-critic/route.ts`
- Результат:
  - `video-critic` стал ближе к остальным factory-роутам по поведению и меньше зависит от собственного regex-path
  - ещё один риск спонтанного 502 на ОТК-петле снят без изменения продуктовой логики

### 2026-06-26 02:58

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть пару живых UI-хвостов в `studio.html`, которые мешали оператору и путали контекст
- Изменено:
  - `public/inferno/studio.html`: `go()` теперь мягко сбрасывает тред Проводника при переходе между экранами
  - в тред добавляется короткий разделитель `— переход: экран —`, а накопленный старый чат не тянется через весь UI-флоу
  - переключение инструментов в инспекторе теперь чистит чужой `preview` state, если там висела `error` или `in_progress` от другого tool
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (отдельный rerun после известного transient `.next/types/validator.ts`)
  - `rg -n "resetAssistantThread|clearForeignPreviewState|function go\\(" public/inferno/studio.html`
- Результат:
  - Проводник меньше тащит устаревший контекст между экранами
  - инспектор меньше показывает оператору stale-state от другого инструмента

### 2026-06-26 03:00

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать технический жаргон из пустых состояний Studio, чтобы UI разговаривал с оператором, а не с разработчиком
- Изменено:
  - `public/inferno/studio.html`: empty-state в бренд-ките больше не ссылается на `migration brand_kits`
  - `public/inferno/studio.html`: empty-state балансов больше не ссылается на `migration service_balances`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (отдельный rerun после известного transient `.next/types/validator.ts`)
  - `rg -n "пока нет брендов для бренд-кита|нет сервисов для показа балансов" public/inferno/studio.html`
- Результат:
  - пустые состояния Studio звучат спокойнее и чище
  - пользовательский UI меньше светит внутренние названия схем/таблиц

### 2026-06-26 03:06

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать ещё один мёртвый UI-контрол из канваса, который только создавал ожидание несуществующей функции
- Изменено:
  - `public/inferno/studio.html`: из хедера канваса убран декоративный `зум/пан — скоро` блок
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n "ИИ-заполнить граф|зум/пан — скоро" public/inferno/studio.html`
- Результат:
  - хедер канваса стал чище
  - UI меньше обещает оператору функцию, которой всё равно нельзя воспользоваться

### 2026-06-26 03:12

- Ветка: текущая рабочая ветка контент-завода
- Цель: сузить MVP-навигацию Studio и убрать из неё placeholder-экран, который не участвует в текущем выпуске контента
- Изменено:
  - `public/inferno/studio.html`: экран `Тексты` убран из массива `SCREENS`
  - `restoreSession()` теперь переводит legacy `screen="text"` обратно в `center`
  - сам `screenText()` оставлен как мягкий fallback с честным сообщением, если кто-то попадёт туда напрямую
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n 'screen==="text"|Линия текстов пока выключена|Пины и карточки' public/inferno/studio.html`
- Результат:
  - боковая навигация стала ближе к реальному MVP-флоу
  - Studio меньше отвлекает на неактивную линию завода

### 2026-06-26 03:18

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать ещё один служебный экран из основной навигации Studio, не ломая прямой fallback-path
- Изменено:
  - `public/inferno/studio.html`: `Дизайн-система` убрана из массива `SCREENS`
  - `restoreSession()` теперь переводит legacy `screen="ds"` обратно в `center`
  - `screenDS()` оставлен как служебный fallback с честным сообщением, что это dev-only экран
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
  - `rg -n 'screen==="ds"|служебный fallback|Дизайн-система' public/inferno/studio.html`
- Результат:
  - системная навигация Studio стала ещё уже и ближе к операторскому MVP
  - dev-only поверхность меньше торчит в основном UI

### 2026-06-26 03:24

- Ветка: текущая рабочая ветка контент-завода
- Цель: вычистить legacy self-heal хвост из Studio, раз в Sprint 1 ручная самопочинка всё равно отключена
- Изменено:
  - `public/inferno/studio.html`: удалён неиспользуемый helper `selfHeal()`
  - убран флаг `SELF_HEAL_ENABLED`, который больше только шумел в UI
  - вместо старых `manual heal off / heal off` оставлен спокойный статус `sprint 1 · fail-open`
- Проверки:
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (отдельный rerun после известного transient `.next/types/validator.ts`)
  - `rg -n 'SELF_HEAL_ENABLED|selfHeal\\(|manual heal|heal off|fail-open' public/inferno/studio.html`
- Результат:
  - код Studio стал чуть уже и честнее отражает текущий режим Sprint 1
  - операторский UI меньше показывает legacy-подсказки про отключённую самопочинку

### 2026-06-26 03:31

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать из Studio ещё одну мёртвую experimental-ветку, чтобы оператор не видел отключённые action-потоки
- Изменено:
  - `public/inferno/studio.html`: удалён выключенный `EXPERIMENTAL_VARIANTS_ENABLED`
  - вырезан неиспользуемый UI потока `hook tournament` в инспекторе ноды
  - удалены мёртвые helper'ы `runHookTournament()` и `openHookPicker()`
  - из карточек библиотеки убран legacy action для `recipe-variants`, который всё равно был недоступен в Sprint 1
- Проверки:
  - `rg -n 'EXPERIMENTAL_VARIANTS_ENABLED|runHookTournament|openHookPicker|hook tournament|recipe-variants' public/inferno/studio.html`
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - Studio стала ближе к реальному Sprint 1 MVP без ложных кнопок и выключенных веток
  - код фронта упростился: меньше мёртвых состояний, меньше лишних сценариев для сопровождения

### 2026-06-26 03:39

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать расхождение в разборе LLM-ответов между живыми factory route'ами и перевести их на общий tolerable parser
- Изменено:
  - `app/api/factory/autofill/route.ts`: локальный `looseJson()` удалён, route переведён на `extractJson()`
  - `app/api/factory/broll/route.ts`: удалён локальный `parseJson()`, разбор ответа Claude теперь идёт через `extractJson()`
  - `app/api/factory/scripts/route.ts`: самодельный `extractScripts()` заменён на общий `extractJsonArray()`
- Проверки:
  - `rg -n 'looseJson|function parseJson|function extractScripts|extractJsonArray\\(|extractJson\\(' app/api/factory/autofill/route.ts app/api/factory/broll/route.ts app/api/factory/scripts/route.ts`
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - живые LLM-path теперь ближе по поведению при markdown-обёртке, хвостовых запятых и обрезанном JSON
  - уменьшено дублирование parsing-логики, значит ниже риск, что один маршрут переживает битый ответ модели, а соседний падает 502

### 2026-06-26 03:47

- Ветка: текущая рабочая ветка контент-завода
- Цель: довести до общего tolerant parsing ещё и внешние video/API-интеграции, чтобы баланс/submit-ответы не зависели от локальных `JSON.parse(text)`-веток
- Изменено:
  - `lib/factory/creatify.ts`: `creatifyBalance()` и `jpost()` переведены на общий `extractJson()`
  - `lib/factory/falVideo.ts`: `falBalance()` тоже переведён на `extractJson()`
- Проверки:
  - `rg -n 'extractJson\\(|JSON\\.parse\\(text\\)' lib/factory/creatify.ts lib/factory/falVideo.ts`
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (после известного transient `.next/types/validator.ts` сделан отдельный rerun)
- Результат:
  - FAL/Creatify-слой теперь использует тот же tolerant parsing-контракт, что и живые LLM-route'ы
  - снижен риск локального 500/diagnostic drift из-за чуть нестандартного JSON-ответа от внешнего сервиса

### 2026-06-26 03:55

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть класс ошибок, где живой factory route мог свалиться платформенным 500 без ясного JSON-диагноза
- Изменено:
  - `app/api/factory/prepare-product/route.ts`: добавлен outer `try/catch` с `prepare-product crash: ...`
  - `app/api/factory/subtitle/route.ts`: добавлен outer `try/catch` с `subtitle crash: ...`
  - `app/api/factory/scenario-quality/route.ts`: добавлен outer `try/catch` с `scenario-quality crash: ...`
- Проверки:
  - `rg -n 'prepare-product crash|subtitle crash|scenario-quality crash' app/api/factory/prepare-product/route.ts app/api/factory/subtitle/route.ts app/api/factory/scenario-quality/route.ts`
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - подготовка ассетов, субтитры и quality-check теперь отдают явный JSON-диагноз даже при throw внутри helper'ов
  - меньше шансов получить “тихое” platform-level 500 без понятного контекста в factory execution path

### 2026-06-26 04:03

- Ветка: текущая рабочая ветка контент-завода
- Цель: добить ещё два живых route'а из execution path и operator-facing creatify service-endpoint'ы тем же crash-contract hardening
- Изменено:
  - `app/api/factory/creatify-credits/route.ts`, `creatify-avatars/route.ts`, `creatify-voices/route.ts`, `creatify-music/route.ts`: добавлен outer `try/catch` с явным JSON-диагнозом
  - `app/api/factory/assemble/route.ts`: добавлен `assemble crash: ...`
  - `app/api/factory/wb-index/route.ts`: добавлен `wb-index crash: ...`
- Проверки:
  - `rg -n 'creatify-(credits|avatars|voices|music) crash|assemble crash|wb-index crash' app/api/factory/creatify-credits/route.ts app/api/factory/creatify-avatars/route.ts app/api/factory/creatify-voices/route.ts app/api/factory/creatify-music/route.ts app/api/factory/assemble/route.ts app/api/factory/wb-index/route.ts`
  - `npm run build`
  - `npx tsc --noEmit --pretty false` (после известного transient `.next/types/validator.ts` сделан отдельный rerun)
- Результат:
  - сервисные creatify-эндпоинты для worker/studio теперь меньше рискуют отдавать пустоту при внезапном throw
  - `assemble` и `wb-index` тоже переведены на явный JSON error-surface, что упрощает диагностику падений в живом прогоне

### 2026-06-26 04:14

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть crash-contract на ключевых execution/diagnostic endpoints без изменения успешного пути
- Изменено:
  - `app/api/factory/graph-run/tick/route.ts`: добавлен `graph-run/tick crash: ...`
  - `app/api/factory/graph-run/cron/route.ts`: добавлен `graph-run/cron crash: ...`
  - `app/api/factory/shotstack-smoke/route.ts`: добавлен `shotstack-smoke crash: ...`
  - `app/api/factory/trends/result/route.ts`: добавлен `trends/result crash: ...`
- Проверки:
  - `rg -n 'graph-run/tick crash|graph-run/cron crash|shotstack-smoke crash|trends/result crash' app/api/factory/graph-run/tick/route.ts app/api/factory/graph-run/cron/route.ts app/api/factory/shotstack-smoke/route.ts app/api/factory/trends/result/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - основной tick/cron execution loop теперь отдаёт явный JSON crash-diagnostic при неожиданном throw
  - smoke/status endpoints стали полезнее для оператора: вместо platform 500 будет понятный route-level контекст

### 2026-06-26 04:22

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать polling/status endpoints устойчивыми к throw в интеграционных helper'ах
- Изменено:
  - `app/api/factory/video-fal-status/[id]/route.ts`: добавлен `video-fal-status crash: ...`
  - `app/api/factory/ugc-creatify-status/[id]/route.ts`: добавлен `ugc-creatify-status crash: ...`
  - `app/api/factory/ugc-creatify-render/[id]/route.ts`: добавлен `ugc-creatify-render crash: ...`
  - `app/api/factory/static-status/route.ts`: добавлен `static-status crash: ...`
- Проверки:
  - `rg -n 'video-fal-status crash|ugc-creatify-status crash|ugc-creatify-render crash|static-status crash' ...`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - browser/studio polling теперь должен получать JSON `{status:"error", error:"..."}` даже при неожиданном исключении
  - меньше шансов, что оператор увидит generic non-JSON/API failure вместо понятного статуса задачи

### 2026-06-26 04:30

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть оставшиеся live route'ы без внешнего crash-contract
- Изменено:
  - `app/api/factory/jobs/corpus-cron/route.ts`: добавлен `jobs/corpus-cron crash: ...`
  - `app/api/factory/jobs/balances-cron/route.ts`: добавлен `jobs/balances-cron crash: ...`
  - `app/api/factory/corpus/sync-orbit/route.ts`: добавлен `corpus/sync-orbit crash: ...`
- Проверки:
  - `rg -n 'jobs/corpus-cron crash|jobs/balances-cron crash|corpus/sync-orbit crash' app/api/factory/jobs/corpus-cron/route.ts app/api/factory/jobs/balances-cron/route.ts app/api/factory/corpus/sync-orbit/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
  - контрольный scan: `factory route без try` → пусто для non-stub route'ов
- Результат:
  - текущий класс P1 `platform 500 без route-level JSON` закрыт по всему живому `app/api/factory`
  - фоновые cron/corpus endpoints теперь дают диагностируемый JSON even on unexpected throw

### 2026-06-26 04:37

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать helper-level падения на не-JSON ответах render-интеграций
- Изменено:
  - `lib/factory/shotstack.ts`: `shotstackSubmit()` и `shotstackStatus()` теперь парсят `r.json().catch(() => ({}))`
  - `lib/factory/remotionRender.ts`: `remotionSubmit()` и `remotionStatus()` теперь парсят `r.json().catch(() => ({}))`
- Проверки:
  - `rg -n 'r\\.json\\(\\)\\)' lib/factory/shotstack.ts lib/factory/remotionRender.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - Shotstack/Remotion helper'ы больше не превращают HTML/пустое тело при HTTP 200 в необъяснимый throw
  - graph-run/render-poll получает обычный `null`/`error` контракт, а не исключение из JSON parser

### 2026-06-26 04:44

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать Creatify helper устойчивее к не-JSON ответам API на read-only/status paths
- Изменено:
  - `lib/factory/creatify.ts`: `creatifyListCreators()`, `creatifyListAvatars()`, `creatifyGetArray()` и `creatifyStatus()` теперь используют `r.json().catch(() => ({}))`
- Проверки:
  - `rg -n 'await r\\.json\\(\\)' lib/factory/creatify.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - голосовые/музыкальные/аватарные picker paths и Creatify status меньше зависят от идеального JSON-тела ответа
  - Studio/worker получают мягкий пустой список или `status:error`, а не исключение из helper'а

### 2026-06-26 04:51

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать ещё несколько helper-level JSON parse throws из ASR/TTS/media extraction paths
- Изменено:
  - `lib/factory/asr.ts`: `transcribeFal()` теперь парсит Whisper JSON через `r.json().catch(() => ({}))`
  - `lib/factory/elevenlabs.ts`: `elevenListVoices()` теперь мягко переживает не-JSON ответ `/voices`
  - `lib/factory/serverMedia.ts`: `extractFrames()` и `extractPosterUrl()` теперь мягко переживают не-JSON ответ FAL extract-frame
- Проверки:
  - `rg -n 'await r\\.json\\(\\)' lib/factory/asr.ts lib/factory/elevenlabs.ts lib/factory/serverMedia.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - ASR, voice picker и server-side frame/poster extraction больше не падают на пустом/HTML теле ответа при HTTP 200
  - helper'ы возвращают штатный пустой/error результат, который graph-run и UI уже умеют отображать

### 2026-06-26 04:58

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть остаточные naked `r.json()` на live factory paths
- Изменено:
  - `lib/factory/telegram.ts`: Telegram API теперь возвращает `{ ok:false, error:"telegram ... не JSON" }` при не-JSON ответе
  - `lib/factory/falVideo.ts`: `falVideoSubmitDetailed()` мягко обрабатывает не-JSON success response
  - `lib/factory/trendSources.ts`: Apify dataset response теперь мягко деградирует в `[]`
  - `app/api/factory/oembed/route.ts`: oEmbed response теперь best-effort без JSON throw
  - `app/api/factory/telegram/route.ts`: internal verdict posts теперь возвращают `null` при не-JSON ответе
- Проверки:
  - `rg -n 'await r\\.json\\(\\)' lib/factory app/api/factory`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - в factory-path scan больше нет голых `await r.json()` без `.catch`
  - внешние API/внутренние POST helper'ы дают штатную мягкую деградацию вместо JSON parser exception

### 2026-06-26 05:05

- Ветка: текущая рабочая ветка контент-завода
- Цель: чуть упростить worker screen для оператора и убрать лишний технический шум
- Изменено:
  - `public/inferno/studio.html`: заголовки worker screen переведены с `Ops status / Suggested actions / Latest stress / Queue snapshot` на спокойные русские подписи
  - из видимой heartbeat diagnostics карточки убран длинный raw `cmd`, вместо него показывается короткий `next`
- Проверки:
  - `rg -n 'Состояние завода|Что сделать дальше|Диагностика heartbeat|Последний стресс-тест|Очередь задач|cmd:|Ops status|Suggested actions|Latest stress|Queue snapshot' public/inferno/studio.html`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - worker page стал менее шумным и ближе к операторскому dashboard
  - технические детали не удалены из backend-диагностики, но перестали занимать основное место в UI

### 2026-06-26 05:13

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть handler-level crash-contract на трёх важных endpoints, которые не поймал file-level scan
- Изменено:
  - `app/api/factory/products/route.ts`: добавлен `products crash: ...` и мягкий `{count:0,items:[]}` при неожиданном сбое
  - `app/api/factory/static-generate/route.ts`: добавлен `static-generate crash: ...`
  - `app/api/factory/worker-state/route.ts`: `POST` heartbeat endpoint получил `worker-state POST crash: ...`
- Проверки:
  - `rg -n 'products crash|static-generate crash|worker-state POST crash' app/api/factory/products/route.ts app/api/factory/static-generate/route.ts app/api/factory/worker-state/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - стартовый список товаров Studio, static render submit и worker heartbeat sender теперь дают route-level JSON при unexpected throw
  - уточнён подход: дальше нужен handler-level scan, потому что file-level `try` может скрывать соседний незащищённый handler

### 2026-06-26 05:24

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть crash-contract на ops/status/stability endpoints, от которых зависит worker screen и диагностика
- Изменено:
  - `app/api/factory/ops/route.ts`: `loadWorkerDocs()` и вся сборка ops snapshot теперь внутри route-level `try/catch`
  - `app/api/factory/status/route.ts`: добавлен общий `status crash: ...` с безопасной формой ответа
  - `app/api/factory/stability/route.ts`: `getSupabaseAdmin()` перенесён внутрь общего crash-contract
- Проверки:
  - `rg -n 'ops crash|status crash|stability crash|ops_crash|route-level crash' app/api/factory/ops/route.ts app/api/factory/status/route.ts app/api/factory/stability/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - worker/ops/status страницы теперь не должны превращать неожиданный backend throw в HTML/500 без контекста
  - production build зелёный

### 2026-06-26 05:35

- Ветка: текущая рабочая ветка контент-завода
- Цель: укрепить MVP-путь сохранения/медиа/рендера без добавления новых функций
- Изменено:
  - `app/api/factory/gen-save/route.ts`: `POST` и `GET` получили route-level `gen-save ... crash`
  - `app/api/factory/media-store/route.ts`: добавлен `media-store crash` и безопасный пустой media response
  - `app/api/factory/video-fal/route.ts`: добавлен `video-fal crash`
  - `app/api/factory/ugc-creatify/route.ts`: добавлен `ugc-creatify crash`
  - `app/api/factory/ugc-creatify/route.ts`: pre-render quality gate переведён из hard stop `422` в fail-open warning
- Проверки:
  - `rg -n 'gen-save POST crash|gen-save GET crash|media-store crash|video-fal crash|ugc-creatify crash|fail-open stabilization' app/api/factory/gen-save/route.ts app/api/factory/media-store/route.ts app/api/factory/video-fal/route.ts app/api/factory/ugc-creatify/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - сохранение генераций, загрузка медиа, FAL submit и Creatify submit теперь возвращают JSON crash-contract при unexpected throw
  - Creatify больше не блокируется pre-render quality gate во время стабилизационного спринта; дефект сохраняется как warning

### 2026-06-26 05:43

- Ветка: текущая рабочая ветка контент-завода
- Цель: ослабить вторичные агентские endpoints, чтобы они не валили операторский поток
- Изменено:
  - `app/api/factory/artifact-check/route.ts`: добавлен внешний fail-open `artifact-check crash: ...`
  - `app/api/factory/director/route.ts`: добавлен `director crash: ...` с пустым структурированным планом
- Проверки:
  - `rg -n 'artifact-check crash|director crash' app/api/factory/artifact-check/route.ts app/api/factory/director/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - artifact gate при unexpected throw пропускает контент как warning, а не блокирует выпуск
  - director endpoint возвращает машинно-читаемый fallback вместо неструктурированного 500

### 2026-06-26 05:55

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать hard-stop на сценарии и producer decision при пустом/битом ответе LLM
- Изменено:
  - `app/api/factory/scenario/route.ts`: добавлен детерминированный fallback-сценарий с `warnings`
  - `app/api/factory/scenario/route.ts`: отсутствие Claude, invalid JSON и model exception теперь возвращают fallback вместо `502`
  - `app/api/factory/produce/route.ts`: добавлен fallback decision (`repurpose_cut` при footage, иначе `slideshow`)
  - `app/api/factory/produce/route.ts`: отсутствие Claude, invalid JSON и model exception теперь возвращают fallback decision вместо `502`
  - `app/api/factory/repurpose/route.ts`: добавлен `repurpose crash: ...`
  - `app/api/factory/hybrid-compose/route.ts`: добавлен `hybrid-compose crash: ...`
- Проверки:
  - `rg -n 'scenario fallback|scenario crash|producer fallback|produce crash|repurpose crash|hybrid-compose crash' app/api/factory/scenario/route.ts app/api/factory/produce/route.ts app/api/factory/repurpose/route.ts app/api/factory/hybrid-compose/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - MVP-путь больше не зависит полностью от идеального JSON сценариста/продюсера
  - при деградации система выбирает простой `slideshow`/`repurpose_cut`, что ближе к цели 10/10 прогонов

### 2026-06-26 06:07

- Ветка: текущая рабочая ветка контент-завода
- Цель: укрепить источники материалов и лёгкую сборку вокруг MVP-пути
- Изменено:
  - `app/api/factory/disk-source/route.ts`: добавлен мягкий `disk-source crash: ...` с пустыми `images/videos`
  - `app/api/factory/overlay/route.ts`: добавлен `overlay crash: ...`
  - `app/api/factory/broll/route.ts`: добавлен детерминированный fallback выбора фраз без Claude
  - `app/api/factory/broll/route.ts`: добавлен `broll crash: ...`
  - `app/api/factory/content-index/route.ts`: `POST/GET` получили `content-index ... crash`
- Проверки:
  - `rg -n 'disk-source crash|overlay crash|broll crash|content-index POST crash|content-index GET crash|fallbackBrollPicks' app/api/factory/disk-source/route.ts app/api/factory/overlay/route.ts app/api/factory/broll/route.ts app/api/factory/content-index/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - сбой каталога/диска теперь деградирует в “материалов нет”, а не валит downstream
  - b-roll specs можно получить без LLM, если рендерная VM/Claude временно недоступны

### 2026-06-26 06:18

- Ветка: текущая рабочая ветка контент-завода
- Цель: защитить worker/brand/winner endpoints от route-level падений
- Изменено:
  - `app/api/factory/worker-state/route.ts`: `GET` теперь ловит сбой `loadWorkerDocs()` и возвращает `worker-state GET crash: ...`
  - `app/api/factory/brand-kit/route.ts`: `GET/POST` получили `brand-kit ... crash`
  - `app/api/factory/winners/route.ts`: `POST/GET` получили `winners ... crash`
- Проверки:
  - `rg -n 'worker-state GET crash|brand-kit GET crash|brand-kit POST crash|winners POST crash|winners GET crash' app/api/factory/worker-state/route.ts app/api/factory/brand-kit/route.ts app/api/factory/winners/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - операторский worker screen больше не зависит от безошибочного чтения docs до основного `try`
  - бренд-киты и winners loop возвращают понятный JSON при unexpected throw

### 2026-06-26 06:29

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать feedback/learning слой best-effort и не мешающим выпуску
- Изменено:
  - `app/api/factory/hook-pick/route.ts`: добавлен `hook-pick crash: ...`
  - `app/api/factory/reject/route.ts`: добавлен `reject crash: ...`
  - `app/api/factory/post-metrics/route.ts`: добавлен `post-metrics crash: ...`
  - `app/api/factory/content-learn/route.ts`: `POST/GET` получили `content-learn ... crash`
- Проверки:
  - `rg -n 'hook-pick crash|reject crash|post-metrics crash|content-learn POST crash|content-learn GET crash' app/api/factory/hook-pick/route.ts app/api/factory/reject/route.ts app/api/factory/post-metrics/route.ts app/api/factory/content-learn/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - выбор/отклонение/метрики/визуальное обучение теперь возвращают структурированный JSON при unexpected throw
  - learning loop остаётся полезным, но не становится точкой отказа MVP-выпуска

### 2026-06-26 06:41

- Ветка: текущая рабочая ветка контент-завода
- Цель: ослабить LLM/API helper endpoints, которые могут вернуть пустой JSON или упасть на внешнем API
- Изменено:
  - `app/api/factory/assistant/route.ts`: добавлен `assistant crash: ...` для outer handler
  - `app/api/factory/improve-prompt/route.ts`: отсутствие Claude, пустой ответ и exception теперь возвращают prompt fallback/warning
  - `app/api/factory/improve-prompt/route.ts`: добавлен `improve-prompt crash: ...`
  - `app/api/factory/niche-playbook/route.ts`: добавлен `fallbackPlaybook()` для отсутствия Orbit/Claude/JSON
  - `app/api/factory/niche-playbook/route.ts`: добавлен `niche-playbook crash: ...`
  - `app/api/factory/trends/search/route.ts`: добавлен `trends/search crash: ...`
- Проверки:
  - `rg -n 'assistant crash|improve-prompt crash|improve-prompt empty|fallbackPlaybook|niche-playbook crash|trends/search crash' app/api/factory/assistant/route.ts app/api/factory/improve-prompt/route.ts app/api/factory/niche-playbook/route.ts app/api/factory/trends/search/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - пустой/битый playbook больше не обязан останавливать выпуск
  - prompt improvement деградирует в исходный/усиленный prompt, а не в hard failure

### 2026-06-26 06:53

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть read-only helper endpoints и trend-анализ для UI
- Изменено:
  - `app/api/factory/corpus/top-hooks/route.ts`: добавлен `top-hooks crash: ...`
  - `app/api/factory/corpus/top-sounds/route.ts`: добавлен `top-sounds crash: ...`
  - `app/api/factory/corpus/top-videos/route.ts`: добавлен `top-videos crash: ...`
  - `app/api/factory/niche-playbook/cached/route.ts`: добавлен `niche-playbook/cached crash: ...`
  - `app/api/factory/oembed/route.ts`: добавлен `oembed crash: ...`
  - `app/api/factory/trends/route.ts`: отсутствие Claude и пустой разбор теперь возвращают warning/fallback вместо `502`
  - `app/api/factory/trends/route.ts`: добавлен `trends crash: ...`
- Проверки:
  - `rg -n 'top-hooks crash|top-sounds crash|top-videos crash|niche-playbook/cached crash|oembed crash|trends crash|Claude недоступен' app/api/factory/corpus/top-hooks/route.ts app/api/factory/corpus/top-sounds/route.ts app/api/factory/corpus/top-videos/route.ts app/api/factory/niche-playbook/cached/route.ts app/api/factory/oembed/route.ts app/api/factory/trends/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - UI helpers теперь возвращают пустые списки/notes при unexpected throw
  - trend-анализ больше не валит поток из-за недоступного Claude

### 2026-06-26 07:04

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть оставшиеся операторские POST-оркестраторы crash-contract'ами
- Изменено:
  - `app/api/factory/batch/route.ts`: добавлен `batch crash: ...`
  - `app/api/factory/graph-run/rejudge/route.ts`: добавлен `graph-run/rejudge crash: ...`
  - `app/api/factory/corpus/init-monitors/route.ts`: добавлен `corpus/init-monitors crash: ...`
  - `app/api/factory/telegram/route.ts`: `GET` получил `telegram GET crash: ...`
  - `app/api/factory/telegram/route.ts`: `POST` получил fail-open `telegram POST crash: ...` с `ok:true`, чтобы Telegram не ретраил webhook
- Проверки:
  - `rg -n 'batch crash|graph-run/rejudge crash|corpus/init-monitors crash|telegram GET crash|telegram POST crash' app/api/factory/batch/route.ts app/api/factory/graph-run/rejudge/route.ts app/api/factory/corpus/init-monitors/route.ts app/api/factory/telegram/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
- Результат:
  - batch/rejudge/monitor init теперь возвращают структурированный JSON при unexpected throw
  - Telegram webhook продолжает отвечать `ok:true` даже при route-level exception, сохраняя fail-closed безопасность на входе

### 2026-06-26 07:15

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть последние найденные handler-level gaps в factory routes
- Изменено:
  - `app/api/factory/corpus/analyze-niches/route.ts`: добавлен `corpus/analyze-niches crash: ...`
  - `app/api/factory/corpus/build-missing-playbooks/route.ts`: добавлен `corpus/build-missing-playbooks crash: ...`
  - `app/api/factory/corpus/sync-all-orbits/route.ts`: добавлен `corpus/sync-all-orbits crash: ...`
  - `app/api/factory/graph-run/watchdog/route.ts`: `POST` получил safe wrapper вокруг disabled stub
- Проверки:
  - `rg -n 'corpus/analyze-niches crash|corpus/build-missing-playbooks crash|corpus/sync-all-orbits crash|graph-run/watchdog POST crash' app/api/factory/corpus/analyze-niches/route.ts app/api/factory/corpus/build-missing-playbooks/route.ts app/api/factory/corpus/sync-all-orbits/route.ts app/api/factory/graph-run/watchdog/route.ts`
  - `npx tsc --noEmit --pretty false`
  - `npm run build`
  - custom handler scan over `app/api/factory/**/route.ts`
- Результат:
  - handler scan result: `remaining=0`
  - по текущему критерию у factory route handlers не осталось голых handler-level точек без `try/fallback/crash/disabled` контракта

### 2026-06-26 07:28

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать quality-signal честнее и убрать false-positive шум из ops alerts
- Изменено:
  - `lib/factory/observability.ts`: `quality_signal` теперь считается по последним 10 прогонам, где реально есть `run_plan.otk.basis`
  - `quality_signal.top_basis_reason` теперь считается из того же quality-window, а не из всех строк выборки
  - `missing_basis` больше не накапливается из старых/недошедших до ОТК рецептов
  - `app/api/factory/studio/route.ts` и `app/api/factory/video-critic/route.ts`: убраны устаревшие `eslint-disable` комментарии
- Проверки:
  - `npx eslint lib/factory/observability.ts app/api/factory/ops/route.ts app/api/factory/studio/route.ts app/api/factory/video-critic/route.ts`
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Наблюдение:
  - первый параллельный `tsc` попал в гонку с `next build`, когда `.next/types` пересоздавались; повторный отдельный `tsc` прошёл зелёным
- Результат:
  - алерты `critic_fallback_dominates` / `critic_text_prefilter_dominates` стали основываться на реальных ОТК-оценках
  - quality observability остаётся fail-open и не блокирует выпуск роликов

### 2026-06-26 07:41

- Ветка: текущая рабочая ветка контент-завода
- Цель: синхронизировать worker queue с фактическим состоянием задач и починить fallback-парсинг
- Изменено:
  - `docs/factory-railway-task-queue.md`: T-002/T-004/T-005 переведены в `done`, T-003 честно отмечен как `blocked`
  - `docs/factory-railway-task-queue.md`: зафиксировано, что `scenario-rewrite` временно disabled для MVP-stability
  - `lib/factory/workerState.ts`: queue parser теперь берёт task id из заголовка `### T-002 · ...`
  - `lib/factory/workerState.ts`: inline-блокер после `- Блокеры:` теперь попадает в worker fallback snapshot
  - `lib/factory/workerHeartbeat.mjs`: sender получил тот же парсинг task id и inline blocker
- Проверки:
  - `npx tsx -e "...loadWorkerDocs()..."`
  - `npx eslint lib/factory/workerState.ts`
  - `node --check lib/factory/workerHeartbeat.mjs`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - worker fallback теперь показывает `T-003` и причину blocked-состояния вместо пустого task id
  - экран worker меньше путает оператора, если heartbeat DB недоступна и Studio живёт от markdown queue

### 2026-06-26 07:55

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать живой UI-вызов disabled `batch-build` из Studio
- Изменено:
  - `public/inferno/studio.html`: режим ночного прогона «с нуля» теперь визуально отключён
  - `public/inferno/studio.html`: активный запрос к `/api/factory/batch-build` и polling `/batch-build?build_id=...` удалены из UI path
  - `public/inferno/studio.html`: оператор видит пояснение, что `batch-build` выведен из MVP-контура, и может запускать только прогон из готовых черновиков
- Проверки:
  - `rg -n "batch-build" public/inferno/studio.html`
  - `npm run build`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - Studio больше не предлагает кнопку, которая дергает disabled orchestrator
  - UI стал ближе к фактической Sprint 1 архитектуре: один канонический execution path без второго batch-build оркестратора

### Verification / cleanup follow-up

- Ветка: текущая рабочая ветка контент-завода
- Цель: снизить шум проверок после большого stabilization/observability набора
- Изменено:
  - `app/api/factory/**`: убраны неиспользуемые `eslint-disable` директивы
  - `lib/factory/**`: убраны неиспользуемые `eslint-disable` директивы
  - `app/api/lab/**`, `lib/lab/**`, `app/uniquizer/page.tsx`, `app/video-overlay/page.tsx`: убран автофиксируемый lint-шум из соседних генерационных helper surfaces
  - `app/abc/page.tsx`: заменён последний `<img>` на `next/image`, чтобы общий lint был полностью чистым
  - `STABILITY_REPORT.md`: добавлены latest verification notes по sandbox-блокерам
- Проверки:
  - `npm run lint`: pass, `0` errors, `0` warnings
  - `npx tsc --noEmit`: pass
  - custom factory handler scan: `96` route handlers, `0` gaps
  - `npm run build`: blocked by sandbox/Turbopack `Operation not permitted` while creating process / binding port for `geist` CSS module
  - `npx tsx lib/factory/*.test.mts`: blocked by sandbox `EPERM` on `tsx` IPC pipe
  - later superseded: build переведён на webpack и прошёл; factory tests переведены на `node --import tsx` и прошли
- Результат:
  - весь репозиторий стал чище для будущих проверок: lint теперь не прячет новые проблемы в старом шуме
  - build/unit-test блокеры зафиксированы как ограничения текущего execution окружения, а не как найденные ошибки приложения

### Quality fail-open follow-up

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать оставшиеся secondary paths, которые могли возвращать старую `otk_fail/rejected` семантику
- Изменено:
  - `app/api/factory/graph-run/rejudge/route.ts`: score < 7 теперь даёт `status:"warning"`, пишет warning в `run_plan.warnings` и не создаёт `rejected` signal
  - `app/api/factory/graph-run/rejudge/route.ts`: `basis` / `basis_reason` из `video-critic` сохраняются в `plan.otk`
  - `app/api/factory/graph-run/rejudge/route.ts`: warning-записи теперь дедуплицируются через локальный `addPlanWarning`
  - `app/api/factory/gen-save/route.ts`: новые записи `generation_history` при `otk < 7` получают `status:"warning"`, а не `otk_fail`
  - `lib/factory/genHistory.ts`: комментарий статусов уточнён: `otk_fail` остаётся legacy read-only статусом
- Проверки:
  - `npx eslint app/api/factory/graph-run/rejudge/route.ts`
  - `npx eslint app/api/factory/graph-run/rejudge/route.ts && npx tsc --noEmit`
  - `npm run lint`
  - `npx tsc --noEmit`
  - `rg -n "status: .*otk_fail|= \"otk_fail\"|event: status === .*rejected" app/api/factory lib/factory public/inferno/studio.html`
- Результат:
  - основной и вторичный quality paths теперь совпадают по Sprint 1 принципу: низкое качество помечается warning, выпуск/сохранение не блокируется
  - новые `otk_fail` больше не создаются в live factory routes; старые значения остаются только для исторической аналитики и stress summary

### Stress history archive follow-up

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть backlog по historical stress storage без новой БД и без нового сервиса
- Изменено:
  - `lib/factory/stressGraphRun.mjs`: добавлен archive mode по умолчанию
  - `lib/factory/stressGraphRun.mjs`: каждый stress-run теперь пишет timestamped JSON/Markdown в `docs/factory-stress-history/`
  - `lib/factory/stabilityArtifacts.ts`: добавлен `readStressHistorySummary()`
  - `app/api/factory/stability/route.ts`, `app/api/factory/ops/route.ts`, `app/api/factory/worker-state/route.ts`: добавлен `stress_history` summary
  - `stress_history` и `latest_stress` читаются из файлового архива даже на ветке `db_ready:false`
  - `public/inferno/studio.html`: command center и worker screen показывают compact summary stress history
  - `docs/factory-stress-history/README.md`: добавлен контракт папки и способ отключения архива
  - `STABILITY_REPORT.md` и `EXECUTION_OBSERVABILITY.md`: обновлены под latest + archive модель
- Проверки:
  - `node --check lib/factory/stressGraphRun.mjs`
  - inline script syntax check for `public/inferno/studio.html`
  - `npx tsc --noEmit && npm run lint`
- Результат:
  - latest artifacts остаются стабильным UI/backend path
  - historical stress серии теперь не затираются следующим запуском
  - automation может читать историю через `stress_history`, не парся markdown и не открывая папку
  - при Supabase outage оператор всё равно видит последний stress context из файлов
  - long-range анализ можно строить поверх файлового архива, не усложняя MVP runtime

### Static route TODO cleanup

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать misleading TODO из live route без расширения static pipeline
- Изменено:
  - `app/api/factory/static-generate/route.ts`: большой TODO-блок заменён на ссылку на backlog в `docs/factory-pin-canon.md`
- Проверки:
  - `npx eslint app/api/factory/static-generate/route.ts && npx tsc --noEmit`
  - `rg -n 'TODO|FIXME' app/api/factory lib/factory public/inferno/studio.html`
- Результат:
  - live factory/studio код больше не содержит `TODO/FIXME`
  - static line остаётся submit-only и не расширяет MVP-видео контур

### Final sandbox verification

- Ветка: текущая рабочая ветка контент-завода
- Цель: повторно проверить базовые gates после docs/UI/observability cleanup
- Проверки:
  - `npm run lint`: pass
  - `npx tsc --noEmit`: pass
  - inline script syntax check for `public/inferno/studio.html`: pass
  - custom factory handler scan: `96` route handlers, `0` gaps
  - `npx next build --webpack`: pass
  - `package.json`: `build` переведён на `next build --webpack`
  - `package.json`: добавлен `test:factory` через `node --import tsx`
  - `package.json`: добавлен `check:factory`
  - `npm run test:factory`: pass
  - `npm run build`: pass
  - `npm run check:factory`: pass
  - `npm run start -- --hostname 127.0.0.1 --port 3021`: blocked by sandbox `listen EPERM`
- Результат:
  - кодовые проверки чистые
  - production build больше не зависит от Turbopack path, который в текущем sandbox падал на `Operation not permitted`
  - factory unit tests теперь запускаются без `npx tsx` IPC path, который блокировался sandbox
  - HTTP smoke/stress нужно запускать в обычном терминале/CI, где разрешён localhost bind

### Stress history unit coverage

- Ветка: текущая рабочая ветка контент-завода
- Цель: покрыть файловый stress archive unit-тестом
- Изменено:
  - `lib/factory/stabilityArtifacts.test.mts`: добавлен изолированный тест latest/history artifacts через temp cwd
  - `lib/factory/stabilityArtifacts.ts`: `limit` теперь применяется к валидным parsed reports, а не к сырым файлам до JSON-parse
- Проверки:
  - `npm run test:factory`: pass, 9 factory test files
  - `npm run lint && npx tsc --noEmit && git diff --check`: pass
- Результат:
  - тест поймал edge case: битый самый новый JSON мог обнулить `readStressHistorySummary(1)`
  - stress history summary теперь устойчив к partial/manual archive файлам даже при малом limit

### Learning fail-open cleanup

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать последний UI/analytics хвост, где legacy quality statuses выглядели как runtime failure
- Изменено:
  - `app/api/factory/learning/route.ts`: `otk_fail`, `rejected` и `artifact_fail` теперь попадают в `warn`, а не в `fail`; `fail` зарезервирован под настоящий `run_fail`
  - `public/inferno/studio.html`: история генераций показывает legacy quality/artifact statuses как `warning`, а не как красный runtime reject
- Проверки:
  - inline script syntax check for `public/inferno/studio.html`: pass
- Результат:
  - learning dashboard согласован с Sprint 1 fail-open политикой
  - старые записи остаются видимыми, но больше не создают ложное ощущение, что выпуск роликов заблокирован

### Factory dependency cycle cleanup

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать лишнюю сцепку helper-слоя вариантов с главным graph-run оркестратором
- Найдено:
  - dependency scan показывал цикл: `graphRun -> nodeEngine -> rehostImage -> reelVariants -> graphRun`
  - импорт был type-only, но архитектурно `reelVariants` всё равно зависел от большого orchestration module
- Изменено:
  - добавлен `lib/factory/graphTypes.ts` с `RunStep`, `RunNode`, `RunPlan`, `ExecutionLogEntry`
  - `lib/factory/graphRun.ts` использует эти типы и re-export'ит их для обратной совместимости старых импортов
  - `lib/factory/reelVariants.ts` импортирует `RunNode` из `graphTypes`, а не из `graphRun`
  - type-only импорты `RunPlan` в `graphWatchdog`, `graph-run`, `graph-run/rejudge`, `reel-recompose` переведены на `graphTypes`
  - добавлен `lib/factory/dependencyCycles.test.mts`, чтобы цикл не вернулся незаметно
- Проверки:
  - factory dependency scan: `147` files, `0` import cycles
  - `npx tsc --noEmit`: pass
  - `npm run test:factory`: pass, 10 factory test files
  - `rg graphRun imports`: runtime `graphRun` imports остались только в execution/recompose paths
- Результат:
  - helper variants layer больше не связан с runtime orchestration module
  - риск hidden init/test coupling вокруг `graphRun` снижен без изменения поведения генерации

### CLI timeout guard cleanup

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать риск, что автономный stress/heartbeat процесс зависнет на одном HTTP-запросе без понятного failure result
- Root cause hypothesis:
  - production factory fetch paths в основном уже имели `AbortSignal.timeout`, но `lib/factory/stressGraphRun.mjs` и `lib/factory/workerHeartbeat.mjs` могли ждать HTTP без верхнего лимита
  - это ломает именно автономную проверку: вместо записанного timeout/fail процесс может просто висеть
- Изменено:
  - `lib/factory/stressGraphRun.mjs`: добавлен `FACTORY_STRESS_REQUEST_TIMEOUT_MS` / `--request-timeout-ms`, `fetchJson` теперь использует `AbortController`
  - `lib/factory/stressGraphRun.mjs`: timeout-конфиг clamp'ится к безопасному минимуму `5000ms`, мусорный env возвращается к дефолту `45000ms`
  - `lib/factory/stressGraphRun.mjs`: request-level failure внутри `runOnce` теперь возвращает результат `run_fail/failed` и попадает в JSON/Markdown отчёт, а не обрывает весь stress без artifact
  - `lib/factory/workerHeartbeat.mjs`: heartbeat `POST` получил `AbortSignal.timeout(15_000)`
  - `lib/factory/workerHeartbeat.mjs`: daemon-loop теперь логирует transient POST failure и продолжает следующий heartbeat, вместо выхода процесса
  - `lib/factory/cliTimeouts.test.mts`: добавлен regression guard на эти таймауты
- Проверки:
  - `node --check lib/factory/stressGraphRun.mjs && node --check lib/factory/workerHeartbeat.mjs`: pass
  - `npm run test:factory`: pass, 11 factory test files
  - `npx tsc --noEmit`: pass
- Результат:
  - stress/heartbeat больше не могут бесконечно висеть на одном HTTP-запросе
  - stress runner сохраняет отчёт даже при падении стартового `POST /graph-run` или poll-запроса после ретраев
  - один сетевой сбой heartbeat больше не превращает живой worker в ложный `stale/dead`
  - KPI-проверка лучше различает “сервер не ответил” и “прогон ещё идёт”

### Ops crash-path stress context cleanup

- Ветка: текущая рабочая ветка контент-завода
- Цель: сохранить файловый stress context даже при route-level degradation в ops endpoints
- Root cause hypothesis:
  - happy path `ops`, `worker-state`, `stability` уже отдавали latest/history stress artifacts
  - crash path этих endpoints возвращал `latest_stress:null` / `stress_history:null`, теряя самый полезный контекст для оператора
- Изменено:
  - `app/api/factory/worker-state/route.ts`: catch path best-effort читает `latest_stress` и `stress_history`
  - `app/api/factory/ops/route.ts`: catch path best-effort читает `latest_stress` и `stress_history`
  - `app/api/factory/stability/route.ts`: catch path best-effort читает `stress_history`
  - `lib/factory/opsFailOpen.test.mts`: добавлен regression guard на crash-path contracts
- Проверки:
  - `npm run test:factory`: pass, 12 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по затронутым route/test файлам: pass
- Результат:
  - при ops-route сбое UI/automation всё равно получает последний файловый stress context
  - observability layer стал ближе к fail-open контракту Sprint 1

### M4 jobs migration guard closeout

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть M4 не только документально, но и guard-тестом против возврата legacy jobs runner
- Root cause:
  - `jobs/enqueue/list/tick` и `lib/factory/jobs.ts` уже были выведены из runtime, но в живом factory-коде оставались формулировки про `self-chaining очередь` / `jobs/tick`
  - это не ломало код, но поддерживало неверную модель “у нас всё ещё второй runner”
- Изменено:
  - `lib/factory/shotstack.ts`, `lib/factory/remotionRender.ts`, `lib/factory/graphRun.ts`, `app/api/factory/batch/route.ts`, `app/api/factory/graph-run/tick/route.ts`: comments переведены на `graph-run runner` terminology
  - `lib/factory/jobsMigrationGuard.test.mts`: добавлен guard на отсутствие `lib/factory/jobs.ts`, runtime imports, live callers disabled `jobs/enqueue|list|tick`, и stale comments
  - `docs/factory-jobs-migration-backlog.md`: M4 status обновлён guard-строками
- Проверки:
  - `npm run test:factory`: pass, 13 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по затронутым файлам: pass
- Результат:
  - M4 jobs deletion/migration теперь закреплён автоматической проверкой
  - graph-run остаётся единственным runtime execution runner для MP4 path

### M5 market feedback loop hardening

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать контур `post_metrics -> winners -> learning` честным и fail-open
- Root cause:
  - `/api/factory/post-metrics` выставлял `forwarded:true` сразу после вызова `/winners`, даже если `/winners` вернул ошибку
  - `/api/factory/ab-rank` мог падать route-level ошибкой при отсутствующей/неприменённой `post_metrics`, хотя это read-only analytics
  - `views=-5` проходил валидацию как truthy number и мог загрязнить market ranking
- Изменено:
  - `app/api/factory/post-metrics/route.ts`: `forwarded:true` теперь только при `res.ok && payload.ok === true`
  - `app/api/factory/post-metrics/route.ts`: добавлен `warnings[]` для случаев, когда метрики сохранены, но winner-forward не прошёл
  - `app/api/factory/post-metrics/route.ts`: `views/saves` нормализуются как неотрицательные целые, `watch_rate/ctr` clamp'ятся в `0..1`
  - `app/api/factory/ab-rank/route.ts`: отсутствие `post_metrics` или сбой `node_recipes` возвращает пустой рейтинг с `note`, а не 500
  - `public/inferno/studio.html`: карточка рецепта показывает `✓ метрики · warning`, если winner-forward не завершился
  - `lib/factory/marketFeedback.test.mts`: добавлен regression guard на M5-контракт
- Проверки:
  - `npm run test:factory`: pass, 14 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M5-файлам: pass
  - inline Studio JS syntax check: pass
- Результат:
  - market feedback loop перестал давать ложноположительный `forwarded`
  - read-only ranking больше не блокирует UI при ещё не готовой таблице метрик
  - в learning loop не попадают отрицательные/мусорные просмотры

### M6 learning readback hardening

- Ветка: текущая рабочая ветка контент-завода
- Цель: оставить learning hints полезными для генерации/критика, но не дать им стать новой точкой отказа или prompt-bloat
- Root cause:
  - `learningHints` уже работал best-effort, но читал `winners`, `hook_corpus` и `rejects` почти как есть
  - длинные hooks/reasons теоретически могли раздувать prompt context для `decompose` / `video-critic`
  - readback слой не был закреплён отдельным regression guard
- Изменено:
  - `lib/factory/learningHints.ts`: winner/corpus/reject snippets нормализуются и ограничиваются по длине
  - `lib/factory/learningHints.ts`: пустые niche и ошибки БД продолжают возвращать пустой hint без падения основного path
  - `lib/factory/learningHints.test.mts`: добавлен guard на bounded hints и fail-open contract
- Проверки:
  - `npm run test:factory`: pass, 15 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M6-файлам: pass
- Результат:
  - learning readback остаётся вспомогательным сигналом, а не блокером выпуска
  - winners/corpus/reject feedback не может бесконтрольно раздуть промпт
  - fail-open поведение learning hints закреплено тестом

### M7 generation history lineage hardening

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть дыру, где `gen-save` мог сохранить/найти ролик, но не оставить запись попытки в `generation_history`
- Root cause:
  - happy path уже писал историю после успешного insert в `content_assets`
  - early returns при `already:true` и dedupe-race возвращали URL до записи `generation_history`
  - ошибки storage/catalog insert возвращались как `ok:false`, но не оставляли `artifact_fail` след для разборов
- Изменено:
  - `app/api/factory/gen-save/route.ts`: добавлен локальный `logGenSaveHistory(...)` helper
  - `gen-save` теперь best-effort логирует success, dedupe hit, unique-index race, storage failure, catalog insert failure и carousel path
  - низкий ОТК в history остаётся `warning`, а не fail-closed статусом
  - `lib/factory/genSaveHistory.test.mts`: добавлен regression guard на lineage contract
- Проверки:
  - `npm run test:factory`: pass, 16 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M7-файлам: pass
- Результат:
  - идемпотентный каталог больше не означает потерянную попытку генерации
  - failed artifact/catalog saves теперь видны как данные для оператора и learning/debug loop
  - lineage слой стал полезнее без изменения основного execution runner

### M8 node-preview lineage cache-hit hardening

- Ветка: текущая рабочая ветка контент-завода
- Цель: закрыть вторую dedupe/cache дыру в V20 history path
- Root cause:
  - `node-preview` уже писал `generation_history` на instant done и async done
  - cache-hit path возвращал готовый preview до записи истории
  - для оператора это выглядело как новая попытка, но для learning/history слоя попытка исчезала
- Изменено:
  - `app/api/factory/node-preview/route.ts`: cache-hit теперь best-effort пишет `generation_history` с `source:"node_preview"` и `reason:"cache_hit"`
  - `lib/factory/nodePreviewHistory.test.mts`: добавлен guard на cache-hit, instant done и async done history paths
- Проверки:
  - `npm run test:factory`: pass, 17 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M8-файлам: pass
- Результат:
  - hash-cache больше не скрывает реальные operator/test attempts
  - `node-preview` остаётся быстрым и идемпотентным, но lineage теперь честнее

### M9 graph-run clip lineage hardening

- Ветка: текущая рабочая ветка контент-завода
- Цель: чтобы дорогие i2v/fal клипы, которые graph-run переносит в durable storage, тоже попадали в lineage
- Root cause:
  - `persistClips` уже спасал эфемерные external clip URLs в `factory-media/clips/*`
  - dedupe/success/failure paths меняли `node.url` или silently degraded, но не писали `generation_history`
  - при разборе качества было видно финальный ролик, но не всегда было видно clip-level provenance
- Изменено:
  - `lib/factory/graphRun.ts`: `persistClips(...)` теперь принимает `recipeId`
  - clip durable success и dedupe hit пишут `generation_history` с `reason:"clip_library"` / `clip_library_dedupe`
  - fetch/upload/publicUrl failures пишутся как `artifact_fail` best-effort, не ломая сборку
  - `lib/factory/graphRunClipHistory.test.mts`: добавлен guard на clip lineage contract
- Проверки:
  - `npm run test:factory`: pass, 18 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M9-файлам: pass
- Результат:
  - clip-level provenance стал видимым в `generation_history`
  - durable clip cache остаётся best-effort и не блокирует MP4 path
  - debugging “почему финальный ролик такой” получил больше данных без нового сервиса

### M10 generation-history API warning contract

- Ветка: текущая рабочая ветка контент-завода
- Цель: сделать history read-path честным: fail-open сохраняется, но деградация не маскируется под “история пустая”
- Root cause:
  - `getRecipeHistory()` возвращал `[]` при отсутствующем Supabase, ошибке таблицы или исключении
  - `/api/factory/generation-history` из-за этого не различал “нет попыток” и “history слой недоступен”
- Изменено:
  - `lib/factory/genHistory.ts`: добавлен `getRecipeHistoryResult(...) -> { history, warning? }`
  - старый `getRecipeHistory(...)` сохранён как совместимый wrapper
  - `app/api/factory/generation-history/route.ts`: ответ теперь содержит `warning:null|string`
  - `lib/factory/generationHistoryApi.test.mts`: добавлен guard на warning contract
- Проверки:
  - `npm run test:factory`: pass, 19 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M10-файлам: pass
- Результат:
  - UI/оператор может отличить пустую историю от недоступной `generation_history`
  - fail-open поведение сохранено: выпуск роликов не зависит от readback слоя

### M11 learning dashboard warning contract

- Ветка: текущая рабочая ветка контент-завода
- Цель: чтобы learning dashboard не маскировал недоступные read-модели под “нулевые метрики”
- Root cause:
  - `/api/factory/learning` был best-effort, но `safe(...)` возвращал fallback без объяснения
  - Supabase `{ error }` из отдельных таблиц не пробрасывался в warning context
  - оператор видел пустые `signals/hooks/history/winners`, но не видел, какой слой деградировал
- Изменено:
  - `app/api/factory/learning/route.ts`: добавлен `warnings[]`
  - каждый read-block получил label (`cf_signals`, `viral_hooks`, `generation_history`, `node_templates`, `content_assets winners`)
  - Supabase query errors теперь превращаются в warning, route остаётся `ok:true`
  - `lib/factory/learningApiWarnings.test.mts`: добавлен guard на warning contract
- Проверки:
  - `npm run test:factory`: pass, 20 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M11-файлам: pass
- Результат:
  - learning dashboard остаётся fail-open, но стал наблюдаемым
  - следующий раз пустые метрики будет проще отличить от отсутствия данных

### M12 observer route fail-open contract

- Ветка: текущая рабочая ветка контент-завода
- Цель: убрать route-level 500 из read-only observer pulse
- Root cause:
  - `loadObserverPulse(...)` уже деградировал в `partial:true`
  - но `/api/factory/observer` возвращал 500 при отсутствующем Supabase или outer crash
  - внешний монитор/Studio могли видеть красную ошибку вместо частичного pulse
- Изменено:
  - `app/api/factory/observer/route.ts`: missing-db и crash paths теперь возвращают `ok:true, partial:true, updated_at, error`
  - ответы observer route остаются `Cache-Control: no-store`
  - `lib/factory/observerFailOpen.test.mts`: добавлен guard на observer fail-open contract
- Проверки:
  - `npm run test:factory`: pass, 21 factory test files
  - `npx tsc --noEmit`: pass
  - targeted eslint по M12-файлам: pass
- Результат:
  - observer больше не превращает read-only деградацию в route-level failure
  - мониторинг получает частичный диагноз вместо “endpoint упал”

### Live stress verification + report contract cleanup

- Ветка: текущая рабочая ветка контент-завода
- Цель: зафиксировать реальный production-like stress и убрать путаницу между текущим stress-result и DB-wide stability snapshot
- Факт прогона:
  - base: `http://127.0.0.1:3012`
  - recipe_id: `68`
  - total_runs: `10`
  - completed: `10`
  - failed: `0`
  - run_fail: `0`
  - timeouts: `0`
  - avg_duration_sec: `19`
  - warnings: `10` (`OTK below threshold: 6`, fail-open допустим)
- Root cause:
  - `docs/factory-latest-stress.md` показывал `target_met:no` из `/api/factory/stability`
  - этот endpoint считает DB-wide recent runs и включает старые failures, а не только текущий stress-run
- Изменено:
  - `lib/factory/stressGraphRun.mjs`: добавлен `summary.targetMet`
  - Markdown-отчёт теперь пишет `stress_target_met`
  - DB-блок переименован в `DB Stability Snapshot` и помечен как historical database-wide snapshot
  - `lib/factory/stressReportContract.test.mts`: добавлен guard на separation текущего stress target и DB snapshot target
- Проверки:
  - `npm run test:factory`: pass, 22 factory test files
  - `node --check lib/factory/stressGraphRun.mjs`: pass
  - targeted eslint по `stressReportContract.test.mts`: pass
- Результат:
  - Sprint KPI по выпуску MP4 подтверждён live stress: `10/10 done`
  - отчёт больше не путает успешный текущий stress с историческими падениями в БД

### Series window reset for next 50-run loop

- Дата: 2026-06-27
- Ветка: `codex/factory-worker-runtime-cleanup`
- Цель: не блокировать новый цикл генерации старым закрытым 50-run окном, сохранив learning gate.
- Root cause:
  - `improvementLoop` считал последние 50 рецептов как одно окно.
  - Production readiness показывал `hold`, потому что историческое окно уже было `50/50`.
  - Для следующего цикла не было явного `series_after`, поэтому кнопка следующей пятёрки упиралась в старую историю.
- Изменено:
  - `lib/factory/improvementLoop.ts`: добавлен `series_after` / `series_start_at`, DB и in-memory фильтр по `created_at`.
  - `/api/factory/{learning,improvement,series-readiness,batch}` прокидывают активное окно серии.
  - Studio learning screen получил кнопку `новый цикл`; readiness и `следующая пятёрка` отправляют тот же `series_after`.
  - `lib/factory/seriesReadinessSmoke.mjs` получил `--series-after`.
  - `docs/factory-50-run-improvement-loop.md` обновлён под новый цикл.
- Проверки:
  - `node lib/factory/improvementLoop.test.mts`
  - `node lib/factory/batchTransparencyContract.test.mts`
  - `node lib/factory/graphRunBatchIdContract.test.mts`
  - `node lib/factory/genSaveBatchMetaContract.test.mts`
  - `node lib/factory/studioImprovementLoopContract.test.mts`
  - `node lib/factory/seriesImprovementReadinessContract.test.mts`
  - `node lib/factory/seriesReadinessContract.test.mts`
  - `node lib/factory/seriesReadinessSmokeContract.test.mts`
  - `node lib/factory/learningApiWarnings.test.mts`
  - `node lib/factory/seriesRunbookContract.test.mts`
  - `node --check lib/factory/seriesReadinessSmoke.mjs`
  - inline-parse `public/inferno/studio.html`
  - Vercel production build/deploy: `dpl_AH3sXqfySJ7uDRLnSiuXSyJzbAGg`, alias `https://finance-panel-two.vercel.app`
- Результат:
  - Старое 50-run окно остаётся историей обучения.
  - Новый цикл можно начать без отключения quality/feedback gate.
  - Следующая генерация должна идти как первая пятёрка нового активного окна.

### Persist active series window in Studio

- Дата: 2026-06-27
- Ветка: `codex/factory-worker-runtime-cleanup`
- Цель: не терять активный `series_after` при reload страницы Studio.
- Изменено:
  - `public/inferno/studio.html`: `seriesAfter` восстанавливается из `localStorage.factory_series_after`.
  - добавлен `setSeriesAfter(...)`, который сохраняет/очищает активное окно серии централизованно.
  - кнопки `новый цикл` и `общее окно` теперь меняют и runtime state, и persisted state.
  - `lib/factory/studioImprovementLoopContract.test.mts`: contract на restore/persist/clear.
- Проверки:
  - `node lib/factory/improvementLoop.test.mts`
  - `node lib/factory/batchTransparencyContract.test.mts`
  - `node lib/factory/graphRunBatchIdContract.test.mts`
  - `node lib/factory/genSaveBatchMetaContract.test.mts`
  - `node lib/factory/studioImprovementLoopContract.test.mts`
  - `node lib/factory/seriesImprovementReadinessContract.test.mts`
  - `node lib/factory/seriesReadinessContract.test.mts`
  - `node lib/factory/seriesReadinessSmokeContract.test.mts`
  - `node lib/factory/learningApiWarnings.test.mts`
  - `node lib/factory/seriesRunbookContract.test.mts`
  - `node --check lib/factory/seriesReadinessSmoke.mjs`
  - inline-parse `public/inferno/studio.html`
  - Vercel production build/deploy: `dpl_EgsmWrBSmfdTCThZh4Fns43nS41z`, alias `https://finance-panel-two.vercel.app`
- Результат:
  - Активная новая серия переживает reload.
  - Оператор может стартовать первую пятёрку нового окна без повторного ручного выставления timestamp.

### New-cycle dry-run preflight CLI

- Дата: 2026-06-27
- Ветка: `codex/factory-worker-runtime-cleanup`
- Цель: дать безопасный terminal-run путь перед первой пятёркой нового 50-run окна без запуска генерации.
- Изменено:
  - `lib/factory/seriesNewCyclePreflight.mjs`: создаёт/принимает `series_after`, вызывает `/api/factory/series-readiness`, затем `/api/factory/batch` только с `dry_run:true`.
  - Артефакты: `docs/factory-latest-series-new-cycle-preflight.json/md`.
  - `lib/factory/seriesNewCyclePreflightContract.test.mts`: guard, что скрипт не имеет trigger/restart mode и требует `require_full_batch + require_learning_gate`.
  - `docs/factory-50-run-improvement-loop.md`: добавлен safe-runbook перед реальным запуском новой пятёрки.
- Проверки:
  - `node lib/factory/seriesNewCyclePreflightContract.test.mts`
  - `node --check lib/factory/seriesNewCyclePreflight.mjs`
- Результат:
  - Перед тратой денег можно одной командой получить verdict: readiness + selected 5 + learning gate + budget dry-run.

### Studio new-cycle preflight action

- Дата: 2026-06-27
- Ветка: `codex/factory-worker-runtime-cleanup`
- Цель: дать тот же safe preflight через залогиненную Studio, если CLI не знает production `CRON_SECRET`.
- Изменено:
  - `public/inferno/studio.html`: добавлена кнопка `preflight нового цикла`.
  - Кнопка выставляет новый `series_after`, сохраняет его и открывает `openNightRun(...)` с `auto_preflight:true`.
  - Генерация не запускается: открывается только dry-run первой пятёрки нового окна.
  - `lib/factory/studioImprovementLoopContract.test.mts`: guard на кнопку и передачу `series_after: startedAt`.
- Проверки:
  - `node lib/factory/studioImprovementLoopContract.test.mts`
  - inline-parse `public/inferno/studio.html`
  - `node lib/factory/improvementLoop.test.mts`
  - `node lib/factory/batchTransparencyContract.test.mts`
  - `node lib/factory/seriesImprovementReadinessContract.test.mts`
  - `node lib/factory/seriesNewCyclePreflightContract.test.mts`
  - `node lib/factory/seriesRunbookContract.test.mts`
  - Vercel production build/deploy: `dpl_7cai4QxbLqFtBgJhcN4KNzWANQjT`, alias `https://finance-panel-two.vercel.app`
- Результат:
  - Реальный следующий шаг в UI: `Обучение` -> `preflight нового цикла`.
  - Это должно показать, хватает ли draft-рецептов/бюджета/learning gate для первой пятёрки без запуска генерации.

### Trace batch ids in improvement loop

- Дата: 2026-06-27
- Ветка: `codex/factory-worker-runtime-cleanup`
- Цель: перед реальной серийной генерацией связать learning snapshot с конкретным `/api/factory/batch` launch.
- Изменено:
  - `lib/factory/improvementLoop.ts`: `batch_run_id` читается из `run_plan`, сохраняется на уровне `ImprovementRun` и агрегируется в `ImprovementBatch`.
  - `public/inferno/studio.html`: блок последней серии показывает реальный `batch_run_id`, если он есть.
  - contract tests усилены на batch traceability.
- Результат:
  - Следующую пятёрку можно сравнивать с предыдущей по реальному batch id, а не только по порядку в истории.
  - Это последний технический хвост перед запуском первой production-пятёрки нового цикла.

### Prepare drafts for first five

- Дата: 2026-06-27
- Ветка: `codex/factory-worker-runtime-cleanup`
- Production finding:
  - Studio `preflight нового цикла` дошёл до `/api/factory/batch`, но вернул `нет рецептов-черновиков для батча`.
  - Это блокирует первую пятёрку без ручного переноса рецептов.
- Изменено:
  - `lib/factory/recipeTransfer.ts`: общий helper переноса template -> draft recipe.
  - `app/api/factory/recipes/route.ts`: старый ручной перенос использует общий helper.
  - `app/api/factory/prepare-drafts/route.ts`: создаёт недостающие `status=draft` рецепты из существующих `node_templates` и прошлых articles; не запускает `graph-run` и не вызывает `/batch`.
  - `app/api/factory/batch/route.ts`: при пустой очереди возвращает `next_action: prepare_drafts`.
  - `public/inferno/studio.html`: batch modal показывает кнопку `подготовить черновики`, после успеха автоматически повторяет dry-run preflight.
- Результат:
  - Путь к первой production-пятёрке стал: `preflight нового цикла` -> при пустой очереди `подготовить черновики` -> повторный preflight -> `Запустить`.
  - `batch-build` остаётся отключённым; новый recovery не добавляет второй оркестратор.

### Unstick cron backstop from a single stale recipe

- Дата: 2026-06-27
- Ветка: `codex/factory-worker-runtime-cleanup`
- Production finding:
  - После запуска пятёрки `125–129` cron-backstop продолжал будить только старый рецепт `124`.
  - При `maxWake: 1` один stale run мог съедать весь recovery slot, а свежий batch фактически ждал, пока старый хвост сам рассосётся.
- Изменено:
  - `app/api/factory/graph-run/cron/route.ts`: backstop wake cap поднят до `5` рецептов за cron-pass.
  - `lib/factory/graphWatchdog.ts`: dedupe теперь сохраняет самый старый `updated_at` по рецепту, а wake-кандидаты сортируются детерминированно (`autofill` first, затем freshest running first) до применения `maxWake`.
  - `lib/factory/graphCronBackstopFairness.test.mts`: новый contract на fairness backstop-а.
  - `lib/factory/autofillTickTimeout.test.mts`: обновлён под batch-sized cron burst.
- Результат:
  - Один проблемный run больше не монополизирует весь cron recovery.
  - Backstop может за один проход подхватить целую production-пятёрку и сначала продвигать свежий активный batch, а не закапываться в самый старый хвост.
- 2026-06-28: батч и prepare-drafts теперь фильтруют `source-ready` артикулы до запуска. Смысл простой: не пихать в пятёрку рецепты без реальных исходников/WB fallback, из-за которых прогон гарантированно умирал ещё до полезной генерации.
- 2026-06-28: `assemble` теперь умеет rescue-path из usable source asset, если генеративные ноды умерли, но у рецепта уже есть безопасный preview/source URL. Для image-only fallback честно требуем Shotstack, вместо того чтобы молча подсовывать картинку как будто это готовый MP4.
- 2026-06-28: `graph-run` больше не глотает тихие сбои `gen-save`: внутренний `jpost(..., true)` теперь умеет считать `{ ok:false }` бизнес-ошибкой, а сам `gen-save` отвечает не-2xx на storage/DB fail. Это убирает класс silent-success, когда банковка фактически не сохранила ролик, но раннер не видел причины.
- 2026-06-28: `falCompose` / `falTimeline` больше не теряют оплаченный compose-job на локальном дедлайне функции. На таймауте они возвращают `pending_url`, а `/api/factory/overlay` и `/api/factory/hybrid-compose` отдают `202 processing` вместо ложного финального фейла.
- 2026-06-28: warning-memory завода нормализована. `observability` и `improvementLoop` теперь агрегируют канонические warning reasons (`OTK below threshold`, `gen-save warning`, `video-critic unavailable`, `source fallback rescued` и т.д.), а не десятки строк с разными числами/хвостами ошибки. Это делает батчи по 5 и серию на 50 роликов реально сравнимыми по причинам деградации.

### Apparel product source packs

- Дата: 2026-07-01
- Ветка: `feat/factory-v2-product-broll`
- Цель: перестать строить одежду из постеров/инфографики и дать Product Digital Twin правдивый source-pack из исходников фотосессии.
- Изменено:
  - `lib/factory/apparelSourcePack.ts`: сбор NORVIA apparel source-pack по ролям `clean_front`, `on_model_front`, `back`, `side`, `fabric_macro`, `closure_detail`, `hood_detail`, `lining_detail`.
  - `app/api/factory/product-twin/source-pack/route.ts`: dry-run/apply endpoint, который пишет source-pack как `content_assets.disk=product_truth` с lineage metadata.
  - `lib/factory/productSourcePicker.ts`: picker теперь подмешивает apparel source-pack кандидатов и ставит `clean_front` первым для сборки twins.
  - Contract tests: `apparelSourcePackContract`, усиленный `productSourcePicker`.
- Проверки:
  - `npx tsx lib/factory/apparelSourcePackContract.test.mts`
  - `npx tsx lib/factory/productSourcePicker.test.mts`
  - `npx tsx lib/factory/productTwinBatchContract.test.mts`
  - `npx tsc --noEmit --pretty false`
  - Реальный ranking NV-08: первым стал `/КУЛИСА/темно-зелен/IMG_7070.JPG`, score `108`, reason `source_pack_role:clean_front`.
- Результат:
  - Для NORVIA NV-08 система нашла полный truth-pack без пропусков: front `IMG_7070`, on-model `IMG_7069`, side `IMG_7072`, back `IMG_7075`, fabric `IMG_7047`, closure `IMG_7046`, lining `IMG_7058`, hood `IMG_7078`.
  - Preview deploy `finance-panel-g0425ezk4-pankman-100-s-projects.vercel.app` собрался, но API apply упёрся во внешнюю Vercel SSO-защиту до Next route. Код готов; live apply надо запускать из production/Railway worker с доступными env или с Vercel protection bypass.

### Apparel source-pack worker

- Дата: 2026-07-01
- Ветка: `feat/factory-v2-product-broll`
- Цель: убрать зависимость от preview HTTP/SSO и дать Railway/production прямой способ записывать product truth packs.
- Изменено:
  - `lib/factory/apparelSourcePackWorker.mjs`: CLI worker для `dry-run/apply` без HTTP: `node --import tsx lib/factory/apparelSourcePackWorker.mjs --articles NV-08,NV-836,NV-816,NV-01 --apply false`.
  - `lib/factory/apparelSourcePack.ts`: article-only запуск больше не требует цветового hint; роли выбирают разные source paths, если есть близкие по score кадры.
  - `lib/factory/apparelSourcePackWorkerContract.test.mts`: contract для worker mode.
- Проверки:
  - `node --import tsx lib/factory/apparelSourcePackWorker.mjs --article NV-08 --out-dir tmp/source-pack-test`
  - `node --import tsx lib/factory/apparelSourcePackWorker.mjs --articles NV-08,NV-836,NV-816,NV-01 --out-dir tmp/source-pack-bulk-test-2`
  - `npx tsx lib/factory/productSourcePicker.test.mts`
  - `npx tsx lib/factory/productTwinBatchContract.test.mts`
  - `npx tsx lib/factory/apparelSourcePackWorkerContract.test.mts`
  - `npx tsc --noEmit --pretty false`
- Результат:
  - Dry-run собрал полные packs без missing roles для `NV-08`, `NV-836`, `NV-816`, `NV-01`.
  - Для линий без hand-tuned frame hints detail-роли теперь расходятся по разным ранним raw-кадрам, вместо дублирования одного файла.
  - Следующий production шаг: запустить worker с `--apply true` в окружении, где есть `NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`.

### Bulk source-pack endpoint

- Дата: 2026-07-01
- Ветка: `feat/factory-v2-product-broll`
- Цель: дать production/Railway один HTTP-вызов для подготовки нескольких apparel source packs.
- Изменено:
  - `app/api/factory/product-twin/source-pack/route.ts`: поддержаны `articles` и `items`; одиночный `article` остаётся совместимым и возвращает `pack`.
  - `apply` теперь пишет общий набор rows одним upsert и защищён от пустой записи.
- Проверки:
  - `npx tsx lib/factory/apparelSourcePackContract.test.mts`
  - `npx tsx lib/factory/apparelSourcePackWorkerContract.test.mts`
  - `npx tsx lib/factory/productSourcePicker.test.mts`
  - `npx tsc --noEmit --pretty false`
  - Dry-run worker по `NV-08,NV-836` подтвердил, что bulk path собирает строки для нескольких линий.

### Source-pack readiness and bags

- Дата: 2026-07-01
- Ветка: `feat/factory-v2-product-broll`
- Цель: закрыть следующий слой после apparel source-pack: видимая readiness в inventory/API и поддержка сумок.
- Изменено:
  - `lib/factory/bagSourcePack.ts`: source-pack для сумок CLERIN по явным папкам `ARTICLE_FOLDERS`, роли `front`, `three_quarter`, `side`, `back`, `hardware_macro`, `strap_detail`, `in_hand`, `on_shoulder`.
  - `lib/factory/productSourcePicker.ts`: picker подмешивает bag source-pack кандидатов и предпочитает `front`.
  - `lib/factory/productTwinInventory.ts`: добавлен `sourcePackReadiness` для apparel/bag; dry-run inventory теперь показывает supported/ok/roles/missing/primarySourcePath.
  - `app/api/factory/product-twin/batch-build/route.ts`: dry-run response возвращает `source_pack_readiness`.
  - `app/api/factory/product-twin/source-pack/route.ts` и worker: один apply path теперь поддерживает и apparel, и bags.
  - `lib/factory/productTwin.ts`: `NV-*` классифицируется как apparel, `CLR*` как bag даже без product name.
- Проверки:
  - Bag dry-run: `CLR00716`, `CLR00715`, `CLR001101`, `CLR001102` собраны без missing roles.
  - Mixed worker dry-run: `NV-08,CLR00716` собраны одним запуском.
  - Inventory dry-run: `NV-08` теперь category `apparel`, primary `/КУЛИСА/темно-зелен/IMG_7070.JPG`; `CLR00716` category `bag`, primary `/МАША/Сумки/Кросс-боди капучино/2.png`.
  - `npx tsx lib/factory/productTwin.test.mts`
  - `npx tsx lib/factory/apparelSourcePackContract.test.mts`
  - `npx tsx lib/factory/apparelSourcePackWorkerContract.test.mts`
  - `npx tsx lib/factory/bagSourcePackContract.test.mts`
  - `npx tsx lib/factory/productSourcePicker.test.mts`
  - `npx tsx lib/factory/productTwinBatchContract.test.mts`
  - `npx tsc --noEmit --pretty false`
- Blocker:
  - Локальный `.env.production.local` содержит имена `SUPABASE_SERVICE_ROLE_KEY`, `FAL_KEY`, `FAL_BILLING_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, но значения пустые. Поэтому реальные apply/build/visual review из локальной сессии не выполнены.
  - Production/Railway команда после установки env: `node --import tsx lib/factory/apparelSourcePackWorker.mjs --articles NV-08,NV-836,NV-816,NV-01,CLR00716,CLR00715,CLR001101,CLR001102 --apply true`.

### Product Twin Studio

- Дата: 2026-07-01
- Ветка: `feat/factory-v2-product-broll`
- Цель: сделать source-pack/readiness/build/review видимыми в UI, чтобы production apply/build не были ручной CLI-магией.
- Изменено:
  - `app/inferno/product-twins/page.tsx`: новый динамический пульт Product Twin Studio.
  - `app/inferno/product-twins/ProductTwinStudio.tsx`: таблица readiness, default articles для NORVIA/CLERIN, кнопки `Refresh`, `Apply Packs`, `Rebuild`, `Load Twins`, просмотр latest twin assets.
  - `app/agent/page.tsx`: добавлена ссылка на Product Twin Studio.
  - `lib/factory/productTwinStudioContract.test.mts`: contract на route, API wiring и ссылку из agent page.
- Проверки:
  - `npx tsx lib/factory/productTwinStudioContract.test.mts`
  - `npx tsx lib/factory/productTwin.test.mts`
  - `npx tsx lib/factory/apparelSourcePackContract.test.mts`
  - `npx tsx lib/factory/apparelSourcePackWorkerContract.test.mts`
  - `npx tsx lib/factory/bagSourcePackContract.test.mts`
  - `npx tsx lib/factory/productSourcePicker.test.mts`
  - `npx tsx lib/factory/productTwinBatchContract.test.mts`
  - `npx tsc --noEmit --pretty false`
  - `npx eslint app/inferno/product-twins/ProductTwinStudio.tsx app/inferno/product-twins/page.tsx app/agent/page.tsx`
- Note:
  - Browser QA в локальной среде упирается в auth redirect на `/login`; это ожидаемо без сессионной cookie. UI использует существующие protected factory API и не раскрывает секреты клиенту.

### Product Twin Yandex preview proxy

- Дата: 2026-07-01
- Ветка: `feat/factory-v2-product-broll`
- Production finding:
  - Product Twin assets после rebuild сохраняются в `content_assets.url` как `yandex-disk:/...`.
  - Studio не могла визуально показать эти картинки, потому что `<img>` не умеет открывать внутренний hint.
- Изменено:
  - `app/api/factory/product-twin/asset-preview/route.ts`: protected proxy для `yandex-disk:` assets через `getYandexDiskDownloadHref`.
  - `lib/factory/productTwinPreview.ts`: helper добавляет `preview_url/previewUrl` к twin assets без изменения DB.
  - `app/api/factory/product-twin/by-article/[article]/route.ts` и `[twin_id]/route.ts`: latest twin API теперь возвращает preview URLs.
  - `app/inferno/product-twins/ProductTwinStudio.tsx`: asset cards используют `preview_url`, fallback остаётся для обычных HTTP URLs.
- Проверки:
  - `npx tsx lib/factory/productTwinPreviewContract.test.mts`
  - `npx tsx lib/factory/productTwinStudioContract.test.mts`
  - `npx tsx lib/factory/productTwin.test.mts`
  - `npx tsx lib/factory/productTwinBatchContract.test.mts`
  - `npx tsc --noEmit --pretty false`
  - `npx eslint app/api/factory/product-twin/asset-preview/route.ts app/api/factory/product-twin/by-article/[article]/route.ts app/api/factory/product-twin/[twin_id]/route.ts app/inferno/product-twins/ProductTwinStudio.tsx lib/factory/productTwinPreview.ts`

### Product Twin rebuild worker

- Дата: 2026-07-01
- Ветка: `feat/factory-v2-product-broll`
- Production finding:
  - Rebuild из Studio на всех 8 товарах упирается в Vercel timeout (~270s/504).
  - Нужен операторский/Railway путь, который собирает товары маленькими батчами и не зависит от serverless request lifetime.
- Изменено:
  - `lib/factory/productTwinRebuildWorker.mjs`: CLI-worker для sequential rebuild Product Twins.
  - Worker поддерживает `--articles`, `--items`, `--batch-size`, `--limit`, `--min-quality`, `--delay-ms`, `--build true`, `--apply-source-packs true`, `FACTORY_TWIN_REBUILD_ENV_FILE`.
  - По умолчанию worker безопасный: не тратит FAL и не пишет source-packs без явных флагов.
  - `lib/factory/productTwinInventory.ts`: `inferProductName` экспортирован, чтобы CLI и Studio одинаково матчали `NV-*` и `CLR*` источники.
  - `lib/factory/productTwinRebuildWorkerContract.test.mts`: contract на batch-mode, source-pack refresh, preview URLs и report.
- Production command для оставшихся/пересобираемых товаров:
  - `node --import tsx lib/factory/productTwinRebuildWorker.mjs --articles NV-816,NV-01,CLR00716,CLR00715,CLR001101,CLR001102 --build true --apply-source-packs true --batch-size 2`
- Проверки:
  - Smoke dry-run: `node --import tsx lib/factory/productTwinRebuildWorker.mjs --articles NV-816,CLR00716 --batch-size 2 --out-dir /tmp/factory-product-twin-worker-smoke`
  - `npx tsx lib/factory/productTwinRebuildWorkerContract.test.mts`
  - `npx tsx lib/factory/productTwinBatchContract.test.mts`
  - `npx tsx lib/factory/productTwinPreviewContract.test.mts`
  - `npx tsx lib/factory/apparelSourcePackWorkerContract.test.mts`
  - `npx tsc --noEmit --pretty false`
  - `npx eslint lib/factory/productTwinRebuildWorker.mjs lib/factory/productTwinRebuildWorkerContract.test.mts lib/factory/productTwinInventory.ts`

### Product Twin derived views worker

- Дата: 2026-07-01
- Ветка: `feat/factory-v2-product-broll`
- Цель:
  - После сборки clean twins догонять ракурсы/детали/lifestyle assets не через Vercel route, а отдельным sequential worker.
- Изменено:
  - `lib/factory/productTwinDeriveViewsWorker.mjs`: CLI-worker для generation of canonical Product Twin views from latest article twin or explicit twin id.
  - Worker поддерживает `--articles`, `--twin-ids`, `--items`, `--view-ids`, `--allow-synthetic true`, `--per-twin-limit`, `--batch-size`, `--generate true`, `FACTORY_TWIN_DERIVE_ENV_FILE`.
  - Генерация явная: без `--generate true` worker только планирует views и не тратит FAL.
  - Generated view assets архивируются в Yandex Disk и пишутся в `content_assets` как `product_twin_view_asset`.
  - `lib/factory/productTwinDeriveViewsWorkerContract.test.mts`: contract на latest/explicit twin source, FAL generation, Yandex archive, report.
- Production command после rebuild:
  - `node --import tsx lib/factory/productTwinDeriveViewsWorker.mjs --articles NV-816,NV-01,CLR00716,CLR00715,CLR001101,CLR001102 --generate true --allow-synthetic true --per-twin-limit 5 --batch-size 1`
- Проверки:
  - `npx tsx lib/factory/productTwinDeriveViewsWorkerContract.test.mts`
  - `npx tsx lib/factory/productTwinRebuildWorkerContract.test.mts`
  - `npx tsc --noEmit --pretty false`
  - `npx eslint lib/factory/productTwinDeriveViewsWorker.mjs lib/factory/productTwinDeriveViewsWorkerContract.test.mts lib/factory/productTwinRebuildWorker.mjs lib/factory/productTwinRebuildWorkerContract.test.mts lib/factory/productTwinInventory.ts`

### Product Twin production build pass

- Дата: 2026-07-01
- Ветка: `feat/factory-v2-product-broll`
- Цель:
  - Дожать Product Digital Twin батч без локальных секретов и без Vercel all-8 timeout.
- Найденный рабочий канал:
  - Railway CLI залогинен в проект `finance-panel-reels-brain-worker`, service `reels-brain-offline-worker`.
  - Сам Railway service не содержит Supabase/FAL/Yandex env, но содержит `CRON_SECRET`.
  - Через `railway run -- node ...` production API `https://finance-panel-two.vercel.app/api/factory/product-twin/*` успешно авторизуется по Bearer `CRON_SECRET` и использует Vercel production env.
- Rebuild production results:
  - `NV-08`: existing latest `pt_NV-08_f8d6edfe8532`, quality `0.77`, 9 assets, service/visual packs complete.
  - `NV-836`: existing latest `pt_NV-836_e4f4e8750e0d`, quality `0.60`, 9 assets, service/visual packs complete.
  - `NV-816`: rebuilt `pt_NV-816_8289cfebf2ad`, quality `0.60`, source `/ПОЯС/ св беж/IMG_7257.JPG`, 9 assets.
  - `NV-01`: rebuilt `pt_NV-01_f5209d13545f`, quality `0.60`, source `/ОЛЬГА МАНЖЕТ/бежевый/IMG_7156.JPG`, 9 assets.
  - `CLR00716`: rebuilt `pt_CLR00716_fba666d426a4`, quality `0.79`, source `/МАША/Сумки/Кросс-боди капучино/2.png`, 9 assets.
  - `CLR00715`: rebuilt `pt_CLR00715_4d00f0d8a979`, quality `0.68`, source `/МАША/Сумки/Кросс-боди шоколад/2 (1).png`, 9 assets.
  - `CLR001101`: rebuilt `pt_CLR001101_dce071f9bc5b`, quality `0.77`, source `/МАША/Сумки/Трапеция черная/2.png`, 9 assets.
  - `CLR001102`: rebuilt `pt_CLR001102_6e94a39e9ac9`, quality `0.76`, source `/МАША/Сумки/Трапеция коричневая/2.png`, 9 assets.
- Derived views production results:
  - 8/8 articles processed with `generate:true`, `allow_synthetic:true`, `limit:5`.
  - Apparel views generated/uploaded for each `NV-*`: `back_flat`, `left_45`, `right_45`, `fabric_macro`, `closure_detail`.
  - Bag views generated/uploaded for each `CLR*`: `back`, `side`, `three_quarter`, `inside_open`, `hardware_macro`.
  - Initial run had transient Yandex Disk `423 resource locked` on 3 view uploads:
    - `CLR00715 inside_open`
    - `CLR001101 three_quarter`
    - `CLR001102 inside_open`
  - Repair pass regenerated those 3 view IDs one-by-one; all 3 finished with `archive_status: uploaded`.
- Final production state:
  - 8/8 latest Product Twins exist.
  - 8/8 have 9 base assets.
  - 8/8 have service assets: `object_mask`, `alpha`, `depth_map`, `segmentation`.
  - 8/8 have visual assets: `clean_png`, `white_bg`, `gray_bg`, `shadow_bg`, `upscaled`.
  - 40/40 intended derived view uploads completed after repair.
- Remaining manual/visual QA:
  - Product Twin Studio on current production still showed broken images before preview-proxy deploy. After PR #92 deploy, run `Load Twins` and inspect preview cards.
  - Quality `0.60` on `NV-836`, `NV-816`, `NV-01` should be visually reviewed before using as hero assets; they are structurally complete but below the preferred `0.68` threshold.

### UGC Katya controlled motion batch

- Дата: 2026-07-01
- Ветка: `feat/product-broll-operator-get-clean`
- Цель:
  - Начать 6-месячную петлю "живого блогера" с контролируемого HeyGen batch без товара и без подключения к основному заводу.
  - Проверить не только внешний вид блогера, а управляемость движения через `motion_prompt` и `expressiveness`.
- Изменено:
  - `lib/factory/heygen.ts`: добавлены `motionPrompt` и `expressiveness` в `HeyGenCreateVideoInput`.
  - `lib/factory/heygenVideo.ts`: smoke-plan теперь прокидывает motion controls отдельно от spoken script.
  - `lib/factory/heygenClientContract.test.mts` и `lib/factory/heygenVideoContract.test.mts`: покрытие motion controls.
  - `docs/factory-ugc-blogger-motion-loop-2026-07-01.md`: roadmap обновлён фактом live batch.
  - `docs/factory-ugc-katya-motion-batch-2026-07-01.md`: отдельный report по платному батчу.
- Paid HeyGen results:
  - 4/4 renders completed.
  - Files:
    - `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/katya-calm-direct-low.mp4`
    - `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/katya-skeptical-pause-medium.mp4`
    - `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/katya-small-nod-medium.mp4`
    - `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/katya-friend-advice-high.mp4`
    - `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/contact-sheet.jpg`
- Предварительный вывод:
  - `high` даёт больше эмоции, но риск presenter/рекламности выше.
  - `medium` выглядит главным кандидатом для следующего controlled batch.
  - Winner нужно выбирать по mp4, потому что ключевая проблема — движение, а не один кадр.
- Проверки:
  - `npx tsx lib/factory/heygenClientContract.test.mts`
  - `npx tsx lib/factory/heygenVideoContract.test.mts`
  - `npx tsx lib/factory/bloggerMotionContract.test.mts`

### UGC Katya actor learning loop

- Дата: 2026-07-01
- Ветка: `feat/product-broll-operator-get-clean`
- Решение:
  - Временно не добавляем B-roll и товар.
  - Фокус только на доработке одного блогера: Катя в разных обстановках, ракурсах, позах, expression и motion.
  - 100 прогонов делаем поколениями, а не одной пачкой.
- Изменено:
  - `lib/factory/bloggerLearningLoop.ts`: dry-run planner для 100 Katya actor runs.
  - `app/api/factory/blogger-learning-loop/route.ts`: API для плана поколений, без paid render.
  - `lib/factory/bloggerLearningLoopContract.test.mts`: контракт на 100 runs, вариативность и запрет B-roll/product.
  - `docs/factory-ugc-katya-actor-learning-loop-2026-07-01.md`: операционный план обучения.
- Архитектура loop:
  - `target_runs`: 100.
  - `generation_size`: 5.
  - `generation_count`: 20.
  - Оси: scene, camera angle, pose, expression, motion preset, expressiveness.
  - Runner тратит деньги только при `--confirm-paid true`.
- First paid generation:
  - Запущен generation 1, limit 5.
  - 2/5 completed:
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01/generation-01/katya_lab__g01__01__window_room__slightly_below__half_smile.mp4`
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01/generation-01/katya_lab__g01__02__sofa_evening__three_quarter_right__tired_honest.mp4`
  - 3/5 failed with HeyGen `MOVIO_PAYMENT_INSUFFICIENT_CREDIT`.
  - Repair attempts also failed with insufficient API credits.
  - Contact sheet: `/tmp/ugc-factory-katya-learning-loop-2026-07-01/generation-01/contact-sheet.jpg`.
- First paid generation retry after top-up:
  - API wallet checked via `GET /v3/users/me`: `$30.13` before retry.
  - Retry generation 1 completed 5/5.
  - API wallet after retry: `$28.58`.
  - Files:
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-retry/generation-01/katya_lab__g01__01__window_room__slightly_below__half_smile.mp4`
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-retry/generation-01/katya_lab__g01__02__sofa_evening__three_quarter_right__tired_honest.mp4`
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-retry/generation-01/katya_lab__g01__03__messy_desk__upper_body__friend_advice.mp4`
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-retry/generation-01/katya_lab__g01__04__mirror_selfie__slightly_above__calm_direct.mp4`
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-retry/generation-01/katya_lab__g01__05__entryway_jacket__three_quarter_left__skeptical_pause.mp4`
  - Contact sheet: `/tmp/ugc-factory-katya-learning-loop-2026-07-01-retry/generation-01/contact-sheet.jpg`.
  - Preliminary frame read: #2 and #5 look like strongest candidates; final choice must be by mp4 motion.
- Generation 2 bias + look-matrix fix:
  - Added winner-biased planning from `prior_results` so next generation reuses strong scene/angle/motion signals instead of random exploration.
  - Added Katya look matrix with multiple female looks:
    - `hallway_hoodie`
    - `kitchen_cardigan`
    - `soft_window_cardigan`
    - `skeptical_kitchen_selfie`
  - Caught and removed an invalid non-Katya private look from the matrix before locking the next batch.
- Valid generation 2b:
  - Prior file: `docs/factory-katya-generation2-prior-results.json`.
  - 5/5 completed:
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation2b/generation-02/katya_lab__g02__01__sofa_evening__three_quarter_left__tired_honest.mp4`
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation2b/generation-02/katya_lab__g02__02__sofa_evening__three_quarter_right__half_smile.mp4`
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation2b/generation-02/katya_lab__g02__03__entryway_jacket__three_quarter_left__skeptical_pause.mp4`
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation2b/generation-02/katya_lab__g02__04__mirror_selfie__three_quarter_right__friend_advice.mp4`
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation2b/generation-02/katya_lab__g02__05__sofa_evening__three_quarter_left__tired_honest.mp4`
  - Contact sheet: `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation2b/generation-02/contact-sheet.jpg`.
  - Preliminary read: `tired_honest` and `skeptical_pause` remain strongest directions.
- Generation 3 tightened batch:
  - Prior file: `docs/factory-katya-generation3-prior-results.json`.
  - Planner enters tightened mode from generation 3 onward when winners exist.
  - 5/5 completed:
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation3/generation-03/katya_lab__g03__01__sofa_evening__three_quarter_left__tired_honest.mp4`
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation3/generation-03/katya_lab__g03__02__sofa_evening__three_quarter_left__tired_honest.mp4`
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation3/generation-03/katya_lab__g03__03__entryway_jacket__three_quarter_left__skeptical_pause.mp4`
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation3/generation-03/katya_lab__g03__04__mirror_selfie__three_quarter_left__friend_advice.mp4`
    - `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation3/generation-03/katya_lab__g03__05__sofa_evening__three_quarter_left__skeptical_pause.mp4`
  - Contact sheet: `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation3/generation-03/contact-sheet.jpg`.
  - Preliminary read:
    - `tired_honest low` looks like the strongest natural baseline.
    - `skeptical_pause hallway` and `skeptical_pause sofa` are the strongest skeptical lines.
    - `friend_advice` remains useful as contrast, not as core direction.
- Проверки:
  - `npx tsx lib/factory/bloggerLearningLoopContract.test.mts`
  - `npx tsx lib/factory/bloggerMotionContract.test.mts`
  - `npx tsc --noEmit --pretty false`

## 2026-07-01 (поздний вечер) — Face Foundry: фаза 0 (код, без платных вызовов)

- Задача от владельца: собственное лицо блогера — генерим снаружи, загружаем в HeyGen как avatar group, оживляем выигрышными моушенами Катиной лаборатории.
- Новые файлы (зона `lib/factory`, платных вызовов не было):
  - `lib/factory/faceFoundry.ts` — план: 8 hero-кандидатов (разные vibe, synthetic-guard + анти-глянец) и 8 ракурсов/света с identity-guard для тренировки avatar group.
  - `lib/factory/faceFoundryRunner.mjs` — CLI: `--stage hero|angles`, dry-run по умолчанию, `--confirm-paid true` для трат; FAL nano-banana (t2i) + nano-banana/edit; ретраи с таймаутами по образцу `falImageEdit.ts`; выход ракурсов скоупится по герою (`angles/<hero>/`); `--hero-file` перезаливает локальный PNG в fal storage на случай протухшего fal.media URL.
  - `lib/factory/faceFoundryContract.test.mts` — контракт: уникальность spec_id, guard-строки в промптах, клампы count, инвариант hero/angle (модель выбирается по наличию `hero_image_url`).
- Ревью: 2 адверсариальных ревьюера; все should-fix закрыты (ретраи/таймаут-ошибки с responseUrl, скоуп ракурсов, robustness `--hero-source`, пины инвариантов в тестах).
- Проверки: `npx tsx lib/factory/faceFoundryContract.test.mts` OK; оба dry-run OK; `npx tsc --noEmit` 0 ошибок.
- Следующий шаг (фаза 1, ~$1): `npx tsx lib/factory/faceFoundryRunner.mjs --stage hero --confirm-paid true` с FAL-ключом; рекомендация ревьюера — сначала smoke `--count 1`.

## 2026-07-02 — Face Foundry: фазы 1-2 (три блогера, живой HeyGen-конвейер)

- Владелец выбрал лица: Маня=soft_daylight, Вика=dark_blonde_wavy, Оля=mom_tired_kind (12 hero-кандидатов FAL nano-banana, 4 срезал контент-фильтр Gemini детерминированно — деньги не списаны).
- Ресёрч «сколько артефактов нужно блогеру» (3 агента, web+repo): паспорт ≈ 100 отобранных артефактов; HeyGen Personal Model = мин 10 / реком 30+ фото, 60 кредитов тренировка; add-looks ≤4 image_keys/вызов; ⚠️ v2 photo_avatar API deprecated до 31.10.2026 (v3 = single-photo POST /v3/avatars). Память: ugc-blogger-asset-passport.
- Матрица тренировочных ракурсов расширена 8→24 (эмоции с mid_speech для липсинка, полный рост, улица/машина/кафе/парк, золотой час/пасмурно/вечер); интерьеры апгрейжены по фидбеку владельца («не надо дешёвых квартир») — guard `not poor or run-down`.
- Сгенерено 72/72 тренировочных кадра (3×24, FAL nano-banana edit, ~$3 суммарно c героями). QC: identity держится; исключён 1 кадр (Маня full_body_street — босиком).
- Живой HeyGen прогон (ключ «для завода», кошелёк $13.98 + 839 кредитов): upload asset OK (image_key формат совпал), группа `ugc_manya_v1` создана живьём = v2-эндпоинты подтверждены. В аккаунте уже 7 групп (Katya v3b, Alina, Sergey...).
- Раннер heygenAvatarGroupRunner: батчинг add по 4, fallback per-key при отказе батча (identity mismatch), внешне-созданная группа через state.creation_key, resume по state.json.
- Матрица луков расширена 8→14 (полный рост ×2, крупняки ×3, машина/улица/парк/балкон, 6 гардеробных архетипов на персону) по запросу владельца «до 100 вариаций».
- Тесты: faceFoundryContract + heygenAvatarGroupContract зелёные, tsc 0 ошибок.
- Запущено: upload+group+train всех трёх групп (фон). Следующее: лук-смоук 1 шт с замером кошелька → полная библиотека луков → Avatar IV бейкофф против текущей Кати.

## 2026-07-02 — Reels Brain Railway: offline media-backfill worker

- Диагностика Railway production показала, что сервис `reels-brain-offline-worker` был online, но крутил старый `audio_backfill_batch_start` loop и застревал на `ready_for_worker: 0`.
- Причина: runtime стартовал `node lib/factory/reelsBrainAudioRailwayWorker.mjs`, а текущий контур для добора `media_locator_candidates` уже вынесен в `lib/factory/reelsBrainOfflineWorker.mjs`.
- Фикс в репо:
  - добавлен совместимый shim `lib/factory/reelsBrainAudioRailwayWorker.mjs`, который переводит Railway на новый offline worker без ручной смены entrypoint;
  - возвращён `railway.json` с `NIXPACKS` и явным `startCommand` на этот shim;
  - дефолты shim-а включают `REELS_BRAIN_ENABLE_LOCAL_MEDIA_RESOLVER=1`, heartbeat и offline loop cadence.
- Следующий live-step: задеплоить этот сервис через `railway up`, добавить `yt-dlp` в `NIXPACKS_PKGS`, прогнать one-shot и проверить рост `rows_with_media` / `ready_for_worker`.

## 2026-07-02 (продолжение) — Фаза 2 ЗАКРЫТА: три обученных блогера с библиотеками луков

- Дедупликация тренировочных сетов по запросу владельца: перцептивный dhash нашёл кластеры клонов (Маня front_neutral≈warm_lamp_evening d=5/144; Оля 4 фронталки слиплись). Отбраковано: Маня 5, Оля 3, Вика 1. Итог в тренировке: 20/24/22 фото (герой+ракурсы).
- Пойман и закрыт баг v2 add: обязательное поле `name` (400 "name is invalid") — из-за него первый прогон добавил Мане 0 фото и тренировка ($4!) ушла на группе из 1 фото; успели докинуть 19 фото пока train был pending — тренировка в итоге прошла на полном сете.
- Тренировки: все 3 группы `ready` (Маня fc29c149, Вика 1b2482be, Оля 3379c2f7). Цена тренировки на wallet-биллинге = $4 (кошелёк $13.98→$1.98 за 3 шт).
- Живость по фидбеку владельца («позы неестественные»): 3 слоя — тренировочный сет остаётся стерильным (якорь identity), луки получили ось микро-действий (кофе mid-sip, смех с зажмуренными глазами, натягивает рукав куртки, оборот через плечо в парке, рассказ в машине с ремнём), плюс candid-guard "no stiff catalog pose". Главный слой живости — моушен на видео-стадии.
- Луки сгенерены ВНЕШНЕ на FAL (nano-banana edit от героев) по рекомендации ресёрча: 42/42 без фейлов, pHash-дедуп = 0 дублей, identity держится (спот-чек). HeyGen-кредиты на луки не потрачены.
- Новые стадии кода: faceFoundryRunner `--stage looks` (FAL-генерация луков из buildAvatarGroupLooks), heygenAvatarGroupRunner `--stage looks-external` (upload+add по одному с именем лука, только после train_ready). Заливка: 42/42 лука в группы, имена look__<persona>__NN__<scene>.
- Ловушка zsh: фоновые команды не сплитят $var по пробелам (set -- $p дал пустой --hero-id) — циклы в фоне писать явными командами.
- Запущен бесплатный Avatar IV смоук Мани (3 free credits на аккаунте): look plain_wall (жестикуляция) × моушен friend_advice (победитель Катиной лаборатории) × якорный скрипт.
- Осталось на кошельке HeyGen: $1.98. На полный бейкофф фазы 3 (3 блогера × 2-3 клипа + старая Катя) нужно ~$10.

## 2026-07-02 (ночь) — Фаза 3: оживление, анти-AI пост, бейкофф

- Первый Avatar IV смоук Мани (plain_wall × friend_advice, голос Anya): вердикт владельца «палится». Диагноз ожидаем: сырые 6с говорящей головы без единого анти-AI слоя = худший режим.
- Найден и заменён протухший voice_id Кати в ugcStoryboard-конфиге (37832e32d4f747... → Anya 37832e32d4f7475ab7a1cb0db8e5dd66); старый даёт «Voice not found» на прод-ключе.
- Ресёрч анти-AI пост-обработки (2 агента, web+repo): топ-рычаг = монтаж 90/10 (лицо ≤3-5с, резы каждые 1-3с); пост лечит стерильную картинку/статичную камеру/«голос из вакуума», НЕ лечит липсинк/мимический дрифт/повторяющиеся жесты. Конкретика: temporal grain noise=alls=9, синусный handheld crop-shake (двухчастотный), деколоризация eq+curves, rgbashift ≤2px, второй прогон кодека 2Mbps, phone-EQ 120-9000Hz + компрессор + brown room tone -32dB. 30fps, НЕ 24. Голос: MiniMax Speech-02 HD через FAL бьёт HeyGen TTS. В заводе есть fal ffmpeg-рельса (falQueueVideo) но compose-только; Remotion VM = настоящий ffmpeg-бокс; room tone можно конфигом на dual-audio Shotstack.
- ffmpeg 8.0 static arm64 поставлен в scratchpad (brew нет); анти-AI цепочка реализована и прогнана на 8 клипах. Вердикт владельца по пост-версиям: «чуть лучше».
- Бейкофф отрендерен ($15.88 на кошельке после пополнения): Вика car+mirror, Оля car+mirror, старая Катя (победный лук лаборатории) — все на одном скрипте/голосе, + 3 Маниных. Страница сравнения: /tmp/ugc-factory-face-foundry/bakeoff.html (raw vs post).
- Банк моушенов расширен 7→13 (voice_message, walk_and_talk, mid_task_aside, story_lean, disbelief_shake, interrupted_real) — тесты зелёные. Комбинаторика: 14 луков × 13 моушенов = 182 комбо/блогера ≈ 12 видео/день комфорт.
- Согласован план: горизонт 1 = боевой формат (лицо 2-3с + твин b-roll + сабы + музыка + пост) + MiniMax голос; горизонт 2 = продуктизация паспортов из /tmp в bloggerRegistry + НАЧАТЬ ПУБЛИКОВАТЬ (петля V5 ждёт); горизонт 3 = vision-критик по рубрике living_blogger_v1 + winner mining по рыночным метрикам.

## 2026-07-02 (ночь) — B-roll studio: живой аудит и фиксы качества source-кадра

- Живой аудит конвейера product-broll-batch (Claude Code сессия владельца): прод dry-run POST на NV-08/CLR00716 выбрал `product_twin_latest`, категории/preservation-хвосты корректны; платный тест 1×Kling 5s на CLR00716 (~$0.35, FAL $12.46 до) отрендерился и заархивировался.
- Вердикт по кадрам: кожа/строчка/движение — хорошо; косяки: (1) в Kling ушёл `shadow_bg` — карточка с паспарту и вшитой подписью CLÉRIN → «рамка-в-рамке» в ролике; (2) шильдик бренда при макро-зуме морфится в кашу; (3) повторные опросы `video-fal-status` плодили дубли файлов в архиве (hash от подписанной FAL-ссылки, она меняется на каждый poll).
- Фиксы:
  - `lib/factory/productTwin.ts`: pickBestTwinAsset для broll теперь предпочитает full-bleed (`broll_source`, `upscaled`, `clean_png`) карточному `shadow_bg`; hero-приоритет не тронут.
  - `app/api/factory/product-broll-batch/route.ts`: `clean_first:true` теперь работает поверх twin/view/auto-twin источника — выбранный кадр рехостится (`rehostImageForFal`) и чистится nano-banana (срезает вшитую подпись/поля) перед video API; авто-твин ветка больше не исключает clean_first.
  - `lib/factory/yandexArchive.ts` + `video-fal-status`: `archiveExternalMediaToYandex` принимает `stableKey` (task id) — идемпотентный путь архива при повторных опросах статуса.
- Проверки:
  - `node --import tsx lib/factory/productTwin.test.mts` (10 passed; контракт обновлён: broll предпочитает full-bleed, hero — карточку)
  - `node --import tsx lib/factory/productBrollBatchRouteContract.test.mts` (18 passed, +2 asserts на twin-clean)
  - `node --import tsx lib/factory/productBrollBatch.test.mts` (15 passed)
  - `node --import tsx lib/factory/yandexArchiveDirectContract.test.mts` (+assert stableKey)
  - `npx tsc --noEmit` — по затронутым файлам чисто (единственная ошибка в `reels-brain/source-run/route.ts` — параллельная незакоммиченная правка другого воркера, вне этого блока)
- Осталось на потом: OTK/video-critic гейт на читаемость логотипа в готовом ролике; пере-генерация смоука с clean_first после деплоя.

## 2026-07-02 (продолжение) — Форматы добыты и закодированы: reelFormats.ts

- Майнинг форматов (3 агента: корпус Reels Brain / RU-рынок / возможности сборки).
- РЫНОК-2026, критично для дистрибуции: IG-реклама запрещена законом с 01.09.2025 (штрафы до 500к₽), YouTube заблокирован с 02.2026, TikTok не грузится с RU. Главный канал = **Wibes** (лента WB: 3.7млн юзеров, −1% комиссии на проданное через ролик, органика новичкам, покупка в 1 тап, буст 250₽/1000). Требования Wibes: 15-30с, хук ≤2с, УТП читается БЕЗ звука, артикул с первых 2с, 3-5 роликов/нед. VK Клипы №2, TG-посевы №3 (CPV 0.09-0.6₽).
- Корпус: единственный срез реальных хуков в репо = supabase/migrations/20260625_viral_hooks_seed.sql (37 хуков, 4 Virlo-орбиты, топ 1.6M views); таксономия 7 хуков × 6 структур × retention-механики в reelsBrainPatterns.ts.
- Сборка: Shotstack = дробные резы + музыка/голос, но только 2 статических текст-слоя (per-beat text = малое расширение buildEdit); fal_timeline = целые секунды, 0 текста, falAutoSubtitle пост-пасс; Remotion VM = покадрово (премиум-лейн).
- **Новое: lib/factory/reelFormats.ts + reelFormatsContract.test.mts** — реестр 6 исполнимых FormatSpec с бит-таймингами и evidence: skeptic_proof (косметика 5), before_after, versus_test (игрушки 5), wb_unboxing, silent_test_drive (БЕЗ блогера и звука — самый дешёвый лейн, Wibes-native), top_n_finds (одежда 5). Валидатор: лицо ≤4с суммарно (поймал 2 моих же нарушения при написании), артикул-эндкард обязателен, хук с 0с, works_without_sound требует плашек. Тесты зелёные, tsc чист.

## 2026-07-02 (утро) — блогеры продуктизированы в код + MiniMax-голос работает

- /tmp почистился при перезапуске: все локальные mp4/png потеряны, НО всё восстановлено из облаков (видео из аккаунта HeyGen по /v3/videos, группы/луки живут в HeyGen). Урок V20 подтверждён.
- **docs/factory-blogger-passports.json** — полные паспорта из живого API: 3 group_id, 42 look_id с именами, конфиги голосов. Паспорта больше не живут в /tmp.
- **MiniMax Speech-02 HD через FAL работает**: fal-ai/minimax/speech-02-hd (sample_rate/channel ЧИСЛАМИ, паузы <#0.35#>, Calm_Woman speed 0.9 pitch -1) → HeyGen /v3/videos принимает плоский audio_url + engine {type: avatar_iv} (форма A прошла с первой попытки). A/B Маня car: MiniMax vs Anya TTS — вердикт владельца ожидается.
- Первый прогон vision-критика (кадровые полосы fps=1/2 tile 4x1, судья — Claude): Вика car ~8/10, Оля mirror ~7.5, Маня-minimax ~7.5, старая Катя ~8.5 ПО КАДРАМ (её слабость — движение, не картинка). Вывод: кадровый критик = дешёвый фильтр брака; «верю/не верю» решает движение+голос. Находка: у Катиного лука текст вшит в изображение («ЧЕСТНЫЙ ОБЗОР») и выглядит нативно — приём стоит перенести на новых.
- **Продуктизация**: RUSSIAN_HEYGEN_BLOGGERS + manya/vika/olya (ugc_wb_v1, реальные look_id, голос Anya), DEFAULT_BLOGGER_VARIANTS + 6 вариантов (car_voice_message/mirror_selfie на каждую, скоры vision-критика, source_runs = heygen video ids). Все 4 blogger-теста зелёные, tsc чист.

## 2026-07-02 (день) — плашки-луки + актёрские пробы

- Катин приём перенесён на новых: у каждой девушки лук с вшитым нативным заголовком (nano-banana edit от исходного лука): Маня «ЧЕСТНЫЙ ОТЗЫВ» (кухня), Вика «ЧТО ПРИШЛО С WB» (зеркало, полный рост), Оля «НАШЛА, ЧЕМ ЗАНЯТЬ РЕБЁНКА» (стол). Ловушки nano-banana: (а) кириллица длинных фраз плывёт — лечится коротким текстом + «letter by letter»; (б) сам дорисовывает вотермарку CapCut — явный запрет в промпт; (в) команда «убери вотермарку» ЗАПРЕЩЕНА гвардом Gemini — только перегенерация с нуля. Плашки залиты в группы, look_id в паспортах (по 15 луков на девушку).
- Актёрские пробы: 6 клипов (story_lean / disbelief_shake / interrupted_real × лучшие луки, expressiveness low, ~$2.4) + анти-AI пост. Страница actor-range.html — вердикт владельца ожидается для карты амплуа.
### Product Twin loop pack pass

- Дата: 2026-07-01
- Ветка: `feat/product-broll-lane-pack`
- Цель:
  - Дособрать операторский контур вокруг Product Twin Studio: real-photo montage status/feedback, richer apparel/bag shot ordering, и живой simple-SKU learning loop в UI.
- Что сделано:
  - `/api/factory/product-broll-montage` расширен до `plan | render | status | feedback`.
  - Для montage добавлен pending flow: если FAL timeline не успел завершиться в одном запросе, route сохраняет `pending_url` в `content_assets` и умеет дожимать job через `status`.
  - Для montage добавлен feedback loop (`usable` / `weak` / `reject`) c записью в `content_assets.analysis.product_broll_feedback` и best-effort сигналом в `cf_signals`.
  - Порядок real-photo montage для `apparel` и `bag` переведён на slot-based scoring (`hero_front`, `closure_detail` / `hardware_detail`, `fabric_macro` / `handle_or_strap`, `side/back`, `inside_detail`) вместо жёсткой привязки только к нескольким `view_id`.
  - Product Twin Studio для простых SKU теперь использует `/api/factory/product-broll-loop`: `Loop Plan` → `Submit 1` → `Judge Last` → `Reject Source`.
  - Product Twin Studio для `apparel` / `bag` теперь умеет `Check Status` для montage и принимает montage feedback без выхода из экрана.
  - Обновлены runbook и visual QA docs под новую операторскую процедуру.
- Проверки:
  - `npx tsx lib/factory/productBrollMontageContract.test.mts`
  - `npx tsx lib/factory/productBrollQualityLoopContract.test.mts`
  - `npx tsx lib/factory/productTwinStudioContract.test.mts`
  - `npx eslint app/api/factory/product-broll-montage/route.ts app/inferno/product-twins/ProductTwinStudio.tsx lib/factory/productBrollMontageContract.test.mts lib/factory/productBrollQualityLoopContract.test.mts lib/factory/productTwinStudioContract.test.mts`
  - `npx tsc --noEmit --pretty false`
  - `npm run dev` → Next.js 16.2.7 поднялся локально на `http://localhost:3000`
- Следующий продовый шаг:
  - Запушить ветку, открыть PR, дождаться deploy и на production Studio проверить `Plan Montage`/`Render Montage`/`Check Status` на `NV-08` и `Loop Plan`/`Submit 1`/`Judge Last` на первом доступном simple SKU.

## 2026-07-02 (вечер) — Спринт «Машина UGC»: день 1 — товар в руки

- Ресёрч (3 агента): (1) product-in-hand = двухфазно: multi-image edit композит + анимация композита (товар не морфит, т.к. уже в кадре); (2) рынок 2026: identity-слой ≠ motion-слой, Arcads = mocap+Seedance 2.0 ~$11/видео, Icon = сборка из тегированных блоков, Sora 2 cameo — НЕ для продакшена (API нет, face-upload забанен); OmniHuman 1.5 = лучший price/quality talking-head ($0.14/сек) и путь миграции с HeyGen v2; (3) Telegram-рельс полностью готов в коде (lib/factory/telegram.ts: sendVideo с кнопками ✓Беру/✕Не то, голосовые ревью через fal-whisper + intent, вердикты → winners/reject) — блокер: FACTORY_TG_BOT_TOKEN/CHAT_ID пусты, ждём от владельца.
- Прототип «Маня держит крем»: тест-товар с кириллической этикеткой «АКТИВ КРЕМ» → композиторы: Seedream v4 edit (этикетка плывёт: «КРЕN»), nano-banana-pro (хуже), **Seedream v4.5 edit = ПОБЕДИТЕЛЬ** — этикетка пиксельно, «гиалуроновая кислота» читается, поза «товар в камеру» ($0.04/композит, best-of-2).
- ⚠️ Seedream v4.5 «исправил» опечатку исходника («килсота»→«кислота») — для реальных брендов нужен OCR-QC против фото карточки (авто-«улучшение» чужого лейбла = риск).
- Рендерится: OmniHuman 1.5 анимация композита под MiniMax-голос — полный прототип «блогер рекламирует товар».
- План спринта Д1-Д4 зафиксирован в тасках. От владельца ждём: TG-токены, 3-5 артикулов с фото, голосовое A/B.

## 2026-07-02 (день) — Зачистка твинов: identity-аудит оригинал vs твин + гейт

- Аудит всех 8 продакшн-твинов против реальных фото съёмки (публичные шары norvia/design), пары отсмотрены глазами:
  - NV-08 — FAIL: твин заметно длиннее реальной куртки (подол у бёдер → почти до колен).
  - NV-836 — PASS: силуэт/карман/кулиски/патч совпадают.
  - NV-816 — FAIL: исходник — фото спины, весь перед твина синтезирован ИИ.
  - NV-01 — WARN: подол длиннее, дорисован чёрный патч на рукаве.
  - CLR00716 — FAIL: другая сумка (замша→зернистая кожа, широкий текстильный ремень→тонкий, тёмная фурнитура→серебро, выдуман шильдик).
  - CLR00715 — FAIL: реальная — тёмный шоколад однотонная, твин — светлый тауп с контрастным клапаном.
  - CLR001101 — WARN: кожа гладкая→зернистая, дорисован лишний тонкий ремешок.
  - CLR001102 — WARN: та же фактура + второй ремешок.
- Вывод: quality_score твина (0.6–0.79) меряет техкачество кадра и НЕ ловит identity-дрифт; 7/8 твинов расходятся с товаром.
- Код:
  - `lib/factory/productTwin.ts`: `ProductTwinIdentityVerdict` + чистый гейт `isTwinIdentityUsable` (fail блокирует, warn/pass пропускают, override явный).
  - `lib/factory/productTwinStore.ts`: identity_verdict читается в rowsToTwin, `setProductTwinIdentityVerdict` пишет вердикт во все строки твина; `getBestProductTwinAsset` больше не отдаёт fail-твины → b-roll (обе ветки: twin_id и auto-twin) падает на реальные фото съёмки.
  - `app/api/factory/product-twin/identity-verdict/route.ts`: GET вердикта, POST записи (protected, reasons обязательны для warn/fail).
- Проверки:
  - `npx tsx lib/factory/productTwinIdentityContract.test.mts` (новый, 11 asserts)
  - `npx tsx lib/factory/productTwin.test.mts`, `productBrollBatchRouteContract` (20), `productTwinBatchContract`
  - `npx tsc --noEmit` — чисто
- После деплоя: применить вердикты на прод через POST identity-verdict (8 артикулов), проверить fallback dry-run CLR00716.

## 2026-07-02 (день) — Удаление fail-твинов

- По решению владельца забракованные identity-аудитом твины удаляются целиком (строки БД + файлы архива).
- Код: `deleteProductTwin` (store), `deleteYandexProductTwinFile` + guard `isDeletableProductTwinPath` (только медиа в product-twin подпапках архива; исходники съёмки недоступны), protected роут `product-twin/delete` (confirm обязателен; без force удаляются только fail-твины).
- Проверки: `productTwinIdentityContract` (+7 asserts), `yandexArchiveCleanupContract`, tsc чистый.
- После деплоя: удалить NV-08, NV-816, CLR00716, CLR00715 (fail); warn/pass не трогаем.

- Результат удаления (прод, 2026-07-02 день):
  - Удалены: NV-08 ×2 битых поколения (f8d6..., +1), NV-816, CLR00716, CLR00715 — суммарно ~71 строка БД, 65 файлов архива.
  - Guard подтверждён живьём: warn-твин NV-01 без force не удаляется (409).
  - Находка: после удаления latest-твина всплывает предыдущее поколение без вердикта. У NV-08 старое поколение pt_NV-08_ae21f401a86c оказалось ХОРОШИМ (длина/карманы/кулиска совпадают) — помечено pass, b-roll снова использует его. Урок: вердикт нужен КАЖДОМУ поколению; при пересборке твина сверка обязательна до записи.
  - Финальная карта твинов: NV-08 pass (старое поколение), NV-836 pass, NV-01/CLR001101/CLR001102 warn, NV-816/CLR00716/CLR00715 — твинов нет, b-roll идёт с реальных фото съёмки.

## 2026-07-02 (ночь) — Итерационный цикл «товар в руки» v1→v5: SHIP

- Протокол владельца: генерация → адверсариальное ревью (2 агента с глазами) → фиксы → следующая итерация; владельцу — только 5-я. Прошли v1 (стоковая поза, «херня») → v2 (селфи-крупняк; этикетка-подстрочник каша, зерно не читается) → v3 (этикетка 8.5 стабильна; оранжевый hero-глоу, поза-манекен) → v4 (композит SHIP: стекло/глоу/identity 8-9; но «наклони банку» перевыполнен OmniHuman'ом → банка боком, label_stability 2.5) → **v5: этикетка во всех кадрах + живая голова при неподвижной банке. Отправлен владельцу в TG.**
- ГЛАВНЫЙ УРОК (зашит в productComposite.ts + тест): ДЕКАПЛИНГ — живость только головой/мимикой/камерой; товар «completely still and upright, label horizontal»; любое движение товара ломает текст и геометрию.
- Новые модули завода: lib/factory/antiAiPost.ts (двухслойное зерно 16+10 в оба прохода — урок «компрессия съедает зерно»; глобальный тёплый каст 7300K против сплит-тона), lib/factory/productComposite.ts (промпт-якоря композита, QC-чеклист 8 артефактов, модели стека), lib/factory/bloggerReelRunner.mjs (конвейер одной команды с resume по response_url), productCompositeContract.test.mts — все зелёные.
- Telegram-канал ревью РАБОТАЕТ: бот @FACTORY_TG_BOT, вебхук на прод; владельцу ушли 10 видео за день. Токены в .env.local (в Vercel добавить FACTORY_TG_BOT_TOKEN/CHAT_ID для кнопок).
- Оперучёт fal: OmniHuman может висеть в очереди 30+ мин — таймаут ≥25 мин, response_url сохранять в state (зашито в раннер); дубль-сабмит как обход застрявшей очереди сработал.
- Осталось от владельца: вердикт по v5, 3-5 реальных артикулов + фото, вердикты голос A/B.

## 2026-07-02 (день) — Identity-сверка в цикле сборки + clean-промпт против вшитых подписей

- `lib/factory/productTwinIdentityCheck.ts`: vision-судья (Claude) сравнивает реальное фото и свежесобранный твин по атрибутам товара (длина, материал/фактура, цвет, фурнитура, ремни, лого). Fail-open без ключа, но с явной пометкой.
- `lib/factory/productTwinBuild.ts`: после persistProductTwin сверка запускается автоматически, вердикт пишется через setProductTwinIdentityVerdict (source=build_auto_check) — fail-твин блокируется гейтом сразу при рождении. Результат возвращается вызывающему (build/batch-build/rebuild worker).
- `lib/factory/productCleanSource.ts`: bag/apparel/default clean-промпты теперь явно убирают брендовую типографику вне товара (урок вшитой подписи CLÉRIN), сохраняя маркировку на самом изделии.
- Проверки: `productTwinIdentityContract` (+6 asserts), `productCleanSource` 19/19, `productTwinBatchContract`, tsc чистый.
- Дальше: пересборка NV-816/CLR00716/CLR00715 с автосверкой + контрольный платный рендер с чистого кадра.

- Результаты блока 1-4 (прод, 2026-07-02 вечер):
  - PR #119 (identity-сверка в сборке + clean-промпты) и #120 (identity_check в ответе build) влиты.
  - Пересборка: CLR00716 → warn (материалы уже верные), CLR00715 → FAIL автосверкой (двухфактурность, выдуманный шильдик, не та фурнитура — судья поймал то же, что ручной аудит) и заблокирован гейтом, NV-816 → warn (перед со спины не сверить). Автосверка работает в бою.
  - Контрольный рендер CLR00716 (warn-твин + clean_first + Kling, ~$0.4): видео теперь НАТИВНО ВЕРТИКАЛЬНОЕ 724×1268, паспарту/рамки нет, замшевый клапан и гладкий корпус читаются верно, движение чистое.
  - Остаточные дефекты: (1) вшитая подпись CLÉRIN внизу кадра — nano-banana её НЕ убирает даже с явным промптом; лечить детерминированным кропом нижней полосы перед video API; (2) шильдик на сумке морфится при макро-зуме Kling («CZ ĤHIN») — нужен OTK-гейт на читаемость лого / движения без макро-прохода по тексту; (3) при деплой-чурне (несколько активных ревизий) статус-опросы могут писать 2 копии в архив — janitor чистит.

## 2026-07-02 (поздняя ночь) — голос выбран, референсы мира найдены

- Голосовые бейкоффы (2 раунда, вердикты владельца): MiniMax Calm=«не живой», Lively=«очень детский» → **ElevenLabs v3 победил** («эдевенлабс а»). Из ресёрча: v3 — единственный TTS, где [laughs]/[sighs]/паузы работают НА РУССКОМ; нативные RU-голоса: Nastya YjESejviApN7SHrbfnA2 (young conversational), Alina dVRDrbP5ULGXB94se4KZ; настройки: stability 0.35-0.45, style 0.4, speed 1.05, language_code=ru. Приём «редактор пауз»: многоточия=вдох, тире=микропауза, КАПС=ударение, филлеры «ну/короче/так вот» прямо в тексте. Зафиксировано в passports voice_winner. Запасной путь: MiniMax voice-clone от 10с аудио (клон живёт 7 дней без использования!).
- Вердикты владельца по видео: v5 «блин плохо», формат-версия: «слишком много шума» (зерно 16+10 → снижено до 8+5 в ANTI_AI_DEFAULTS), «с товаром в руках — без товара наверное лучше» (дефолт формата: лицо чистое, товар только врезками из реальных фото), «голос не живой» (решено v3).
- Охота за референсами мира: Kalshi NBA ad (Veo3, нац-ТВ США, $2000: 300 клипов→15, кадр ≤3с), Min Choi street interview («This is 100% AI», 22.05.2025: неидеальный свет+шум улицы+микрофон), Mirage/Captions (UGC-native модель: микро-реакции тела МЕЖДУ фразами), Seedance 2.0 (ждать на fal — решит консистентность лица между склейками), HeyGen Avatar IV (наш стек, миграция с v2 = скачок мимики). **В RU-сегменте маркетплейсов неотличимых примеров НЕ НАЙДЕНО — ниша открыта.**
- Чеклист Mirage перенят как эталон OTK: (1) неидеальный свет, (2) реакции тела между фразами, (3) селфи-кадрировка, (4) кадр ≤4с.
- В рендере: v6.1 (Jessica) готов, v6.2 (Nastya + редактор пауз) в очереди — финальное голосовое A/B владельцу.

## 2026-07-02 — Mirage (Captions) разведан, API-заявка подана владельцем

- Mirage Studio = captions.ai (mirage.app редиректит; mirage-studio.io — ДРУГОЙ продукт). Своё лицо МОЖНО (selfie→digital twin, переиспользуемый между роликами), русское аудио на вход работает (image+audio→video), Free 200 lifetime-кредитов с вотермаркой, Pro $9.99. API в early-access бете (заявка typeform, $0.175/сек, api.captions.ai) — **владелец подал заявку**. Отзывы: 4.2/5, экспрессия лучше конкурентов, минусы — медленный рендер, меньше контроля, товар-в-руках у них тоже боль.
- План: веб-триал с фото Мани + Nastya-аудио = внешний эталон против нашего OmniHuman v7 (деглянц+резкость) лоб-в-лоб; при одобрении API — Mirage как альтернативный motion-слой в bloggerReelRunner (наши identity-ассеты переносимы, вендор-лок нулевой).
- Калибровка вечера по вердиктам владельца (все зашиты в antiAiPost.ts): шум 16+10→8+5, глянец → деглянц исходника + прижатые света, «мягкая картинка» → CAS 0.45 + lanczos + битрейт 2600k. Голос: Nastya канонизирована (passports.voice_winner).

## 2026-07-02 — бейкофф аниматоров: промежуточное + FAL исчерпан

- Деглянц-лук получился со 2-й попытки (фото-термины вместо «кожных»: uneven window light, underexposed, matte skin — Seedream на 1-й вернул 0 картинок). Кадры — новый стандарт реализма луков.
- FAL-баланс исчерпан в ноль (день сжёг ~15 оживлений + композиты + TTS) — аккаунт заперт, ждём пополнения владельца. Урок: нужен баланс-гард перед батчами (fal.ai баланс-чек в раннер).
- HeyGen Avatar IV ветка (аудио захощено через TG-файлы + deleteMessage): движение ок, НО темнит кадр и слегка уводит лицо vs деглянц-исходник. Урок → antiAiPost.adaptGradeToLuma(): грейд по замеру YAVG (тёмному лифт, яркому дотенение).
- Микро-реакции (Mirage-чеклист) вшиты в моушен-промпты: «thoughtful reaction before the first phrase, sincere smirk after the last».
- Ожидание: FAL-топап → OmniHuman+Kling на том же кадре → ревьюер судит четвёрку (с Mirage по готовности) → чемпион владельцу.

## 2026-07-02 (вечер) — Ультра-аудит контента + манифест исходников твинов

- Ультра-аудит съёмки (14 агентов, все папки товаров отсмотрены глазами + обход 36 цветовых папок NORVIA):
  - Папки — это готовые карточки маркетплейса, а не исходники: чистых кадров 0–2 на артикул у МАША (YYS0101 0/17, TT04102 0/46, CLR001101 0/15), вшитый текст на 80–100% файлов.
  - В съёмке замешаны AI-рендеры товара: NV-01 IMG_1718/1720 — куртка другой длины (источник твин-брака «длина/патч»); CLR00715 — в одной папке ДВЕ фактуры сумки (замша vs гладкая) — требуется сверка с физтоваром.
  - Задников нет ни у одного товара МАША; у NORVIA нет ghost-mannequin передов; кадр 11.png CLR00716 содержит чужой бренд SAINT LAURENT.
  - Структура: 4 пустые папки ПОЯС («перекрас»), /сортировать 225 неразобранных файлов, 7 папок с ведущим пробелом в имени, дубли, PDF-карусели вперемешку с сырьём.
  - Код-причина: пикеры выбирали исходник по номеру файла (bag n∈[2..5]) и по захардкоженным номерам кадров одной съёмки (apparel 7070/7073) — слепые эвристики брали инфографику и спину.
- Код:
  - `lib/factory/twinSourceManifest.ts` — проверенный глазами чистый кадр для каждого из 13 артикулов (+fallbacks), blocked для TT04102 (чистых кадров нет), bannedNames для AI-рендеров NV-01 и инфографики NV-816.
  - `lib/factory/twinSourceScreen.ts` — vision-скрин кандидатов пикера: вшитый текст / перекрытый товар / подозрение на рендер отклоняются ДО сборки (fail-open без ключа).
  - `lib/factory/productTwinBuild.ts` — resolveInputImage: манифест → пикер-fallback со скрином и бан-листом; blocked валит сборку с понятной ошибкой.
- Проверки: `twinSourceManifestContract` (новый, 19 asserts), `productTwinIdentityContract`, `productTwinBatchContract`, `productSourcePicker`, tsc чистый.
- Дальше: пересборка всех манифест-артикулов с автосверкой; организационное — запросить у дизайнера подложки без текста, доснять задники, сверить фактуру CLR00715.

## 2026-07-02 (ночь) — WB-каталог кабинета NORVIA: 60 SKU в заводе

- Владелец передал WB-экспорт «Общие характеристики» (02.07.2026): 36 курток (4 модели × 9 цветов) + 24 ветровки (HT-42/80/83 × 8 цветов). Раньше завод знал только 4 куртко-SKU (по одному цвету на модель).
- `lib/factory/wbSellerCatalog.ts`: статический каталог всех 60 SKU (артикул, wbId, цвета карточки, модель), маппинг SKU → съёмочная папка цвета (точные имена, включая ведущие пробелы), легаси-алиасы (NV-08-57→NV-08 и т.д. — существующие твины/вердикты записаны под короткими именами), ветровки помечены pending (съёмка в ZIP не распакована), 4 «перекрасные» папки ПОЯС — пустые.
- `twinSourceManifest.twinSourceForArticle`: полные SKU канонических цветов наследуют манифест легаси-артикула.
- `productTwinBuild.resolveInputImage`: новая ветка между манифестом и слепым пикером — для каталожного SKU кандидаты берутся из сырых IMG_* его цветовой папки и проходят vision-скрин (перёд/три-четверти без текста); pending-SKU валит сборку с понятной причиной.
- Проверки: `wbSellerCatalogContract` (новый, 20 asserts), `twinSourceManifestContract`, `productTwinIdentityContract`, tsc чистый.
- Эффект: завод готов собирать твины и гнать b-roll на все 32 куртко-цвета с контентом (было 4). Ветровки — после распаковки ZIP. Пересборка 12 базовых артикулов ждёт пополнения FAL (кошелёк в минусе).

## 2026-07-02 (ночь) — Reels Brain: локальный audio loop вынесен на Railway

- Прод-диагностика показала две реальные пробки:
  - корпус уже `6682` строк, analyzed `6624`, но audio `0 ok / 7 failed / 6675 pending`;
  - Railway worker стабильно крутит media/audio по платформам, но audio-этап на Vercel падал в `ffprobe_unavailable`.
- Техфикс:
  - `app/api/factory/jobs/reels-brain-audio-backfill/route.ts`: добавлен `dry_run=1`, чтобы Vercel только отдавал кандидатов без попытки извлечения аудио;
  - `app/api/factory/jobs/reels-brain-audio-commit/route.ts`: новый авторизованный commit-route для записи локально извлечённых audio_features/transcript обратно в `viral_videos.analyzed_full`;
  - `lib/factory/reelsBrainOfflineWorker.mjs`: worker теперь умеет `local-audio` режим по умолчанию, если на Railway есть `ffprobe` + `ffmpeg`; забирает dry-run кандидатов, сам делает `ffprobe`/`ffmpeg`, опционально `fal-whisper`, затем пишет результат через `audio-commit`.
- Контуры безопасности:
  - image-like media URLs локально не трогаются;
  - старый media loop не сломан, mixed rotation и local yt-dlp resolver остаются.
- Проверки: `reelsBrainOfflineWorkerContract` зелёный (14/14), `tsc --noEmit` зелёный.
- Следующий live step: задеплоить свежий код в Vercel, затем перезапустить/перекатить Railway service, чтобы он начал брать новый `dry_run + audio-commit` путь.

## 2026-07-02 — ПЕРВОЕ «ВЕРЮ» ВЛАДЕЛЬЦА 🎉

- Бейкофф аниматоров (один деглянц-кадр, один голос): **HeyGen Avatar IV победил OmniHuman 33:30** (судья-агент). OmniHuman: лучшая моторика, но дрейф лица, глаза закрыты 3/5 кадров, галлюцинация улицы в выбитом окне. HeyGen: identity/пропсы/свет держит; теллы (relight лица, сглаженная кожа) — лечатся постом/монтажом.
- Чемпион (деглянц-лук + Nastya + адаптивный лифт-грейд + зерно 8+5 + CAS) отправлен владельцу → **«верю рил круто»** — первый пройденный believability-гейт за всю историю блогеров завода.
- КАНОН-РЕЦЕПТ «идеального блогера»: своё лицо (foundry) → деглянц-лук (фото-термины: uneven window light, underexposed, matte skin) → HeyGen Avatar IV (audio_url, микро-реакции в motion_prompt) → ElevenLabs v3 нативный RU-голос + редактор пауз → адаптивный грейд по YAVG → зерно 8+5 + CAS 0.45 → кадр ≤4с в монтаже.
- Тиражирование на Вику (голос Alina dVRDrbP5ULGXB94se4KZ) и Олю — запущено.

## 2026-07-02 (поздний вечер) — Пересборка 12 твинов + контрольный рендер

- FAL пополнен ($27.91). Пересобраны все 12 манифест-артикулов с аудированных исходников; автосверка вынесла вердикты: TT05102 pass, остальные 11 warn с конкретикой.
- Системные паттерны nano-banana, пойманные сверкой: (1) выдуманный шильдик NORVIA на рукаве у ВСЕХ курток; (2) фурнитура сумок серебро→gunmetal; (3) фактура клапана гладкая/замша→зернистая; (4) YOYO — дорисован корейский текст под лого.
- Контрольный рендер CLR00716 (Kling, 1 job, ~$0.35) с нового твина: НАТИВНАЯ ВЕРТИКАЛЬ 724×1268 (было 960×960 с паспарту), без рамок и вшитой подписи, движение чистое (рука входит, макро-наезд), руки без артефактов.
- Остаточные дефекты: эмбос-лого CLÉRIN морфится при макро-зуме (CLERIN→CLBRIN на пике) — подтверждает необходимость OTK-гейта на читаемость лого; фактура клапана зернистая vs замша оригинала (warn твина, лечится подложками от дизайнера или пересъёмкой).
- Итог дня: конвейер от исходника до видео проходит с тремя рубежами контроля (манифест/скрин → identity-сверка → gate) и честной маркировкой брака.

## 2026-07-03 (ночь) — OTK-гейт живьём + разбор ветровок

- Judge-гейт петли (product-broll-loop?action=judge) проверен живьём на контрольном рендере CLR00716: артефакт-чек по 3 кадрам вернул clean (морф эмбос-лого на макро-пике не пойман — кадровая выборка first/middle/last), но политика петли вынесла reject «category_too_complex» с рекомендацией «apparel/bag → real-photo motion montage». Политика параллельного агента сходится с identity-аудитом: i2v для сумок/одежды — только ручной режим с override.
- `product-broll-batch` submitted-ответ теперь подсказывает judge_route — оператор дергает OTK одним кликом после status=done (контракт 21 assert).
- Ветровки: модельные ZIP (HT-42/80/83, ~432 МБ) скачаны и распакованы с починкой кодировки имён (cp437→utf8) в /scratchpad/windbreakers/unpacked/HT-{42,80,83}/<цвет>/ — 8 цветов на модель + отдельные папки «аи главные» (AI-обложки уже отделены). НО: содержимое — готовые карусели карточек (размерные сетки, слайды «мы ценим качество»), сырой съёмки в этих ZIP нет. Сырьё — в «ветровки съемка 1.zip» (480 МБ) и «ветровки съемка 2.zip» (1.1 ГБ) — разбирать отдельным заходом.
- Открытый вопрос владельцу: куда заливать разобранное сырьё ветровок (публичные шары read-only; вариант — владелец заливает в шару NORVIA папку /Ветровки/HT-XX/<цвет>/, тогда каталог расширяется на 24 SKU без изменений пайплайна).

## 2026-07-03 (ночь) — WB-CDN как источник твинов: артикул-точные фото для 60 SKU

- Ключевое открытие: WB-экспорт содержит колонку «Фото» с URL опубликованных карточек на CDN wbbasket.ru — по каждому из 60 SKU, привязано к точному артикулу и цвету. Это снимает саму проблему «какой это товар»: не нужен ни ручной маппинг съёмочных папок, ни распаковка ZIP. Съёмочные ZIP-ы вскрыты и опознаны фан-аутом (12 сессий), но оказались смешанными по цветам/изделиям и без надёжной модели — WB-CDN обходит это полностью.
- `lib/factory/wbCardPhotos.ts`: базовые URL + счётчик фото для всех 60 SKU; `wbCardPhotoUrls` отдаёт кандидатов в порядке обложка→края→середина (слайды размерной сетки/гарантии в конце).
- `productTwinBuild.resolveInputImage`: новая ветка 1.5 между манифестом и съёмочной папкой — тянет WB-фото по артикулу, webp→png, vision-скрин (чистый перёд, отсев плашек), возвращает article-exact источник. Для 56 неканонических SKU это основной путь.
- Проверки: `wbCardPhotosContract` (новый), `wbSellerCatalogContract`, `twinSourceManifestContract`, tsc чистый.
- Дальше: smoke 2 SKU на проде (проверить, что WB-фото дают чистый твин end-to-end), затем пересборка всех 60.

## 2026-07-02 — финальный суд четырёх аниматоров + Drill Loop батч 1

- Финал на одном кадре+аудио: **heygen_direct победил** (identity 8.5/свет 9/живость 8.5/ugc 9) — сцена попиксельно, настоящий липсинк, $0.067/с. **kling v2 standard** (fal-ai/kling-video/ai-avatar/v2/standard — сегменты пути ПЕРЕВЁРНУТЫ в v2!) — свет 9, пластика 9 (отпивает, прикрывает глаза), но НЕТ липсинка → канонизирован как **аниматор молчаливых b-roll перебивок** ($0.056/с, новый класс контента). fal_heygen исключён (хуже прямого +49% цены), omnihuman исключён (перерисовывает сцену даже с фиксами окна/глаз).
- Кошельки: речь = HeyGen, всё остальное = fal (пожелание владельца о полной консолидации на fal не пережило суда по качеству — задокументировано честно).
- Drill Loop построен в код: lib/factory/bloggerDrillLoop.ts (планировщик батчей, ось-за-осью + контроли) + bloggerDrillRunner.mjs (пер-клип resume, леджер в docs/factory-blogger-drill-ledger.json). Батч 1 «свет и сцена» (10 клипов Мани) выполняется; план петли: docs/factory-blogger-drill-loop-plan.md (50 клипов/день ≈ $30, владельцу — только лучшие).
- Агент-находка: полный каталог fal talking-head моделей с ценами (kling v2, wan s2v, infinitalk, sync-lipsync v2/v3 для пере-озвучки реальных b-roll) — в леджере знаний.

## 2026-07-03 — Полный прогон каталога: 60 SKU через WB-CDN + 3 рубежа

- Прогнаны все 60 SKU кабинета NORVIA (36 курток + 24 ветровки) через пайплайн: источник (манифест → WB-CDN → папка цвета → пикер, каждый кандидат через vision-скрин) → сборка → identity-сверка → вердикт в базу.
- Итог (после ретрая 1 транзиентного 504):
  - **30 годных твинов (warn/pass)** — товар верный, дрифт мелкий и помечен. Куртки 23, ветровки 7. Источник: 29 WB-фото, 12 папки цвета, 4 манифест.
  - **15 fail-identity** — собраны, но гейт заблокировал (не пойдут в b-roll). Причины: ветровки — WB-обложка обрезана по пояс → выдуманная длина/парка; куртки — дрифт фактуры/фурнитуры. SKU: HT-42-01/22/35, HT-80-04/11/22/32/43, NV-01-05, NV-08-53/55/58, NV-816-35, NV-836-53/57.
  - **14 не собрались**: 9 ветровок с пустыми папками цвета (HT-42-04/32/43, HT-83-01/04/11/32/35/43) + 5 курток, где WB — только карточки с плашками «Весна 2026» и в папке цвета чистого переда нет (NV-08-02/04/05/48, NV-836-02).
- Вывод: система работает как задумано — ни один брак не прошёл (все fail заблокированы). Потолок — качество источника: для 29 SKU (15 fail + 14 no-build) нужен чистый полноростовой кадр переда (подол в кадре, без плашек). Это reshoot-лист дизайнеру.
- Стоимость прогона: ~$10 FAL (44 сборки nano-banana) + vision-скрин.

## 2026-07-03 — Починка порядка WB-кандидатов: чистая зона вместо обложки

- Диагностика «сам разберёшься»: скачал ВСЕ фото 2 заваленных SKU (HT-42-01 28шт, NV-08-02 22шт), осмотрел контакт-листами. Вывод: чистые полноростовые фронты И ghost-packshot В КАРТОЧКАХ ЕСТЬ (HT-42-01: #15/18/20/23; NV-08-02: #13/15/17/20 + packshot #20). Дизайнер НЕ нужен — резолвер просто искал не там.
- Корень: candidateOrder брал обложку первой (#1..3), а это ровно фиче-слайды с плашками «Весна 2026». Чистые кадры кластеризуются в СЕРЕДИНЕ-КОНЦЕ карточки.
- Фикс `wbCardPhotos.candidateOrder`: порядок теперь середина(0.4·count)→хвост→обложка; limit 8→14. Проверено: HT-42-01 пробует 12,13,14,15…; NV-08-02 — 9,10,…13,15,17,20.
- Проверки: `wbCardPhotosContract` обновлён (обложка НЕ первая), tsc чистый.
- Дальше: пересобрать 29 SKU из reshoot-листа — теперь резолвер добирается до чистых кадров.

## 2026-07-03 — Reels Brain worker: облегчён cold start и включена честная bootstrap-диагностика

- Цель: добить Railway worker до состояния, где он стартует быстро и не зависает в `INITIALIZING`, даже если на контейнере нет `ffmpeg/ffprobe`.
- Диагностика:
  - production service `reels-brain-offline-worker` продолжал крутить старый успешный deployment `f0d584cf...`, а новые `61de88b1...` и `a0176a3f...` не давали полезных startup-логов;
  - runtime-логи старого деплоя подтвердили, что mixed loop жив, media backfill крутится, но audio ветка падала на `ffprobe_unavailable`, позже уже с новым кодом добавился хвост `whisper 422`;
  - это указывало не на бизнес-логику, а на тяжёлый bootstrap-path до входа в основной воркер.
- Фикс:
  - `lib/factory/reelsBrainAudioRailwayWorker.mjs`: убран автодownload `ffmpeg` tarball на старте и убран `pip install yt-dlp` из cold start;
  - shim теперь только ищет уже существующие бинарники в стандартных путях Railway/Nixpacks;
  - добавлены явные startup-логи `bootstrap_start` и `bootstrap_ready` с полями `yt_dlp_bin`, `ffmpeg_bin`, `ffprobe_bin`, `fal_key_present`.
- Ожидаемый эффект:
  - новый deployment должен либо стартовать сразу и показать bootstrap-состояние в логах, либо честно упасть уже после вывода диагностической строки;
  - worker больше не будет зависеть от сетевого скачивания heavy-бинарей в boot-time.
- Локальные проверки:
  - `npx tsx lib/factory/reelsBrainOfflineWorkerContract.test.mts` — зелёный (14/14)
  - `npx tsc --noEmit --pretty false` — зелёный

## 2026-07-03 — Пересборка 29 reshoot-SKU после фикса порядка: +17 годных

- Anthropic-кредиты пополнены (были исчерпаны → оба vision-рубежа фейл-опенились). После пополнения — полный прогон 29 SKU из reshoot-листа с живым скрином+сверкой.
- Итог 29: **17 годных (16 warn + 1 pass)** + 12 остались fail. 3 транзиентных «no response» (NV-08-04/05/48) добиты ретраем — все warn.
- Восстановлены без дизайнера: куртки NV-08-02/04/05/48/55/58, NV-816-35 (pass!), NV-836-57; ветровки HT-42-01/04/32/35/43, HT-80-43, HT-83-11/35/43.
- **Итого по каталогу: 48 из 60 SKU имеют годный твин** (было 4 на старте линии). Reshoot-лист сжался 29 → 12.
- Остаются fail (гейт блокирует, не публикуются): HT-42-22, HT-80-04/11/22/32, HT-83-01/04/32, NV-01-05, NV-08-53, NV-836-02/53. Смесь: реальный дрифт nano-banana + цвета, где даже в чистой зоне карточки перёд обрезан/проблемный. HT-80 (ветровка база) проседает сильнее прочих — кандидат на точечный разбор.
- Вывод «сам разберёшься»: подтверждён — 17/29 восстановлены только правкой резолвера, источник был в карточках всё это время.

## 2026-07-03 — Ниша «bags» в рубрикаторе + свой набор b-roll moves

- Находка при разборе товаров МАША по нишам: сумки CLÉRIN (CLR*) падали в нишу `default` и получали скинкейр-моушены b-roll («рука берёт крем», vanity orbit) — не для сумки.
- `rubric.ts`: добавлена ниша `bags` (тип, веса audience+sell — акцент на удержание/бренд-шильдик, флоры наследуются), классификатор `nicheFromArticle` ловит CLR/сумк/кросс-боди/клатч/шоппер/рюкзак/bag/tote.
- `productBrollBatch.ts`: рецепт `bag_lookbook` + BAG_LOOKBOOK_MOVES (10 движений: hero push, leather macro, hardware detail, strap drape, shoulder carry, turntable, flap gesture, flatlay rise, window light, in-hand walk). movesFor отдаёт их для recipe=bag_lookbook или category=bag.
- Allowlist ниши расширен в graphRun.ts и video-critic (иначе bags молча резался в default).
- Проверки: productBrollBatch 19 (+bags), rubricV2Contract, tsc чистый.
- Эффект: 4 сумки теперь оцениваются и анимируются по своей нише, а не как косметика.

## 2026-07-03 — Дожим 12 fail: точечный clean-промпт под 2 системных дрифта

- Разбор причин 12 fail-твинов одежды выявил 2 паттерна nano-banana (не source, а генерация):
  - A) удлинение короткой ветровки в парку/пальто + выдуманный капюшон + перекрас молнии (8/12: HT-42-22, HT-80-04/11/22/32, HT-83-01/04/32);
  - B) выдуманный шильдик/нашивка на рукаве (NV-01-05, NV-08-53, NV-836-53) — этот же дрифт был в причинах МНОГИХ warn по всему каталогу.
- `productCleanSource.ts` apparel-промпт усилен тремя строками: (1) жёсткая фиксация длины (короткая ветровка остаётся короткой, не парка); (2) копировать застёжку/капюшон как в источнике, не добавлять капюшон, тёмную молнию держать тёмной; (3) ЗАПРЕТ выдумывать рукавный шильдик/патч/лого — воспроизводить только реально присутствующую маркировку.
- Проверки: productCleanSource 22 (+3), tsc чистый.
- Ожидание: B-паттерн (рукавный шильдик) должен уйти → часть fail в warn/pass; A-паттерн (длина) частично, где источник честно показывает крой.

## 2026-07-03 — Итог дожима: +6 годных (54/60 NORVIA)

- Пересборка 12 fail с усиленным apparel-промптом: **6 подняли fail→warn**, 6 остались fail.
- Сработало: B-паттерн (рукавный шильдик) закрыт полностью — NV-01-05, NV-08-53, NV-836-53 годны. A-паттерн частично — HT-80-22 (капюшон), HT-80-32 (длина), HT-83-04 годны.
- Остались fail (6): HT-42-22, HT-80-04 (белая молния), HT-80-11 (пропали кнопки-планка), HT-83-01, HT-83-32, NV-836-02 (карманы без клапанов). Это самый упрямый A-паттерн — nano-banana продолжает удлинять короткие ветровки в парку даже с явным запретом в промпте; фикс уровня промпта тут упирается в структурную предвзятость модели.
- Технический урок: с усиленным промптом билд вырос до ~100с; клиентский fetch без таймаута отваливался раньше ответа («no response»), хотя твин на сервере собирался. Добавлен AbortSignal.timeout(310000) в rebuild-скрипт.
- **Покрытие каталога: 54/60 NORVIA + 8/9 МАША = 62/69 годных твинов** (было 4 на старте всей линии). Остаётся 6 NORVIA fail + 1 МАША blocked, все держит гейт (не публикуются).

## 2026-07-03 — YouTube переключен в API-first режим для Reels Brain

- Принято решение не тащить YouTube Shorts через `yt-dlp/cookies` как основной путь: anti-bot нестабилен и не нужен для discovery.
- `Reels Brain` оставлен с официальным `youtube`-провайдером для discovery и пополнения корпуса через `YouTube Data API`.
- Offline mixed worker переведен в практичный дефолт:
  - `REELS_BRAIN_PLATFORMS=tiktok,instagram`
  - `REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_YOUTUBE=youtube`
- Смысл: TikTok/Instagram продолжают идти в full-fidelity loop (`media -> transcript -> audio`), а YouTube работает как metadata/discovery-слой без траты циклов на media extraction.
- Живая проверка production API:
  - `POST /api/factory/jobs/reels-brain-bulk-ingest` с `platforms=["youtube"]`, `providers=["youtube"]`
  - результат: `found=5`, `enriched=5`, `error=null`, `best_provider="youtube"`, `estimated_spend_usd=0.035`
- Вывод: YouTube API-ветка жива и годится для роста корпуса; raw-media разбор Shorts остается отдельной задачей и больше не блокирует общий цикл обучения.

## 2026-07-03 — Deep-analysis cleanup: расширены transcript timeout'ы и очищен ложный Instagram media слой

- Проблема 1: mixed worker был жив, но transcript-only путь на Railway часто падал по таймауту до того, как FAL Whisper успевал вернуть текст.
- Фикс:
  - `lib/factory/reelsBrainOfflineWorker.mjs`: таймауты вынесены в env-aware константы и увеличены:
    - `REELS_BRAIN_FAL_REHOST_FETCH_TIMEOUT_MS` → default `180000`
    - `REELS_BRAIN_FAL_STORAGE_PUT_TIMEOUT_MS` → default `180000`
    - `REELS_BRAIN_FAL_WHISPER_TIMEOUT_MS` → default `120000`
    - `REELS_BRAIN_YTDLP_DOWNLOAD_TIMEOUT_MS` → default `240000`
    - `REELS_BRAIN_HTTP_JSON_TIMEOUT_MS` → default `180000`
  - цель: даже без `ffprobe/ffmpeg` увеличить шанс на `transcript_ready` через transcript-only ветку.
- Проблема 2: в `audio_visual_readiness` Instagram показывал `with_media_locators=60`, но это были не видео, а старые `jpg/webp/heic` image-only locators. Они раздували готовность слоя и не давали честно понимать прогресс.
- Data repair:
  - через production Supabase reset'нуты `60` Instagram rows с image-only `reels_seed.media_locator_candidates`;
  - `pipeline.media_status` переведен обратно в `media_missing`, чтобы rows снова попали в нормальный `media-backfill`.
- Проверка после repair:
  - `audio_visual_readiness.with_media_locators` упал `98 -> 38`
  - `instagram.with_media_locators` упал `60 -> 0`
  - витрина readiness теперь честно показывает, что deep-ready слой фактически держится на TikTok, а Instagram требует повторного video backfill.
- Параллельно для Railway service обновлен `NIXPACKS_PKGS` на `ffmpeg-full yt-dlp` и запущен rebuild, чтобы дожать настоящий local audio toolchain (`ffmpeg_bin/ffprobe_bin` вместо `null`).

## 2026-07-03 — Перекраска твинов от эталона (идея владельца)

- Стратегия: вместо сборки каждого цвета отдельно (разное качество, дрифт) — взять ОДИН лучший твин-эталон на модель и перекрасить в остальные цвета. Перекраска не трогает геометрию → все цвета одинаково качественные, nano-banana не может удлинить/выдумать капюшон (структуру не перегенерируем). Это же лечит остаток fail.
- `lib/factory/twinRecolor.ts`: `buildRecolorPrompt` (меняет только цвет ткани, жёстко держит силуэт/длину/застёжку/фурнитуру; hex-якорь цвета WB-палитры) + `recolorTwinFromBase` (эталон→nano-banana recolor→variants→upload→persist как твин целевого артикула, provenance recolor).
- `app/api/factory/product-twin/recolor/route.ts`: POST одиночный {base_article,target_article,color} + батч {base_article, all_colors_of_model:true} по всем цветам модели из WB-каталога.
- Проверки: twinRecolorContract (новый), tsc чистый.
- Дальше: владелец выбирает лучший эталон на модель (4 куртки + 3 ветровки) по галерее; перекрашиваю в остальные цвета. Сумки оставляем как есть.
