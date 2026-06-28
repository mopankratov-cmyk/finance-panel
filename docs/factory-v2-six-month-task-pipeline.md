# Reels Factory v2: Six-Month Task Pipeline

Дата: 2026-06-28  
Статус: рабочая нарезка из RFC `Reference-First + Two-Lane + QA-Before-Assembly`  
Цель: за 6 месяцев перейти от нестабильного выпуска MP4 к качественному, измеримому и управляемому контент-заводу.

## Главный принцип

Не строим сразу "всю фабрику". Идем слоями:

1. Сначала продуктовая линия, потому что сейчас главная боль в товарном кадре и ОТК.
2. Потом строгая структура ролика, чтобы убрать клоны и рассинхрон.
3. Потом надежность worker/очереди, чтобы не платить дважды и не ловить зависания.
4. Потом fan-out и обучение, когда качество уже честно измеряется.
5. Потом UGC/hybrid.
6. Потом масштабирование на ниши, публикацию и автономный планировщик.

Если следующий слой не может пройти acceptance предыдущего, он не стартует.

## Северная метрика

`frames_grounded_otk_pass_rate`

Pass считается только если:

- есть реальное MP4;
- кадры извлечены из этого MP4;
- `video-critic` судил по кадрам, а не только по тексту/fallback;
- `artifact-check` не нашел broken-дефект;
- score >= 7;
- ролик сохранен в approved memory.

MP4 с warning не считается победой.

## Месяц 1: Product Lane Foundation

Цель месяца: остановить сырой WB-source, сделать честный вход в рендер и убрать самые грубые артефакты до платного fan-out.

### M1.P1 Canonical Frame v1

Задача:

- создать `lib/factory/canonicalFrame.ts`;
- добавить `normalizeToOutputRes(buffer, 720, 1280)`;
- использовать Sharp `contain + letterbox`, не crop;
- добавить interim-хранение canonical через `content_assets.analysis.canonical=true`;
- без миграции БД на первом PR;
- `prepare-product` должен возвращать canonical/staged URL.

Файлы:

- `lib/factory/canonicalFrame.ts`
- `lib/factory/sourcePrep.ts`
- `app/api/factory/prepare-product/route.ts`
- тесты в `lib/factory/*canonical*.test.mts`

Acceptance:

- любой prepared asset после prep имеет 720x1280;
- товар не обрезан;
- no-FAL fallback тоже дает canonical;
- тест проверяет размер изображения;
- старый API `prepare-product` не ломается.

### M1.P2 Source Readiness Gate

Задача:

- изменить смысл source-ready;
- `prepared` = strong ready;
- `real` = acceptable ready;
- `wb` = weak, не strong;
- WB-only не должен проходить `require_strong_source`;
- batch должен явно возвращать `next_action: prepare_product`.

Файлы:

- `lib/factory/sourceReadiness.ts`
- `app/api/factory/batch/route.ts`
- `app/api/factory/prepare-drafts/route.ts`

Acceptance:

- WB-only article не попадает в paid i2v при `require_strong_source=true`;
- batch dry-run показывает, сколько SKU требуют prep;
- no-paid smoke умеет объяснить блокер;
- 0 raw-WB-in-frame в новом guarded прогоне.

### M1.P3 Canonical-First Asset Binding

Задача:

- `assetBind` сначала выбирает canonical/prepared asset;
- round-robin оставить только fallback;
- `assetMatchesArticle` не ослаблять;
- если canonical есть, все product i2v nodes используют один source.

Файлы:

- `lib/factory/assetBind.ts`
- `lib/factory/graphRun.ts`

Acceptance:

- в run_plan видно `canonical_frame_url` или prepared source;
- один SKU в одном ролике не скачет между разными WB-картинками;
- чужой артикул отбрасывается.

### M1.P4 Render Router Minimal

Задача:

- добавить `lib/factory/renderRouter.ts`;
- ввести lane metadata: `product | ugc | hybrid`;
- default lane = `product`;
- пока не менять UGC-пайплайн;
- router только классифицирует и логирует, не включает новых провайдеров.

Файлы:

- `lib/factory/renderRouter.ts`
- `lib/factory/graphTypes.ts`
- `lib/factory/graphRun.ts`

Acceptance:

- каждый `run_plan` имеет lane;
- product nodes не уходят в Creatify;
- тесты на 10-12 кейсов роутинга;
- нет новых внешних API.

### M1.P5 Month-1 Quality Smoke

Задача:

- запустить 10 guarded product-прогонов;
- собрать отчет по source, OTK, warnings, spend;
- зафиксировать baseline после canonical/source gate.

Документ:

- `docs/factory-v2-m1-report.md`

Acceptance:

- 10 прогонов завершены или честно DLQ/warning;
- 0 raw WB;
- есть список top-3 причин брака;
- понятно, что чинить в M2.

## Месяц 2: Blueprint and Specialization

Цель месяца: убрать клоны и рассинхрон script/product/brand.

### M2.P1 Blueprint Schema

Задача:

- создать `lib/factory/blueprint/schema.ts`;
- Zod-схема для `Blueprint`;
- поля: `sku_id`, `lane`, `format`, `duration_s`, `hook`, `beats`, `voiceover`, `captions`, `music_mood`, `cta`;
- `hook.locked=true`;
- bounded repair для JSON.

Acceptance:

- invalid blueprint не проходит;
- hook нельзя перезаписать downstream;
- тесты на валидный/битый JSON.

### M2.P2 Compile Blueprint to Nodes

Задача:

- создать `lib/factory/blueprint/compile.ts`;
- `beats[]` превращаются в `node_recipe_nodes`;
- `beat.ref` указывает на canonical;
- `motion` идет в prompt через текущие prompt helpers;
- competitor text не копируется.

Acceptance:

- один Blueprint детерминированно дает одинаковые nodes;
- 0 verbatim competitor text в новых nodes;
- `recipeTransfer` не используется как autopilot spine.

### M2.P3 Producer Brain Minimal

Задача:

- адаптировать `produce/route.ts` и `scenario/route.ts` под Blueprint;
- Reels Brain pattern дает структуру, но не копирует текст;
- brand kit и canonical frame входят в prompt context;
- не добавлять новых агентов.

Acceptance:

- каждый новый автопилотный recipe имеет Blueprint;
- `scenarioQuality` проверяет Blueprint до submit;
- при fail producer не уходит в paid render.

### M2.P4 Hook Policy

Задача:

- отделить human/strong-prompt hook от остальных полей;
- hook должен быть locked;
- hook judge можно включить как текстовый pre-render gate;
- слабые hooks режутся до рендера.

Acceptance:

- hook source записан;
- downstream не меняет hook;
- слабый hook дает reject до paid stage.

### M2.P5 Month-2 Clone Audit

Задача:

- прогнать 20 product videos;
- проверить уникальность hook/scenario/assets;
- собрать diff к M1.

Acceptance:

- 0 дословных клонов;
- каждый ролик привязан к конкретному SKU;
- OTK pass-rate растет или причины падения стали точнее.

## Месяц 3: QA Before Assembly

Цель месяца: перенести качество из "после склейки warning" в реальные gates.

### M3.P1 In-Process QA Gates

Задача:

- создать `lib/factory/qaGates.ts`;
- вынести core logic из `artifact-check/route.ts` и `video-critic/route.ts`;
- routes оставить тонкими wrappers;
- `graphRun` вызывает функции напрямую, не route-to-route.

Acceptance:

- 0 route-to-route вызовов `artifact-check/video-critic` из main OTK path;
- 0 508 в QA path;
- API routes продолжают работать для ручной диагностики.

### M3.P2 Clip-QA Step

Задача:

- добавить `RunStep = clip-qa`;
- вставить между `gen-poll` и `assemble`;
- каждый клип получает `node.qa`;
- broken clip не доходит до assemble;
- fail -> regen culprit, если бюджет есть.

Acceptance:

- broken clip останавливается до assemble;
- в execution_log есть `clip-qa`;
- qa attempts учитываются в budget.

### M3.P3 OTK Gate Ramp

Задача:

- ввести режимы: `shadow`, `block_broken`, `strict`;
- default для production ramp: `block_broken`;
- strict включать только после smoke;
- `approved` только при frames-grounded pass;
- иначе `qa_reject` или warning, но не approved.

Acceptance:

- `cf_signals approved` появляется только на pass;
- low score не выглядит как winner;
- владелец может временно включить fail-open override, но default OFF.

### M3.P4 Rubric v2

Задача:

- расширить оси до `hook/scrollStop/retention/aiSlop/productVisibility/conversion`;
- сохранить backward compatibility для старых axes;
- `pickCulprit` должен понимать новые оси.

Acceptance:

- старые записи не ломают diagnostics;
- новые OTK issues говорят, какой аспект чинить;
- regen hint связан с culprit axis.

### M3.P5 Month-3 Gate Report

Acceptance месяца:

- 0 508 в QA path;
- 0 broken clips passed to assemble;
- `approved/rejected/qa_reject` честно разведены;
- pass-rate M3 target: >=10% или понятный top-3 blocker.

## Месяц 4: Reliability, DLQ, Budget, Worker

Цель месяца: убрать ручное шаманство, двойную оплату и зависания.

### M4.P1 Idempotency

Задача:

- создать `lib/factory/idempotency.ts`;
- `computeIdempotencyKey(recipeId, nodes, lane)`;
- записывать key в `run_plan`;
- перед повторным submit проверять existing tokens/urls.

Acceptance:

- повторный enqueue не делает double-pay;
- тест на один и тот же recipe дважды;
- idempotency key виден в run_summary.

### M4.P2 Render-Service Dedup

Задача:

- `render-service` принимает `Idempotency-Key`;
- `render_jobs` не создает дубль при одинаковом key;
- возвращает existing job.

Зона требует осторожности:

- `render-service` разрешен владельцем ранее, но любые infra/env изменения отдельно.

Acceptance:

- два одинаковых render submit = один job;
- лог показывает dedupe.

### M4.P3 DLQ v1 Without Migration

Задача:

- сначала DLQ в `run_plan.dlq` или docs/log fallback;
- `writeDeadLetter` gracefully degrades, если таблицы нет;
- категории: `policy_error`, `render_failure`, `qa_reject`;
- replay пока только read/diagnostic.

Acceptance:

- каждый terminal fail получает structured category;
- UI/ops видит fail reason;
- нет silent failed.

### M4.P4 DLQ With Migration [OWNER]

Задача:

- добавить `dead_letter_jobs`;
- `dlq/route.ts`;
- `dlq/replay/route.ts`;
- replay переиспользует done URLs после HEAD-check.

Acceptance:

- replay не re-pay, если URLs живые;
- paused lane не replay-ится;
- все fails можно найти по category.

### M4.P5 Budget Ledger [OWNER]

Задача:

- `spend_ledger`;
- `lane_budget_state`;
- `recordSpend`;
- `isLanePaused`;
- `enforceBudgetKill`.

Acceptance:

- MTD spend виден по lane/tool/stage;
- при cap линия auto-paused;
- batch отказывает paused lane до трат.

### M4.P6 Worker Move Plan

Задача:

- не переписывать всё сразу;
- вынести только long poll loops и DLQ/replay в worker;
- Next остается control/read plane.

Acceptance:

- Vercel не держит длинный render/poll;
- worker heartbeat виден;
- cron/backstop не конкурирует с worker.

## Месяц 5: Candidate Fanout and Learning

Цель месяца: улучшать каждый следующий batch не руками, а через измеримые эксперименты.

### M5.P1 Text Fanout

Задача:

- `candidateFanout.ts`;
- K hooks x M scenarios на дешевой стадии;
- default 5x3;
- paid render получает top-k 1, max 2.

Acceptance:

- текстовых кандидатов много;
- платных кандидатов <=2;
- budget preflight знает worst-case.

### M5.P2 Candidate Select

Задача:

- `candidateSelect.ts`;
- hook judge + scenario quality;
- выбрать top-k;
- записать причины выбора.

Acceptance:

- каждый paid render имеет selection rationale;
- слабые hooks/scenarios отсекаются до render.

### M5.P3 Best-of-N Regen

Задача:

- привести regen loop к lane budget;
- bestScore/bestUrl уже есть, зафиксировать контракт;
- no cost runaway.

Acceptance:

- regen реально улучшает хотя бы часть роликов;
- renderCount не превышает lane budget;
- bank выбирает лучший URL, а не последний.

### M5.P4 Metrics Poll v1

Задача:

- `metricsPoll.ts`;
- `jobs/metrics-poll/route.ts`;
- подтягивать views/watch_rate/hook_rate/hold_rate/completion, где доступно;
- POST в `post-metrics`.

Acceptance:

- `market_views/watch_rate` не null для опубликованных роликов;
- `improvementLoop` видит собственные метрики;
- no metrics не ломает batch.

### M5.P5 Auto Feedback v2

Задача:

- не придумывать winners;
- winner только при OTK pass + market signal или явном owner signal;
- trash при broken/low OTK/repeated reject.

Acceptance:

- `viral_hooks` пополняются только качественными сигналами;
- feedback queue объясняет label reason.

## Месяц 6: UGC, Hybrid, Publish, Scale

Цель месяца: расширить завод после того, как product lane научился честно выпускать приемлемые ролики.

### M6.P1 Personas [OWNER]

Задача:

- `personas` table;
- `consent_status`;
- `brand_kits.persona_id`;
- `persona.ts`.

Acceptance:

- unknown consent блокирует render;
- Creatify stock можно backfill как consent_actor;
- custom persona без consent не используется.

### M6.P2 UGC Script Strict JSON

Задача:

- `ugc-script/route.ts`;
- strict spoken lines;
- emotion/delivery/pause;
- reuse Blueprint validation.

Acceptance:

- UGC script валиден;
- hook locked;
- не уходит в render без persona consent.

### M6.P3 UGC Jobs and QA

Задача:

- `ugc_jobs`;
- idempotency;
- UGC QA: lipsync, face drift, policy;
- DLQ categories.

Acceptance:

- каждый UGC render имеет job row;
- fail-open убран;
- retry не re-pay.

### M6.P4 Hybrid Lane

Задача:

- persona spine + product b-roll;
- b-roll только из product canonical/product lane;
- `hybrid-compose` становится lane path.

Acceptance:

- hybrid не берет random disk source;
- product b-roll прошел product QA;
- stitch проходит final OTK.

### M6.P5 Publish and RU Compliance

Задача:

- `distribution.ts`;
- `publish/route.ts`;
- `ad_token` для paid;
- fail-closed если paid без token;
- organic/manual publish можно без ad token по правилам.

Acceptance:

- published_url связан с recipe/job;
- paid без ad token не публикуется;
- metrics poll знает, что опрашивать.

### M6.P6 Provider Evaluation

Задача:

- PixVerse/Veo/Runway/HeyGen/Argil/Creatomate только behind flags;
- сравнение по pass-rate/cost/latency;
- никакого rip-and-replace.

Acceptance:

- provider считается candidate, пока не доказал лучший pass-rate;
- можно выключить без миграции;
- нет одновременного stack-churn.

## Сквозные правила на все 6 месяцев

### Нельзя

- добавлять новых агентов до закрытия Product Lane Foundation;
- включать новые провайдеры без feature flag;
- считать warning output победой;
- пускать WB-only в paid i2v при quality-first;
- делать миграции без OWNER;
- менять финансы/auth/common marketplace без отдельного согласования;
- пушить в main.

### Нужно

- каждый PR маленький;
- каждый PR с тестами;
- каждый PR имеет smoke или dry-run;
- каждый PR обновляет docs, если меняет архитектурную карту;
- все новые gates сначала имеют shadow/diagnostic режим;
- все paid paths имеют budget guard;
- все long-running paths имеют timeout/retry/lease.

## Рекомендуемые первые 10 PR

1. `fix/factory-canonical-frame-v1`
2. `fix/factory-source-readiness-strong-gate`
3. `fix/factory-canonical-first-asset-bind`
4. `feat/factory-render-router-minimal`
5. `feat/factory-blueprint-schema`
6. `feat/factory-blueprint-compile`
7. `fix/factory-producer-no-verbatim-copy`
8. `feat/factory-qa-gates-in-process`
9. `feat/factory-clip-qa-step`
10. `fix/factory-otk-gate-ramp`

## Stop criteria

Если любой из пунктов случился, следующий слой не стартует:

- paid spend растет, а frames-grounded pass-rate не растет;
- raw WB снова попадает в кадр;
- warning снова считается approved;
- 508 возвращается в QA path;
- UGC начинается до стабильного product lane;
- новая миграция требуется, но OWNER не согласовал;
- PR затрагивает больше 8-10 файлов без явной причины.

## Что считать успехом через 6 месяцев

- product lane стабильно выпускает ролики с frames-grounded OTK pass-rate >=50%;
- у каждого ролика есть canonical source и Blueprint;
- broken clips не доходят до assemble;
- failures идут в DLQ, а не теряются;
- budget cap останавливает runaway spend;
- метрики публикаций возвращаются в learning loop;
- UGC/hybrid включены только как управляемые lanes, не как хаотичный второй завод;
- следующий batch использует собственную память winners/trash, а не только чужие паттерны.
