-- Структурные проверки восстановленной базы. Выводит строки вида
--   имя_проверки|ok|подробность
-- и ничего не изменяет. Запускается scripts/ops/verify-restore.sh.
--
-- Проверяется то, от чего зависят границы доступа и ограды удаления:
-- роли и их права, RLS, схема очереди, отсутствие «воскресших» данных.
--
-- ТРЕБОВАНИЕ К РОЛИ: только роль с BYPASSRLS (эксплуатационная роль
-- восстановления). На таблицах включён FORCE ROW LEVEL SECURITY, поэтому под
-- обычным владельцем схемы политики скрыли бы строки и проверки оград прошли бы
-- на пустом наборе — файл отчитался бы «ok», ничего не проверив. Роль миграций
-- не подходит: ей BYPASSRLS в production запрещён (см. RUNBOOK § 6.0).
--
-- Ожидаемые значения приходят из манифеста копии (verify-restore.sh передаёт их
-- через -v): число политик, число таблиц с FORCE RLS и мажорная версия сервера
-- сверяются точным равенством, а не порогом «больше нуля».
--
--   psql -v ON_ERROR_STOP=1 -v fence_ids='{}' \
--        -v expected_policies=34 -v expected_rls_forced=33 -v expected_server_major=18 \
--        -f scripts/ops/verify-restore.sql

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset fieldsep |

-- Барьер 1: под ролью без BYPASSRLS запрос к таблице с политиками падает с явной
-- ошибкой, а не возвращает молча ноль строк.
set row_security = off;

-- Барьер 2: понятное объяснение до того, как PostgreSQL сообщит о политике.
do $$
begin
  if not exists (
    select 1 from pg_roles
    where rolname = current_user and (rolbypassrls or rolsuper)
  ) then
    raise exception using
      message = 'Проверка восстановления требует роли с BYPASSRLS.',
      detail = format(
        'Роль %I политики RLS не обходит: проверки оград увидели бы ноль строк и отчитались бы «ok», ничего не проверив.',
        current_user),
      hint = 'Запустите проверку эксплуатационной ролью восстановления (BYPASSRLS, см. RUNBOOK § 6.0). Роль миграций для этого не подходит: ей BYPASSRLS в production запрещён.';
  end if;
end
$$;

-- Назначения под оградой — то же определение, что и в deletion-fences.sql.
create temporary view fenced_assignments as
with journal as (
  select unnest((:'fence_ids')::uuid[]) as assignment_id
),
requests as (
  select pr.organization_id, pr.assignment_id, pr.employee_id
  from platform.privacy_requests pr
  where pr.request_type in ('deletion', 'withdrawal')
    and pr.state not in ('rejected', 'completed')
),
jobs as (
  select pr.organization_id, pr.assignment_id, pr.employee_id
  from platform.deletion_jobs dj
  join platform.privacy_requests pr on pr.id = dj.privacy_request_id
  where dj.state in ('queued', 'running', 'failed')
),
-- Отзыв согласия платформа хранит отдельно от privacy_requests: то же определение,
-- что и в deletion-fences.sql.
withdrawals as (
  select c.organization_id, c.assignment_id, null::uuid as employee_id
  from core.consent_records c
  where c.withdrawn_at is not null
),
scoped as (
  select * from requests
  union all
  select * from jobs
  union all
  select * from withdrawals
)
select distinct a.organization_id, a.id as assignment_id, a.data_generation, a.processing_hold
from core.assignments a
where a.id in (select assignment_id from journal)
   or exists (
        select 1 from scoped s
        where s.organization_id = a.organization_id
          and (s.assignment_id = a.id or s.employee_id = a.employee_id)
      );

-- 1. Runtime-роли на месте и не обходят RLS.
select 'roles.exist|' ||
       case when count(*) = 3 then 'ok' else 'fail' end ||
       '|найдено ролей: ' || count(*) || ' из 3'
from pg_roles
where rolname in ('context_api', 'context_worker', 'context_evaluator');

select 'roles.no_bypassrls|' ||
       case when count(*) = 0 then 'ok' else 'fail' end ||
       '|ролей с BYPASSRLS или SUPERUSER: ' || count(*)
from pg_roles
where rolname in ('context_api', 'context_worker', 'context_evaluator')
  and (rolbypassrls or rolsuper);

-- 2. Разделение схем: worker без identity и evaluation, api без evaluation.
select 'grants.worker_no_identity|' ||
       case when not has_schema_privilege('context_worker', 'identity', 'usage')
            then 'ok' else 'fail' end ||
       '|context_worker не имеет доступа к схеме identity';

select 'grants.worker_no_evaluation|' ||
       case when not has_schema_privilege('context_worker', 'evaluation', 'usage')
            then 'ok' else 'fail' end ||
       '|context_worker не имеет доступа к схеме evaluation';

select 'grants.api_no_evaluation|' ||
       case when not has_schema_privilege('context_api', 'evaluation', 'usage')
            then 'ok' else 'fail' end ||
       '|context_api не имеет доступа к схеме evaluation';

-- 3. RLS включена и принудительна для владельца. Сверка — ТОЧНАЯ, с манифестом
--    базы-источника: порог «больше нуля» пропустил бы потерю почти всех политик,
--    то есть именно границы изоляции tenant.
select 'rls.forced_tables|' ||
       case when count(*) = (:'expected_rls_forced')::int then 'ok' else 'fail' end ||
       '|таблиц с FORCE ROW LEVEL SECURITY: ' || count(*) ||
       ', в манифесте источника: ' || (:'expected_rls_forced')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and c.relrowsecurity
  and c.relforcerowsecurity
  and n.nspname in ('core', 'identity', 'platform', 'evaluation');

select 'rls.tenant_policies|' ||
       case when count(*) = (:'expected_policies')::int then 'ok' else 'fail' end ||
       '|политик всего: ' || count(*) ||
       ', в манифесте источника: ' || (:'expected_policies')
from pg_policies;

-- 3a. Мажорная версия сервера восстановления совпадает с источником: дамп
--     custom format восстанавливается и на другой мажорной версии, но поведение
--     и набор системных объектов при этом другие.
select 'server.version_major|' ||
       case when split_part(current_setting('server_version'), '.', 1)
                 = (:'expected_server_major')
            then 'ok' else 'fail' end ||
       '|сервер восстановления: ' || split_part(current_setting('server_version'), '.', 1) ||
       ', источник: ' || (:'expected_server_major');

-- 4. Схема очереди восстановлена и доступна worker.
select 'queue.schema|' ||
       case when has_schema_privilege('context_worker', 'pgboss', 'usage')
            then 'ok' else 'fail' end ||
       '|context_worker имеет доступ к схеме очереди pgboss';

-- 5. Журнал миграций не пуст (полное сравнение делает verify-restore.sh).
select 'migrations.present|' ||
       case when count(*) > 0 then 'ok' else 'fail' end ||
       '|записей в public.schema_migrations: ' || count(*)
from public.schema_migrations;

-- 6. Ограды удаления: у каждого назначения под оградой стоит processing_hold.
select 'fences.hold|' ||
       case when count(*) = 0 then 'ok' else 'fail' end ||
       '|назначений под оградой без processing_hold: ' || count(*)
from fenced_assignments
where processing_hold = false;

-- 7. Ограды удаления: неопубликованных событий outbox по таким назначениям нет.
select 'fences.outbox|' ||
       case when count(*) = 0 then 'ok' else 'fail' end ||
       '|активных событий outbox под оградой: ' || count(*)
from platform.outbox_events e
where e.published_at is null
  and e.retries_stopped_at is null
  and (
    exists (
      select 1 from fenced_assignments f
      where f.organization_id = e.organization_id
        and e.entity_type = 'assignment'
        and e.entity_id = f.assignment_id
    )
    or exists (
      select 1
      from fenced_assignments f
      join core.attempts t
        on t.organization_id = f.organization_id
       and t.assignment_id = f.assignment_id
      where e.entity_type = 'attempt'
        and e.entity_id = t.id
    )
  );

-- 8. Ограды удаления: задания очереди, ждущие обработки, несут устаревшее
--    поколение данных — обработчик их пропустит, а не «доделает» удалённое.
select 'fences.queue_generation|' ||
       case when count(*) = 0 then 'ok' else 'fail' end ||
       '|заданий очереди с действующим поколением под оградой: ' || count(*)
from pgboss.job j
join fenced_assignments f
  on f.assignment_id::text in (j.data ->> 'assignmentId', j.data ->> 'entityId')
-- Незавершённые состояния целиком: задание, взятое в работу в момент снимка
-- (active), pg-boss вернёт в retry по истечении expire_seconds и выполнит.
where j.state not in ('completed', 'cancelled', 'failed')
  and (j.data ->> 'dataGeneration') is not distinct from f.data_generation::text;

-- 9. Нет воскресших данных по исполненным запросам на удаление: если запрос
--    отмечен выполненным, содержания в восстановленной копии быть не должно.
select 'fences.no_resurrection|' ||
       case when count(*) = 0 then 'ok' else 'fail' end ||
       '|исполненных удалений с сохранившимися ответами: ' || count(*)
from platform.privacy_requests pr
join core.answers a
  on a.organization_id = pr.organization_id
 and a.attempt_id in (
   select t.id from core.attempts t
   where t.organization_id = pr.organization_id
     and t.assignment_id = pr.assignment_id
 )
where pr.request_type = 'deletion'
  and pr.state = 'completed';

-- 10. Функциональная проверка RLS: runtime-роль без контекста организации не
--     видит ни одной строки, хотя у владельца строки есть.
--
--     `set role context_api` требует членства в этой роли. Эксплуатационная роль
--     восстановления членом runtime-ролей не является (миграция создаёт их без
--     grant владельцу), и на кластере, где владелец схемы не суперпользователь,
--     весь файл падал бы здесь с «permission denied to set role». Поэтому:
--     есть право сменить роль — идёт функциональная проверка; нет — проверка по
--     каталогу политик, и в подробности пишется, какой из вариантов выполнен.
select (
  pg_has_role(current_user, 'context_api', 'SET')
  and exists (select 1 from core.assignments)
) as can_set_role \gset

\if :can_set_role
begin;
set local role context_api;
-- Для этой проверки политики должны действовать: весь остальной файл идёт с
-- row_security = off, а здесь проверяется именно то, что RLS закрывает данные.
set local row_security = on;
select 'rls.no_context_denies|' ||
       case when count(*) = 0 then 'ok' else 'fail' end ||
       '|строк core.assignments под ролью context_api без контекста: ' || count(*)
from core.assignments;
rollback;
\else
-- Роль проверки не член context_api (или в копии нет ни одного назначения):
-- сменить роль нельзя, проверяем то же по каталогу — на core.assignments
-- включена и принудительна RLS, политика есть, а сама роль RLS не обходит.
select 'rls.no_context_denies|' ||
       case when bool_and(c.relrowsecurity and c.relforcerowsecurity)
                 and (select count(*) from pg_policies
                      where schemaname = 'core' and tablename = 'assignments') > 0
                 and not (select rolbypassrls or rolsuper from pg_roles
                          where rolname = 'context_api')
            then 'ok' else 'fail' end ||
       '|проверено по каталогу (роль ' || current_user ||
       ' не может set role context_api): на core.assignments FORCE RLS и политики есть, context_api RLS не обходит'
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'core' and c.relname = 'assignments';
\endif
