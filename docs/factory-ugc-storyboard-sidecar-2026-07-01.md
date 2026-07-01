# UGC Storyboard Sidecar

Дата: 2026-07-01  
Контур: UGC Factory sidecar, detached from main factory  
Статус: dry-run contract, no paid provider calls

## Зачем

После HeyGen mini-batch стало видно: Катя и Алина годятся для первых тестов, но лицо нельзя держать долго. Поэтому новый контур строит ролик как две отдельные зоны:

1. `hook_talking_head`: 2-4 секунды лица блогера.
2. `proof_broll`: доказательный B-roll, который подтверждает утверждение из хука.

Это позволяет сейчас тестировать блогеров отдельно, а позже подключить товарный Product Twin / FAL / реальные кадры без пересборки identity.

## Что добавлено

- `lib/factory/ugcStoryboard.ts`: чистый builder storyboard.
- `lib/factory/ugcStoryboardContract.test.mts`: контракт на ограничения и текущие HeyGen blogger IDs.
- `app/api/factory/ugc-storyboard/route.ts`: dry-run endpoint, не запускает HeyGen/FAL.

## Текущие блогеры

| Key | Role | Avatar look ID | Decision |
| --- | --- | --- | --- |
| `katya` | primary creator | `f9e4ecf1b902451aaa17e8c2430a5c1b` | основной кандидат |
| `alina` | mom review | `8dd0451ca8af4d25b5222014d3f0657f` | secondary |
| `sergey` | dad review | `a5e9b0c485a749518e577ce392318366` | пока не масштабировать |

## Example

```bash
curl -sS -X POST "$BASE_URL/api/factory/ugc-storyboard" \
  -H 'content-type: application/json' \
  -d '{
    "blogger_key": "katya",
    "product": "детский набор",
    "angle": "честный обзор",
    "hook": "Я сначала подумала: ну нет, опять какая-то штука из рекламы.",
    "faceDurationSec": 3,
    "proofCues": [{
      "claim": "не выглядит как рекламная постановка",
      "shot": "показать руки, упаковку и обычный стол без студийного света",
      "evidence": "hands"
    }],
    "cta": "смотри реальные кадры"
  }'
```

## Contract Rules

- Talking-head всегда первый клип.
- Talking-head clamp: минимум 2 сек, максимум 4 сек.
- В face-сегменте нет product proof shot.
- Каждое утверждение должно иметь visual proof cue.
- `proof_broll` получает canonical `BRollSpec`, чтобы downstream мог сделать overlay/монтаж.
- Endpoint только dry-run: paid render должен идти отдельным budget-guarded action.

## Next

1. Прогнать 2 storyboard dry-run:
   - Katya / `skeptic-stop`
   - Katya / `daily-use`
2. Подставить реальный product twin, когда товарный слой готов.
3. Сгенерировать только первые 2-4 секунды HeyGen face.
4. Сгенерировать B-roll отдельно и проверить proof-frame QC.
5. Только после этого собирать full UGC clip.
