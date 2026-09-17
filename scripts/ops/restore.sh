#!/usr/bin/env bash
# Восстановление базы «Контекст» из дампа в НОВУЮ базу с применением оград удаления.
#
#   RESTORE_TARGET_URL=postgresql://context_restore:...@127.0.0.1:55443/context_restore_check \
#   PG_CONTAINER=context-postgres-test \
#   scripts/ops/restore.sh backups/context-20260917T060000Z.dump
#
# РОЛЬ: эксплуатационная роль восстановления с BYPASSRLS, CREATEDB и CREATEROLE
# (см. RUNBOOK § 6.0; там же честно описано, что через членство во владельце схемы
# эта роль получает и права на DDL — «роль без DDL» сделать не получается).
# Ограды удаления без BYPASSRLS применились бы к пустому набору строк, поэтому
# deletion-fences.sql такую роль отвергает.
#
# Порядок и его причины:
#   0. сверка sha256 дампа с манифестом копии: повреждённый файл не восстанавливаем;
#   1. роли кластера (context_api/worker/evaluator) — это глобальные объекты, их
#      в дампе нет, а права в дампе на них ссылаются: создаём до восстановления,
#      без паролей. Пароли выставит команда миграции из окружения. Там же
#      эксплуатационной роли выдаётся членство в этих ролях (inherit false):
#      без него verify-restore.sql не может сделать `set role context_api`;
#   2. создание базы с той же локалью, что и у источника, и владельцем —
#      ролью владельца схемы (RESTORE_DB_OWNER, по умолчанию context_owner),
#      а не ролью подключения;
#   3. pg_restore --exit-on-error: молча пропущенных объектов быть не должно;
#   4. ограды удаления (scripts/ops/deletion-fences.sql) — ДО того, как база
#      станет доступна приложению и фоновой обработке (ТЗ 10.8 п. 6).
#
# Восстановленную базу нельзя открывать пользователям, пока не пройдены ограды и
# scripts/ops/verify-restore.sh. Пропустить ограды можно только осознанно:
# RESTORE_SKIP_FENCES=1 (скрипт скажет об этом в выводе).
#
# Журнал удалений, исполненных после снимка, передаётся так:
#   RESTORE_FENCE_IDS='{uuid,uuid}'   — идентификаторы назначений.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ops/lib.sh
. "$SCRIPT_DIR/lib.sh"

DUMP_FILE="${1:-}"
[[ -n "$DUMP_FILE" ]] || fail "Укажите файл дампа: scripts/ops/restore.sh <файл.dump>"
[[ -f "$DUMP_FILE" ]] || fail "Файл дампа не найден: $DUMP_FILE"
[[ -n "${RESTORE_TARGET_URL:-}" ]] ||
  fail "Не задана RESTORE_TARGET_URL — подключение владельца схемы к НОВОЙ базе восстановления."

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# 0. Целостность копии. Манифест хранит sha256 дампа: без сверки повреждённый или
#    подменённый файл восстановится молча, и «проверка копии» ничего не проверяет.
MANIFEST="${RESTORE_MANIFEST:-${DUMP_FILE%.dump}.manifest}"
if [[ -f "$MANIFEST" ]]; then
  EXPECTED_SHA="$(sed -n 's/^dump_sha256=//p' "$MANIFEST" | head -n 1)"
  [[ -n "$EXPECTED_SHA" ]] ||
    fail "В манифесте $MANIFEST нет dump_sha256: целостность дампа подтвердить нечем."
  log "0/5 Сверяю контрольную сумму дампа с манифестом $(basename "$MANIFEST")…"
  ACTUAL_SHA="$(sha256_of "$DUMP_FILE")"
  [[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] ||
    fail "Контрольная сумма дампа не совпадает с манифестом (файл повреждён или подменён). Ожидалось $EXPECTED_SHA, получено $ACTUAL_SHA. Восстановление остановлено."
  log "      sha256 совпадает."
elif [[ "${RESTORE_NO_MANIFEST:-0}" == "1" ]]; then
  log "0/5 Манифест не задан (RESTORE_NO_MANIFEST=1): целостность дампа НЕ проверена."
else
  fail "Манифест не найден: $MANIFEST. Укажите его в RESTORE_MANIFEST или подтвердите восстановление без проверки целостности: RESTORE_NO_MANIFEST=1."
fi

RESTORE_DB_LOCALE="${RESTORE_DB_LOCALE:-ru-RU}"
RESTORE_FENCE_IDS="${RESTORE_FENCE_IDS:-}"
[[ -n "$RESTORE_FENCE_IDS" ]] || RESTORE_FENCE_IDS='{}'
RESTORE_MAINTENANCE_DB="${RESTORE_MAINTENANCE_DB:-postgres}"
# Владелец восстановленной базы — роль владельца схемы из дампа, а НЕ роль,
# которой подключились. Иначе public достаётся pg_database_owner = эксплуатационной
# роли, и pg_restore падает на `alter table ... owner to context_owner`:
# «permission denied for schema public». В среде разработки это не всплывает,
# потому что там подключаются самим владельцем.
RESTORE_DB_OWNER="${RESTORE_DB_OWNER:-context_owner}"

pg_env "$RESTORE_TARGET_URL"
TARGET_DB="$PGDATABASE"
OWNER="$RESTORE_DB_OWNER"

# Служебные операции идут в maintenance-базу: создавать базу, подключившись к ней, нельзя.
PGDATABASE="$RESTORE_MAINTENANCE_DB"
export PGDATABASE
require_tools

EXISTS="$(psql_quiet -c "select count(*) from pg_database where datname = '${TARGET_DB//\'/\'\'}'")"
if [[ "$EXISTS" != "0" ]]; then
  [[ "${RESTORE_ALLOW_EXISTING:-0}" == "1" ]] ||
    fail "База $TARGET_DB уже существует. Восстанавливайте в новую базу или задайте RESTORE_ALLOW_EXISTING=1, если она пустая и создана для этой проверки."
fi

log "1/5 Создаю недостающие runtime-роли (без паролей: их задаёт команда миграции)…"
pg_run psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  role_name text;
begin
  foreach role_name in array array['context_api', 'context_worker', 'context_evaluator'] loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      -- Runtime-роль не должна обходить RLS и не должна иметь права на DDL.
      execute format('create role %I login noinherit nobypassrls nocreatedb nocreaterole', role_name);
      raise notice 'Создана роль %', role_name;
    end if;
  end loop;
end
$$;

-- Членство эксплуатационной роли в runtime-ролях: нужно verify-restore.sql,
-- чтобы функционально проверить RLS через `set role context_api`. Права
-- runtime-роли строго меньше прав владельца схемы, поэтому членство ничего не
-- расширяет; inherit false — привилегии runtime-ролей не подмешиваются к
-- собственным, роль только может ими стать.
-- Выдать членство может не всякая роль (нужен ADMIN OPTION, CREATEROLE или
-- SUPERUSER). Если права нет — это не повод прерывать восстановление:
-- verify-restore.sql в таком случае проверит RLS по каталогу и скажет об этом.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['context_api', 'context_worker', 'context_evaluator'] loop
    if not pg_has_role(current_user, role_name, 'SET') then
      begin
        execute format('grant %I to current_user with inherit false, set true', role_name);
        raise notice 'Роли % выдано членство текущему пользователю (для проверки RLS)', role_name;
      exception
        when insufficient_privilege then
          raise notice 'Нет права выдать членство в роли % — функциональная проверка RLS пойдёт по каталогу', role_name;
      end;
    end if;
  end loop;
end
$$;
SQL

if [[ "$EXISTS" == "0" ]]; then
  log "2/5 Создаю базу $TARGET_DB (владелец $OWNER, локаль ICU $RESTORE_DB_LOCALE)…"
  pg_run psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
    -c "create database \"$TARGET_DB\" with owner \"$OWNER\" template template0 encoding 'UTF8' locale_provider icu icu_locale '$RESTORE_DB_LOCALE'"
else
  log "2/5 База $TARGET_DB уже существует — создание пропущено (RESTORE_ALLOW_EXISTING=1)."
fi

PGDATABASE="$TARGET_DB"
export PGDATABASE

log "3/5 Восстанавливаю дамп ($(wc -c <"$DUMP_FILE" | tr -d ' ') байт)…"
pg_run pg_restore --dbname="$TARGET_DB" --exit-on-error --no-password <"$DUMP_FILE"

log "4/5 Обновляю статистику планировщика (analyze)…"
# Только таблицы приложения и очереди: `analyze` без аргументов под ролью,
# которая не суперпользователь, перебирает и системные каталоги и печатает
# десяток WARNING «permission denied to analyze pg_authid» — шум, из-за которого
# настоящее предупреждение в выводе восстановления легко не заметить.
pg_run psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  rel text;
begin
  for rel in
    select format('%I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and n.nspname in ('core', 'identity', 'platform', 'evaluation', 'public', 'pgboss')
  loop
    execute 'analyze ' || rel;
  end loop;
end
$$;
SQL

if [[ "${RESTORE_SKIP_FENCES:-0}" == "1" ]]; then
  log "5/5 ОГРАДЫ УДАЛЕНИЯ ПРОПУЩЕНЫ (RESTORE_SKIP_FENCES=1)."
  log "     Эту базу нельзя открывать пользователям и worker: удалённые данные в ней живы."
else
  log "5/5 Применяю ограды удаления…"
  pg_run psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
    --set=fence_ids="$RESTORE_FENCE_IDS" <"$SCRIPT_DIR/deletion-fences.sql"
fi

log ""
log "База $TARGET_DB восстановлена."
log "Дальше: пароли runtime-ролей (npm run db:migrate с окружением этой базы)"
log "и проверка scripts/ops/verify-restore.sh с манифестом резервной копии."
