-- 0004: назначения, приглашения, участие, попытки и ответы.

create table core.assignment_drafts (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  created_by uuid not null references identity.users (id),
  scenario_version_id uuid references core.scenario_versions (id),
  context_json jsonb not null default '{}'::jsonb,
  employee_ids uuid[] not null default '{}',
  due_days integer,
  step integer not null default 1 check (step between 1 and 4),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create index assignment_drafts_owner_idx
  on core.assignment_drafts (organization_id, created_by, updated_at desc);

create table core.assignments (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete restrict,
  employee_id uuid not null,
  scenario_version_id uuid not null references core.scenario_versions (id) on delete restrict,
  -- Снимок контекста на момент создания. Изменение должности позже его не переписывает.
  context_snapshot jsonb not null default '{}'::jsonb,
  mode text not null default 'demo' check (mode in ('demo', 'research', 'validated_use')),
  state text not null default 'draft'
    check (state in ('draft', 'invited', 'in_progress', 'completed', 'cancelled', 'expired')),
  due_at timestamptz,
  created_by uuid not null references identity.users (id),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (length(cancel_reason) <= 1000),
  replaces_assignment_id uuid references core.assignments (id),
  -- Счётчик поколения данных: старый job не сохранит результат после отзыва или удаления.
  data_generation bigint not null default 1,
  processing_hold boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (organization_id, id),
  -- Композитный FK гарантирует, что сотрудник принадлежит той же организации.
  foreign key (organization_id, employee_id)
    references identity.employees (organization_id, id) on delete restrict
);

create index assignments_state_idx on core.assignments (organization_id, state, due_at);
create index assignments_employee_idx
  on core.assignments (organization_id, employee_id, created_at desc);

create table core.invitations (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  assignment_id uuid not null,
  -- Хранится только SHA-256 токена. Открытый URL выдаётся один раз при выпуске.
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  issued_by uuid not null references identity.users (id),
  last_exchanged_at timestamptz,
  exchange_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, assignment_id)
    references core.assignments (organization_id, id) on delete cascade
);

-- Одновременно действует только одна ссылка на назначение.
create unique index invitations_active_key
  on core.invitations (organization_id, assignment_id)
  where revoked_at is null;

create table core.participant_sessions (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  assignment_id uuid not null,
  invitation_id uuid not null references core.invitations (id) on delete cascade,
  session_hash text not null unique,
  lease_version integer not null default 1,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, assignment_id)
    references core.assignments (organization_id, id) on delete cascade
);

-- Одна активная сессия участника на назначение (ТЗ E03).
create unique index participant_sessions_active_key
  on core.participant_sessions (organization_id, assignment_id)
  where revoked_at is null;

create table core.consent_records (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  assignment_id uuid not null,
  document_version_id uuid not null references core.legal_document_versions (id),
  document_hash core.content_hash not null,
  purpose text not null,
  accepted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  -- Минимально необходимое подтверждение. IP и устройство не сохраняются без основания.
  confirmation_metadata jsonb not null default '{}'::jsonb,
  unique (organization_id, id),
  unique (organization_id, assignment_id, document_version_id),
  foreign key (organization_id, assignment_id)
    references core.assignments (organization_id, id) on delete cascade
);

create table core.participation_declines (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  assignment_id uuid not null,
  declined_at timestamptz not null default now(),
  unique (organization_id, assignment_id),
  foreign key (organization_id, assignment_id)
    references core.assignments (organization_id, id) on delete cascade
);

create table core.attempts (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  assignment_id uuid not null,
  method_version_id uuid not null references core.method_versions (id) on delete restrict,
  order_index integer not null check (order_index >= 0),
  required boolean not null default true,
  state text not null default 'not_started'
    check (state in ('not_started', 'in_progress', 'submitted', 'scored', 'scoring_failed')),
  started_at timestamptz,
  submitted_at timestamptz,
  -- Зафиксированный порядок item ID: номер вопроса не пересчитывается при обновлении страницы.
  question_order_json jsonb not null default '[]'::jsonb,
  active_item_id text,
  revision integer not null default 1,
  session_lease integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, assignment_id, method_version_id),
  unique (organization_id, assignment_id, order_index),
  foreign key (organization_id, assignment_id)
    references core.assignments (organization_id, id) on delete cascade
);

create table core.answers (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  attempt_id uuid not null,
  item_id text not null,
  response_json jsonb not null,
  revision integer not null default 1,
  saved_at timestamptz not null default now(),
  unique (organization_id, attempt_id, item_id),
  foreign key (organization_id, attempt_id)
    references core.attempts (organization_id, id) on delete cascade
);

-- Неизменяемый снимок отправленных ответов.
create table core.submission_snapshots (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  attempt_id uuid not null,
  answers_snapshot_json jsonb not null,
  input_hash core.content_hash not null,
  consent_hash core.content_hash not null,
  submitted_at timestamptz not null default now(),
  unique (organization_id, attempt_id),
  unique (organization_id, id),
  foreign key (organization_id, attempt_id)
    references core.attempts (organization_id, id) on delete cascade
);

create table core.score_results (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  attempt_id uuid not null,
  scorer_version text not null,
  input_hash core.content_hash not null,
  output_schema_version text not null,
  result_json jsonb not null,
  missing_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  -- Пересчёт другим алгоритмом создаёт новую строку, не переписывает историческую.
  unique (organization_id, attempt_id, scorer_version, input_hash),
  foreign key (organization_id, attempt_id)
    references core.attempts (organization_id, id) on delete cascade
);

create trigger assignments_touch before update on core.assignments
  for each row execute function app.touch_updated_at();
create trigger assignment_drafts_touch before update on core.assignment_drafts
  for each row execute function app.touch_updated_at();
create trigger attempts_touch before update on core.attempts
  for each row execute function app.touch_updated_at();
