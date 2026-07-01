# UGC Living Blogger: 6-Month Roadmap

Дата: 2026-07-01  
Контур: UGC Factory sidecar, detached from main factory  
Фокус: сделать AI-блогеров заметно живее и построить learning loop, который улучшает их со временем

## Главный вывод

Текущие блогеры уже достаточно хорошие, чтобы идти в тесты.

Но следующий bottleneck теперь другой:

- лицо выглядит хорошо в статике и терпимо в коротком видео;
- в серии начинает палиться повторяемость: одинаковая мимика, одинаковые повороты головы, одинаковый ритм;
- если держать talking-head слишком долго, ощущение "это AI" быстро растет.

Значит наша задача на 6 месяцев не "найти идеальный аватар один раз", а построить систему, которая:

1. держит лицо коротко и только там, где оно усиливает хук;
2. уводит ролик в proof B-roll до того, как talking-head начинает разваливаться;
3. учится на том, какие лица, движения, голоса, хуки и монтаж реально выглядят живыми.

## Северная метрика

`first_2s_human_believability`

Рабочий смысл:

- человек не думает "это нейронка" в первые 2 секунды;
- talking-head не разваливается на мимике/повороте;
- ролик можно безопасно открыть лицом, а не сразу прятаться за B-roll.

Эта метрика должна позже собираться из:

- ручной оценки;
- Telegram shortlisting;
- auto-judge;
- retention в первые 2-3 секунды;
- сравнений внутри одного blogger/hook batch.

## Что уже есть

- живые HeyGen blogger candidates;
- live smoke и mini-batch по Кате и Алине;
- voice learning loop;
- visual-first blogger mode;
- dry-run storyboard sidecar с правилом "любое утверждение подтверждается кадром".

Это хорошая база. Мы уже не с нуля.

## В какую сторону дорабатывать живость

### 1. Не держать лицо долго

Это уже не гипотеза, а правило.

- face segment: `2-4` секунды;
- дальше сразу `proof_broll`;
- длинный монолог talking-head не делать основным форматом.

### 2. Разбить "живость" на отдельные оси

Нам не нужен один магический score. Нужны отдельные параметры:

- лицо/кожа;
- мимика;
- поворот головы;
- моргание;
- ритм речи;
- синхрон губ;
- бытовость кадра;
- повторяемость между дублями.

Только так можно понять, что именно надо чинить.

### 3. Делать не одного блогера, а вариативный пакет одного блогера

Для каждого блогера нужен не один look, а family:

- base look;
- softer look;
- tired/casual look;
- brighter look;
- close selfie look;
- half-body room look.

Тогда один и тот же персонаж остается узнаваемым, но не превращается в "одну и ту же голову в одном и том же кадре".

### 4. Учить не "красоту", а анти-AI-эффект

Победителем считается не самый красивый ролик, а тот, который:

- меньше всего палится как AI;
- держит первые секунды;
- не выглядит как повтор прошлого дубля;
- не требует прятать лицо раньше времени.

## План по месяцам

## Месяц 1: Human Baseline

Цель: зафиксировать рабочий baseline и научиться оценивать "живость" не на глаз в хаосе, а по одной шкале.

### M1.1 Blogger Evaluation Rubric

Сделать единый rubric для blogger QC:

- face realism;
- motion realism;
- lip sync;
- voice naturalness;
- room authenticity;
- anti-AI first 2 seconds;
- repeatability penalty.

Выход:

- JSON-структура оценки;
- ручная форма/endpoint;
- единый scorecard для всех smoke batch.

### M1.2 Blogger Variant Registry

Сделать реестр blogger variants:

- blogger_id;
- role;
- look_id;
- voice mode;
- room type;
- framing type;
- expression profile;
- notes;
- live scores.

Цель: помнить не только "Катя хорошая", а "Катя / hallway / skeptical / medium frame = работает лучше".

### M1.3 First 20 Controlled Smokes

Прогнать 20 коротких smoke-роликов:

- Катя primary;
- Алина secondary;
- 2-3 hook types;
- 2 frame types;
- 2 delivery types;
- только 2-4 секунды face.

Acceptance:

- есть shortlist winner variants;
- есть анти-patterns;
- есть понимание, что ломает живость чаще всего.

## Месяц 2: Motion and Expression Loop

Цель: убрать одинаковые повороты головы и одинаковую мимику.

### M2.1 Motion Taxonomy

Ввести словарь motion/expression presets:

- calm direct;
- skeptical pause;
- small nod;
- half-smile;
- tired honest;
- friend advice;
- practical demo.

Это нужно хранить как параметры в blogger/storyboard, а не только в тексте промпта.

### M2.2 Motion Batch Runner

Для одного и того же hook автоматически делать вариации:

- same text;
- same blogger;
- different motion preset;
- different framing;
- different expressiveness.

Цель: сравнивать motion отдельно от script.

### M2.3 Repeatability Detector v1

Сделать heuristic score:

- одинаковый угол головы;
- одинаковый crop;
- одинаковая улыбка;
- одинаковое начало фразы;
- одинаковое timing pattern.

Если batch слишком однообразный, он не проходит shortlist.

## Месяц 3: Voice + Face Context Learning

Цель: оценивать голос только в контексте лица, а не отдельно.

### M3.1 Face-Voice Pair Registry

Хранить пары:

- blogger variant;
- voice preset/provider;
- lip-sync result;
- manual score;
- fail reasons.

Потому что хороший mp3 может плохо работать на конкретном лице.

### M3.2 Two-Lane Voice System

Закрепить architecture:

- premium realism lane;
- fallback batch lane.

Премиум lane:

- speech-to-speech / cloned / highly natural voice.

Fallback lane:

- predictable Russian TTS для быстрых batch и baseline.

### M3.3 Telegram Review Loop v2

Присылать не просто mp3, а пары:

- short talking-head clip;
- номер;
- 1-2 вопроса по живости.

Нам нужно, чтобы обратная связь шла по "верю / не верю", а не только "норм голос".

## Месяц 4: Storyboard Learning

Цель: учить не только блогера, но и структуру ролика.

### M4.1 Hook -> Proof Mapping Memory

Для каждого hook типа хранить:

- какой proof cue после него работает лучше;
- какой B-roll shot подтверждает claim лучше;
- когда надо резать лицо раньше.

### M4.2 Blogger-Specific Storyboard Templates

Сделать шаблоны:

- Katya / skeptical;
- Katya / daily-use;
- Alina / mom-review;
- Sergey / practical-dad.

Чтобы мы не собирали ролик каждый раз с нуля.

### M4.3 Proof Discipline Gate

Если в storyboard есть claim без visual proof, batch не идёт дальше.

Это ключ к тому, чтобы ролик оставался живым: не "говорящая голова", а голова + доказательство.

## Месяц 5: Market Feedback Brain

Цель: перейти от "нам кажется это живее" к "рынок подтверждает, что это живее".

### M5.1 Publication Feedback Mapping

Связать post metrics с параметрами:

- blogger;
- variant;
- motion preset;
- voice preset;
- hook type;
- face duration;
- proof type;
- montage style.

### M5.2 Winner Pattern Mining

Находить:

- какие blogger+hook combinations чаще побеждают;
- какие motion presets дают лучший старт;
- где лица лучше резать на 2 сек, а где можно держать 4.

### M5.3 Auto-Demotion

Если variant repeatedly:

- палится как AI;
- имеет низкий shortlist score;
- хуже рынка;

он автоматически выходит из active pool.

## Месяц 6: Semi-Autonomous Blogger Factory

Цель: чтобы контур сам не только генерировал, но и постепенно улучшал блогеров.

### M6.1 Active Blogger Pool

Слои:

- active;
- experimental;
- archived;
- retrain_needed.

### M6.2 Automatic Next-Batch Proposals

Система сама предлагает:

- что тестировать дальше;
- какой blogger variant доработать;
- где нужен новый look;
- где поменять motion;
- где заменить voice lane.

### M6.3 100-Run Learning Report

Финальная цель цикла:

- 100+ controlled blogger clips;
- карта победителей;
- карта анти-patterns;
- decision table по blogger/hook/motion/voice/proof combinations.

## Что делаем прямо сейчас

Это и есть ближайший execution lane.

### Sprint A: ближайшие 7-10 дней

1. Сделать `blogger evaluation rubric`.
2. Сделать `blogger variant registry`.
3. Прогнать ещё один controlled batch по Кате и Алине:
   - 2 frame types;
   - 2 motion types;
   - 2 hook types.
4. Записать победителей и анти-patterns.

### Sprint B: следующие 10-14 дней

1. Сделать `motion taxonomy`.
2. Сделать `motion batch runner`.
3. Добавить `repeatability penalty`.
4. Обновить shortlist logic так, чтобы однообразные дубляжи не выигрывали.

### Sprint C: после этого

1. Перевести feedback в Telegram на short video review, а не только на audio.
2. Собирать pair-scores `face + voice`.
3. Подключать реальный товар только через storyboard с proof discipline.

## Что не надо делать сейчас

- Не пытаться сделать длинные talking-head ролики.
- Не пытаться выбрать "идеального" одного блогера навсегда.
- Не подключать это сразу ко всему основному заводу.
- Не смешивать voice improvement и motion improvement в одном batch без контроля.

## Какой у нас рабочий приоритет

Приоритет на сейчас:

1. Катя как primary blogger.
2. Алина как secondary.
3. Улучшать motion/repeatability раньше, чем расширять пул лиц.
4. Строить learning loop вокруг short hooks, а не full ads.

## Решение

Да, нам стоит строить петлю обучения уже сейчас.

Но не как "большой AI-мозг сразу", а как серию маленьких измеримых контуров:

- rubric;
- registry;
- controlled batch runner;
- repeatability detector;
- face+voice shortlist;
- market feedback mapping.

Это даст нам систему, которая реально становится живее, а не просто генерирует всё больше похожих роликов.
