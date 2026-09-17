-- 0005: свидетельства, заключения, рецензии и управленческие записи.

create table core.evidence_items (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  assignment_id uuid not null,
  -- Стабильный код, на который ссылается заключение: ev_1, ev_2 ...
  evidence_code text not null check (evidence_code ~ '^ev_[a-z0-9_]{1,40}$'),
  kind text not null
    check (kind in ('self_report', 'manager_opinion', 'work_fact', 'method_result')),
  source_ref text,
  collected_at timestamptz not null,
  normalized_content jsonb not null,
  limitations jsonb not null default '[]'::jsonb,
  content_hash core.content_hash not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, assignment_id, evidence_code),
  foreign key (organization_id, assignment_id)
    references core.assignments (organization_id, id) on delete cascade
);

create table core.reports (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  assignment_id uuid not null,
  current_published_revision_id uuid,
  status text not null default 'queued'
    check (status in ('queued', 'generating', 'generation_failed', 'pending_review',
                      'revision_requested', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, assignment_id),
  foreign key (organization_id, assignment_id)
    references core.assignments (organization_id, id) on delete cascade
);

create index reports_published_idx
  on core.reports (organization_id, status, published_at desc);

create table core.report_revisions (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  report_id uuid not null,
  revision_no integer not null check (revision_no >= 1),
  state text not null default 'queued'
    check (state in ('queued', 'generating', 'generation_failed', 'pending_review',
                     'revision_requested', 'published', 'superseded')),
  input_hash core.content_hash,
  evidence_snapshot_hash core.content_hash,
  prompt_version_id uuid references core.prompt_versions (id),
  output_schema_version text,
  model_version text,
  -- fake допустим только в demo; подмена real-результата fake запрещена приложением.
  generation_mode text check (generation_mode in ('fake', 'template', 'llm')),
  content_json jsonb,
  content_hash core.content_hash,
  failure_code text,
  reviewer_id uuid references identity.users (id),
  reviewed_at timestamptz,
  published_at timestamptz,
  supersedes_id uuid references core.report_revisions (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, report_id, revision_no),
  check (state <> 'published' or (content_hash is not null and published_at is not null
                                  and reviewer_id is not null)),
  foreign key (organization_id, report_id)
    references core.reports (organization_id, id) on delete cascade
);

alter table core.reports
  add constraint reports_current_revision_fk
  foreign key (organization_id, current_published_revision_id)
  references core.report_revisions (organization_id, id);

create index report_revisions_review_idx
  on core.report_revisions (organization_id, state, created_at);

create table core.report_reviews (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  revision_id uuid not null,
  reviewer_id uuid not null references identity.users (id),
  checklist_json jsonb not null,
  action text not null check (action in ('approved', 'revision_requested', 'edited')),
  comment text check (length(comment) <= 4000),
  reviewed_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, revision_id)
    references core.report_revisions (organization_id, id) on delete cascade
);

create table core.decisions (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  report_revision_id uuid not null,
  actor_id uuid not null references identity.users (id),
  action_code text not null
    check (action_code in ('discussed_with_employee', 'collected_more_information',
                           'scheduled_follow_up', 'approved_next_step', 'postponed', 'no_action')),
  user_comment text check (length(user_comment) <= 2000),
  follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, report_revision_id)
    references core.report_revisions (organization_id, id) on delete cascade
);

create table core.correction_requests (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  resource_type text not null check (resource_type in ('report_revision', 'assignment')),
  resource_id uuid not null,
  requester_type text not null check (requester_type in ('manager', 'participant')),
  requester_user_id uuid references identity.users (id),
  block_key text,
  description text not null check (length(btrim(description)) between 5 and 2000),
  state text not null default 'received'
    check (state in ('received', 'accepted', 'rejected', 'resolved')),
  resolution_reference uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table core.notifications (
  id uuid primary key default uuidv7(),
  organization_id uuid not null references core.organizations (id) on delete cascade,
  recipient_user_id uuid not null references identity.users (id) on delete cascade,
  type text not null
    check (type in ('report_published', 'assignment_expiring', 'revision_requested',
                    'export_ready', 'deletion_completed', 'access_grant_requested')),
  resource_type text,
  resource_id uuid,
  -- Текст заключения в уведомление не попадает.
  title text not null check (length(title) <= 200),
  read_at timestamptz,
  event_key text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (recipient_user_id, event_key)
);

create index notifications_inbox_idx
  on core.notifications (organization_id, recipient_user_id, read_at, created_at desc);

create trigger reports_touch before update on core.reports
  for each row execute function app.touch_updated_at();
create trigger report_revisions_touch before update on core.report_revisions
  for each row execute function app.touch_updated_at();
create trigger correction_requests_touch before update on core.correction_requests
  for each row execute function app.touch_updated_at();
