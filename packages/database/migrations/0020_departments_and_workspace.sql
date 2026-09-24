-- 0020: пространство организации, подразделения и неизменяемые снимки назначения.

alter table core.organizations
  add column logo_url text,
  add column setup_completed_at timestamptz,
  add constraint organizations_logo_url_length check (logo_url is null or length(logo_url) <= 500);

create table core.departments (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'archived')),
  archived_at timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index departments_name_key
  on core.departments (organization_id, lower(btrim(name)));
create index departments_status_idx on core.departments (organization_id, status, name);

create table core.department_managers (
  id uuid primary key default uuidv7(),
  organization_id uuid not null,
  department_id uuid not null,
  user_id uuid not null references identity.users (id) on delete restrict,
  assigned_by uuid references identity.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, department_id)
    references core.departments (organization_id, id) on delete cascade
);

create unique index department_managers_active_key
  on core.department_managers (organization_id, department_id, user_id)
  where revoked_at is null;
create index department_managers_user_idx
  on core.department_managers (organization_id, user_id, revoked_at);

alter table identity.employees
  add column department_id uuid,
  add column user_id uuid references identity.users (id) on delete set null,
  add constraint employees_department_fk
    foreign key (organization_id, department_id)
    references core.departments (organization_id, id) on delete restrict;

create unique index employees_user_key
  on identity.employees (organization_id, user_id)
  where user_id is not null;
create index employees_department_idx
  on identity.employees (organization_id, department_id, archived_at);

-- Каждое уникальное старое название становится подразделением. Сама строка остаётся
-- в employees до завершения перехода сервисов, поэтому исходное значение не теряется.
insert into core.departments (organization_id, name)
select organization_id, min(btrim(department))
from identity.employees
where department is not null and btrim(department) <> ''
group by organization_id, lower(btrim(department));

update identity.employees e
set department_id = d.id
from core.departments d
where d.organization_id = e.organization_id
  and lower(btrim(d.name)) = lower(btrim(e.department));

create table identity.employee_department_history (
  id uuid primary key default uuidv7(),
  organization_id uuid not null,
  employee_id uuid not null,
  from_department_id uuid,
  to_department_id uuid,
  effective_at timestamptz not null default now(),
  transferred_by uuid references identity.users (id) on delete set null,
  reason text check (reason is null or length(reason) <= 1000),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, employee_id)
    references identity.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, from_department_id)
    references core.departments (organization_id, id) on delete restrict,
  foreign key (organization_id, to_department_id)
    references core.departments (organization_id, id) on delete restrict,
  check (from_department_id is not null or to_department_id is not null)
);

create index employee_department_history_employee_idx
  on identity.employee_department_history (organization_id, employee_id, effective_at desc);

insert into identity.employee_department_history (
  organization_id, employee_id, to_department_id, effective_at, reason
)
select organization_id, id, department_id, created_at, 'Перенос из строкового поля при миграции'
from identity.employees
where department_id is not null;

alter table core.assignments
  add column department_id_snapshot uuid,
  add column responsible_manager_id_snapshot uuid references identity.users (id) on delete set null,
  add constraint assignments_department_snapshot_fk
    foreign key (organization_id, department_id_snapshot)
    references core.departments (organization_id, id) on delete restrict;

update core.assignments a
set department_id_snapshot = e.department_id
from identity.employees e
where e.organization_id = a.organization_id and e.id = a.employee_id;

create trigger departments_touch before update on core.departments
  for each row execute function app.touch_updated_at();

do $$
declare
  t text;
  tables text[] := array[
    'core.departments',
    'core.department_managers',
    'identity.employee_department_history'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
    execute format(
      'create policy tenant_or_ops on %s
         using (organization_id = app.current_organization_id() or app.is_platform_ops())
         with check (organization_id = app.current_organization_id() or app.is_platform_ops())', t);
  end loop;
end
$$;

grant select, insert, update, delete on
  core.departments, core.department_managers, identity.employee_department_history
  to context_api;

comment on column identity.employees.department is
  'Устаревшее исходное название подразделения. До завершения перехода сохраняется для сверки; новые права используют department_id.';
comment on column core.assignments.department_id_snapshot is
  'Подразделение сотрудника на момент назначения; последующий перевод историю не меняет.';
