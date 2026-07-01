# UGC Blogger Motion Loop

Дата: 2026-07-01  
Контур: UGC Factory sidecar, detached from main factory  
Статус: dry-run only, no paid provider calls

## Что сделано

Добавлен второй исполнимый слой `Living Blogger` roadmap:

- motion taxonomy;
- controlled batch planner;
- repeatability detector v1.

Цель: перестать генерировать "ещё один похожий ролик" и начать заранее планировать вариации движения, кадра и подачи.

## Новые модули

- `lib/factory/bloggerMotion.ts`
- `lib/factory/bloggerMotionContract.test.mts`
- `app/api/factory/blogger-motion/route.ts`

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
- `evaluation_seed`;
- repeatability dry-run report.

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
