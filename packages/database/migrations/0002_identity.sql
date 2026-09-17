-- 0002: организации, доступы, учётные записи, сессии и сотрудники.

create table core.organizations (
  id uuid primary key default uuidv7(),
  name text not null check (length(btrim(name)) between 2 and 200),
  code core.stable_code not null unique,
  timezone core.iana_timezone not null default 'Europe/Moscow',
  mode text not null default 'demo' check (mode in ('demo', 'research', 'validated_use')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  -- Контакт, который видит участник. Не персональные данные конкретного менеджера.
  participant_contact text check (length(participant_contact) <= 300),
  active_employee_limit integer not null default 500 check (active_employee_limit between 1 and 5000),
  retention_policy_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);

comment on table core.organizations is 'Изолированный tenant. Режим определяет допустимость реальных участников.';

create table identity.users (
  id uuid primary key default uuidv7(),
  email_normalized text not null unique check (email_normalized = lower(btrim(email_normalized))),
  email_display text not null,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  password_hash text,
  platform_role text check (platform_role in ('platform_admin')),
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  mfa_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table identity.users is
  'Учётные записи руководителей и администраторов. Ответы сотрудников здесь не хранятся.';

create table core.memberships (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete restrict,
  user_id uuid not null references identity.users (id) on delete restrict,
  role text not null default 'manager' check (role in ('manager')),
  -- Allowlist проверяется приложением по @context/domain.ORG_PERMISSIONS.
  permissions text[] not null default '{}',
  status text not null default 'invited' check (status in ('invited', 'active', 'revoked')),
  invited_by uuid references identity.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, id)
);

create index memberships_user_idx on core.memberships (user_id, status);

create table identity.account_tokens (
  id uuid primary key default uuidv7(),
  user_id uuid references identity.users (id) on delete cascade,
  membership_id uuid references core.memberships (id) on delete cascade,
  purpose text not null check (purpose in ('activation', 'password_reset')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  -- Токен в открытом виде не хранится ни здесь, ни в журналах.
  check (user_id is not null or membership_id is not null)
);

create index account_tokens_user_idx on identity.account_tokens (user_id, purpose);

create table identity.recovery_requests (
  id uuid primary key default uuidv7(),
  -- Ссылка на аккаунт опциональна: публичный ответ не раскрывает существование учётной записи.
  user_id uuid references identity.users (id) on delete set null,
  submitted_reference text not null,
  state text not null default 'received'
    check (state in ('received', 'verified', 'link_issued', 'rejected')),
  verified_by uuid references identity.users (id),
  verified_at timestamptz,
  resolution_ref uuid references identity.account_tokens (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table identity.user_sessions (
  id uuid primary key default uuidv7(),
  session_hash text not null unique,
  user_id uuid not null references identity.users (id) on delete cascade,
  actor_type text not null check (actor_type in ('manager', 'platform_admin')),
  -- Минимальные технические подсказки, без подробного отпечатка устройства.
  device_hint text check (length(device_hint) <= 120),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  check (absolute_expires_at > created_at)
);

create index user_sessions_user_idx on identity.user_sessions (user_id, revoked_at);

create table identity.mfa_credentials (
  user_id uuid primary key references identity.users (id) on delete cascade,
  encrypted_totp_secret text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table identity.mfa_recovery_codes (
  id uuid primary key default uuidv7(),
  user_id uuid not null references identity.users (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);

-- Временный целевой доступ администратора к содержанию организации (ТЗ A03).
create table core.access_grants (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  grantee_user_id uuid not null references identity.users (id) on delete cascade,
  purpose text not null check (purpose in ('report_review', 'incident_support', 'data_request')),
  resource_scope jsonb not null default '{}'::jsonb,
  permissions text[] not null default '{}',
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  state text not null default 'requested'
    check (state in ('requested', 'approved', 'rejected', 'revoked', 'expired')),
  requested_by uuid not null references identity.users (id),
  requested_at timestamptz not null default now(),
  approved_by uuid references identity.users (id),
  approved_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  decision_note text check (length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  -- Одобрение не может выдать себе сам запрашивающий (ТЗ M13).
  check (approved_by is null or approved_by <> requested_by),
  check (state <> 'approved' or (approved_by is not null and expires_at is not null))
);

create index access_grants_active_idx
  on core.access_grants (organization_id, grantee_user_id, state, expires_at);

create table identity.employees (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete restrict,
  display_name text check (length(btrim(display_name)) between 1 and 200),
  external_code text check (length(btrim(external_code)) between 1 and 64),
  job_title text check (length(job_title) <= 120),
  department text check (length(department) <= 120),
  email text check (length(email) <= 320),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  -- Обязательно хотя бы одно из: имя или внутренний код.
  check (display_name is not null or external_code is not null),
  unique (organization_id, id)
);

-- Внутренний код уникален в организации, если задан. Однофамильцы допустимы.
create unique index employees_external_code_key
  on identity.employees (organization_id, external_code)
  where external_code is not null;

create index employees_active_idx on identity.employees (organization_id, archived_at, id);

create trigger organizations_touch before update on core.organizations
  for each row execute function app.touch_updated_at();
create trigger users_touch before update on identity.users
  for each row execute function app.touch_updated_at();
create trigger memberships_touch before update on core.memberships
  for each row execute function app.touch_updated_at();
create trigger employees_touch before update on identity.employees
  for each row execute function app.touch_updated_at();
create trigger access_grants_touch before update on core.access_grants
  for each row execute function app.touch_updated_at();
create trigger recovery_requests_touch before update on identity.recovery_requests
  for each row execute function app.touch_updated_at();
