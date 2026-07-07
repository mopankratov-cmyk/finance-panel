-- Отдельная категория токена WB «Вопросы и Отзывы» (feedbacks-api.wildberries.ru) —
-- существующий основной токен её не обязательно покрывает (как Продвижение/Контент,
-- см. token_advert/token_content). resolveWbToken пробует token_feedbacks, иначе
-- основной token — тот же паттерн 1:1.
alter table public.wb_cabinets add column if not exists token_feedbacks text;
