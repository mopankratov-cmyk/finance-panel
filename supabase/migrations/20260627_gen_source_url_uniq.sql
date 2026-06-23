-- #14: уникальный индекс на ВИДЕО-gen-ассеты по source_url → два параллельных gen-poll с одним видео
-- не плодят дубль строки в каталоге. Раньше дедуп проверялся ДО скачивания, вставка ПОСЛЕ → гонка.
-- Код gen-save обрабатывает 23505 (конфликт) gracefully: ловит → возвращает уже сохранённую строку.
-- До применения этой миграции код работает как раньше (re-check сужает окно, но гарантии нет).
--
-- ⚠️ ТОЛЬКО kind='video': у каруселей source_url = base64-слайд (slides[0], ~250 КБ) → btree-индекс
-- падает (index row > 8191 байт). Видео-source_url = короткий URL ролика. Дедуп-гонка #14 — это видео-путь
-- (if (videoUrl) в gen-save); карусельный путь дедупа не имеет и в индексе не нуждается.

-- сперва убираем существующие дубли ВИДЕО (оставляем самую раннюю строку на каждый source_url),
-- иначе CREATE UNIQUE INDEX упадёт на уже имеющихся дублях
delete from content_assets a using content_assets b
  where a.disk = 'gen' and b.disk = 'gen'
    and a.kind = 'video' and b.kind = 'video'
    and a.id > b.id
    and (a.analysis->>'source_url') is not null
    and (a.analysis->>'source_url') = (b.analysis->>'source_url');

create unique index if not exists content_assets_gen_source_url_uniq
  on content_assets ((analysis->>'source_url'))
  where disk = 'gen' and kind = 'video' and (analysis->>'source_url') is not null;
