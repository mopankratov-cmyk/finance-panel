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

Отдельно для b-roll: чистый packshot на фоне (`shadow_bg`, `white_bg`, `gray_bg`) сам по себе не проходит производственный paid submit. Он годится для hero/card QA и технического smoke, но не должен масштабироваться как b-roll источник.

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
4. Отметить ассеты/ракурсы кнопками b-roll QA: usable, weak, reject.
5. Для passed SKU запускать product b-roll dry-run и проверить `source_gate`.
6. Для failed SKU запускать rebuild только после выбора лучшего source-pack.

## Вывод из первого smoke

TT04102 и YYS0101 были полезны как проверка транспорта: FAL submit/status/Yandex archive работают. Как b-roll результат они не годятся, потому что источником был `shadow_bg` packshot с качеством около 0.54-0.57 и риском medium/high. Следующий производственный прогон должен начинаться с derived view или clean in-context source, а не с фоновой карточки.
