-- 0022: технический администратор управляет пользователями и подразделениями,
-- поэтому видит кадровые метаданные employees. Ответы, попытки и заключения
-- остаются под строгими tenant-политиками и этим изменением не затрагиваются.

drop policy tenant_isolation on identity.employees;
create policy tenant_or_ops on identity.employees
  using (organization_id = app.current_organization_id() or app.is_platform_ops())
  with check (organization_id = app.current_organization_id() or app.is_platform_ops());

comment on table identity.employees is
  'Кадровые карточки сотрудников. Доступны своей организации и техническому администратору для настройки пространства; ответов оценок не содержат.';
