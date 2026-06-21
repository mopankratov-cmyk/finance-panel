-- Обложки/эмбеды конкурентных видео: кэшируем oEmbed (thumbnail + плеер), чтобы лента была визуальной
-- (видно ЧТО за ролик — проверить, то ли спарсили) и игралась инлайн. Идемпотентно.
alter table viral_videos add column if not exists cover_url text;   -- thumbnail_url из oEmbed
alter table viral_videos add column if not exists embed_html text;  -- html-плеер из oEmbed (инлайн-просмотр)
alter table viral_videos add column if not exists oembed_at timestamptz; -- когда фетчили (чтобы не долбить повторно/по неудачам)

notify pgrst, 'reload schema';
