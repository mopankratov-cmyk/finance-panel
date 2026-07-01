# UGC Blogger Rubric and Registry

Дата: 2026-07-01  
Контур: UGC Factory sidecar, detached from main factory  
Статус: dry-run only, no DB writes

## Что сделано

Собран первый исполнимый слой из roadmap `UGC Living Blogger`:

- `blogger evaluation rubric`;
- `blogger variant registry`;
- dry-run endpoints для оценки и применения оценки к registry.

Это первая память по блогерам, которая не зависит от "помню, что Катя вроде была лучше".

## Новые модули

- `lib/factory/bloggerEvaluation.ts`
- `lib/factory/bloggerRegistry.ts`
- `lib/factory/bloggerRegistryContract.test.mts`
- `app/api/factory/blogger-evaluation/route.ts`
- `app/api/factory/blogger-registry/route.ts`

## Rubric

Версия: `living_blogger_v1`

Оси:

- `face_realism`
- `motion_realism`
- `lip_sync`
- `voice_naturalness`
- `room_authenticity`
- `anti_ai_first_2s`
- `repeatability_penalty`

Ключевая идея:

- realism axes считают, насколько ролик похож на живого человека;
- `repeatability_penalty` считает, насколько этот дубль похож на остальные и палится как шаблон;
- итоговый label:
  - `promote`
  - `keep_testing`
  - `rework`

## Registry

Текущий static registry:

- `katya` -> `active`
- `alina` -> `experimental`
- `sergey` -> `rework`

Каждый variant хранит:

- `blogger_id`
- `variant_id`
- `role`
- `avatar_look_id`
- `voice_id`
- `room_type`
- `framing_type`
- `expression_profile`
- `motion_profile`
- `latest_scores`
- `source_runs`

## Endpoints

### `GET /api/factory/blogger-evaluation`

Возвращает rubric и scorecard metadata.

### `POST /api/factory/blogger-evaluation`

Принимает dry-run оценку smoke/sample и возвращает:

- normalized axis scores;
- `weighted_score_100`;
- `anti_ai_score_100`;
- `summary_label`;
- рекомендации.

### `GET /api/factory/blogger-registry`

Возвращает текущий static registry и summary.

### `POST /api/factory/blogger-registry`

Принимает evaluation payload, прогоняет через rubric и возвращает dry-run registry after evaluation.

## Минимальный payload

```json
{
  "blogger_id": "katya_russian_creator_v3b",
  "variant_id": "katya_russian_creator_v3b::base",
  "run_id": "katya_batch_001",
  "hook_type": "skeptic-stop",
  "frame_type": "upper_body_room",
  "motion_preset": "calm_direct",
  "delivery_type": "confessional",
  "face_duration_sec": 3,
  "scores": {
    "face_realism": 8,
    "motion_realism": 7,
    "lip_sync": 7,
    "voice_naturalness": 6,
    "room_authenticity": 8,
    "anti_ai_first_2s": 8,
    "repeatability_penalty": 3
  },
  "fail_reasons": [
    "same head turn in multiple takes"
  ],
  "notes": "better than previous smoke"
}
```

## Что это нам дает прямо сейчас

1. Можно начать оценивать все следующие HeyGen smoke одним форматом.
2. Можно копить fail reasons и winner patterns по конкретным variant, а не по памяти.
3. Можно строить `repeatability detector` поверх уже нормализованных evaluation payload.

## Следующий шаг

Следующий кодовый слой после этого:

1. `motion taxonomy`
2. `controlled batch runner`
3. `repeatability detector v1`

Именно после этого learning loop станет по-настоящему полезным, потому что начнет сравнивать не "ролики вообще", а конкретные motion/frame/hook combinations.
