-- 0013: продление временного доступа отдельной записью.
--
-- Продление не должно переписывать срок выданного гранта: иначе из журнала
-- исчезает, на какой срок доступ выдавали изначально и кто его продлил
-- (ТЗ A03, M13). Поэтому продление — это новый грант, ссылающийся на прежний.

alter table core.access_grants
  add column extends_grant_id uuid references core.access_grants (id) on delete set null;

-- Продление ссылается на грант той же организации: цепочку нельзя увести
-- в чужой tenant.
create index access_grants_extends_idx on core.access_grants (extends_grant_id)
  where extends_grant_id is not null;

create index access_grants_org_state_idx
  on core.access_grants (organization_id, state, requested_at desc);

comment on column core.access_grants.extends_grant_id is
  'Продлеваемый грант. Продление создаётся новой записью, срок прежней не меняется.';
