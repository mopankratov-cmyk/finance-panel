# Railway worker task queue

Исторический task-board для отдельного AI-worker на Railway по контент-заводу.

> Текущий live execution path уже не берётся из этого файла: реальные прогоны идут через `graph-run`, а операторская очередь видна в Studio на экране `Пульс завода` → `Очередь прогонов`. Этот документ оставлен как архив решений и backlog по припаркованным компонентам.

## Как пользоваться

- Для живого выпуска роликов не использовать этот файл как очередь прогонов.
- Новые задачи сюда добавлять только если нужно восстановить отдельный Railway AI-worker task-board.
- Worker, если он снова включён как отдельный исполнитель, меняет статус задачи по ходу работы:
  - `todo` — можно брать;
  - `doing` — в работе;
  - `blocked` — нужен владелец или внешний доступ;
  - `pr_open` — PR открыт и ждёт ревью;
  - `done` — принято/влито.
- Под каждую задачу указывать ветку, PR, проверки и краткий итог.
- Если задача требует выйти за мандат из `AGENTS.md`, ставить `blocked`.
- Пульс Railway worker сейчас опционален: отсутствие таблицы/heartbeat не блокирует выпуск MP4.

## Текущие задачи

Статус после Sprint 1 / Milestone 4+ cleanup:

- Активных задач со статусом `todo` нет.
- Активных P0/P1 по стабильности MVP в этой очереди нет.
- T-003 оставлен как намеренно припаркованный компонент: rewrite не нужен для получения MP4 и сейчас увеличивает LLM-точку отказа.
- Реальная очередь прогонов теперь строится из `node_recipes` / observability snapshot, а не из markdown task-board.

Ночной порядок на старт:

1. T-001 закрыт.
2. T-002 закрыт.
3. T-003 временно припаркован: rewrite route отключён для MVP-stability.
4. T-004 закрыт в fail-open режиме.
5. T-005 закрывается текущим отчётом и логом.

### T-001 · Scenario quality gate before render

- Статус: `done`
- Приоритет: P0
- Ветка: `feat/factory-scenario-quality-gate`
- PR: #30
- Зона: `app/api/factory/`, `lib/factory/`, `docs/factory-*.md`
- Цель: перед дорогим видео-рендером оценивать сценарии/хуки/visual beats и не пропускать слабые варианты дальше.
- Контекст:
  - Главный принцип из диалога о промптинге: система должна быстро отбрасывать плохой контент, а не просто быстро генерировать.
  - Не менять видео-рендер и не запускать платные генерации.
  - Использовать существующий подход к Claude client, JSON extraction и factory routes.
- Первый шаг:
  - открыть `app/api/factory/scenario-quality/route.ts` и `lib/factory/scenarioQuality.ts`;
  - проверить, что вход/выход уже соответствуют очереди;
  - если что-то нестыкуется, сначала довести `scenario-quality` до чистого JSON-fallback;
  - только потом трогать `scenario-rewrite` и wire-up.
- Реализация:
  - Добавить серверную логику в `lib/factory/`, например `scenarioQuality.ts`.
  - Добавить endpoint в `app/api/factory/`, например `scenario-quality/route.ts`.
  - Endpoint принимает `article`, `product_name`, `niche`, `scenario`, `hooks`, `visual_beats`, `threshold`.
  - Endpoint всегда возвращает JSON, даже при ошибке.
  - Оценивать по осям:
    - `hook`
    - `retention`
    - `clarity`
    - `emotion`
    - `specificity`
    - `novelty`
    - `publishability`
  - Вернуть `winner`, `ranked`, `issues`, `rewrite_hints`, `score`, `should_render`.
  - Слабый сценарий должен получать `should_render:false`.
- Acceptance criteria:
  - [x] Можно POST-нуть один сценарий и получить score + `should_render`.
  - [x] Можно POST-нуть пачку хуков/сценариев и получить ranking.
  - [x] Слабый общий текст получает issues про слабый хук/нет интриги/AI-стерильность.
  - [x] Ошибки Claude/JSON возвращаются контролируемым JSON, не сырой 500-простынёй.
  - [x] Есть документация в `docs/factory-scenario-quality-gate.md` или обновление `docs/factory-prompting-canon.md`.
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npx eslint app/api/factory/scenario-quality/route.ts lib/factory/scenarioQuality.ts`
  - `npm run dev`
- Итог: scenario-quality gate собран с fallback JSON; taste patterns и Creatify-safe wire-up закрывались отдельными блоками. Rewrite route в текущем runtime оставлен disabled stub для MVP-stability.
- Блокеры:

### T-002 · Taste pattern library

- Статус: `done`
- Приоритет: P1
- Ветка: `feat/factory-taste-patterns`
- PR: включено в текущий рабочий набор
- Старт сейчас: завершено после T-001.
- Зона: `lib/factory/`, `docs/factory-*.md`, опционально `app/api/factory/`
- Цель: дать генератору и критику библиотеку структур победителей, чтобы они копировали удерживающий каркас, а не придумывали с нуля.
- Контекст:
  - Не добавлять миграции и зависимости.
  - Не копировать контент/пиксели конкурентов. Копируем только структуру: ритм, hook type, beat shape, payoff.
- Реализация:
  - Добавить `lib/factory/tastePatterns.ts`.
  - Описать форматы:
    - `problem_solution`
    - `shock_fact`
    - `myth_busting`
    - `before_after`
    - `story_twist`
    - `top_list`
    - `ugc_confession`
  - Для каждого формата задать:
    - hook structure;
    - retention rhythm;
    - visual beats;
    - curiosity gap;
    - payoff;
    - failure signs.
  - Экспортировать helper для выбора паттернов по `niche`, `format`, `goal`.
  - Подключить hints к T-001, если T-001 уже сделан; иначе оставить чистый модуль + docs.
- Acceptance criteria:
  - [x] Есть типизированный список pattern hints.
  - [x] Есть helper, который возвращает 1-3 релевантных паттерна.
  - [x] Документация объясняет принцип: копируем структуру, не контент.
  - [x] Нет изменений в БД, зависимостях, auth, CI.
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npx eslint lib/factory/tastePatterns.ts`
  - `npm run dev`
- Итог: `lib/factory/tastePatterns.ts` добавлен; hints используются в `lib/factory/scenarioQuality.ts`. Принцип: копируем структуру удержания, не чужой контент/пиксели.
- Блокеры:

### T-003 · Anti-AI-slop rewrite before render

- Статус: `blocked`
- Приоритет: P1
- Ветка: `feat/factory-anti-slop-rewrite`
- PR:
- Зона: `app/api/factory/`, `lib/factory/`, `docs/factory-*.md`
- Цель: если scenario quality gate нашёл стерильный/общий текст, переписывать его до рендера в живой UGC-тон с конкретикой.
- Контекст:
  - Не превращать текст в рекламную простыню.
  - Учитывать `brandProfiles`.
  - Не трогать i2v/edit канон, это отдельная стадия для сценария.
- Реализация:
  - Добавить `lib/factory/scenarioRewrite.ts` или расширить T-001 модуль.
  - Добавить endpoint, например `app/api/factory/scenario-rewrite/route.ts`.
  - Вход: `scenario`, `product_name`, `article`, `brand`, `issues`, `rewrite_hints`.
  - Выход: `rewritten`, `changed`, `kept`, `score_before`, `score_after`, `notes`.
  - Rewrite должен добавлять:
    - конкретные действия;
    - бытовые детали;
    - числа или измеримые обещания, если уместно;
    - живые фразы без канцелярита;
    - причину досмотреть.
- Acceptance criteria:
  - [ ] Общий текст переписывается в конкретный.
  - [ ] Rewrite сохраняет смысл и бренд-голос.
  - [x] Endpoint всегда возвращает JSON.
  - [x] Есть пример request/response в docs.
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npx eslint app/api/factory/scenario-rewrite/route.ts lib/factory/scenarioRewrite.ts`
  - `npm run dev`
- Итог: runtime endpoint сейчас intentionally disabled stub: `POST /api/factory/scenario-rewrite` возвращает JSON `{ disabled:true }`.
- Блокеры: компонент временно отключён для MVP-stability, потому что не нужен для получения MP4 и добавляет LLM-точку отказа. Возвращать после повторного стабильного stress-pass и только в fail-open режиме.

### T-004 · Wire quality gate into existing factory flow safely

- Статус: `done`
- Приоритет: P2
- Ветка: `feat/factory-quality-gate-wireup`
- PR:
- Зона: `app/api/factory/`, `lib/factory/`, `docs/factory-*.md`
- Цель: аккуратно подключить scenario quality gate к существующему потоку там, где это можно сделать без риска и без платных прогонов.
- Контекст:
  - Брать только после T-001.
  - Не ломать существующие маршруты и не менять схему БД.
  - Если интеграция требует более широкой архитектуры, поставить `blocked` и описать точку подключения.
- Реализация:
  - Найти безопасное место перед рендером сценария/хука.
  - Добавить feature-safe вызов gate с мягкой деградацией.
  - Если `should_render:false`, возвращать понятный статус/diagnostic вместо запуска рендера.
  - Логировать summary в существующий сигнал/историю только если уже есть подходящий helper; миграции не делать.
- Acceptance criteria:
  - [x] Слабый сценарий получает diagnostic/warning перед дорогим render path.
  - [x] Существующие ручные flow не ломаются.
  - [x] При ошибке gate поток мягко деградирует или явно сообщает diagnostic.
  - [x] Документация описывает, где стоит gate.
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npx eslint` по затронутым файлам
  - `npm run dev`
- Итог: Creatify UGC route вызывает scenario quality gate до render path, но в стабилизационном MVP режиме не блокирует выпуск; слабый сценарий сохраняется как warning.
- Блокеры:

### T-005 · Morning report cleanup

- Статус: `done`
- Приоритет: P0
- Ветка: текущие рабочие ветки
- PR: не нужен, это отчетный блок
- Зона: `docs/factory-railway-night-log.md`, PR descriptions
- Цель: в конце смены оставить владельцу понятный утренний отчёт.
- Acceptance criteria:
  - [x] Верхний блок `docs/factory-railway-night-log.md` заполнен.
  - [x] В каждой задаче выше обновлён статус.
  - [x] Для каждого PR/рабочего набора есть ветка, проверки, риски в night log.
  - [x] Отдельно перечислено, что припарковано и почему нужен следующий этап.
- Проверки:
  - Не требуется, если менялся только отчёт.
- Итог: очередь синхронизирована с текущей Sprint 1 / Milestone 2 / Milestone 3 / quality-observability реальностью.
- Блокеры:

## Архив
