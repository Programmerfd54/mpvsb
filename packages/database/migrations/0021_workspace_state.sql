-- 0021: явное основное пространство установки.
-- В demo может существовать второй tenant для теста изоляции, поэтому порядок строк
-- organizations не используется как бизнес-правило.

create table platform.workspace_state (
  singleton boolean primary key default true check (singleton),
  organization_id uuid not null unique references core.organizations (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workspace_state_touch before update on platform.workspace_state
  for each row execute function app.touch_updated_at();

alter table platform.workspace_state enable row level security;
alter table platform.workspace_state force row level security;
create policy platform_ops_only on platform.workspace_state
  using (app.is_platform_ops())
  with check (app.is_platform_ops());

grant select, insert, update on platform.workspace_state to context_api;

-- Существующая demo-база получает основной tenant явно; для старой одиночной
-- установки используется её единственная организация.
insert into platform.workspace_state (singleton, organization_id)
select true, id
from core.organizations
order by (code = 'demo_alpha') desc, created_at asc
limit 1
on conflict (singleton) do nothing;
