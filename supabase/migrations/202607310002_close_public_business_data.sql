-- Приложение использует собственную httpOnly-сессию, а не Supabase Auth.
-- Поэтому публичный anon key не должен иметь прямого доступа ни к финансовым,
-- ни к marketplace-таблицам/RPC: иначе внешний селлер мог бы обойти API-гейты.
-- Все рабочие обращения уже выполняются сервером через service_role.

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from anon, authenticated;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges in schema public
  revoke all on functions from anon, authenticated;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

comment on schema public is
  'Business data is server-only. Browser access goes through app API with fp_session RBAC and tenant checks.';
