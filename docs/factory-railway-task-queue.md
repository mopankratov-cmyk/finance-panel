# Railway worker task queue

Очередь задач для отдельного AI-worker на Railway по контент-заводу.

## Как пользоваться

- Владелец или основной Codex добавляет задачи в этот файл.
- Worker берёт верхнюю задачу со статусом `todo`.
- Worker меняет статус задачи по ходу работы:
  - `todo` — можно брать;
  - `doing` — в работе;
  - `blocked` — нужен владелец или внешний доступ;
  - `pr_open` — PR открыт и ждёт ревью;
  - `done` — принято/влито.
- Под каждую задачу worker указывает ветку, PR, проверки и краткий итог.
- Если задача требует выйти за мандат из `AGENTS.md`, worker не делает её и ставит `blocked`.
- Если worker живой, Studio показывает его `last_seen` из `POST /api/factory/worker-state`; если heartbeat пропал, она помечает worker как `stale`/`dead`.

## Текущие задачи

### T-001 · Scenario quality gate before render

- Статус: `doing`
- Приоритет: P0
- Ветка: `feat/factory-scenario-quality-gate`
- PR:
- Зона: `app/api/factory/`, `lib/factory/`, `docs/factory-*.md`
- Цель: перед дорогим видео-рендером оценивать сценарии/хуки/visual beats и не пропускать слабые варианты дальше.
- Контекст:
  - Главный принцип из диалога о промптинге: система должна быстро отбрасывать плохой контент, а не просто быстро генерировать.
  - Не менять видео-рендер и не запускать платные генерации.
  - Использовать существующий подход к Claude client, JSON extraction и factory routes.
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
  - [ ] Можно POST-нуть один сценарий и получить score + `should_render`.
  - [ ] Можно POST-нуть пачку хуков/сценариев и получить ranking.
  - [ ] Слабый общий текст получает issues про слабый хук/нет интриги/AI-стерильность.
  - [ ] Ошибки Claude/JSON возвращаются контролируемым JSON, не сырой 500-простынёй.
  - [ ] Есть документация в `docs/factory-scenario-quality-gate.md` или обновление `docs/factory-prompting-canon.md`.
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npx eslint app/api/factory/scenario-quality/route.ts lib/factory/scenarioQuality.ts`
  - `npm run dev`
- Итог: quality gate, taste patterns, rewrite route и Creatify-safe wire-up собраны в рабочем дереве; dev/tests зелёные, ждёт commit/PR.
- Блокеры:

### T-002 · Taste pattern library

- Статус: `doing`
- Приоритет: P1
- Ветка: `feat/factory-taste-patterns`
- PR:
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
  - [ ] Есть типизированный список pattern hints.
  - [ ] Есть helper, который возвращает 1-3 релевантных паттерна.
  - [ ] Документация объясняет принцип: копируем структуру, не контент.
  - [ ] Нет изменений в БД, зависимостях, auth, CI.
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npx eslint lib/factory/tastePatterns.ts`
  - `npm run dev`
- Итог: библиотека паттернов победителей добавлена и готова к использованию в gate/rewrite.
- Блокеры:

### T-003 · Anti-AI-slop rewrite before render

- Статус: `doing`
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
  - [ ] Endpoint всегда возвращает JSON.
  - [ ] Есть пример request/response в docs.
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npx eslint app/api/factory/scenario-rewrite/route.ts lib/factory/scenarioRewrite.ts`
  - `npm run dev`
- Итог: endpoint переписывания сценария добавлен, fallback живой.
- Блокеры:

### T-004 · Wire quality gate into existing factory flow safely

- Статус: `doing`
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
  - [ ] Слабый сценарий не уходит в дорогой render path.
  - [ ] Существующие ручные flow не ломаются.
  - [ ] При ошибке gate поток мягко деградирует или явно сообщает diagnostic.
  - [ ] Документация описывает, где стоит gate.
- Проверки:
  - `npx tsc --noEmit --pretty false`
  - `npx eslint` по затронутым файлам
  - `npm run dev`
- Итог: Creatify UGC route теперь режет слабые сценарии до запуска render path.
- Блокеры:

### T-005 · Morning report cleanup

- Статус: `doing`
- Приоритет: P0
- Ветка: текущие рабочие ветки
- PR:
- Зона: `docs/factory-railway-night-log.md`, PR descriptions
- Цель: в конце смены оставить владельцу понятный утренний отчёт.
- Acceptance criteria:
  - [ ] Верхний блок `docs/factory-railway-night-log.md` заполнен.
  - [ ] В каждой задаче выше обновлён статус.
  - [ ] Для каждого PR есть ссылка/номер, ветка, проверки, риски.
  - [ ] Отдельно перечислено, что не успел и где нужен владелец.
- Проверки:
  - Не требуется, если менялся только отчёт.
- Итог: ночной отчёт обновлён текущими результатами и проверками.
- Блокеры:

## Архив
