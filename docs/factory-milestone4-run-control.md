# Factory Milestone 4 — Production Run Control

Статус: `closed for MVP operator scope`

Дата закрытия: 2026-06-26

## Цель

Сделать Studio не только диагностикой, а рабочим пультом выпуска роликов:

- оператор видит реальные прогоны из `node_recipes` / `graph-run`;
- оператор может открыть граф, открыть MP4 и перезапустить конкретный рецепт;
- запуск доступен из библиотеки рецептов без возврата к legacy `jobs/*`;
- worker heartbeat остаётся наблюдаемостью, а не главным смыслом экрана.

## Что изменено

### Пульс завода

Экран `Пульс завода` теперь показывает:

- текущий или последний прогон;
- `article` / рецепт;
- статус `идёт`, `подвис`, `предупр.`, `сбой`, `готово`;
- действия `открыть граф`, `MP4`, `запустить снова`;
- отдельную `Очередь прогонов`, построенную из observability snapshot, а не из markdown task queue.

### База видосов

Карточка рецепта теперь даёт короткий путь выпуска:

- `старт` — запускает существующий `POST /api/factory/graph-run`;
- `пульс` — показывается вместо старта, если рецепт уже бежит;
- `MP4` — открывает сохранённый результат;
- `ОТК` — открывает экран сборки и проверки.

### Backend snapshot

`loadRecentRecipeRunRows` теперь выбирает operator-facing поля:

- `article`;
- `niche`;
- `otk_score`;
- `output_url`;
- `run_plan`.

`buildObservability` прокидывает эти поля в `recent_runs`, чтобы UI не строил пульт по голым id/status.

## Guard tests

Добавлены или обновлены проверки:

- `lib/factory/runControlSnapshot.test.mts`;
- `lib/factory/studioSimplification.test.mts`.

Контракты, которые теперь закреплены:

- run snapshot содержит поля для operator run control;
- `Пульс завода` показывает `Очередь прогонов`;
- run control использует существующий `graph-run`;
- карточки рецептов имеют `старт`, `пульс`, `MP4`, `ОТК`;
- running-рецепты не получают второй start button.

## Проверки

Выполнено:

```bash
npm run test:factory
npm run build
```

Оба прохода зелёные.

Production deploy:

- deployment: `dpl_GCcY8qKK4CXCzYqbMSBwE2EaCbfb`;
- alias: `https://finance-panel-two.vercel.app`;
- status: `READY`.

Auth smoke:

- `GET /inferno/studio.html` без сессии возвращает `307` на login;
- `GET /api/factory/ops` без сессии возвращает `401 Не авторизовано`;
- это ожидаемое поведение защищённого production-домена.

## Что осталось за пределами Milestone 4

Не входит в этот milestone:

- stop/cancel running run;
- bulk night run UI;
- автоматический выбор следующего рецепта;
- авто-постинг;
- авто-подтягивание platform metrics;
- улучшение качества роликов;
- возврат `scenario-rewrite`, `hook-judge`, `variations`, `recipe-variants`, `batch-build`.

Эти задачи должны идти отдельными milestone после подтверждения стабильного single-run выпуска.

## Операторский контур после M4

Основной ежедневный путь:

1. Открыть `База видосов`.
2. Нажать `старт` на готовом рецепте.
3. Смотреть статус в `Пульс завода`.
4. Открыть `MP4`.
5. Если статус `предупр.`, проверить ролик, но не считать выпуск заблокированным.
6. Если `сбой` или `подвис`, открыть граф и чинить конкретный шаг.

Полный runbook: `docs/factory-daily-runbook.md`.
