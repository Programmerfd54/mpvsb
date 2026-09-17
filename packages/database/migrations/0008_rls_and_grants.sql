-- 0008: изоляция tenant через RLS и минимальные права runtime-ролей.
--
-- Принципы (ТЗ 06.5, 10.5):
--   * runtime-роли не владеют таблицами и не имеют BYPASSRLS;
--   * на tenant-таблицах включён FORCE ROW LEVEL SECURITY — политика действует и на владельца;
--   * отсутствие app.organization_id означает отказ, а не «всё видно»;
--   * эксплуатационный доступ администратора (app.platform_ops) распространяется только на
--     метаданные организаций и никогда на ответы, evidence и заключения.

-- ——— Строгие tenant-таблицы: доступ только по совпадению организации ———
do $$
declare
  t text;
  strict_tables text[] := array[
    'identity.employees',
    'core.assignment_drafts',
    'core.assignments',
    'core.invitations',
    'core.participant_sessions',
    'core.consent_records',
    'core.participation_declines',
    'core.attempts',
    'core.answers',
    'core.submission_snapshots',
    'core.score_results',
    'core.evidence_items',
    'core.reports',
    'core.report_revisions',
    'core.report_reviews',
    'core.decisions',
    'core.correction_requests',
    'core.notifications',
    'core.studies',
    'core.study_cases',
    'core.historical_snapshots',
    'core.baseline_predictions',
    'core.predictions',
    'evaluation.outcomes',
    'evaluation.evaluation_runs',
    'evaluation.case_interventions'
  ];
begin
  foreach t in array strict_tables loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
    execute format(
      'create policy tenant_isolation on %s
         using (organization_id = app.current_organization_id())
         with check (organization_id = app.current_organization_id())', t);
  end loop;
end
$$;

-- ——— Таблицы метаданных организации: доступен также эксплуатационный режим ———
alter table core.organizations enable row level security;
alter table core.organizations force row level security;
create policy tenant_or_ops on core.organizations
  using (id = app.current_organization_id() or app.is_platform_ops())
  with check (id = app.current_organization_id() or app.is_platform_ops());

do $$
declare
  t text;
  ops_tables text[] := array[
    'core.memberships',
    'core.access_grants',
    'platform.readiness_checks',
    'platform.privacy_requests',
    'platform.deletion_jobs'
  ];
begin
  foreach t in array ops_tables loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
    execute format(
      'create policy tenant_or_ops on %s
         using (organization_id = app.current_organization_id() or app.is_platform_ops())
         with check (organization_id = app.current_organization_id() or app.is_platform_ops())', t);
  end loop;
end
$$;

-- Аудит append-only: запись разрешена всегда, чтение — по организации или в режиме эксплуатации.
alter table platform.audit_events enable row level security;
alter table platform.audit_events force row level security;
create policy audit_append on platform.audit_events for insert with check (true);
create policy audit_read on platform.audit_events for select
  using (app.is_platform_ops() or organization_id = app.current_organization_id());

-- platform.outbox_events намеренно без RLS: диспетчер обрабатывает очередь всех организаций.
-- Защита — отсутствие прав у любой роли, кроме api (insert) и worker (чтение/отметка).
comment on table platform.outbox_events is
  'Очередь событий. Без RLS: диспетчер межтенантный. Payload содержит только идентификаторы.';

-- ——— Права ролей ———

revoke all on schema app, core, identity, evaluation, platform from public;
revoke all on all tables in schema core, identity, evaluation, platform from public;

grant usage on schema app to context_api, context_worker, context_evaluator;
grant execute on function app.current_organization_id(), app.is_platform_ops()
  to context_api, context_worker, context_evaluator;

-- API: полный рабочий доступ в границах RLS.
grant usage on schema core, identity, platform to context_api;
grant select, insert, update, delete on all tables in schema core to context_api;
grant select, insert, update, delete on all tables in schema identity to context_api;
grant select, insert, update, delete on all tables in schema platform to context_api;

-- Worker: обработка ответов и подготовка заключений.
-- Схема identity не выдаётся: подсчёт и генерация не видят имён и email (ТЗ 07.3).
grant usage on schema core, platform to context_worker;
grant select on
  core.organizations, core.assignments, core.attempts, core.answers,
  core.submission_snapshots, core.score_results, core.evidence_items,
  core.method_versions, core.scenario_versions, core.scenario_methods,
  core.scenarios, core.methods, core.prompt_versions, core.reporting_policies,
  core.consent_records, core.reports, core.report_revisions, core.invitations
  to context_worker;
grant insert, update on
  core.score_results, core.evidence_items, core.reports, core.report_revisions,
  core.notifications, core.attempts, core.assignments
  to context_worker;
grant insert on core.notifications to context_worker;
grant select, insert, update, delete on platform.outbox_events to context_worker;
grant select, insert, update on platform.deletion_jobs to context_worker;
grant select, update on platform.privacy_requests to context_worker;
grant insert on platform.audit_events to context_worker;
grant select, insert, update, delete on core.answers to context_worker;

-- Evaluator: единственная роль, имеющая доступ к исходам.
grant usage on schema core, evaluation to context_evaluator;
grant select on
  core.organizations, core.studies, core.study_cases,
  core.predictions, core.baseline_predictions, core.historical_snapshots
  to context_evaluator;
grant update on core.studies to context_evaluator;
grant select, insert, update on evaluation.outcomes to context_evaluator;
grant select, insert on evaluation.evaluation_runs to context_evaluator;
grant select, insert on evaluation.case_interventions to context_evaluator;
grant usage on schema platform to context_evaluator;
grant insert on platform.audit_events to context_evaluator;

-- Явный отзыв доступа к исходам у конвейера оценки. Это ключевой инвариант
-- слепого режима, проверяемый отдельным тестом.
revoke all on schema evaluation from context_api, context_worker;
revoke all on all tables in schema evaluation from context_api, context_worker;

-- Права по умолчанию для будущих объектов, создаваемых владельцем.
alter default privileges for role context_owner in schema core
  grant select, insert, update, delete on tables to context_api;
alter default privileges for role context_owner in schema identity
  grant select, insert, update, delete on tables to context_api;
alter default privileges for role context_owner in schema platform
  grant select, insert, update, delete on tables to context_api;
alter default privileges for role context_owner in schema evaluation
  grant select, insert, update on tables to context_evaluator;
