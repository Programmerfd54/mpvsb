-- 0007: служебные таблицы — outbox, идемпотентность, аудит, запросы по данным, готовность.

create table platform.outbox_events (
  id uuid primary key default uuidv7(),
  event_type text not null,
  organization_id uuid references core.organizations (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  -- В payload только идентификаторы и безопасные технические параметры.
  payload jsonb not null default '{}'::jsonb,
  data_generation bigint not null default 1,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  attempts integer not null default 0,
  last_error_code text
);

create index outbox_pending_idx on platform.outbox_events (published_at, created_at)
  where published_at is null;

create table platform.idempotency_records (
  id uuid primary key default uuidv7(),
  actor_scope text not null,
  route text not null,
  idempotency_key text not null,
  request_hash core.content_hash not null,
  state text not null default 'in_progress'
    check (state in ('in_progress', 'succeeded', 'failed')),
  -- Ссылка на созданный ресурс. Открытый URL приглашения здесь не хранится.
  response_reference jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (actor_scope, route, idempotency_key)
);

create index idempotency_expiry_idx on platform.idempotency_records (expires_at);

create table platform.audit_events (
  id uuid primary key default uuidv7(),
  occurred_at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('manager', 'platform_admin', 'participant', 'service')),
  actor_id uuid,
  organization_id uuid references core.organizations (id) on delete set null,
  action text not null,
  resource_type text,
  resource_id uuid,
  outcome text not null check (outcome in ('success', 'denied', 'failed')),
  request_id text,
  purpose text,
  -- Только allowlisted метаданные. Ответы, токены, тексты заключений запрещены.
  metadata jsonb not null default '{}'::jsonb
);

create index audit_events_lookup_idx
  on platform.audit_events (organization_id, occurred_at desc, action);
create index audit_events_actor_idx on platform.audit_events (actor_id, occurred_at desc);

create table platform.privacy_requests (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  subject_type text not null check (subject_type in ('participant', 'employee')),
  assignment_id uuid,
  employee_id uuid,
  request_type text not null
    check (request_type in ('correction', 'access', 'withdrawal', 'deletion')),
  description text check (length(description) <= 2000),
  state text not null default 'received'
    check (state in ('received', 'verifying', 'approved', 'rejected',
                     'executing', 'completed', 'failed')),
  receipt_code text not null unique,
  requested_at timestamptz not null default now(),
  approved_by uuid references identity.users (id),
  approved_at timestamptz,
  completed_at timestamptz,
  rejection_reason text check (length(rejection_reason) <= 1000),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table platform.deletion_jobs (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  privacy_request_id uuid not null references platform.privacy_requests (id) on delete cascade,
  scope_json jsonb not null,
  -- Поколение данных на момент запуска: старый worker не воскресит удалённое.
  data_generation bigint not null,
  state text not null default 'queued'
    check (state in ('queued', 'running', 'completed', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  -- Счётчики удалённых записей по видам. Удаляемый текст здесь не сохраняется.
  receipt_json jsonb not null default '{}'::jsonb,
  last_error_code text,
  created_at timestamptz not null default now()
);

create table platform.readiness_checks (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  check_key text not null,
  state text not null default 'pending'
    check (state in ('pending', 'verified', 'not_applicable')),
  verified_by uuid references identity.users (id),
  verified_at timestamptz,
  -- Ссылка на подтверждение вне публичного репозитория, если документ чувствителен.
  evidence_ref text check (length(evidence_ref) <= 500),
  expires_at timestamptz,
  note text check (length(note) <= 1000),
  updated_at timestamptz not null default now(),
  unique (organization_id, check_key),
  check (state <> 'verified' or (verified_by is not null and verified_at is not null))
);

create trigger privacy_requests_touch before update on platform.privacy_requests
  for each row execute function app.touch_updated_at();
create trigger readiness_checks_touch before update on platform.readiness_checks
  for each row execute function app.touch_updated_at();
