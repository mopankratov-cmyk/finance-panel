# HeyGen Russian Blogger Candidates

Дата: 2026-07-01  
Контур: UGC Factory sidecar, detached from main factory  
Провайдер: HeyGen prompt avatars  
Режим: visual-first, без финального голоса

## Цель

Сместить визуальный стиль блогеров под русскую аудиторию: меньше западного стокового глянца, больше бытового UGC из обычной квартиры, без текста на картинке, телефона в кадре, брендов и рекламной постановки.

## Что изменили в промптах

- Убрали слишком длинные промпты: HeyGen отклоняет `prompt` длиннее 1000 символов.
- Добавили бытовые российские сцены: кухня, прихожая, простые шкафы, холодильник, чайник, батарея, дневной свет.
- Запретили элементы, которые ломают UGC-реализм: text overlay, captions, emoji, logo, phone screen, mirror, product, studio lighting, glamour makeup.
- Перешли от "beautiful avatar" к "ordinary marketplace buyer / reviewer vibe".

## Текущие кандидаты

| Role | Slug | Avatar look ID | Avatar group ID | Status | Локальный preview | Оценка |
| --- | --- | --- | --- | --- | --- | --- |
| Мама / честный обзор | `alina_russian_mom_v3b` | `8dd0451ca8af4d25b5222014d3f0657f` | `3455f070b3d2404083b9114dce1555ba` | `completed` | `/tmp/ugc-factory-heygen-bloggers-2026-07-01/alina_russian_mom_v3b.jpg` | Лучший первый кандидат. Бытовая кухня, обычное лицо, нет глянца. Выражение чуть хитрое, но живое. |
| Молодая UGC / POV | `katya_russian_creator_v3b` | `f9e4ecf1b902451aaa17e8c2430a5c1b` | `f0ca9e763ce24aa3abcfad494977a5c0` | `completed` | `/tmp/ugc-factory-heygen-bloggers-2026-07-01/katya_russian_creator_v3b.jpg` | Хороша для POV, лайфхака, "я сначала сомневалась". Сцена похожа на обычную квартиру. |
| Папа / практичный обзор | `sergey_russian_dad_v3b` | `a5e9b0c485a749518e577ce392318366` | `490f1bfefaec43f7a816a69a1b7b44de` | `completed` | `/tmp/ugc-factory-heygen-bloggers-2026-07-01/sergey_russian_dad_v3b.jpg` | Самый бытовой мужской кандидат. Минус: выражение слишком суровое для семейных товаров, нужен мягкий дубль. |

Все три look поддерживают `avatar_iv`.

## Что отклонили

- `alina_mom_review`: HeyGen добавил крупный русский text overlay, нельзя использовать как чистого блогера.
- `max_dad_review`: телефон/рекурсивный экран в кадре, слишком искусственный UGC-сетап.
- `*_v2`: стало лучше по запретам, но лица и стиль остались ближе к западному stock family.
- `*_v3`: промпты были слишком длинные, HeyGen вернул `invalid_parameter` из-за лимита 1000 символов.

## Следующий прогон

1. Взять `alina_russian_mom_v3b` как primary smoke.
2. Взять `katya_russian_creator_v3b` как second smoke.
3. Сделать короткий HeyGen visual/talking-head smoke 3-4 секунды без товара.
4. Проверить в первую очередь:
   - не появляется ли "AI face" в движении;
   - насколько естественные глаза/рот/паузы;
   - не ломается ли русская фраза на синтетическом HeyGen voice;
   - можно ли оставить первые 2-4 секунды лица, а дальше уходить в B-roll.
5. Для Сергея сделать еще один prompt-дубль с менее нахмуренным выражением: calm practical dad, slight tired smile, not angry.

## Decision

Не подключать к основному контент-заводу до платного smoke. Сейчас это кандидатный контур блогеров: создаем стабильные identity/look ID, тестируем движение и только потом связываем с продуктовым пайплайном.
