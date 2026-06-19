-- Виральный корпус: постоянное хранилище залетевших коротких видео (TikTok/Reels/Shorts) по нишам,
-- кеш Orbit-поисков и Comet-мониторов Virlo, и проверенные хуки. На этом корпусе обучаются агенты
-- завода (хук-турнир калибруется на реальных хуках, сценарист берёт beat-структуру победителей,
-- niche-playbook агрегирует корпус, а не один прогон). Читать Virlo бесплатно — корпус компаундит.

-- ── Залетевшие видео ниши (главная таблица) ─────────────────────────────────────────────
create table if not exists viral_videos (
  id                bigint generated always as identity primary key,
  niche             text,                                 -- clothing | toys | cosmetics | default
  platform          text,                                 -- tiktok | youtube | instagram
  url               text not null,                        -- прямая ссылка (дедуп по ней)
  views             bigint,
  likes             bigint,
  followers_creator bigint,                               -- подписчики автора (для скоринга)
  virality_score    numeric,                              -- ln(views/followers)*ln(followers): >=35 искл., 25-35 очень сильно
  caption           text,
  hook_text         text,                                 -- первая фраза 0-3 сек (из analyze_video)
  format_detected   text,                                 -- POV | before-after | unboxing | demo | life-hack | problem-solution
  beat_structure    jsonb,                                -- [{duration, visual, voiceover, emotional_arc}]
  sound_id          text,                                 -- id трендового звука Virlo
  sound_title       text,
  is_commerce_safe  boolean,                              -- безопасен ли звук для рекламы
  theme_detected    text,
  viral_reason      jsonb,                                -- ключевые факторы успеха из analyze_video
  source_orbit_id   text,                                 -- job_id Orbit, выловивший видео
  source_comet_id   text,                                 -- monitor_id Comet (постоянный мониторинг)
  analyzed          boolean not null default false,       -- запускался ли analyze_video
  analyzed_full     jsonb,                                -- полный ответ analyze_video (structure/why_viral/hooks...)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (url)
);
create index if not exists viral_videos_niche_idx     on viral_videos(niche, platform, virality_score desc);
create index if not exists viral_videos_score_idx     on viral_videos(virality_score desc);
create index if not exists viral_videos_unanalyzed_idx on viral_videos(virality_score desc) where not analyzed;
create index if not exists viral_videos_orbit_idx     on viral_videos(source_orbit_id);
create index if not exists viral_videos_comet_idx     on viral_videos(source_comet_id);

-- ── Кеш Orbit-поисков (вместо пересоздания — читать analysis/sounds бесплатно) ───────────
create table if not exists orbit_searches (
  job_id           text primary key,                      -- Virlo Orbit job_id
  niche            text,
  article          text,
  keywords         text[] default '{}',
  platforms        text[] default '{}',
  time_period      text,                                  -- this_month | this_week
  status           text,                                  -- pending | completed | partial_failure
  finalized        boolean not null default false,        -- finalized=true → analysis готов
  video_count      int,
  analysis_summary jsonb,                                 -- themes[], viral_tactics[], timing_analysis
  sounds           jsonb,                                 -- [{id,title,is_commerce_music,usage_count,avg_views}]
  created_at       timestamptz not null default now(),
  fetched_at       timestamptz
);
create index if not exists orbit_searches_niche_idx   on orbit_searches(niche);
create index if not exists orbit_searches_created_idx on orbit_searches(created_at desc);

-- ── Реестр Comet-мониторов (постоянный поток видео, читать get_niche_monitor_data бесплатно) ─
create table if not exists niche_monitors (
  id                text primary key,                     -- Virlo monitor_id
  niche             text,
  article           text,
  query             text,
  platforms         text[] default '{}',
  status            text,                                 -- active | paused | completed
  last_polled_at    timestamptz,
  video_count_total int,
  next_sync_at      timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists niche_monitors_niche_idx  on niche_monitors(niche);
create index if not exists niche_monitors_active_idx on niche_monitors(status) where status = 'active';

-- ── Проверенные хуки (хук-турнир калибруется на РЕАЛЬНЫХ залетевших примерах, не на теории) ─
create table if not exists viral_hooks (
  id                 bigint generated always as identity primary key,
  niche              text,
  mode               text check (mode in ('audience','sell')),
  hook_text          text not null,
  video_source_id    bigint references viral_videos(id) on delete set null,
  structure          jsonb,                               -- {duration, pattern, emotion}
  viability_score    int not null default 0,              -- сколько раз хук-судья одобрил (сортировка/калибровка)
  times_approved     int not null default 0,
  times_rejected     int not null default 0,
  times_reworked     int not null default 0,
  effectiveness_notes text,
  created_at         timestamptz not null default now()
);
create index if not exists viral_hooks_niche_mode_idx on viral_hooks(niche, mode);
create index if not exists viral_hooks_score_idx      on viral_hooks(viability_score desc);
