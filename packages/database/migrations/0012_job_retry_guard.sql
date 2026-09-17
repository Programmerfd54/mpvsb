-- 0012: резолвер условий повтора фонового задания.
--
-- Экран обработки обязан отказать в повторе, если назначение отменено, участник
-- отозвал согласие или поколение данных изменилось (ТЗ A09, 10.8). Проверять это
-- нужно по таблицам назначения, а они закрыты строгой tenant-политикой, в которую
-- эксплуатационный режим администратора намеренно не входит.
--
-- Поэтому здесь узкий SECURITY DEFINER резолвер: он принимает уже известную
-- администратору строку очереди и возвращает только признаки состояния.
-- Ни ответов, ни контекста решения, ни сведений о человеке он не отдаёт.

create or replace function app.resolve_job_target(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
  returns table (
    assignment_id uuid,
    assignment_state text,
    processing_hold boolean,
    data_generation bigint,
    consent_active boolean,
    declined boolean
  )
  language sql
  stable
  security definer
  set search_path = pg_catalog, core, public
  as $$
    with target as (
      select case
               when p_entity_type = 'assignment' then p_entity_id
               when p_entity_type = 'attempt' then (
                 select a.assignment_id
                 from core.attempts a
                 where a.id = p_entity_id and a.organization_id = p_organization_id
               )
             end as assignment_id
    )
    select
      s.id,
      s.state,
      s.processing_hold,
      s.data_generation,
      exists (
        select 1 from core.consent_records c
        where c.organization_id = s.organization_id
          and c.assignment_id = s.id
          and c.withdrawn_at is null
      ),
      exists (
        select 1 from core.participation_declines d
        where d.organization_id = s.organization_id
          and d.assignment_id = s.id
      )
    from target t
    join core.assignments s
      on s.id = t.assignment_id and s.organization_id = p_organization_id
  $$;

comment on function app.resolve_job_target(uuid, text, uuid) is
  'Признаки состояния назначения для решения о повторе задания. Содержания не возвращает.';

revoke all on function app.resolve_job_target(uuid, text, uuid) from public;
grant execute on function app.resolve_job_target(uuid, text, uuid) to context_api;

-- Worker резолвер не получает: его ограды проверяются внутри самого задания
-- в tenant-контексте организации.
