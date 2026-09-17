-- 0014: ограничения временного доступа администратора на уровне схемы.
--
-- Сервер уже проверяет срок, объём и цепочку продлений, но ограничение БД не
-- даёт обойти эти правила ни ошибкой в коде, ни прямой записью (ТЗ A03, M13, 10.4).

-- Срок, о котором просил администратор. Владелец видит его в запросе и по
-- умолчанию разрешает именно его; выданный срок хранится в expires_at.
alter table core.access_grants
  add column requested_hours smallint
    check (requested_hours between 1 and 24);

comment on column core.access_grants.requested_hours is
  'Запрошенный срок в часах. Выданный срок — expires_at; максимум 24 часа (ТЗ A03).';

-- Продление ссылается только на грант той же организации: цепочку нельзя
-- увести в чужой tenant. Одиночный внешний ключ из 0013 этого не гарантирует.
alter table core.access_grants
  add constraint access_grants_extends_same_org_fk
  foreign key (organization_id, extends_grant_id)
  references core.access_grants (organization_id, id);

alter table core.access_grants
  add constraint access_grants_extends_not_self
  check (extends_grant_id is null or extends_grant_id <> id);

-- Выданный доступ живёт не дольше суток от момента выдачи.
alter table core.access_grants
  add constraint access_grants_max_duration
  check (
    expires_at is null
    or approved_at is null
    or (expires_at > approved_at and expires_at <= approved_at + interval '24 hours')
  );

-- Отзыв фиксируется моментом: без него «немедленное закрытие» не проверить.
alter table core.access_grants
  add constraint access_grants_revoked_has_time
  check (state <> 'revoked' or revoked_at is not null);

-- Выданный грант всегда знает момент выдачи: от него считается предел срока.
alter table core.access_grants
  add constraint access_grants_approved_has_time
  check (state <> 'approved' or approved_at is not null);
