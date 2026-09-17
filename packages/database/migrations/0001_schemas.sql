-- 0001: схемы, служебные функции контекста доступа и общие домены.
-- Роли создаёт запускающий скрипт до применения миграций (пароли берутся из окружения).

create schema if not exists app;
create schema if not exists identity;
create schema if not exists core;
create schema if not exists evaluation;
create schema if not exists platform;

comment on schema app is 'Служебные функции контекста запроса для RLS.';
comment on schema identity is 'Учётные записи, сессии и справочник сотрудников организации.';
comment on schema core is 'Предметные данные платформы.';
comment on schema evaluation is 'Исходы исследований. Отдельные credentials; недоступна API и worker.';
comment on schema platform is 'Служебные таблицы: очередь, идемпотентность, аудит, запросы по данным.';

-- Организация текущей транзакции. Значение ставится transaction-local:
-- set_config('app.organization_id', ..., true). Отсутствие значения означает отказ.
create or replace function app.current_organization_id() returns uuid
  language sql
  stable
  as $$
    select nullif(current_setting('app.organization_id', true), '')::uuid
  $$;

-- Эксплуатационный доступ администратора платформы. Разрешает работу только с
-- метаданными организаций, но никогда с содержанием оценок (ответы, заключения).
create or replace function app.is_platform_ops() returns boolean
  language sql
  stable
  as $$
    select coalesce(nullif(current_setting('app.platform_ops', true), ''), 'off') = 'on'
  $$;

comment on function app.current_organization_id() is
  'UUID организации текущей транзакции или NULL. NULL приводит к отказу во всех tenant-политиках.';
comment on function app.is_platform_ops() is
  'Признак эксплуатационного доступа. Не даёт доступ к ответам, evidence и заключениям.';

-- Общие проверяемые домены.
create domain core.iana_timezone as text
  check (value ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' and length(value) between 3 and 64);

create domain core.currency_code as text
  check (value ~ '^[A-Z]{3}$');

create domain core.content_hash as text
  check (value ~ '^[0-9a-f]{64}$');

create domain core.semver as text
  check (value ~ '^[0-9]+\.[0-9]+\.[0-9]+$');

create domain core.stable_code as text
  check (value ~ '^[a-z][a-z0-9_]{1,62}$');

-- Триггер поддержки updated_at.
create or replace function app.touch_updated_at() returns trigger
  language plpgsql
  as $$
  begin
    new.updated_at := now();
    return new;
  end;
  $$;

-- Запрет изменения опубликованного содержимого (ТЗ 07.1).
create or replace function app.forbid_published_content_update() returns trigger
  language plpgsql
  as $$
  begin
    if old.status in ('published', 'retired', 'suspended_for_new_assignments') then
      if new.content_hash is distinct from old.content_hash then
        raise exception 'Содержимое опубликованной версии неизменяемо (%).', old.id
          using errcode = 'restrict_violation';
      end if;
    end if;
    return new;
  end;
  $$;
