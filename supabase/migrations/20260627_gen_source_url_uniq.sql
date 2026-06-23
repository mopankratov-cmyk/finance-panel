-- #14: уникальный индекс на gen-ассеты по source_url → два параллельных gen-poll с одним видео
-- не плодят дубль строки в каталоге. Раньше дедуп проверялся ДО скачивания, вставка ПОСЛЕ → гонка.
-- Код gen-save обрабатывает 23505 (конфликт) gracefully: ловит → возвращает уже сохранённую строку.
-- До применения этой миграции код работает как раньше (re-check сужает окно, но гарантии нет).

-- сперва убираем существующие дубли (оставляем самую раннюю строку на каждый source_url),
-- иначе CREATE UNIQUE INDEX упадёт на уже имеющихся дублях
delete from content_assets a using content_assets b
  where a.disk = 'gen' and b.disk = 'gen'
    and a.id > b.id
    and (a.analysis->>'source_url') is not null
    and (a.analysis->>'source_url') = (b.analysis->>'source_url');

create unique index if not exists content_assets_gen_source_url_uniq
  on content_assets ((analysis->>'source_url'))
  where disk = 'gen' and (analysis->>'source_url') is not null;
