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

Автономный режим:

```text
node --import tsx lib/factory/bloggerLearningLoopRunner.mjs --generation 5 --limit 5 --generation-size 5 --prior-results-file docs/factory-katya-generation5-prior-results.json --confirm-paid true --auto-select true --auto-top-k 2
```

В этом режиме после paid render runner сам создаёт:

- `results-sanitized.json`
- `auto-prior-results.json`

`auto-prior-results.json` становится памятью для следующего поколения. То есть человек не обязан каждый раз руками называть winners; ручная проверка нужна только если confidence низкий или батч визуально слишком близкий.

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

## Generation 2

Первый generation 2 прогон оказался частично невалидным для оценки, потому что в look matrix случайно попал не-Katya private look. Этот прогон не использовать для выбора winners.

После этого planner был исправлен:

- generation 2 теперь biased вокруг winner-кандидатов generation 1;
- planner использует только Katya-like female looks;
- для разных scenes переключаются разные `avatar_look_id`.

Рабочий prior file:

```text
docs/factory-katya-generation2-prior-results.json
```

## Generation 2b valid batch

Дата: 2026-07-01

Команда:

```text
node --import tsx lib/factory/bloggerLearningLoopRunner.mjs --generation 2 --limit 5 --generation-size 5 --prior-results-file docs/factory-katya-generation2-prior-results.json --confirm-paid true --out-dir /tmp/ugc-factory-katya-learning-loop-2026-07-01-generation2b
```

Результат:

- 5/5 completed;
- batch уже biased вокруг generation 1 winners:
  - `tired_honest`
  - `skeptical_pause`
- используются только женские Katya-like looks:
  - `soft_window_cardigan`
  - `hallway_hoodie`
  - `skeptical_kitchen_selfie`

Успешные mp4:

- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation2b/generation-02/katya_lab__g02__01__sofa_evening__three_quarter_left__tired_honest.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation2b/generation-02/katya_lab__g02__02__sofa_evening__three_quarter_right__half_smile.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation2b/generation-02/katya_lab__g02__03__entryway_jacket__three_quarter_left__skeptical_pause.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation2b/generation-02/katya_lab__g02__04__mirror_selfie__three_quarter_right__friend_advice.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation2b/generation-02/katya_lab__g02__05__sofa_evening__three_quarter_left__tired_honest.mp4`

Contact sheet:

```text
/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation2b/generation-02/contact-sheet.jpg
```

Предварительный визуальный вывод по кадрам:

- `1 tired_honest medium` и `5 tired_honest low` выглядят как сильные natural candidates;
- `3 skeptical_pause hallway` остаётся хорошим skeptical hook;
- `2 half_smile` и `4 friend_advice` полезны как контрастные варианты, но требуют проверки по движению, чтобы не уйти в presenter.

Следующий шаг:

1. выбрать 2-3 winners из generation 2b;
2. generation 3 делать уже как tighter batch:
   - один лучший skeptical;
   - один лучший tired honest;
   - один контрастный expressive variant;
3. менять по одной оси, а не всё сразу.

## Generation 3 tightened batch

Дата: 2026-07-01

Режим:

- tightened generation mode;
- planner меняет по одной оси вокруг generation 2 winners;
- prior file: `docs/factory-katya-generation3-prior-results.json`

Команда:

```text
node --import tsx lib/factory/bloggerLearningLoopRunner.mjs --generation 3 --limit 5 --generation-size 5 --prior-results-file docs/factory-katya-generation3-prior-results.json --confirm-paid true --out-dir /tmp/ugc-factory-katya-learning-loop-2026-07-01-generation3
```

Результат:

- 5/5 completed;
- batch не exploratory, а comparison-oriented;
- сравниваются:
  - `tired_honest` low vs medium;
  - `skeptical_pause` hallway vs sofa;
  - один expressive contrast: `friend_advice`.

Успешные mp4:

- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation3/generation-03/katya_lab__g03__01__sofa_evening__three_quarter_left__tired_honest.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation3/generation-03/katya_lab__g03__02__sofa_evening__three_quarter_left__tired_honest.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation3/generation-03/katya_lab__g03__03__entryway_jacket__three_quarter_left__skeptical_pause.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation3/generation-03/katya_lab__g03__04__mirror_selfie__three_quarter_left__friend_advice.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation3/generation-03/katya_lab__g03__05__sofa_evening__three_quarter_left__skeptical_pause.mp4`

Contact sheet:

```text
/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation3/generation-03/contact-sheet.jpg
```

User feedback после просмотра generation 3:

- `1`, `2` и `5` не понравились;
- `3` и `4` выглядят "норм в стиле UGC".

Это важный поворот: вручную подтверждено, что более "натуральный" по моей предварительной оценке `tired_honest` не обязательно выигрывает как UGC-подача. Значит, контур самообучения должен оптимизироваться не просто под natural baseline, а под human-picked UGC realism.

Следующий шаг:

1. generation 4 делать как targeted bakeoff только вокруг user-approved линий;
2. оставить две активные ветки:
   - `skeptical_pause hallway`
   - `friend_advice mirror`
3. проверить внутри них:
   - micro-pause;
   - pose feel;
   - first-2s realism;
   - не уходит ли `friend_advice` в presenter.

## Generation 4 targeted UGC bakeoff

Дата: 2026-07-01

Режим:

- generation построен уже не от моей визуальной гипотезы, а от user label;
- prior file: `docs/factory-katya-generation4-prior-results.json`;
- в batch оставлены только направления, которые пользователь признал "в стиле UGC".

Команда:

```text
node --import tsx lib/factory/bloggerLearningLoopRunner.mjs --generation 4 --limit 5 --generation-size 5 --prior-results-file docs/factory-katya-generation4-prior-results.json --confirm-paid true --out-dir /tmp/ugc-factory-katya-learning-loop-2026-07-01-generation4
```

Результат:

- 5/5 completed;
- batch сфокусирован на сравнении двух рабочих линий:
  - `skeptical_pause` в `entryway_jacket`;
  - `friend_advice` в `mirror_selfie` и `entryway_jacket`;
- planner сравнивает уже не broad exploration, а controlled UGC micro-variation.

Успешные mp4:

- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation4/generation-04/katya_lab__g04__01__entryway_jacket__three_quarter_left__skeptical_pause.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation4/generation-04/katya_lab__g04__02__entryway_jacket__three_quarter_left__skeptical_pause.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation4/generation-04/katya_lab__g04__03__mirror_selfie__three_quarter_left__friend_advice.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation4/generation-04/katya_lab__g04__04__mirror_selfie__three_quarter_left__friend_advice.mp4`
- `/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation4/generation-04/katya_lab__g04__05__entryway_jacket__three_quarter_left__friend_advice.mp4`

Contact sheet:

```text
/tmp/ugc-factory-katya-learning-loop-2026-07-01-generation4/generation-04/contact-sheet.jpg
```

Что именно сравнивается внутри generation 4:

- `01` vs `02`: один и тот же `skeptical_pause`, но разный pose/expression/expressiveness;
- `03` vs `04`: один и тот же `friend_advice` в mirror/selfie линии, но разная рука/поза/выражение;
- `05`: перенос `friend_advice` из mirror в entryway, чтобы проверить, что именно даёт UGC-ощущение: motion или scene.

Текущий вывод контура:

- `tired_honest` временно демотирован как не самый удачный именно для UGC;
- рабочие линии для дальнейшего добивания живости:
  - skeptical skeptical hook;
  - conversational friend-advice hook;
- следующий цикл должен уже учиться на user-picked winners generation 4, а не заново исследовать всю матрицу.

## Переход в auto-select loop

Чтобы владелец не участвовал в каждом поколении, контур переводится в полуавтономный режим:

1. generation рендерится пятёркой;
2. auto selector сам ранжирует completed runs;
3. top-2 попадают в `auto-prior-results.json`;
4. следующий generation строится уже от этого файла;
5. ручное вмешательство нужно только если `needs_human_review = true`.

Текущая логика автоотбора пока heuristic-based:

- предпочитает `skeptical_pause` и `friend_advice`;
- повышает score за `mirror_selfie`, `entryway_jacket`, `phone_in_hand`, `leaning_on_table`;
- штрафует `high expressiveness`, `half_smile`, `calm_direct`, повторяющиеся семейства кадров;
- повышает anti-AI score у low/medium expressiveness и friend-like posture.

Это не финальный vision critic, но уже убирает владельца из ручного цикла для большинства батчей.

## Generation 5 autonomous loop

Дата: 2026-07-01

Режим:

- prior file: `docs/factory-katya-generation5-prior-results.json`
- paid render + `--auto-select true --auto-top-k 2`
- человек больше не выбирает winners вручную после каждого батча

Команда:

```text
node --import tsx lib/factory/bloggerLearningLoopRunner.mjs --generation 5 --limit 5 --generation-size 5 --prior-results-file docs/factory-katya-generation5-prior-results.json --confirm-paid true --auto-select true --auto-top-k 2 --out-dir /tmp/ugc-factory-katya-learning-loop-2026-07-01-generation5
```

Результат:

- 5/5 completed;
- auto selector сам выпустил `auto-prior-results.json`;
- top-2 winners:
  - `katya_lab__g05__04__mirror_selfie__three_quarter_left__friend_advice`
  - `katya_lab__g05__01__entryway_jacket__three_quarter_left__skeptical_pause`

Смысл generation 5:

- контур подтвердил, что user-picked линии действительно остаются strongest anchors;
- `phone_in_hand + friend_warning + mirror_selfie` стала сильнейшей веткой;
- `leaning_on_table + skeptical_pause + entryway` осталась второй сильной веткой.

Автоуверенность:

- `confidence = low`
- причина не в поломке, а в том, что весь batch оказался плотным по score и разрыв между `#2` и `#3` небольшой.

Следствие:

- even with low confidence, next generation можно строить автоматически;
- low confidence просто значит: если понадобится, человек может потом разово откалибровать вкусовой сдвиг.

## Generation 6 autonomous continuation

Дата: 2026-07-01

Режим:

- prior file: `docs/factory-katya-generation6-prior-results.json`
- этот файл уже создан автоматически из `generation 5 auto-prior-results`
- paid render + `--auto-select true --auto-top-k 2`

Команда:

```text
node --import tsx lib/factory/bloggerLearningLoopRunner.mjs --generation 6 --limit 5 --generation-size 5 --prior-results-file docs/factory-katya-generation6-prior-results.json --confirm-paid true --auto-select true --auto-top-k 2 --out-dir /tmp/ugc-factory-katya-learning-loop-2026-07-01-generation6
```

Результат:

- 5/5 completed;
- loop уже не ждал ручного решения и сам продолжил от generation 5;
- auto winners:
  - `katya_lab__g06__04__mirror_selfie__three_quarter_left__friend_advice`
  - `katya_lab__g06__01__mirror_selfie__three_quarter_left__friend_advice`

Что изменилось по поведению поиска:

- generation 5 ещё держал баланс между `friend_advice/mirror_selfie` и `skeptical_pause/entryway`;
- generation 6 уже сам сместился в сторону `mirror_selfie + friend_advice`;
- при этом `mirror_selfie + skeptical_pause` тоже показал высокий score как exploration branch, но не обогнал two best friend-advice runs.

Текущий вывод:

- автономная петля обучения работает end-to-end;
- strongest current basin:
  - `mirror_selfie`
  - `three_quarter_left`
  - `friend_advice`
- следующая инженерная задача уже не "можем ли мы учиться без человека", а "как не схлопнуться в один шаблон и когда расширять wardrobe/environment matrix".

## Autopilot and anti-collapse upgrade

После generation 6 был запущен настоящий autopilot:

- `lib/factory/bloggerLearningLoopAutopilot.mjs`
- он сам делает generation -> auto-select -> next prior file -> next generation

Первый прогон autopilot (`generation 7 -> generation 8`) показал важную проблему:

- петля действительно учится;
- но без дополнительной защиты она слишком быстро схлопывается в одну семью:
  - `mirror_selfie`
  - `friend_advice`

Это полезный failure mode: значит контур уже достаточно сильный, чтобы залипать в локальный максимум.

### Что было улучшено

Добавлены два слоя защиты:

1. `autoSelect` diversity guard  
   Если top-2 слишком похожи, а рядом есть почти такой же по score кандидат из другой семьи, в winners сохраняется и этот альтернативный кандидат.

2. `tightened planner` contrast guard  
   Если два последних winners принадлежат одной и той же семье, следующий batch обязан сохранить contrast branch вместо полного копирования одной линии.

### Повторный autopilot run после улучшения

Повторный прогон `generation 7 -> generation 8` после diversity upgrade показал уже более здоровое поведение:

- generation 7 winners:
  - `katya_lab__g07__04__mirror_selfie__three_quarter_left__friend_advice`
  - `katya_lab__g07__05__mirror_selfie__three_quarter_left__skeptical_pause`
- generation 8 winners:
  - `katya_lab__g08__04__mirror_selfie__three_quarter_left__friend_advice`
  - `katya_lab__g08__05__mirror_selfie__three_quarter_left__skeptical_pause`

Ключевой вывод:

- петля не потеряла лучший basin;
- но перестала превращаться в монокультуру;
- теперь она держит в живых две конкурентные семьи:
  - `mirror_selfie + friend_advice`
  - `mirror_selfie + skeptical_pause`

То есть да: learning loop уже не просто повторяет старое, а улучшает собственную стратегию поиска.
