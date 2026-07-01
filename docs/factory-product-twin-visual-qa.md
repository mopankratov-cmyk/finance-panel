# Product Twin visual QA

Дата: 2026-07-01.

## Что проверяем глазами

Цифровой двойник считается пригодным для b-roll только если:

- товар узнаётся как тот же SKU;
- нет рекламных плашек, лишних надписей и WB-инфографики;
- нет “перерисованной” формы, цвета, фурнитуры, этикетки или швов;
- края чистые, без рваной альфы и грязных ореолов;
- `shadow_bg` или `clean_png` выглядит лучше исходника;
- сервисные карты (`mask`, `alpha`, `depth`, `segmentation`) не выбираются как визуальный source.

## Решение по слабым twin

- `needs_review`: не запускать paid b-roll, пока не выбран новый исходник или не пересобран source-pack.
- `broll_ready=false`: можно хранить в twin, но нельзя использовать как happy path для i2v.
- `yandex-disk:/...` raw URL: не вставлять напрямую в `<img>`; сначала получать preview/download URL.

## Приоритет для одежды и сумок

Для `apparel` и `bag` source-pack должен собираться максимально богато:

- front / back / 45 left / 45 right;
- крупно: ткань, швы, молния, фурнитура, патч;
- on-model, если есть чистая фотосессия;
- item-only clean PNG;
- shadow/white/gray background;
- mask/alpha/depth/segmentation для подготовки к видео.

Если есть чистые фотки с фотосессии без рекламных плашек, они важнее WB-карточек.

## Первый визуальный QA batch

1. Открыть Product Twin Studio.
2. `Load Twins`.
3. Смотреть `Derived Views` и `Asset Readiness`.
4. Пометить слабые SKU в журнале.
5. Для passed SKU запускать product b-roll dry-run.
6. Для failed SKU запускать rebuild только после выбора лучшего source-pack.
