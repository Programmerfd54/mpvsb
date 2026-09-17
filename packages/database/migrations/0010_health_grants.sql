-- 0010: доступ runtime-ролей к журналу миграций для проверки готовности.
-- Таблицу создаёт запускающий скрипт до применения миграций; здесь только права.

grant usage on schema public to context_api, context_worker, context_evaluator;
grant select on public.schema_migrations to context_api, context_worker, context_evaluator;

-- Роли не должны создавать объекты в public.
revoke create on schema public from public, context_api, context_worker, context_evaluator;
