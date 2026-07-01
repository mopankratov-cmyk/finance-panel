# UGC Blogger Motion Loop

Дата: 2026-07-01
Контур: UGC Factory sidecar, detached from main factory
Статус: dry-run + first paid HeyGen controlled motion batch

## Что сделано

Добавлен второй исполнимый слой `Living Blogger` roadmap:

- motion taxonomy;
- controlled batch planner;
- repeatability detector v1.
- HeyGen video payload controls for `motion_prompt` and `expressiveness`.

Цель: перестать генерировать "ещё один похожий ролик" и начать заранее планировать вариации движения, кадра и подачи.

## Новые модули

- `lib/factory/bloggerMotion.ts`
- `lib/factory/bloggerMotionContract.test.mts`
- `app/api/factory/blogger-motion/route.ts`
- `lib/factory/heygen.ts`
- `lib/factory/heygenVideo.ts`

## Motion presets

Текущие presets:

- `calm_direct`
- `skeptical_pause`
- `small_nod`
- `half_smile`
- `tired_honest`
- `friend_advice`
- `practical_demo`

Каждый preset хранит:

- `motion_prompt`;
- `expression_profile`;
- `head_motion`;
- `risk_notes`.

## Controlled batch

`POST /api/factory/blogger-motion` в режиме batch строит cross-product:

- hooks;
- motion presets;
- frame types;
- delivery types;
- face duration.

Выход:

- `runs[]`;
- `heygen_motion_prompt`;
- `expressiveness`;
- `evaluation_seed`;
- repeatability dry-run report.

## HeyGen Avatar IV controls

Проверенный рабочий слой для живости блогера:

- `motion_prompt`: отдельная инструкция движения, не смешанная с spoken script;
- `expressiveness`: `low | medium | high`;
- постоянный `avatar_id`/look id;
- постоянный `voice_id`;
- один и тот же spoken script внутри controlled batch.

Зачем: иначе нельзя понять, что именно улучшило ролик. Теперь batch можно сравнивать по одной переменной: движение/энергия, а не новый текст + новый блогер + новый голос одновременно.

Правило для UGC loop:

- first-face тесты гоняем только на одном блогере и одном тексте;
- сначала перебираем `motion_prompt` + `expressiveness`;
- затем добавляем voice/provider;
- затем добавляем товар/B-roll;
- все оценки пишем по rubric `living_blogger_v1`.

## Repeatability detector

`POST /api/factory/blogger-motion` с `mode=repeatability` принимает samples и считает:

- `repeatability_penalty_0_10`;
- `diversity_score_100`;
- `repeated_axes`;
- рекомендации.

Оси повтора:

- `motion_preset`;
- `frame_type`;
- `delivery_type`;
- `expression_profile`;
- `head_turn_signature`;
- `crop_signature`;
- `timing_signature`.

## Example: batch

```json
{
  "blogger_id": "katya_russian_creator_v3b",
  "hooks": [
    {
      "id": "skeptic-stop",
      "text": "Я сначала подумала: ну нет, опять какая-то штука из рекламы.",
      "hook_type": "skeptic-stop"
    }
  ],
  "motion_preset_ids": ["calm_direct", "skeptical_pause", "small_nod"],
  "frame_types": ["upper_body_room", "medium_selfie"],
  "delivery_types": ["confessional", "friend_advice"],
  "face_duration_sec": 3,
  "max_runs": 8
}
```

## Example: repeatability

```json
{
  "mode": "repeatability",
  "blogger_id": "katya_russian_creator_v3b",
  "samples": [
    {
      "run_id": "1",
      "motion_preset": "calm_direct",
      "frame_type": "upper_body_room",
      "head_turn_signature": "same_left"
    },
    {
      "run_id": "2",
      "motion_preset": "calm_direct",
      "frame_type": "upper_body_room",
      "head_turn_signature": "same_left"
    },
    {
      "run_id": "3",
      "motion_preset": "calm_direct",
      "frame_type": "upper_body_room",
      "head_turn_signature": "same_left"
    }
  ]
}
```

## Следующий шаг

Следующий слой:

1. взять `runs[]` из controlled batch;
2. выбрать 4-6 paid HeyGen samples;
3. оценить их через `blogger-evaluation`;
4. прогнать repeatability detector;
5. обновить registry dry-run;
6. только потом решать, какие motion presets идут дальше.

## First paid controlled batch

Дата: 2026-07-01
Блогер: `katya_russian_creator_v3b`
Look id: `f9e4ecf1b902451aaa17e8c2430a5c1b`
Voice: `Anya`, `37832e32d4f7475ab7a1cb0db8e5dd66`
Товар: нет, first-face/motion only
Script:

```text
Я сначала подумала: ну нет, опять какая-то штука из рекламы. А потом поймала себя на том, что смотрю дальше.
```

Локальные файлы:

- `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/katya-calm-direct-low.mp4`
- `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/katya-skeptical-pause-medium.mp4`
- `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/katya-small-nod-medium.mp4`
- `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/katya-friend-advice-high.mp4`
- `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/contact-sheet.jpg`

HeyGen video ids:

- `7fc1caa733a84966be67d2d5573e9248` — `calm_direct`, `low`
- `03c166e696ad43408686d49e5c43e096` — `skeptical_pause`, `medium`
- `670f99d20c5a4a8a8e615d13b8bd647e` — `small_nod`, `medium`
- `3d8128d41e414a9594ce6ef411af53dd` — `friend_advice`, `high`

Предварительный вывод по кадрам:

- `high` быстро уходит в более улыбающегося presenter, риск AI/рекламы выше;
- `low` и `medium` выглядят спокойнее, но финально оценивать нужно по видео, потому что ключевой риск — повторяющийся loop движения головы.

Следующий шаг:

1. пользователь выбирает 1-2 лучших видео по живости;
2. выбранные варианты прогоняются через `blogger-evaluation`;
3. на базе winner prompt делаем второй batch: те же настройки, но 3 разных hook/emotional curve;
4. только после этого добавляем B-roll или товар.
