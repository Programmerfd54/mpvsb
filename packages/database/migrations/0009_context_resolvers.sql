-- 0009: узкие резолверы контекста доступа.
--
-- Проблема: чтобы установить app.organization_id, нужно сначала узнать организацию
-- по подтверждённой сессии. Но сами таблицы закрыты RLS, которая требует этот контекст.
--
-- Решение: несколько SECURITY DEFINER функций с жёстко ограниченным выводом.
-- Каждая принимает уже проверенный идентификатор (user_id из сессии, hash токена),
-- возвращает минимум полей и не даёт перечислять чужие данные.
-- Это единственный разрешённый обход RLS; общего bypass у runtime-ролей нет.

create or replace function app.resolve_user_memberships(p_user_id uuid)
  returns table (
    organization_id uuid,
    organization_code text,
    organization_name text,
    organization_mode text,
    organization_status text,
    membership_id uuid,
    permissions text[],
    membership_status text
  )
  language sql
  stable
  security definer
  set search_path = pg_catalog, core, public
  as $$
    select
      o.id, o.code::text, o.name, o.mode, o.status,
      m.id, m.permissions, m.status
    from core.memberships m
    join core.organizations o on o.id = m.organization_id
    where m.user_id = p_user_id
      and m.status = 'active'
      and o.status = 'active'
    order by o.name
  $$;

comment on function app.resolve_user_memberships(uuid) is
  'Организации подтверждённого пользователя. Принимает user_id из проверенной сессии.';

create or replace function app.resolve_participant_session(p_session_hash text)
  returns table (
    session_id uuid,
    organization_id uuid,
    assignment_id uuid,
    invitation_id uuid,
    lease_version integer,
    idle_expires_at timestamptz,
    absolute_expires_at timestamptz,
    revoked_at timestamptz
  )
  language sql
  stable
  security definer
  set search_path = pg_catalog, core, public
  as $$
    select s.id, s.organization_id, s.assignment_id, s.invitation_id,
           s.lease_version, s.idle_expires_at, s.absolute_expires_at, s.revoked_at
    from core.participant_sessions s
    where s.session_hash = p_session_hash
  $$;

comment on function app.resolve_participant_session(text) is
  'Область сессии участника по хэшу. Ни имени сотрудника, ни ответов не возвращает.';

create or replace function app.resolve_invitation(p_token_hash text)
  returns table (
    invitation_id uuid,
    organization_id uuid,
    assignment_id uuid,
    expires_at timestamptz,
    revoked_at timestamptz
  )
  language sql
  stable
  security definer
  set search_path = pg_catalog, core, public
  as $$
    select i.id, i.organization_id, i.assignment_id, i.expires_at, i.revoked_at
    from core.invitations i
    where i.token_hash = p_token_hash
  $$;

comment on function app.resolve_invitation(text) is
  'Область приглашения по хэшу токена. Вызывается только после POST-обмена ссылки.';

-- Активный временный грант администратора. Срок проверяется на каждом запросе.
create or replace function app.resolve_access_grant(p_user_id uuid, p_organization_id uuid)
  returns table (
    grant_id uuid,
    purpose text,
    permissions text[],
    resource_scope jsonb,
    expires_at timestamptz
  )
  language sql
  stable
  security definer
  set search_path = pg_catalog, core, public
  as $$
    select g.id, g.purpose, g.permissions, g.resource_scope, g.expires_at
    from core.access_grants g
    where g.grantee_user_id = p_user_id
      and g.organization_id = p_organization_id
      and g.state = 'approved'
      and g.revoked_at is null
      and g.expires_at > now()
  $$;

comment on function app.resolve_access_grant(uuid, uuid) is
  'Действующий целевой грант. Истёкший или отозванный грант не возвращается.';

revoke all on function
  app.resolve_user_memberships(uuid),
  app.resolve_participant_session(text),
  app.resolve_invitation(text),
  app.resolve_access_grant(uuid, uuid)
  from public;

grant execute on function
  app.resolve_user_memberships(uuid),
  app.resolve_participant_session(text),
  app.resolve_invitation(text),
  app.resolve_access_grant(uuid, uuid)
  to context_api;

-- Worker и evaluator этих резолверов не получают: их контекст приходит из задания,
-- а не из пользовательской сессии.
