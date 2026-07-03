# Рецепт оживления Мани на OmniHuman-1.5 (петля обучения 2026-07-03)

> Прорыв: смена движка оживления HeyGen talking-photo → OmniHuman-1.5 image-to-video
> дала настоящее движение тела/рук вместо анимации неподвижного фото. Петля из 5 итераций
> добила мыло, текстуру кожи и живость. Владельцу отправлены v1→v5 (виден прогресс).

## Движок: fal-ai/bytedance/omnihuman/v1.5

Вход: `image_url` (id-lock стилл Мани) + `audio_url` (ElevenLabs Nastya) → видео с телом/руками.
Параметры (input schema): `resolution`, `turbo_mode`, `mask_url`, `image_url`, `audio_url`, `prompt`.

### КРИТИЧНО (корень «нового хуже»)
- **`turbo_mode: false`** — дефолт идёт в turbo (быстро=грязно), лицо уплывало в generic/моложе/глаже. Выкл turbo = лицо держится и резкое. ЭТО была причина «похуже».
- **`resolution: "1080p"`** — не 720p дефолт.
- **`prompt`** с сохранением идентичности: «Keep her exact face and identity unchanged: same face shape, freckles, grey-blue eyes. Sharp realistic imperfect skin with visible pores, no smoothing, no beautification.»
- Цена: ~$1.5/клип 10с. Медленно (non-turbo 1080p ~15-20 мин/клип) — гнать в фоне/параллельно.

### Живость (v4)
Промпт с выразительностью: «excitedly talks, expressive lively face with natural micro-expressions, raised eyebrows, genuine animated hand gestures, small natural head movements».

## Вход: стилл с усиленной кожей (id-lock Seedream)

Двух-картиночный деглянц (лицо-эталон + сцена) с МАКСИМУМОМ кожи:
«highly detailed real skin with clearly visible pores, fine skin texture, a few small blemishes
and freckles, slight uneven redness, faint under-eye shadows, tiny fine facial hairs, NO smoothing,
NO beautification, NO plastic skin, matte not glossy.» → OmniHuman анимирует уже текстурное лицо.

## Де-мыло пост (ffmpeg) — правка реализм-паса под OmniHuman

Реализм-пас был настроен под HeyGen; на резком 1080p OmniHuman он МЫЛИЛ. Правки:
- **Убрать `hqdn3d`** (хромо-смаз — главный источник мыла).
- **`cas=0.75-0.85`** (было 0.55) — сильнее contrast-adaptive sharpen.
- **Битрейт `6000-7000k`** (было 3800k) — компрессия меньше мылит; `-profile:v high`.
- **Зерно легче**: `noise=c0s=2-3:c1s=5-8` (грубое зерно на низком битрейте = мушится).
- CRF пасса A 14-15 (было 17).

## Итерации (что показали владельцу)

| v | Изменение | Результат |
|---|---|---|
| v1 | базовая HQ OmniHuman + старый реализм-пас | лицо держится, но мягко |
| v2 | де-мыло пост | резче, мыло ушло |
| v3 | + стилл с текстурой кожи | кожа живая, поры/веснушки |
| v4 | + промпт живости | искренняя мимика/жесты |
| v5 | best-of + макс доводка резкости | финал: чёткое реальное лицо |

## Что переиспользовано (не выброшено)

id-lock деглянц (лицо-эталон), голос Nastya, персона-библия, палитра регистров, реализм-пас
(в де-мыло редакции), субтитры/луп-слой. Сменился ОДИН узел: HeyGen Avatar IV → OmniHuman.

## Следующий шаг
Вшить рецепт в раннер как движок оживления (флаг engine=omnihuman): деглянц-стилл + TTS →
OmniHuman(1080p,turbo off,identity+liveness prompt) → де-мыло пост. Перегнать 5 showcase-сцен.
Уходит зависимость от HeyGen (умирает 31.10.2026).
