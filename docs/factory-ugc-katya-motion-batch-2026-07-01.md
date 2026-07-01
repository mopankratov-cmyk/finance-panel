# UGC Katya Motion Batch

Дата: 2026-07-01
Контур: UGC Factory sidecar, detached from main factory
Провайдер: HeyGen Avatar IV
Статус: 4/4 paid renders completed

## Цель

Проверить, можно ли убрать ощущение "AI крутит голову по одной схеме" через управляемые параметры HeyGen, пока без товара и без подключения к основному контент-заводу.

Главный принцип batch:

- один блогер;
- один look id;
- один голос;
- один spoken script;
- меняются только `motion_prompt` и `expressiveness`.

## Blogger

- `blogger_id`: `katya_russian_creator_v3b`
- `avatar_look_id`: `f9e4ecf1b902451aaa17e8c2430a5c1b`
- `voice`: `Anya`
- `voice_id`: `37832e32d4f7475ab7a1cb0db8e5dd66`
- `aspect_ratio`: `9:16`
- `resolution`: `720p`

## Script

```text
Я сначала подумала: ну нет, опять какая-то штука из рекламы. А потом поймала себя на том, что смотрю дальше.
```

## Variants

| # | ID | Expressiveness | HeyGen video id | Local mp4 |
|---|---|---:|---|---|
| 1 | `katya-calm-direct-low` | `low` | `7fc1caa733a84966be67d2d5573e9248` | `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/katya-calm-direct-low.mp4` |
| 2 | `katya-skeptical-pause-medium` | `medium` | `03c166e696ad43408686d49e5c43e096` | `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/katya-skeptical-pause-medium.mp4` |
| 3 | `katya-small-nod-medium` | `medium` | `670f99d20c5a4a8a8e615d13b8bd647e` | `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/katya-small-nod-medium.mp4` |
| 4 | `katya-friend-advice-high` | `high` | `3d8128d41e414a9594ce6ef411af53dd` | `/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/katya-friend-advice-high.mp4` |

Contact sheet:

```text
/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/contact-sheet.jpg
```

Sanitized run result:

```text
/tmp/ugc-factory-heygen-katya-motion-batch-2026-07-01/results-sanitized.json
```

## Motion prompts

### 1. calm direct

```text
Natural phone selfie. Mostly steady eye contact, one tiny breath before the second sentence, very small nod at the end. Avoid repetitive head swinging.
```

### 2. skeptical pause

```text
Start with a small skeptical head tilt and micro-pause, then relax the face. Eyes glance aside briefly once, then back to camera. No big presenter gestures.
```

### 3. small nod

```text
Conversational creator energy. Two subtle nods timed with the realization, relaxed shoulders, soft half-smile only near the final words. Keep movements asymmetrical and human.
```

### 4. friend advice

```text
Friendly but not salesy. Slight lean toward camera on the first sentence, softer expression after the pause, small hand or shoulder movement if possible. Avoid theatrical smile.
```

## Preliminary read

По contact sheet:

- `friend_advice` + `high` выглядит самым эмоциональным, но есть риск presenter/реклама из-за улыбки;
- `calm_direct` + `low` выглядит менее рекламно, но может быть слишком плоским;
- `skeptical_pause` + `medium` и `small_nod` + `medium` выглядят как главные кандидаты для следующего batch.

Оценивать winner нужно по движению в mp4, не по одному кадру.

## Next batch

Если пользователь выбирает winner:

1. зафиксировать winning `motion_prompt` и `expressiveness`;
2. сделать 6 вариантов с разными emotional curves:
   - skeptic -> curiosity;
   - tired -> relief;
   - doubt -> proof;
   - friend warning -> advice;
   - no-plan -> surprise;
   - mom-check -> practical recommendation;
3. прогнать `blogger-evaluation` по rubric `living_blogger_v1`;
4. выбрать 2 best-of-batch;
5. только потом добавлять товар/B-roll.

## Engineering result

Кодовый контур теперь поддерживает:

- `motionPrompt` in `HeyGenCreateVideoInput`;
- `expressiveness` in `HeyGenCreateVideoInput`;
- smoke-plan propagation from `heygenVideo.ts`;
- contract coverage in `heygenClientContract` and `heygenVideoContract`.
