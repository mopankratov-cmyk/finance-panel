-- V14 · Winner → пресет: когда видео залетает, снимаем ПРОИЗВОДСТВЕННЫЕ настройки его рецепта
-- (движок/params/сабтайтлы/музыка/длительности по ролям) в node_templates как переиспользуемый пресет.
-- node_templates уже источник «перенести себе» (transfer) — расширяем его метками winner-происхождения.
alter table node_templates add column if not exists from_winner    boolean default false; -- пресет рождён из залетевшего видео (приоритетный)
alter table node_templates add column if not exists win_note       text;                  -- чем залетел: формат · ОТК · просмотры
alter table node_templates add column if not exists source_recipe_id bigint;              -- рецепт-первоисточник (дедуп пересохранений)
create index if not exists node_templates_winner_idx on node_templates(niche, from_winner);

notify pgrst, 'reload schema';
