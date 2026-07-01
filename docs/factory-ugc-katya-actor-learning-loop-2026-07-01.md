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
- `lib/factory/bloggerLearningLoopContract.test.mts`

API:

```text
GET /api/factory/blogger-learning-loop
POST /api/factory/blogger-learning-loop
```

Маршрут dry-run only: он планирует 100 прогонов, но не вызывает платный HeyGen render.

## Базовая стратегия 100 прогонов

Не запускать 100 сразу.

Делить на поколения:

- generation size: 12;
- target runs: 100;
- всего 9 поколений;
- после каждого поколения — оценка и выбор winners/losers.

Причина: если сразу сделать 100, мы не учимся. Если делать 12 -> оценка -> улучшение -> 12, система начинает реально сходиться.

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
  "target_runs": 12,
  "generation_size": 12
}
```

### Next generation with prior results

```json
{
  "blogger_id": "katya_russian_creator_v3b",
  "target_runs": 12,
  "generation_size": 12,
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

Добавить paid runner, который берёт только одно поколение из `planned_runs` и рендерит его в HeyGen:

- input: `generation`, `limit`, `confirmPaid`;
- output: local mp4 paths;
- no product;
- no B-roll;
- no main factory graph-run.

Пока runner не добавлен, API намеренно dry-run only.
