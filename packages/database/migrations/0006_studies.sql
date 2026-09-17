-- 0006: исследования и отделённые исходы.
-- Исходы живут в схеме evaluation под отдельными credentials: основной конвейер
-- оценки и подготовки заключения к ним доступа не имеет (ТЗ 07.7, 11.4).

create table core.studies (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  title text not null check (length(btrim(title)) between 2 and 200),
  study_type text not null
    check (study_type in ('historical_snapshot', 'prospective', 'retrospective_description')),
  scenario_version_id uuid references core.scenario_versions (id),
  protocol_json jsonb not null default '{}'::jsonb,
  protocol_hash core.content_hash,
  phase text not null default 'draft'
    check (phase in ('draft', 'locked', 'collecting', 'predictions_frozen',
                     'outcomes_open', 'evaluated', 'archived')),
  -- Признак, что предсказательные метрики недоступны: система проверяет процесс,
  -- но не заявляет прогностическую точность (ТЗ 11.2).
  predictive_capability_available boolean not null default false,
  locked_at timestamptz,
  predictions_frozen_at timestamptz,
  roster_hash core.content_hash,
  custodian_user_id uuid references identity.users (id),
  evaluator_user_id uuid references identity.users (id),
  created_by uuid not null references identity.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check (phase = 'draft' or (protocol_hash is not null and locked_at is not null)),
  -- Хранитель исходов и расчётчик не совпадают с одним и тем же человеком.
  check (custodian_user_id is null or evaluator_user_id is null
         or custodian_user_id <> evaluator_user_id)
);

create table core.study_cases (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  study_id uuid not null,
  -- Код случая: в payload AI и в экспорте вместо имени сотрудника.
  case_code text not null check (case_code ~ '^[A-Z0-9-]{3,32}$'),
  assignment_id uuid,
  inclusion_state text not null default 'included'
    check (inclusion_state in ('included', 'excluded', 'withdrawn')),
  exclusion_reason text check (length(exclusion_reason) <= 500),
  evidence_cutoff_at timestamptz,
  follow_up_end_at timestamptz,
  eligibility_attestation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, study_id, case_code),
  foreign key (organization_id, study_id)
    references core.studies (organization_id, id) on delete cascade,
  foreign key (organization_id, assignment_id)
    references core.assignments (organization_id, id) on delete set null,
  check (inclusion_state <> 'excluded' or exclusion_reason is not null)
);

create table core.historical_snapshots (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  case_id uuid not null,
  feature_schema_version text not null,
  observed_at timestamptz not null,
  source_created_at timestamptz,
  imported_at timestamptz not null default now(),
  -- Исход в снимок не принимается: импорт отклоняет outcome-колонки.
  payload jsonb not null,
  content_hash core.content_hash not null,
  source_provenance jsonb not null default '{}'::jsonb,
  unique (organization_id, id),
  foreign key (organization_id, case_id)
    references core.study_cases (organization_id, id) on delete cascade
);

create table core.baseline_predictions (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  case_id uuid not null,
  value_json jsonb not null,
  entered_by uuid not null references identity.users (id),
  -- Базовая оценка фиксируется до просмотра системного прогноза.
  locked_at timestamptz not null default now(),
  content_hash core.content_hash not null,
  unique (organization_id, case_id),
  unique (organization_id, id),
  foreign key (organization_id, case_id)
    references core.study_cases (organization_id, id) on delete cascade
);

create table core.predictions (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  case_id uuid not null,
  target text not null,
  horizon_days integer check (horizon_days > 0),
  output_type text not null
    check (output_type in ('binary', 'categorical', 'continuous', 'abstention')),
  value_json jsonb not null,
  -- Утверждение о возможности прогноза для этой цели, а не догадка модели.
  supported_capability text,
  method_version_id uuid references core.method_versions (id),
  report_revision_id uuid,
  frozen_at timestamptz,
  content_hash core.content_hash,
  created_at timestamptz not null default now(),
  unique (organization_id, case_id, target),
  unique (organization_id, id),
  foreign key (organization_id, case_id)
    references core.study_cases (organization_id, id) on delete cascade,
  foreign key (organization_id, report_revision_id)
    references core.report_revisions (organization_id, id) on delete set null
);

-- ——— Отделённая схема исходов ———

create table evaluation.outcomes (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  case_id uuid not null,
  event_type text not null,
  occurred_at timestamptz,
  observation_end_at timestamptz,
  status text not null check (status in ('observed', 'censored', 'unknown')),
  value_json jsonb not null default '{}'::jsonb,
  source_ref text,
  entered_by uuid not null references identity.users (id),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, case_id, event_type),
  check (status <> 'observed' or occurred_at is not null)
);

create table evaluation.evaluation_runs (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  study_id uuid not null,
  protocol_hash core.content_hash not null,
  predictions_hash core.content_hash not null,
  outcomes_version integer not null,
  metrics_json jsonb not null,
  exclusions_json jsonb not null default '[]'::jsonb,
  evaluator_version text not null,
  computed_at timestamptz not null default now()
);

create index evaluation_runs_study_idx
  on evaluation.evaluation_runs (organization_id, study_id, computed_at desc);

-- Управленческое вмешательство после прогноза: его нельзя молча считать
-- подтверждением или опровержением прогноза (ТЗ 11.6).
create table evaluation.case_interventions (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  case_id uuid not null,
  description text not null check (length(btrim(description)) between 5 and 2000),
  occurred_at timestamptz not null,
  entered_by uuid not null references identity.users (id),
  created_at timestamptz not null default now()
);

create trigger studies_touch before update on core.studies
  for each row execute function app.touch_updated_at();
create trigger study_cases_touch before update on core.study_cases
  for each row execute function app.touch_updated_at();
create trigger outcomes_touch before update on evaluation.outcomes
  for each row execute function app.touch_updated_at();
