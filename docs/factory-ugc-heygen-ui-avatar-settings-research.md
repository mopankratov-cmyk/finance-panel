# HeyGen — UI / API research для UGC-блогера (UGC Factory contour)

**Дата:** 2026-07-01
**Автор:** Claude Code (исследование через Chrome, живой залогиненный аккаунт HeyGen)
**Ветка:** `feat/factory-v2-product-broll`
**Аккаунт:** app-v4.1.0 (новый интерфейс «AI Studio / Avatar V / Seedance 2»)
**Метод:** ручной обход UI + официальные API-доки (`developers.heygen.com`). Ничего не создавалось, ничего не оплачивалось, credits не тратились.

> ⚠️ Все скрин-факты ниже сняты вживую в UI. Тяжёлый WebGL-редактор (`/create-v4`) не отдаёт визуальный скрин, но структуру панелей я снял через accessibility-дерево.

---

## 1. Краткий вывод (TL;DR)

- **Нашего блогера можно сделать прямо в HeyGen, без съёмки живого человека и без consent.** Нужный путь — **AI-generated Photo Avatar** («Create a virtual character → Design with AI»). Он полностью описывается промптом (имя, возраст, пол, этнос, внешность, поза, ориентация, стиль) и создаёт постоянную личность.
- **Ключевое ограничение стоков:** публичные (stock) аватары идут с **фиксированным маленьким набором looks (1–2)** в **одной** сцене. Их окружение нельзя свободно менять. Чтобы получить наши 10 домашних сцен (кухня, спальня, диван…), **нужен свой аватар** + генерация looks под него.
- **Против «студийного/презентерского» вида** работает не набор пресетов (они как раз студийные — Podcast Studio, Presenter, Lawyer…), а **свободный промпт**: `Design with AI` (при создании) и `Cinematic / Describe your shot` (при генерации сцены). Именно туда пишем «kitchen daylight, selfie, phone camera, natural light».
- **Almost everything is API-able.** Создание photo-avatar, генерация looks, тренировка (консистентность лица), выбор голоса и генерация видео — всё есть в v2 API. У завода **уже заведён Production API-ключ** («для завода», активен с 30.06.2026).
- **Что пока UI-first:** новый режим **Cinematic (Seedance 2)** — «режиссура» камеры/света/продукта (product b-roll). В публичном API его ещё не видно → эти сцены, скорее всего, придётся собирать вручную в UI (или дождаться API).
- **Бюджет тонкий:** тариф $9.99, потрачено $3.71 (~$6 остатка). Cinematic-шот стоит **60 credits**, Presenter — **0.3 credit/сек**. Экономить надо на Cinematic.

**Рекомендуемый путь: A + B (гибрид).** Создаём одного synthetic Photo Avatar «Alina», генерируем 8–12 looks (частично промптом, частично Cinematic вручную), затем **Codex гоняет генерацию видео по готовым look_id через API**. Digital twin (путь C) — только если владелец захочет снять живого актёра (нужен consent + видео).

---

## 2. Способы создания аватара (что есть в UI)

Точка входа: **Avatar → Avatars → «New Avatar»** (или экран «Create Your First Avatar»). Наверху — два больших пути; «virtual character» раскрывается в два под-пути.

| Способ | Где в UI | Inputs | Нужен consent? | Нужно видео? | Из 1 фото? | Credits / warning | Looks / фон / одежда | Для нас |
|---|---|---|---|---|---|---|---|---|
| **Clone a real person (Avatar V / Digital twin)** | Avatars → «Clone a real person» → `digital-twin/lite-record` или `lite-upload` | Веб-камера / телефон / загрузка видео (WebP/MP4/MOV/WebM ≤10GB или Google Drive). ≥15 сек речи, естественные жесты, паузы, тихая освещённая комната | **ДА** — «We'll verify you have permission to use this avatar before creating videos with it» | **ДА** (≥15 сек) | Нет | Списание при генерации видео | Да (Avatar V: «one recording, unlimited looks») | Только если снимаем живого актёра |
| **Virtual character → Upload photo** | Avatars → «Create a virtual character → Upload photo» | Своё фото (чёткое лицо, ≥720p) → open native file picker | Для реального узнаваемого лица — да; для сгенерённого/синтет. фото — нет | Нет | **Да** | Warning при генерации looks/видео | Да (через looks) | Возможно (если у нас есть готовое лицо) |
| **Virtual character → Design with AI** ⭐ | Avatars → «Create a virtual character → Design with AI» → модалка «Describe your avatar's look» | Промпт-форма (см. §3.1) | **Нет** (это синтетический персонаж, не реальный человек) | Нет | — (генерится с нуля) | Кнопка **«Generate Preview»** = списание credits (я НЕ нажимал) | Да, полностью управляется | **ОСНОВНОЙ путь для «Alina»** |
| **Stock / Public Avatars** | Avatars → вкладка «Public Avatars» | Выбор из каталога + фильтры | Нет | Нет | — | Списание при генерации видео | ❗ **Фикс. 1–2 looks в ОДНОЙ сцене, менять окружение нельзя** | Для быстрых тестов / бенчмарка качества |
| **Photo to Video (Avatar V)** | Avatar → Quick create → «Photo to video» | 1 фото + скрипт (или запись голоса) | Для реального лица — да | Нет | **Да** | 720p дропдаун, Generate = credits | Разовое видео, не постоянный аватар | Быстрый тест «оживления» одного фото |

**Про «Instant / Interactive / Avatar IV»:** в новом интерфейсе они консолидированы. «Avatar IV» теперь — это **Motion Engine** внутри редактора (выбирается на сцене), а не отдельный тип создания. «Instant Avatar» = старое название для digital-twin (webcam/upload). Отдельного «Interactive (streaming) Avatar» в разделе Avatar нет — это отдельный продукт (real-time), в этот контур не входит.

### 2.1 Промпт-форма «Design with AI» (полный список полей)

| Поле | Тип | Значения | Для Alina |
|---|---|---|---|
| **Name** * | текст | — | `Alina` |
| **Age** * | dropdown | Young Adult · Early Middle Age · Late Middle Age · Senior · Unspecified | **Young Adult** (25–34) |
| **Gender** * | dropdown | Man · Woman · Unspecified | **Woman** |
| **Ethnicity** | dropdown | White · Black · Asian American · East Asian · South East Asian · South Asian · Middle Eastern · Pacific · Hispanic · Unspecified | на выбор владельца (напр. White/East Asian) |
| **Describe your avatar** | free text | напр. «A young man in hiking gear standing on a mountain trail» | описываем «обычную покупательницу», без гламура |
| **Orientation** | сегменты | Landscape · **Portrait** · Square | **Portrait** (9:16) |
| **Pose** | сегменты | Full Body · **Upper Body** · Face | Upper Body / Face под селфи-интро |
| **Style** | dropdown | **Realistic** · Pixar · Cinematic · Vintage · Noir · Cyberpunk | **Realistic** |
| → **Generate Preview** | кнопка | генерит превью аватара | ⚠️ тратит credits — только с подтверждения владельца |

> Эти поля 1-в-1 совпадают с API `POST /v2/photo_avatar/photo/generate` (см. §6) — значит, создание аватара автоматизируемо.

---

## 3. Настройки looks (несколько образов на одного аватара)

Концепция HeyGen: **Avatar V — «One recording. Unlimited looks. Generate yourself in any outfit, pose, or setting.»** То есть looks — это отдельная сущность поверх одной «личности».

Где создаются looks (Avatar → **Avatar Shots**, вкладка **«Design a look»**):

- **Look Packs** — готовые пакеты по 5 связанных looks (напр. «Fitness» = 5 looks). ❗ Каталог пресетов **перекошен в студию/профессии**: Podcast Studio, Studio Streamer, Presenter, Real Estate, Lawyer, Professor. Поиск «kitchen» дал только «Fitness». **Для anti-studio они плохо подходят.**
- **Custom look по промпту** — экран «What new look are you imagining?» + поиск сцен. Именно сюда пишем нужную домашнюю обстановку.
- **Cinematic / Describe your shot** — самый гибкий способ задать сцену/камеру/свет текстом (см. §4).
- **Per-scene в AI Studio** — на каждой сцене отдельно: Avatar Background (Customize / Remove / Color), Layout (Original / Circle), Radius, Zoom.

Что реально управляется (и чем убрать «презентера»):

| Параметр looks | Есть? | Как задаётся | Заметка для anti-studio |
|---|---|---|---|
| Разные комнаты (кухня/спальня/…) | ✅ | промпт (Design with AI / Cinematic / Design a look) | пресеты — нет, промпт — да |
| Разные outfits | ✅ | промпт | «casual hoodie», «cardigan», без делового |
| Разные poses | ✅ | Pose (Full/Upper/Face) + промпт | «leaning on kitchen counter» |
| Framing / camera | ✅ | Cinematic (360° camera), Zoom, Layout | close-up / medium |
| Selfie / phone style | ✅ | **только промптом** («selfie, front camera, arm's length») | ключ к «нативности» |
| Background | ✅ | Customize / Remove / Color + промпт | Remove → композ на своё видео |
| Lighting | ✅ | промпт (Cinematic «direct lighting») | «soft daylight from window» |
| Vertical 9:16 | ✅ | Orientation Portrait / Aspect 9:16 | по умолчанию для нас |
| Close-up / medium shot | ✅ | Zoom + Pose + Cinematic | |
| Gestures | ✅ | Cinematic «full-body performance» + Motion | |
| Facial expression | ✅ | промпт + голос-эмоция | «slightly skeptical, friendly» |

**Вывод по looks:** свобода огромная, **но через промпт, а не через пресеты**. Пресетные Look Packs — студийные, их избегаем.

---

## 4. Настройки видео (генерация)

В разделе **Avatar → Avatar Shots** три режима (переключаются вкладками вверху):

| Режим | Движок | Max длина | Ключевое | Стоимость | Для чего |
|---|---|---|---|---|---|
| **Presenter** | Avatar V | 30 мин | 175+ языков, #1 lip-sync | **0.3 credit/сек** | говорящая голова, скрипт → видео |
| **Cinematic** ⭐ | **Seedance 2** | 15 сек | **360° camera control**, direct camera/lighting/full-body, «stage interactions across people, products, and places», **до 3+ references** | **60 credits/шот** | нативные хуки, product b-roll |
| **Design a look** | — | — | генерация нового look для аватара | — | образы (см. §3) |

### 4.1 Presenter (говорящая голова)
- **Script** (ввод / upload / record), **Avatar** selector, **Motion**, **Voice**, aspect ratio, resolution, Generate.

### 4.2 Cinematic / «Describe your shot» (главный для нативного UGC + product)
- **Describe your shot** — свободный текст сцены/действия.
- **«+» → Avatar / Media** — добавить аватара и/или **Media (референс-картинку продукта)** → **это механизм product b-roll** (3+ references).
- **Enhance prompt** toggle.
- **Aspect ratio:** **Portrait (9:16)** / Landscape.
- **Resolution:** **720p / 1080p** (на free-плане потолок 720p).
- **Shot duration:** **Auto** / **Custom** (Custom → нужные «face intro 2–3 сек»).
- **Credits counter** + Generate (⚠️ 60 credits/шот — не жать без подтверждения).

### 4.3 Полный редактор — AI Studio (`/create-v4`)
Сюда вынесены «тяжёлые» настройки видео (структура снята через accessibility-дерево):

- **Aspect:** Portrait (9:16) / Landscape (16:9).
- **Левый тулбар:** Avatar · AI Tools · Media · Elements · **Music** · **Captions** · Screen Recorder · **Templates** · Layers · **Interactivity**.
- **Сцена (Avatar & Voice):** Avatar + конкретный look («Annie Casual Standing Front 2»), **Voice** (per-scene), **Motion Engine = Avatar IV**, **Avatar Background: Customize / Remove / Color**, **Layout: Original / Circle**, **Radius**, **Zoom**, Render Scene.
- **Скрипт:** текст + `/`-команды, **Upload audio**, **Script Writer** (AI-скрипт), **Add scene**, **Auto-split**, таймлайн (est. длительность).
- **Templates:** категории Elevated / Friendly / Minimal / Professional / Playful (можно **без шаблона** — «New video» стартует пустым).

### 4.4 Чек по нашим требованиям
| Нужно | Можно? | Как |
|---|---|---|
| Vertical native selfie | ✅ | Portrait 9:16 + промпт «selfie / phone camera» |
| No captions | ✅ | Captions — опциональный слой, просто не включаем |
| No template | ✅ | «New video» / Presenter / Cinematic без шаблона |
| No podcast/desk/mic | ✅ | не берём студийные Look Packs; промпт «home, no desk, no microphone» |
| Only face intro 2–3 сек | ✅ | Cinematic → Shot duration **Custom** (2–3 s), Pose = Face |
| Голос: speed/pitch/emotion, язык | ✅ | per-scene Voice-панель (speed/pitch/pronunciation/emotion — стандарт HeyGen); 175+ языков |
| Motion prompt / camera movement | ✅ | Cinematic «describe your shot» + 360° camera |
| Music / background | ✅ | AI Studio → Music; Background Customize/Remove/Color |

---

## 5. Каталог: лучшие UGC-кандидаты (female 25–34, casual reviewer)

Путь: **Public Avatars → категория `UGC` → Filters: Gender = Woman, Age = Young Adult** (URL `?publicTab=UGC&tab=public`). Каталог фильтруется по **Gender / Age / Ethnicity** и категориям **All · Professional · Lifestyle · UGC · Community · Favorites**.

> ❗ **avatar_id в карточке НЕ показан.** Он появляется в URL при открытии аватара (напр. Diana → `…/my-avatars/39b3a236040140ffa0371ad9235cdeb9`) и полностью — только через API `GET /v2/avatars`. ID looks — только через API.

UGC × Woman × Young Adult дал **20+ кандидатов**. Почти все — в **естественных домашних/кафе-сценах**, селфи-фрейминг, тёплый bokeh (не студия). Отобранные:

| # | Name | Looks | Сцена / вид | Почему подходит | Риски |
|---|---|---|---|---|---|
| 1 | **Izzy** | 2 | блондинка, дом, indoor | натуральный casual, тёплый свет | looks фикс., одна сцена |
| 2 | **Stephanie** | 2 | брюнетка, у окна | «домашняя подруга» | одна сцена |
| 3 | **Rumi** | 2 | азиатка, sage-топ, прихожая | очень «нативно», home | одна сцена |
| 4 | **Bethany** | 2 | блондинка, полка/home-office | reviewer-vibe | лёгкий «work-from-home» уклон |
| 5 | **Morgan** | 2 | блондинка, стена с рамками, casual | сильный UGC-look | одна сцена |
| 6 | **Melina** | 2 | азиатка, тёплый office bokeh | дружелюбный reviewer | чуть офисно |
| 7 | **Jeyla** | 2 | тёмнокожая, яркая рубашка, bokeh | экспрессивная, живая мимика | яркий образ — не «нейтральный» |
| 8 | **Diana** | 2 | оранжевый фон, белый блейзер | influencer-стиль | ближе к «модель», чем «покупательница» |
| 9 | **Sammy** | 1 | азиатка, кафе / гирлянды | уютно, нативно | 1 look |
| 10 | **Nelly** | 1 | кудрявая брюнетка, кафе/дом | тёплый, «своя» | 1 look |
| 11 | **Olivia** | 1 | брюнетка, дом | нейтрально-casual | 1 look |
| 12 | **Journey** | 1 | азиатка, дом | натурально | 1 look |
| 13 | **Pam** | 1 | женщина с комнатным растением | максимально «домашне» | 1 look |
| 14 | **Emma** | 1 | брюнетка, мягкий дом | casual | 1 look |
| 15 | **Laya** | 1 | блондинка, дом/кухня | нативно | 1 look |
| 16 | **Lily** | 1 | брюнетка, оранжевый топ, дом | улыбчивая, «подруга» | 1 look |
| 17 | **Hazel** | 1 | брюнетка, дом с растением | натурально | 1 look |
| 18 | **Joy** | 1 | тёмнокожая, дом у окна | тёплый свет | 1 look |
| 19 | **Milani** | 1 | mixed, светлый дом | свежо | 1 look |
| 20 | **Elaine** | 1 | брюнетка, чёрный топ, дом | нейтрально | 1 look |
| 21 | **Harper** | 1 | брюнетка, тёплый bokeh | casual | 1 look |

**Топ-5 под «слегка скептичная подруга-reviewer»:** **Morgan, Rumi, Pam, Nelly, Bethany** (домашние сцены, не гламур, не студия).
**Общий риск стоков:** у всех 1–2 фикс. looks в одной сцене → под 10 наших сцен **сток не тянет**, нужен свой аватар.

---

## 6. UI vs API — что автоматизируется, что руками

Официальные v2-эндпоинты (docs.heygen.com / developers.heygen.com). База: `https://api.heygen.com`.

| Задача | API? | Эндпоинт / где | Кто делает |
|---|---|---|---|
| Создать synthetic photo-avatar по промпту | ✅ | `POST /v2/photo_avatar/photo/generate` — поля **name, age, gender, ethnicity, orientation, pose, style, appearance** (те же, что в UI) → возвращает `generation_id` | Codex (по ТЗ) |
| Сгенерировать новые looks аватара | ✅ | `POST /v2/photo_avatar/look/generate` (Generate Photo Avatar Looks) | Codex |
| Тренировка группы (консистентное лицо) | ✅ | Create & Train Photo Avatar Groups | Codex |
| Добавить motion / голос к photo-avatar | ✅ | photo_avatar motion / voice endpoints | Codex |
| Список аватаров + look_id | ✅ | `GET /v2/avatars` (List All Avatars V2) | Codex |
| Список голосов + voice_id | ✅ | `GET /v2/voices` (List All Voices V2) | Codex |
| Сгенерировать видео | ✅ | `POST /v2/video/generate` (Create Avatar Video V2): `avatar_id`, `voice` (input_text, voice_id, speed/pitch/emotion), `background` {color/image/video}, `dimension` {width,height} | Codex |
| Оживить 1 фото (photo→video) | ✅ | Avatar IV videos (`create-avatar-iv-videos`) | Codex |
| Статус видео / async | ✅ | Video status + **Webhook** (в аккаунте есть раздел Webhook) | Codex |
| Форматы вывода | ✅ | 9:16 / 16:9 / 4:5 / 1:1 / auto; 720p (free) / 1080p / 4k; **MP4 или WebM (прозрачный фон)** | — |
| Digital twin реального человека | ⚠️ частично | создание требует **consent-верификации** (UI-гейт) + видео | Владелец (UI) |
| **Cinematic (Seedance 2)** — режиссура камеры/света, product b-roll | ❌ пока не видно в публичном API | новый v4-режим, UI-first | Руками в UI (пока) |
| Curation / визуальный QA сгенерённых looks | ❌ | глазами | Человек/оператор |

**Где нужен consent:** только для клонирования реального человека / загрузки узнаваемого реального лица. Для **AI-generated** аватара («Design with AI») consent не требуется.
**Где нужен paid confirmation:** любая генерация (Generate Preview аватара, Generate looks, Generate видео, Cinematic-шот). На free/тонком балансе — особенно Cinematic (60 credits).

### 6.1 Bring-your-own-face + промпт на КАЖДОМ этапе (важно для контроля лица)

Вопрос: можно ли на каждом шаге и промптить, и заливать своё (сгенерированное отдельно) лицо/картинку? **Да, на всех трёх этапах, часто одновременно.** (Подтверждено по [Photo Avatars API](https://docs.heygen.com/docs/photo-avatars-api), [Create & Train Groups](https://docs.heygen.com/docs/create-and-train-photo-avatar-groups), [Avatar IV API](https://docs.heygen.com/docs/create-avatar-iv-videos).)

| Этап | Промпт? | Заливка своего лица/картинок? | Как (UI / API) |
|---|---|---|---|
| **1. Личность (avatar group)** | ✅ Design with AI | ✅ Upload photo | UI: «virtual character → Upload photo» **или** «Design with AI». API: `POST /v2/photo_avatar/avatar_group/create` (с `image_key` из Upload Asset) **или** `POST /v2/photo_avatar/photo/generate`. **Группа может содержать И залитые, И AI-фото одновременно.** |
| **1a. Train (консистентность лица)** | — | (входные фото группы) | `POST /v2/photo_avatar/train` (group_id). Обязателен перед генерацией looks. Держит идентичность между looks/видео. |
| **2. Looks** | ✅ | ✅ доп. референс-фото (`image_keys[]`) + inspiration из библиотеки | «You can generate looks by uploading more photos as reference, prompting/describing, or choosing inspiration.» Три способа **комбинируются**. `POST /v2/photo_avatar/look/generate`. |
| **3a. Видео — Avatar IV (photo→video)** | ✅ **`custom_motion_prompt`** (+ `enhance_custom_motion_prompt`) | ✅ фото каждый ролик (`image_key`) | На каждый ролик: залить фото + скрипт + `voice_id` + промпт движения. Поддерживает angled/profile, human/anime/pet. |
| **3b. Видео — Cinematic (Seedance)** | ✅ «describe your shot» | ✅ **Media references** (продукт/сцена, 3+) | UI-first. Промпт + загрузка вместе. |

**Best practice для «Alina»:** сгенерить лицо у себя (внешний image-gen / photo-editor) → **залить 5–8 ракурсов одного лица (разные углы, эмоции, close-up + full-body) → train группу**. Получаем блогера, чьё лицо мы **контролируем и владеем**, с консистентностью между всеми 10 сценами. Надёжнее, чем face-лотерея «Design with AI». Одно фото (Avatar IV) тоже работает, но лицо может слегка «плыть» между роликами.

**Оговорки:**
- **Consent при заливке лица:** узнаваемое реальное лицо → HeyGen может запросить подтверждение прав/ownership. Синтетическое (наше) лицо — наш ассет, но галочку могут всё равно спросить; проверить на первом аплоаде.
- **Стоимость Avatar IV API:** ≈ **$4/мин (1080p), $5/мин (4K)**. При остатке ~$6 это ~1.5 мин — жать осторожно.

---

## 7. ТЗ на нашего блогера — «Alina / UGC friend»

**Персонаж:**
- девушка 25–34 (Age = Young Adult), Gender = Woman, Style = Realistic, Ethnicity — на выбор владельца;
- обычная покупательница/reviewer, **не** presenter/модель/corporate;
- говорит как подруга, слегка скептичная, «не продаёт, а проверяет»;
- короткие face-intro 2–3 сек (Cinematic, Shot duration = Custom, Pose = Face);
- формат 9:16, selfie/phone-камера, естественный свет, без captions/desk/mic по умолчанию.

**Base appearance prompt (черновик для «Design with AI»):**
> «An ordinary young woman (25–34), natural everyday look, minimal makeup, casual clothes (hoodie / cardigan / plain tee), friendly but slightly skeptical expression. Amateur selfie vibe, phone front camera, soft natural daylight. Not a model, not a studio presenter.»

**10 looks (через look-prompts / Cinematic, НЕ через студийные Look Packs):**
| # | Look | Prompt-ядро |
|---|---|---|
| 1 | kitchen daylight | «home kitchen, morning daylight from window, leaning on counter» |
| 2 | bedroom / cardigan | «cozy bedroom, soft light, wearing a knit cardigan» |
| 3 | living room couch | «sitting on a living-room couch, relaxed» |
| 4 | bathroom / skincare-safe | «bathroom mirror area, skincare context, modest framing» |
| 5 | store aisle | «retail store aisle, shopping, phone selfie» |
| 6 | desk corner (no monitor/mic) | «home desk corner, NO monitor, NO microphone, casual» |
| 7 | hallway / entryway | «apartment hallway / entryway, about to go out» |
| 8 | window daylight close-up | «close-up by a window, natural backlight» |
| 9 | balcony (optional) | «small balcony, daytime, city or greenery behind» |
| 10 | parked car passenger (optional) | «passenger seat of a parked car, daylight, casual» |

---

## 8. Recommended path (итог)

**A + B (гибрид), с элементами C по желанию владельца:**

1. **A — создать synthetic Photo Avatar «Alina»** через «Design with AI» (без consent, без видео). Сгенерировать 8–12 looks: часть — промптом (`look/generate` / Design a look), часть — вручную через Cinematic для нативных/product-сцен.
2. **B — отдать look_id / avatar_id / voice_id в Codex**, который через существующий API-ключ гонит `POST /v2/video/generate` (9:16, 720p, скрипт, голос с эмоцией) и слушает webhook на готовность.
3. **C — только если нужен максимальный фотореализм живого человека:** снять живого актёра (digital twin) — это уже consent + видео ≥15 сек, запускать **только с владельцем**.

**Почему не «чистый сток»:** stock-аватары дают 1–2 look в одной сцене и не покрывают 10 домашних обстановок. Сток годится только как **бенчмарк качества лица** и для быстрых тестов.

---

## 9. Что нужно от владельца

1. **Подтверждение на первую платную генерацию** (Generate Preview аватара) — спишет credits.
2. **Выбор этноса/внешности Alina** (одно решение — влияет на весь контур).
3. **Решение по бюджету:** баланс $3.71/$9.99. Cinematic = 60 credits/шот. Нужен ли top-up перед прогоном 10 looks + серии видео.
4. **Политика по Cinematic vs Presenter:** product b-roll (Seedance) дорогой и UI-only — делать точечно или ждать API?
5. **Нужен ли путь C (живой актёр / digital twin)** — если да, готовим consent + требования к видео.
6. **Доступ к API-ключу «для завода»** для Codex (ключ уже активен; значение мне не показывалось и в отчёт не попало).

---

## 10. Что НЕЛЬЗЯ делать без явного подтверждения

- ❌ Нажимать **Generate Preview / Generate / Render Scene / Describe a shot → Generate** — любая генерация тратит credits.
- ❌ Запускать **Cinematic-шот** (60 credits) на тонком балансе.
- ❌ Создавать **digital twin реального человека** без consent и без владельца.
- ❌ **Add balance / Add balance top-up / смена тарифа** — денежная операция.
- ❌ **Regenerate / удалять API-ключ** «для завода» (сломает интеграцию).
- ❌ **Публиковать** любое сгенерённое видео.
- ❌ Менять настройки аккаунта / webhook / connections без запроса.

---

## 11. Next steps для Codex / API-интеграции

1. **Auth:** использовать существующий Production-ключ «для завода» (заголовок `X-Api-Key`), базовый `https://api.heygen.com`.
2. **Bootstrap каталога:** `GET /v2/avatars` + `GET /v2/voices` → сохранить `avatar_id` / `look_id` / `voice_id` в конфиг завода.
3. **Создание Alina (один раз):** `POST /v2/photo_avatar/photo/generate` с полями из §7 → `generation_id` → poll статус → train group (консистентность) → `look/generate` для looks 1–10.
4. **Генерация видео (массово):** `POST /v2/video/generate` — `character{avatar_id, avatar_style}`, `voice{input_text, voice_id, speed, pitch, emotion}`, `background{remove/color/image}`, `dimension{720×1280}` (9:16). Async → **webhook** на готовность (раздел Webhook в аккаунте уже есть).
5. **Хранение:** маппинг `look → сцена (kitchen/bedroom/…)` + `avatar_id/look_id/voice_id` в контракте завода (рядом с `lib/factory/productTwinStudioContract`).
6. **Формат вывода:** MP4 9:16 720p (free-потолок), либо WebM с прозрачным фоном, если нужен композ поверх product b-roll.
7. **Ограничение по бюджету:** ставить guard на количество генераций/шотов; Cinematic-шоты (60 credits) — только вручную/по флагу.
8. **Открытый вопрос:** проверить, появился ли публичный API для **Seedance 2 / Cinematic** и **Design-a-look** промптов; если нет — эти сцены остаются ручными в UI.

---

### Приложение: факты аккаунта (на 2026-07-01)
- Версия: `app-v4.1.0-2026.06.30`.
- API-ключ: **«для завода»**, тип Production, статус Active, создан 30.06.2026 (значение скрыто).
- Usage: **$3.71 / $9.99** spent.
- Разделы Developers: Overview, Billing, Usage, **Webhook**, Skills, Connections, Models, API Doc, **MCP**, CLI.
- Пример avatar_id (Diana, stock): `39b3a236040140ffa0371ad9235cdeb9`.
- Тарификация: Presenter **0.3 credit/сек**, Cinematic (Seedance 2) **60 credits/15-сек шот**.
