-- Учебная проверка оград удаления на ВОССТАНОВЛЕННОЙ копии.
--
-- Проверка «ограды применились» бессмысленна, если в копии нет ни одного
-- незавершённого удаления: тогда она проходит пустой. Этот скрипт создаёт
-- синтетическую ситуацию удаления прямо в копии, чтобы ограды было что держать:
--
--   • запрос на удаление (privacy_requests) в состоянии approved;
--   • задание удаления (deletion_jobs) в состоянии queued;
--   • неопубликованное событие outbox по тому же назначению;
--   • задание очереди pg-boss с ДЕЙСТВУЮЩИМ поколением данных (в состоянии
--     created или active — см. ниже).
--
-- Ситуация создаётся для ТРЁХ назначений:
--   A — обработка не приостановлена, задание очереди в состоянии created
--       (обычный случай);
--   B — processing_hold стоял уже в момент снимка (именно так помечает назначение
--       приём запроса на удаление). Поколение B тоже обязано подняться: иначе
--       задание очереди переживёт восстановление и выполнится по восстановленным
--       данным, как только hold снимут;
--   C — задание очереди в состоянии active: именно так выглядит задание, ВЗЯТОЕ в
--       работу в момент аварии, из-за которой делают восстановление. pg-boss
--       вернёт просроченное active в retry (expire_seconds, по умолчанию 900 с) и
--       обработчик получит его с совпадающим dataGeneration, если ограда
--       смотрела только на created/retry.
--
-- После этого scripts/ops/verify-restore.sh обязан сообщить об ошибке, а после
-- scripts/ops/deletion-fences.sql — пройти. Так видно, что проверка не пустая.
--
-- ВНИМАНИЕ: скрипт ИЗМЕНЯЕТ базу. Запускать только на временной восстановленной
-- копии, никогда — на рабочей базе и на базе разработки.
--
-- Требование к роли то же, что у оград: BYPASSRLS (см. RUNBOOK § 6.0). Под ролью
-- без него политики скрыли бы строки и учебная ситуация не создалась бы.
--
--   psql -v ON_ERROR_STOP=1 -f scripts/ops/fence-drill.sql

\set ON_ERROR_STOP on

set row_security = off;

do $$
begin
  if not exists (
    select 1 from pg_roles
    where rolname = current_user and (rolbypassrls or rolsuper)
  ) then
    raise exception using
      message = 'Учебная проверка оград требует роли с BYPASSRLS.',
      detail = format('Роль %I политики RLS не обходит: учебная ситуация не была бы ни создана, ни видна.', current_user),
      hint = 'Запустите скрипт эксплуатационной ролью восстановления (BYPASSRLS, см. RUNBOOK § 6.0).';
  end if;
end
$$;

begin;

-- Назначения с ответами: на них видно и остановку обработки, и отзыв ссылки.
create temporary table drill_targets on commit drop as
with candidates as (
  select a.id as assignment_id, a.organization_id, a.employee_id, a.data_generation,
         row_number() over (order by a.id) as rn
  from core.assignments a
  join core.attempts t on t.organization_id = a.organization_id and t.assignment_id = a.id
  join core.answers ans on ans.organization_id = a.organization_id and ans.attempt_id = t.id
  where a.processing_hold = false
  group by a.id, a.organization_id, a.employee_id, a.data_generation
)
select assignment_id, organization_id, employee_id, data_generation,
       (rn = 2) as pre_held,
       case when rn = 3 then 'active' else 'created' end as job_state
from candidates
where rn <= 3;

do $$
begin
  if (select count(*) from drill_targets) < 3 then
    raise exception 'В копии меньше трёх назначений с ответами: учебную проверку проводить не на чем.';
  end if;
end
$$;

-- Назначение B уже стоит на hold: так выглядит принятый запрос на удаление в
-- момент снимка. Ограда обязана поднять ему поколение, хотя hold уже выставлен.
update core.assignments a
   set processing_hold = true
  from drill_targets d
 where d.pre_held
   and a.organization_id = d.organization_id
   and a.id = d.assignment_id;

with request as (
  insert into platform.privacy_requests
    (organization_id, subject_type, assignment_id, employee_id, request_type,
     description, state, receipt_code, approved_at)
  select d.organization_id, 'participant', d.assignment_id, d.employee_id, 'deletion',
         'Учебная проверка восстановления. Синтетический запрос.',
         'approved', 'DRILL-' || substr(md5(random()::text), 1, 12), now()
  from drill_targets d
  returning id, organization_id, assignment_id
)
insert into platform.deletion_jobs
  (organization_id, privacy_request_id, scope_json, data_generation, state)
select r.organization_id, r.id,
       jsonb_build_object('assignment_id', r.assignment_id, 'drill', true),
       d.data_generation, 'queued'
from request r
join drill_targets d on d.assignment_id = r.assignment_id;

-- Неопубликованные события: после ограды они не должны оставаться активными.
insert into platform.outbox_events
  (event_type, organization_id, entity_type, entity_id, payload, data_generation)
select 'report.generation_requested', d.organization_id, 'assignment', d.assignment_id,
       jsonb_build_object('drill', true), d.data_generation
from drill_targets d;

-- Задания очереди с действующим поколением: после ограды поколение назначения
-- станет другим, и обработчик такое задание пропустит. Одно из заданий — в
-- состоянии active (взято в работу в момент снимка): pg-boss вернёт его в retry
-- после expire_seconds, поэтому ограда обязана поднять поколение и ему.
insert into pgboss.job (name, data, state, started_on)
select 'generate-report',
       jsonb_build_object(
         'entityId', d.assignment_id,
         'assignmentId', d.assignment_id,
         'organizationId', d.organization_id,
         'dataGeneration', d.data_generation::text,
         'drill', true),
       d.job_state::pgboss.job_state,
       case when d.job_state = 'active' then now() end
from drill_targets d;

select 'Учебная ситуация создана: назначение ' || assignment_id ||
       ' (задание очереди: ' || job_state ||
       case when pre_held then ', processing_hold стоял до ограды' else ', обработка не приостановлена' end ||
       ')' as drill_target
from drill_targets
order by assignment_id;

commit;
