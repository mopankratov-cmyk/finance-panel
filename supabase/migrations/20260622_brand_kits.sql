-- V24 · openreels бренд-кит: ФИКСИРОВАННАЯ айдентика бренда как переиспользуемые ПРОИЗВОДСТВЕННЫЕ
-- пресеты (голос/персона/шаблон/музыка/шрифт/цвет/CTA/бан-слова/хэштеги). Автозаполнение (§17) и сборка
-- берут их как дефолты → каждое видео бренда консистентно, без ручного подбора. Дополняет нарративный
-- brandProfiles.ts (текст-голос для копирайтера) машинными значениями для движков.
-- Ключ = detectBrand() (CLÉRIN/ENOUGH/Tim Tin/NORVIA/…). Пусто = кит не задан → autofill как раньше.
create table if not exists brand_kits (
  id              bigint generated always as identity primary key,
  brand           text not null unique,        -- ключ из detectBrand(article,name)
  niche           text,
  -- Creatify (UGC-актёр)
  voice_id        text,                         -- override_voice
  persona_id      text,                         -- override_avatar
  visual_style    text,                         -- шаблон композиции
  music_url       text,                         -- background_music_url
  -- субтитры/титры (creatify caption_setting.* + shotstack font.*)
  caption_font    text,                         -- font_family / font.family (кириллица-safe)
  caption_color   text,                         -- text_color / font.color (#RRGGBB[AA])
  caption_highlight text,                       -- highlight_text_color (karaoke)
  -- копирайт/постинг
  cta             text,                         -- шаблон призыва
  ban_words       jsonb not null default '[]',  -- стоп-слова/анти-стиль (бренд не использует)
  hashtags        jsonb not null default '[]',  -- бренд-хэштеги
  notes           text,
  updated_at      timestamptz not null default now()
);

notify pgrst, 'reload schema';
