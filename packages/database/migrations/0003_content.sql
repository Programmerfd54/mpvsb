-- 0003: глобальная библиотека содержимого. Данных сотрудников здесь нет.

create table core.methods (
  id uuid primary key default uuidv7(),
  stable_code core.stable_code not null unique,
  title text not null check (length(btrim(title)) between 2 and 200),
  current_published_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table core.method_versions (
  id uuid primary key default uuidv7(),
  method_id uuid not null references core.methods (id) on delete restrict,
  semantic_version core.semver not null,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'published', 'suspended_for_new_assignments', 'retired')),
  -- Уровень готовности содержимого. Не выводится из факта публикации.
  applicability_mode text not null default 'demo'
    check (applicability_mode in ('demo', 'research', 'validated_use')),
  -- Паспорт: назначение, целевая группа, ограничения, язык, права использования.
  passport_json jsonb not null default '{}'::jsonb,
  -- Вопросы со стабильными item/option ID.
  items_json jsonb not null default '[]'::jsonb,
  -- Декларативные правила подсчёта из allowlist. Исполняемый код здесь запрещён.
  scoring_config_json jsonb not null default '{}'::jsonb,
  scorer_id text,
  scorer_version text,
  interpretation_rules_json jsonb not null default '{}'::jsonb,
  missing_policy text not null default 'reject'
    check (missing_policy in ('reject', 'mark_unknown', 'exclude_item')),
  license_metadata jsonb not null default '{}'::jsonb,
  validation_metadata jsonb not null default '{}'::jsonb,
  -- Контрольные примеры: синтетические ответы и ожидаемый результат.
  fixtures_json jsonb not null default '[]'::jsonb,
  content_hash core.content_hash,
  published_at timestamptz,
  published_by uuid references identity.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (method_id, semantic_version),
  check (status <> 'published' or (content_hash is not null and published_at is not null))
);

alter table core.methods
  add constraint methods_current_version_fk
  foreign key (current_published_version_id) references core.method_versions (id);

create index method_versions_status_idx on core.method_versions (status, applicability_mode);

create table core.scenarios (
  id uuid primary key default uuidv7(),
  stable_code core.stable_code not null unique,
  title text not null check (length(btrim(title)) between 2 and 200),
  current_published_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table core.prompt_versions (
  id uuid primary key default uuidv7(),
  key core.stable_code not null,
  semantic_version core.semver not null,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'published', 'retired')),
  -- Шаблон системных указаний. Наружу в браузер не отдаётся.
  template text not null,
  output_schema_version text not null,
  provider_policy_id text,
  review_metadata jsonb not null default '{}'::jsonb,
  content_hash core.content_hash,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, semantic_version)
);

create table core.reporting_policies (
  id uuid primary key default uuidv7(),
  stable_code core.stable_code not null,
  semantic_version core.semver not null,
  -- Допустимые утверждения и обязательные ограничения для сценария.
  permitted_claims jsonb not null default '[]'::jsonb,
  required_limitations jsonb not null default '[]'::jsonb,
  forbidden_claims jsonb not null default '[]'::jsonb,
  participant_visibility text not null default 'completion_receipt'
    check (participant_visibility in ('completion_receipt', 'participant_summary')),
  created_at timestamptz not null default now(),
  unique (stable_code, semantic_version)
);

create table core.scenario_versions (
  id uuid primary key default uuidv7(),
  scenario_id uuid not null references core.scenarios (id) on delete restrict,
  semantic_version core.semver not null,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'published', 'suspended_for_new_assignments', 'retired')),
  applicability_mode text not null default 'demo'
    check (applicability_mode in ('demo', 'research', 'validated_use')),
  -- Схема полей контекста решения, которые заполняет руководитель.
  context_schema_json jsonb not null default '{}'::jsonb,
  reporting_policy_id uuid references core.reporting_policies (id),
  prompt_version_id uuid references core.prompt_versions (id),
  participant_visibility text not null default 'completion_receipt'
    check (participant_visibility in ('completion_receipt', 'participant_summary')),
  content_hash core.content_hash,
  published_at timestamptz,
  published_by uuid references identity.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scenario_id, semantic_version),
  check (status <> 'published' or (content_hash is not null and published_at is not null))
);

alter table core.scenarios
  add constraint scenarios_current_version_fk
  foreign key (current_published_version_id) references core.scenario_versions (id);

create table core.scenario_methods (
  id uuid primary key default uuidv7(),
  scenario_version_id uuid not null references core.scenario_versions (id) on delete cascade,
  method_version_id uuid not null references core.method_versions (id) on delete restrict,
  order_index integer not null check (order_index >= 0),
  required boolean not null default true,
  unique (scenario_version_id, order_index),
  unique (scenario_version_id, method_version_id)
);

create table core.legal_document_versions (
  id uuid primary key default uuidv7(),
  key core.stable_code not null,
  locale text not null default 'ru' check (locale ~ '^[a-z]{2}$'),
  semantic_version core.semver not null,
  -- draft не допускается для реальных участников; demo помечает образец видимой надписью.
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  title text not null,
  body text not null,
  purpose text not null,
  content_hash core.content_hash not null,
  effective_from timestamptz,
  approved_by uuid references identity.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (key, locale, semantic_version),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

create table core.retention_policy_versions (
  id uuid primary key default uuidv7(),
  stable_code core.stable_code not null,
  semantic_version core.semver not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  mode text not null default 'demo' check (mode in ('demo', 'research', 'validated_use')),
  -- Сроки по назначению обработки в днях.
  rules_json jsonb not null default '{}'::jsonb,
  legal_basis text,
  approved_by uuid references identity.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (stable_code, semantic_version)
);

alter table core.organizations
  add constraint organizations_retention_policy_fk
  foreign key (retention_policy_version_id) references core.retention_policy_versions (id);

create table core.knowledge_articles (
  id uuid primary key default uuidv7(),
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'),
  locale text not null default 'ru' check (locale ~ '^[a-z]{2}$'),
  audience text not null check (audience in ('manager', 'participant', 'admin')),
  category text not null,
  current_published_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug, locale)
);

create table core.knowledge_article_versions (
  id uuid primary key default uuidv7(),
  article_id uuid not null references core.knowledge_articles (id) on delete cascade,
  revision_no integer not null check (revision_no >= 1),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  title text not null check (length(btrim(title)) between 2 and 200),
  excerpt text check (length(excerpt) <= 400),
  -- Markdown; исполняемый HTML запрещён и вычищается до записи.
  body_markdown text not null,
  content_hash core.content_hash not null,
  published_at timestamptz,
  published_by uuid references identity.users (id),
  created_at timestamptz not null default now(),
  unique (article_id, revision_no)
);

alter table core.knowledge_articles
  add constraint knowledge_current_version_fk
  foreign key (current_published_version_id) references core.knowledge_article_versions (id);

create trigger methods_touch before update on core.methods
  for each row execute function app.touch_updated_at();
create trigger method_versions_touch before update on core.method_versions
  for each row execute function app.touch_updated_at();
create trigger method_versions_immutable before update on core.method_versions
  for each row execute function app.forbid_published_content_update();
create trigger scenarios_touch before update on core.scenarios
  for each row execute function app.touch_updated_at();
create trigger scenario_versions_touch before update on core.scenario_versions
  for each row execute function app.touch_updated_at();
create trigger scenario_versions_immutable before update on core.scenario_versions
  for each row execute function app.forbid_published_content_update();
create trigger prompt_versions_touch before update on core.prompt_versions
  for each row execute function app.touch_updated_at();
create trigger knowledge_articles_touch before update on core.knowledge_articles
  for each row execute function app.touch_updated_at();
