# Scenario quality gate

`POST /api/factory/scenario-quality` проверяет сценарий до дорогого видео-рендера.

## Что принимает

- `article`
- `product_name`
- `niche`
- `scenario`
- `hooks`
- `visual_beats`
- `threshold`
- `scenarios` для пачки вариантов

## Что возвращает

- `winner`
- `ranked`
- `issues`
- `rewrite_hints`
- `score`
- `should_render`

Если модель недоступна или вернула плохой JSON, endpoint всё равно отдаёт контролируемый JSON через fallback-оценку.

## Пример

```json
{
  "article": "123456",
  "product_name": "Крем для лица",
  "niche": "cosmetics",
  "scenario": "Сценарий для UGC",
  "hooks": ["Почему этот крем не скатывается", "Три ошибки с кремом"],
  "visual_beats": ["крупный план", "нанесение", "результат"],
  "threshold": 7
}
```

Пример ответа:

```json
{
  "ok": true,
  "winner": {
    "id": "hook-1",
    "label": "Почему этот крем не скатывается",
    "score": 8,
    "should_render": true
  },
  "ranked": [],
  "issues": [],
  "rewrite_hints": ["добавь конкретную боль в первый кадр"],
  "score": 8,
  "should_render": true
}
```

## Rewrite

`POST /api/factory/scenario-rewrite` переписывает слабый сценарий в более живой UGC-тон и возвращает:

- `rewritten`
- `changed`
- `kept`
- `score_before`
- `score_after`
- `notes`

Это отдельный шаг, который удобно ставить сразу после quality gate, если сценарий не прошёл порог.
