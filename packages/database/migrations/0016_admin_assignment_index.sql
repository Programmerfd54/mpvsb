-- 0016: узкий резолвер перечня назначений для администратора платформы.
--
-- Проблема: чтобы попросить доступ, администратор обязан перечислить назначения
-- в объёме обращения — а `core.assignments` закрыта строгой tenant-политикой,
-- в которую эксплуатационный режим администратора намеренно не входит (0008).
-- Открывать этот перечень установкой app.organization_id из пути нельзя: в такой
-- транзакции вместе с назначениями открылись бы ответы, evidence и заключения,
-- а границей служил бы только код (ТЗ 10.4, A03).
--
-- Решение то же, что в 0009 и 0012: SECURITY DEFINER резолвер с жёстко
-- зафиксированным списком колонок. Он отдаёт ровно то, из чего составляется
-- объём — идентификатор назначения, сценарий и дату — и физически не может
-- вернуть ни имени сотрудника, ни external_code, ни состояния назначения,
-- ни признаков заключения. Границу держит база, а не тело callback.
--
-- Признак app.is_platform_ops() требуется дополнительно: резолвер вызывается
-- только из эксплуатационной транзакции администратора. Сам по себе признак —
-- не рубеж (его выставляет тот же API-роль), рубеж здесь — список колонок.

create or replace function app.resolve_org_assignment_index(
  p_organization_id uuid,
  p_scenario_code text,
  p_limit integer,
  p_offset integer
)
  returns table (
    assignment_id uuid,
    scenario_title text,
    scenario_code text,
    created_at timestamptz,
    total_count bigint
  )
  language sql
  stable
  security definer
  set search_path = pg_catalog, core, public
  as $$
    with scoped as (
      select a.id, a.created_at, s.title, s.stable_code::text as stable_code
      from core.assignments a
      join core.scenario_versions v on v.id = a.scenario_version_id
      join core.scenarios s on s.id = v.scenario_id
      where app.is_platform_ops()
        and a.organization_id = p_organization_id
        and (p_scenario_code is null or s.stable_code::text = p_scenario_code)
    )
    -- Полное число строк считается окном до среза страницы: молча обрезанный
    -- перечень неотличим от пустого.
    select id, title, stable_code, created_at, count(*) over ()
    from scoped
    order by created_at desc, id desc
    limit greatest(least(coalesce(p_limit, 20), 100), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  $$;

comment on function app.resolve_org_assignment_index(uuid, text, integer, integer) is
  'Перечень назначений организации для составления объёма обращения за доступом. Ни имени сотрудника, ни состояния назначения, ни заключения не возвращает.';

-- Проверка объёма обращения одним обращением к базе и на одном снимке данных:
-- поштучная проверка давала бы до 20 round-trip и расходящийся список.
create or replace function app.resolve_org_assignment_ids(
  p_organization_id uuid,
  p_assignment_ids uuid[]
)
  returns table (assignment_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, core, public
  as $$
    select a.id
    from core.assignments a
    where app.is_platform_ops()
      and a.organization_id = p_organization_id
      and a.id = any(p_assignment_ids)
  $$;

comment on function app.resolve_org_assignment_ids(uuid, uuid[]) is
  'Какие из перечисленных назначений существуют в этой организации. Ничего, кроме идентификаторов, не возвращает.';

revoke all on function
  app.resolve_org_assignment_index(uuid, text, integer, integer),
  app.resolve_org_assignment_ids(uuid, uuid[])
  from public;

grant execute on function
  app.resolve_org_assignment_index(uuid, text, integer, integer),
  app.resolve_org_assignment_ids(uuid, uuid[])
  to context_api;

-- Worker и evaluator этих резолверов не получают: перечень назначений нужен
-- только администратору платформы при составлении обращения.
