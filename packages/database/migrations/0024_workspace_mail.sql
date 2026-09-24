-- 0024: SMTP и безопасный шаблон приглашения для единственного workspace.

create table platform.workspace_mail_settings (
  organization_id uuid primary key references core.organizations (id) on delete cascade,
  host text not null check (length(host) between 1 and 253),
  port integer not null check (port between 1 and 65535),
  secure boolean not null default true,
  username text check (length(username) <= 320),
  password_encrypted text,
  from_email text not null check (length(from_email) <= 320),
  from_name text not null check (length(from_name) between 1 and 200),
  revision integer not null default 1 check (revision > 0),
  verified_at timestamptz,
  last_test_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger workspace_mail_settings_touch before update on platform.workspace_mail_settings
  for each row execute function app.touch_updated_at();

create table platform.workspace_mail_templates (
  organization_id uuid primary key references core.organizations (id) on delete cascade,
  subject text not null check (length(subject) between 1 and 200),
  greeting text not null check (length(greeting) between 1 and 500),
  body text not null check (length(body) between 1 and 3000),
  button_label text not null check (length(button_label) between 1 and 80),
  signature text not null check (length(signature) between 1 and 500),
  support_contact text check (length(support_contact) <= 320),
  status text not null default 'draft' check (status in ('draft', 'published')),
  revision integer not null default 1 check (revision > 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger workspace_mail_templates_touch before update on platform.workspace_mail_templates
  for each row execute function app.touch_updated_at();

alter table platform.workspace_mail_settings enable row level security;
alter table platform.workspace_mail_settings force row level security;
create policy platform_ops_only on platform.workspace_mail_settings
  using (app.is_platform_ops()) with check (app.is_platform_ops());
alter table platform.workspace_mail_templates enable row level security;
alter table platform.workspace_mail_templates force row level security;
create policy platform_ops_only on platform.workspace_mail_templates
  using (app.is_platform_ops()) with check (app.is_platform_ops());

grant select, insert, update on platform.workspace_mail_settings to context_api;
grant select, insert, update on platform.workspace_mail_templates to context_api;
