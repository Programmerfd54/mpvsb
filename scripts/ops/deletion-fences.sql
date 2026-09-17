-- Ограды удаления для восстановленной базы (ТЗ 10.8 п. 6).
--
-- Восстановленная копия содержит данные на момент снимка. Всё, что было удалено
-- или отозвано позже, в ней «живо». Открывать такую базу пользователям и фоновой
-- обработке нельзя, пока не применены ограды:
--
--   1. назначения с незавершённым удалением или отозванным согласием ставятся на
--      processing_hold;
--   2. у тех из них, по которым в копии остались «живые» задания очереди или
--      неостановленные события outbox, поднимается поколение данных
--      (data_generation + 1) — такое задание обработчик пропустит;
--      «живое» задание — это ЛЮБОЕ незавершённое состояние pg-boss, включая
--      active: задание, взятое в работу в момент снимка, после восстановления
--      вернётся в retry по истечении expire_seconds и будет выполнено;
--   3. ссылки участников и сессии по ним отзываются;
--   4. неопубликованные события outbox для этих назначений останавливаются.
--
-- Скрипт идемпотентен: повторный запуск не меняет данные и не пишет аудит,
-- потому что после первого прогона совпадений по поколению и незакрытых
-- событий outbox уже нет.
--
-- ТРЕБОВАНИЕ К РОЛИ: только роль с BYPASSRLS (эксплуатационная роль
-- восстановления). На таблицах включён FORCE ROW LEVEL SECURITY, поэтому под
-- обычным владельцем схемы политики скрыли бы строки и ограды применились бы к
-- пустому набору — скрипт «прошёл» бы, не сделав ничего. Роль миграций для
-- этого не подходит: ей BYPASSRLS в production запрещён (см. RUNBOOK § 6.0).
--
-- Запуск (psql, одна транзакция):
--   psql -v ON_ERROR_STOP=1 -v fence_ids='{}' -f scripts/ops/deletion-fences.sql
--
-- fence_ids — журнал удалений, выполненных ПОСЛЕ снимка. Их следов в копии нет,
-- поэтому список идентификаторов назначений приходит извне копии, из журнала
-- исполненных запросов по данным: -v fence_ids='{uuid,uuid}'. Пустое значение
-- '{}' означает «внешнего журнала нет»; тогда оградами закрываются только
-- незавершённые запросы, видимые в самой копии.

\set ON_ERROR_STOP on

-- Барьер 1: под ролью без BYPASSRLS любой запрос к таблице с политиками упадёт
-- с явной ошибкой, а не вернёт молча ноль строк.
set row_security = off;

-- Барьер 2: понятное объяснение до того, как PostgreSQL сообщит о политике.
do $$
begin
  if not exists (
    select 1 from pg_roles
    where rolname = current_user and (rolbypassrls or rolsuper)
  ) then
    raise exception using
      message = 'Ограды удаления требуют роли с BYPASSRLS.',
      detail = format(
        'Роль %I политики RLS не обходит: под ней ограды применились бы к пустому набору строк и завершились бы «успешно», ничего не оградив.',
        current_user),
      hint = 'Запустите скрипт эксплуатационной ролью восстановления (BYPASSRLS, см. RUNBOOK § 6.0). Роль миграций для этого не подходит: ей BYPASSRLS в production запрещён.';
  end if;
end
$$;

begin;

-- Назначения под оградой: внешний журнал + незавершённые запросы по данным +
-- незавершённые задания удаления (в том числе упавшие) + отозванное согласие.
create temporary table fenced_assignments on commit drop as
with journal as (
  select unnest((:'fence_ids')::uuid[]) as assignment_id
),
requests as (
  select pr.id, pr.organization_id, pr.assignment_id, pr.employee_id
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
-- Отзыв согласия платформа хранит отдельно от privacy_requests (core.consent_records).
-- Runbook описывает ограду как «удаление ИЛИ отзыв согласия», поэтому он тоже здесь.
withdrawals as (
  select c.organization_id, c.assignment_id, null::uuid as employee_id
  from core.consent_records c
  where c.withdrawn_at is not null
),
scoped as (
  select organization_id, assignment_id, employee_id from requests
  union all
  select organization_id, assignment_id, employee_id from jobs
  union all
  select organization_id, assignment_id, employee_id from withdrawals
)
select distinct a.organization_id, a.id as assignment_id
from core.assignments a
where a.id in (select assignment_id from journal)
   or exists (
        select 1 from scoped s
        where s.organization_id = a.organization_id
          and (s.assignment_id = a.id or s.employee_id = a.employee_id)
      );

-- Журнал фактических изменений: нужен, чтобы повторный прогон не дописывал аудит.
create temporary table fence_changes (
  step text not null,
  organization_id uuid not null
) on commit drop;

\echo 'Назначений под оградой:'
select count(*) as fenced_assignments from fenced_assignments;

-- 1. Приостановка обработки.
with updated as (
  update core.assignments a
     set processing_hold = true
    from fenced_assignments f
   where a.organization_id = f.organization_id
     and a.id = f.assignment_id
     and a.processing_hold = false
  returning a.organization_id
)
insert into fence_changes (step, organization_id)
select 'held_assignments', organization_id from updated;

-- 2. Новое поколение данных — по факту наличия «живой» работы, а НЕ по признаку
--    processing_hold. Назначение, стоявшее на hold уже в момент снимка (именно так
--    его помечает приём запроса на удаление), иначе сохранило бы действующее
--    поколение: задание очереди прошло бы сверку и выполнилось по восстановленным
--    данным, как только hold снимут. Идемпотентность держится на том, что после
--    бампа совпадений по поколению нет.
with updated as (
  update core.assignments a
     set data_generation = a.data_generation + 1
    from fenced_assignments f
   where a.organization_id = f.organization_id
     and a.id = f.assignment_id
     and (
       exists (
         select 1
         from pgboss.job j
         -- Незавершённые состояния целиком, а не только created/retry. Задание в
         -- состоянии active — самое вероятное в момент аварии: pg-boss вернёт
         -- просроченное active в retry (expire_seconds, по умолчанию 900 с) и
         -- обработчик получит его с совпадающим dataGeneration. Перечислены
         -- ЗАВЕРШЁННЫЕ состояния, чтобы новое состояние pg-boss не выпало из ограды.
         where j.state not in ('completed', 'cancelled', 'failed')
           and (j.data ->> 'dataGeneration') is not distinct from a.data_generation::text
           and a.id::text in (j.data ->> 'assignmentId', j.data ->> 'entityId')
       )
       or exists (
         select 1
         from platform.outbox_events e
         where e.published_at is null
           and e.retries_stopped_at is null
           and e.organization_id = a.organization_id
           and e.data_generation = a.data_generation
           and (
             (e.entity_type = 'assignment' and e.entity_id = a.id)
             or (e.entity_type = 'attempt' and e.entity_id in (
                   select t.id
                   from core.attempts t
                   where t.organization_id = a.organization_id
                     and t.assignment_id = a.id))
           )
       )
     )
  returning a.organization_id
)
insert into fence_changes (step, organization_id)
select 'regenerated_assignments', organization_id from updated;

-- 3. Отзыв ссылок участников и активных сессий по ним.
with updated as (
  update core.invitations i
     set revoked_at = now()
    from fenced_assignments f
   where i.organization_id = f.organization_id
     and i.assignment_id = f.assignment_id
     and i.revoked_at is null
  returning i.organization_id
)
insert into fence_changes (step, organization_id)
select 'revoked_invitations', organization_id from updated;

with updated as (
  update core.participant_sessions s
     set revoked_at = now()
    from fenced_assignments f
   where s.organization_id = f.organization_id
     and s.assignment_id = f.assignment_id
     and s.revoked_at is null
  returning s.organization_id
)
insert into fence_changes (step, organization_id)
select 'revoked_sessions', organization_id from updated;

-- 4. Остановка неопубликованных событий outbox по этим назначениям
--    (событие может ссылаться и на попытку — она принадлежит назначению).
with updated as (
  update platform.outbox_events e
     set retries_stopped_at = now()
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
     )
  returning e.organization_id
)
insert into fence_changes (step, organization_id)
select 'stopped_outbox_events', organization_id from updated;

\echo 'Изменения оград:'
select step, count(*) as rows_changed
from fence_changes
group by step
order by step;

-- 5. Запись в журнал аудита: восстановление — событие эксплуатации, а не «ничего
--    не произошло». Содержания удаляемых данных в метаданных нет. Если ограды
--    ничего не изменили (повторный прогон), записи не будет: иначе «идемпотентно»
--    было бы неправдой.
insert into platform.audit_events
  (actor_type, organization_id, action, resource_type, outcome, purpose, metadata)
select 'service',
       f.organization_id,
       'restore.deletion_fences_applied',
       'assignment',
       'success',
       'backup_restore',
       jsonb_build_object('fenced_assignments', count(*))
from fenced_assignments f
where exists (
  select 1 from fence_changes c where c.organization_id = f.organization_id
)
group by f.organization_id;

commit;
