-- 0011: наблюдаемость фоновой обработки.
--
-- До этой миграции строка outbox отмечалась как доставленная в очередь и
-- больше ничего о себе не сообщала: исход задания нигде не фиксировался,
-- поэтому счётчик ошибок на экране администратора всегда показывал ноль.
-- Здесь появляются исход, время завершения и остановка повторов.

alter table platform.outbox_events
  -- Успешное завершение обработчика. Разница с created_at — реальная задержка.
  add column completed_at timestamptz,
  -- Момент последней ошибки. Код ошибки уже был, времени у него не было.
  add column failed_at timestamptz,
  -- Остановка будущих повторов администратором: диспетчер такую строку
  -- не берёт, пока остановку не снимут.
  add column retries_stopped_at timestamptz,
  add column retries_stopped_by uuid references identity.users (id),
  -- Момент последнего повтора, назначенного администратором.
  add column retried_at timestamptz,
  add column retried_by uuid references identity.users (id);

-- Ошибка и успех несовместимы: строка не может быть одновременно выполненной
-- и упавшей.
alter table platform.outbox_events
  add constraint outbox_outcome_check
  check (completed_at is null or failed_at is null);

-- Код ошибки без времени и время без кода одинаково бесполезны.
alter table platform.outbox_events
  add constraint outbox_failure_check
  check ((failed_at is null) = (last_error_code is null));

-- Остановленные повторы диспетчер пропускает: условие индекса повторяет
-- условие выборки.
drop index if exists platform.outbox_pending_idx;
create index outbox_pending_idx on platform.outbox_events (published_at, created_at)
  where published_at is null and retries_stopped_at is null;

-- Экран обработки фильтрует по типу, состоянию и периоду.
create index outbox_events_admin_idx
  on platform.outbox_events (created_at desc, event_type);

create index outbox_events_failed_idx
  on platform.outbox_events (failed_at desc)
  where failed_at is not null;
