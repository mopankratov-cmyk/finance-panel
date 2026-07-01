# Katya Actor Learning Loop

Дата: 2026-07-01
Контур: UGC Factory sidecar, detached from main factory
Фокус: только блогер, без товара и без B-roll
Статус: dry-run planner готов, paid renders запускать поколениями

## Решение

Мы временно перестаём строить ролик как рекламу.

Новая задача: довести одного блогера, Катю, до максимально живой talking-head модели:

- разные комнаты;
- разные ракурсы;
- разные позы;
- разные выражения лица;
- разные motion prompts;
- разная expressiveness;
- одинаково сохранённая личность.

Товар и B-roll запрещены до стабилизации блогера.

## Новый кодовый контур

- `lib/factory/bloggerLearningLoop.ts`
- `app/api/factory/blogger-learning-loop/route.ts`
- `lib/factory/bloggerLearningLoopRunner.mjs`
- `lib/factory/bloggerLearningLoopContract.test.mts`

API:

```text
GET /api/factory/blogger-learning-loop
POST /api/factory/blogger-learning-loop
```

Маршрут dry-run only: он планирует 100 прогонов, но не вызывает платный HeyGen render.

CLI runner:

```text
node --import tsx lib/factory/bloggerLearningLoopRunner.mjs --generation 1 --limit 5 --generation-size 5
```

Без `--confirm-paid true` runner только сохраняет план.

## Базовая стратегия 100 прогонов

Не запускать 100 сразу.

Делить на поколения:

- generation size: 5;
- target runs: 100;
- всего 20 поколений;
- после каждого поколения — оценка и выбор winners/losers.

Причина: если сразу сделать 100, мы не учимся. Если делать 5 -> оценка -> улучшение -> 5, система начинает реально сходиться.

## Ограничение HeyGen fixed look

Текущий `avatar_look_id` Кати хорошо подходит для проверки:

- движения головы;
- пауз;
- улыбки/неулыбки;
- expressiveness;
- lip-sync;
- first-2s AI read.

Но разные комнаты, ракурсы и позы не будут полностью честно меняться, если мы рендерим один и тот же fixed avatar look.

Чтобы реально получить "Катя в разных обстановках/позах", следующий слой должен создать несколько Katya source looks:

- Katya hallway;
- Katya kitchen;
- Katya sofa/evening;
- Katya desk;
- Katya mirror/entryway;
- Katya close selfie.

До этого generation runner использует scene/angle/pose как гипотезы и motion context, но не обещает полного изменения комнаты.

## Оси вариативности

### Scene

- `home_hallway`
- `small_kitchen`
- `window_room`
- `sofa_evening`
- `messy_desk`
- `mirror_selfie`
- `entryway_jacket`
- `plain_wall`

### Camera angle

- `front_phone_eye`
- `slightly_above`
- `slightly_below`
- `three_quarter_left`
- `three_quarter_right`
- `closer_face`
- `upper_body`

### Pose

- `standing_relaxed`
- `sitting_close`
- `leaning_on_table`
- `one_shoulder_forward`
- `phone_in_hand`
- `arms_low`
- `jacket_on_chair`

### Expression

- `neutral_curious`
- `skeptical_soft`
- `thinking`
- `half_smile_late`
- `tired_honest`
- `friend_warning`

### Motion

Используются существующие motion presets, кроме `practical_demo`, потому что он ведёт к B-roll:

- `calm_direct`
- `skeptical_pause`
- `small_nod`
- `half_smile`
- `tired_honest`
- `friend_advice`

## Evaluation loop

Каждый mp4 оценивается по `living_blogger_v1`:

- `face_realism`
- `motion_realism`
- `lip_sync`
- `voice_naturalness`
- `room_authenticity`
- `anti_ai_first_2s`
- `repeatability_penalty`

Главные метрики для winner:

1. `anti_ai_first_2s`
2. `motion_realism`
3. `face_realism`
4. низкая `repeatability_penalty`

Если high expressiveness даёт presenter smile, она демотится даже при хорошей эмоции.

## Как запускать

### Exploratory generation

```json
{
  "blogger_id": "katya_russian_creator_v3b",
  "target_runs": 5,
  "generation_size": 5
}
```

### Next generation with prior results

```json
{
  "blogger_id": "katya_russian_creator_v3b",
  "target_runs": 5,
  "generation_size": 5,
  "start_generation": 2,
  "prior_results": [
    {
      "run_id": "katya_lab__g01__03__window_room__front_phone_eye__small_nod",
      "scores": {
        "face_realism": 8,
        "motion_realism": 8,
        "lip_sync": 7,
        "voice_naturalness": 6,
        "room_authenticity": 8,
        "anti_ai_first_2s": 8,
        "repeatability_penalty": 2
      },
      "notes": "best first-2s realism"
    }
  ]
}
```

## Правила самоулучшения

После каждого поколения:

1. сохранить user winner labels;
2. прогнать scorecard;
3. promote:
   - anti-AI first 2s >= 75;
   - motion realism >= 75;
   - repeatability penalty <= 3;
4. demote:
   - presenter smile;
   - одинаковый head loop;
   - слишком идеальная кожа/свет;
   - рекламная интонация;
   - лицо стало не похоже на Катю.
5. следующий batch строить вокруг winners, но менять одну ось за раз.

## Следующий инженерный шаг

Paid runner добавлен. Следующий шаг — прогнать generation 1:

```text
HEYGEN_API_KEY=... node --import tsx lib/factory/bloggerLearningLoopRunner.mjs --generation 1 --limit 5 --generation-size 5 --confirm-paid true
```

Правила:

- рендерить только 5;
- смотреть все 5 глазами;
- выбрать 1-2 winners;
- внести prior results;
- только потом запускать generation 2.

## Generation 1 run

Дата: 2026-07-01

Команда:

```text
node --import tsx lib/factory/bloggerLearningLoopRunner.mjs --generation 1 --limit 5 --generation-size 5 --confirm-paid true --out-dir /tmp/ugc-factory-katya-learning-loop-2026-07-01
```

Результат:

- 2/5 completed;
- 3/5 failed из-за `MOVIO_PAYMENT_INSUFFICIENT_CREDIT`;
- repair попытка тоже упёрлась в `MOVIO_PAYMENT_INSUFFICIENT_CREDIT`;
- prompt не является причиной падения.

Успешные mp4:

- `/tmp/ugc-factory-katya-learning-loop-2026-07-01/generation-01/katya_lab__g01__01__window_room__slightly_below__half_smile.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01/generation-01/katya_lab__g01__02__sofa_evening__three_quarter_right__tired_honest.mp4`

Contact sheet:

```text
/tmp/ugc-factory-katya-learning-loop-2026-07-01/generation-01/contact-sheet.jpg
```

Failed due to credits:

- `katya_lab__g01__03__messy_desk__upper_body__friend_advice`
- `katya_lab__g01__04__mirror_selfie__slightly_above__calm_direct`
- `katya_lab__g01__05__entryway_jacket__three_quarter_left__skeptical_pause`

Следующий платный шаг после top-up:

```text
node --import tsx lib/factory/bloggerLearningLoopRunner.mjs --generation 1 --limit 5 --generation-size 5 --confirm-paid true --out-dir /tmp/ugc-factory-katya-learning-loop-2026-07-01-retry
```

Но лучше перед retry выбрать из двух успешных: если один явно сильнее, generation 2 строить вокруг него, а не добивать старую пятёрку.

## Generation 1 retry after API wallet top-up

Дата: 2026-07-01

Команда:

```text
node --import tsx lib/factory/bloggerLearningLoopRunner.mjs --generation 1 --limit 5 --generation-size 5 --confirm-paid true --out-dir /tmp/ugc-factory-katya-learning-loop-2026-07-01-retry
```

Результат:

- 5/5 completed;
- причина прошлых падений подтверждена: не prompt, а нехватка API wallet credits;
- API wallet после batch: `$28.58`;
- ориентировочная стоимость generation из 5 коротких Avatar IV видео: около `$1.55`.

Успешные mp4:

- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-retry/generation-01/katya_lab__g01__01__window_room__slightly_below__half_smile.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-retry/generation-01/katya_lab__g01__02__sofa_evening__three_quarter_right__tired_honest.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-retry/generation-01/katya_lab__g01__03__messy_desk__upper_body__friend_advice.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-retry/generation-01/katya_lab__g01__04__mirror_selfie__slightly_above__calm_direct.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-retry/generation-01/katya_lab__g01__05__entryway_jacket__three_quarter_left__skeptical_pause.mp4`

Contact sheet:

```text
/tmp/ugc-factory-katya-learning-loop-2026-07-01-retry/generation-01/contact-sheet.jpg
```

Предварительный визуальный вывод по кадрам:

- `2 tired_honest low` выглядит самым естественным и наименее рекламным;
- `5 skeptical_pause medium` выглядит хорошим кандидатом на живой skeptical hook;
- `3 friend_advice medium` даёт больше энергии, но может уйти в presenter;
- `1 half_smile high` и `4 calm_direct medium` требуют проверки по видео, есть риск пластичности/странной артикуляции.

Следующий шаг:

1. пользователь выбирает 1-2 номера winners;
2. внести winners как `prior_results`;
3. generation 2 делать не как retry, а как улучшение вокруг winners.
