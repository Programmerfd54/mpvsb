-- 0023: отдельный тип сессии для кабинета сотрудника.

alter table identity.user_sessions
  drop constraint user_sessions_actor_type_check;

alter table identity.user_sessions
  add constraint user_sessions_actor_type_check
  check (actor_type in ('manager', 'platform_admin', 'employee'));

create or replace function app.resolve_employee_account(p_user_id uuid)
  returns table (
    employee_id uuid,
    organization_id uuid,
    department_id uuid
  )
  language sql
  stable
  security definer
  set search_path = pg_catalog, identity, core, public
  as $$
    select e.id, e.organization_id, e.department_id
    from identity.employees e
    join core.organizations o on o.id = e.organization_id
    where e.user_id = p_user_id
      and e.archived_at is null
      and o.status = 'active'
    order by e.created_at
    limit 1
  $$;

comment on function app.resolve_employee_account(uuid) is
  'Минимальный контекст активного сотрудника по user_id проверенной сессии.';

revoke all on function app.resolve_employee_account(uuid) from public;
grant execute on function app.resolve_employee_account(uuid) to context_api;
