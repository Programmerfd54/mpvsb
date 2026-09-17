#!/usr/bin/env bash
# Резервная копия базы «Контекст» в custom format (pg_dump -Fc) и манифест проверки.
#
#   BACKUP_SOURCE_URL=postgresql://context_backup:...@127.0.0.1:55442/context \
#   PG_CONTAINER=context-postgres \
#   scripts/ops/backup.sh backups
#
# РОЛЬ: только роль с BYPASSRLS (эксплуатационная роль копий, см. RUNBOOK § 6.0).
# На таблицах включён FORCE ROW LEVEL SECURITY, и pg_dump под обычным владельцем
# схемы отказывает: «query would be affected by row-level security policy».
# Роль миграций не подходит: ей BYPASSRLS в production запрещён.
#
# PG_CONTAINER=<имя>: клиентские утилиты запускаются ВНУТРИ контейнера, поэтому
# host/port строки подключения заменяются на внутренние (PG_CONTAINER_HOST/PORT,
# по умолчанию 127.0.0.1:5432) — об этом скрипт сообщает в выводе.
#
# Даёт два файла: <база>-<дата>.dump и <база>-<дата>.manifest.
# Манифест нужен проверке восстановления: количества строк, список миграций с
# контрольными суммами, версия сервера, число политик и таблиц с FORCE RLS,
# sha256 дампа. Состава runtime-ролей в манифесте нет: роли — глобальные объекты
# кластера, их наличие и свойства проверяет verify-restore.sql по каталогу
# восстановленного сервера (roles.exist, roles.no_bypassrls, grants.*).
#
# Роли кластера в дамп не попадают (это глобальные объекты) — их создаёт
# scripts/ops/restore.sh, пароли задаёт команда миграции. Секретов в манифесте нет.
#
# Дамп содержит персональные данные: хранить только в зашифрованном хранилище,
# срок хранения — по утверждённой политике (ТЗ 10.7), а не «навсегда».
#
# Учебные и проверочные прогоны оставляют дамп на локальном диске незашифрованным.
# После проверки его нужно удалить: BACKUP_DELETE_AFTER_SECONDS=<n> удаляет из
# каталога вывода дампы, их манифесты и журналы старше n секунд (см. RUNBOOK § 6.6).
# Файлы создаются с umask 077 (-rw-------): на общей машине дамп не должен быть
# читаем другими локальными пользователями.

set -euo pipefail

# Дамп содержит полное незашифрованное содержание базы, включая персональные
# данные участников. С umask по умолчанию файл вышел бы -rw-r--r--, то есть
# читаемым любым локальным пользователем эксплуатационной машины.
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ops/lib.sh
. "$SCRIPT_DIR/lib.sh"

OUT_DIR="${1:-${BACKUP_DIR:-backups}}"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/packages/database/migrations"

[[ -n "${BACKUP_SOURCE_URL:-}" ]] ||
  fail "Не задана BACKUP_SOURCE_URL — строка подключения владельца схемы к копируемой базе."

pg_env "$BACKUP_SOURCE_URL"
require_tools

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="$OUT_DIR/${PGDATABASE}-${STAMP}"
DUMP_FILE="$BASE.dump"
MANIFEST_FILE="$BASE.manifest"

# Запрос количеств строк. pgboss исключён: служебная очередь меняется постоянно
# и сравнивать её количества между снимками бессмысленно.
COUNTS_SQL="
select n.nspname || '.' || c.relname || ' ' ||
       (xpath('/row/c/text()',
              query_to_xml('select count(*) as c from ' ||
                           quote_ident(n.nspname) || '.' || quote_ident(c.relname),
                           false, true, '')))[1]::text
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname in ('core', 'identity', 'platform', 'evaluation', 'public')
order by 1"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# Количества строк снимаются В ТОМ ЖЕ снимке, что и дамп. Два отдельных запроса
# «до» и «после» на работающей базе почти всегда расходятся, и сверка полноты
# восстановления превратилась бы в предупреждение именно тогда, когда она нужна.
# Поэтому: держим транзакцию repeatable read, экспортируем из неё снимок,
# передаём его pg_dump (--snapshot) и считаем строки в той же транзакции.
HOLDER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/context-backup.XXXXXX")"
HOLDER_PID=""
cleanup_holder() {
  # Закрываем канал: psql увидит конец ввода и завершит транзакцию.
  exec 9>&- 2>/dev/null || true
  [[ -n "$HOLDER_PID" ]] && wait "$HOLDER_PID" 2>/dev/null || true
  rm -rf "$HOLDER_DIR"
}
trap cleanup_holder EXIT

mkfifo "$HOLDER_DIR/in"
: >"$HOLDER_DIR/out"

log "Открываю транзакцию-держатель снимка…"
psql_quiet -f - <"$HOLDER_DIR/in" >"$HOLDER_DIR/out" 2>"$HOLDER_DIR/err" &
HOLDER_PID=$!
exec 9>"$HOLDER_DIR/in"

printf '%s\n' \
  'begin isolation level repeatable read;' \
  'select pg_export_snapshot();' >&9

SNAPSHOT_ID=""
for _ in $(seq 1 150); do
  kill -0 "$HOLDER_PID" 2>/dev/null ||
    fail "Транзакция-держатель снимка завершилась досрочно: $(cat "$HOLDER_DIR/err")"
  SNAPSHOT_ID="$(head -n 1 "$HOLDER_DIR/out" | tr -d '\r')"
  [[ -n "$SNAPSHOT_ID" ]] && break
  sleep 0.2
done
[[ -n "$SNAPSHOT_ID" ]] ||
  fail "Не удалось получить снимок транзакции (pg_export_snapshot). Ошибка psql: $(cat "$HOLDER_DIR/err")"
log "Снимок: $SNAPSHOT_ID"

log "Создаю дамп: $DUMP_FILE"
# --no-password: пароль только из PGPASSWORD, интерактивного запроса быть не должно.
# --snapshot: дамп и количества строк относятся к одному и тому же состоянию базы.
pg_run pg_dump --format=custom --compress=6 --no-password --snapshot="$SNAPSHOT_ID" --verbose \
  >"$DUMP_FILE" 2>"$BASE.log"

log "Снимаю количества строк в снимке дампа…"
printf '%s\n' "$COUNTS_SQL;" 'commit;' >&9
exec 9>&-
wait "$HOLDER_PID" ||
  fail "Запрос количеств строк в снимке дампа не выполнен: $(cat "$HOLDER_DIR/err")"
HOLDER_PID=""
# Первая строка вывода — идентификатор снимка, дальше количества строк.
COUNTS_IN_SNAPSHOT="$(tail -n +2 "$HOLDER_DIR/out")"
[[ -n "$COUNTS_IN_SNAPSHOT" ]] || fail "Количества строк не получены: $(cat "$HOLDER_DIR/err")"

SERVER_VERSION="$(psql_quiet -c 'show server_version')"
POLICIES="$(psql_quiet -c 'select count(*) from pg_policies')"
RLS_TABLES="$(psql_quiet -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relrowsecurity and c.relforcerowsecurity and n.nspname in ('core','identity','platform','evaluation')")"
MIGRATIONS="$(psql_quiet -c "select filename || ' ' || checksum from public.schema_migrations order by filename")"
DUMP_SHA="$(sha256_of "$DUMP_FILE")"
DUMP_BYTES="$(wc -c <"$DUMP_FILE" | tr -d ' ')"

{
  echo "# Манифест резервной копии базы «Контекст». Секретов и персональных данных не содержит."
  echo "created_at=$STAMP"
  echo "source_database=$PGDATABASE"
  echo "server_version=$SERVER_VERSION"
  echo "dump_file=$(basename "$DUMP_FILE")"
  echo "dump_sha256=$DUMP_SHA"
  echo "dump_bytes=$DUMP_BYTES"
  # Количества строк относятся к снимку самого дампа, а не к моменту «около» него:
  # при восстановлении сравнение строгое.
  echo "counts_source=dump_snapshot"
  echo "policies=$POLICIES"
  echo "rls_forced_tables=$RLS_TABLES"
  echo "[migrations]"
  echo "$MIGRATIONS"
  echo "[counts]"
  echo "$COUNTS_IN_SNAPSHOT"
} >"$MANIFEST_FILE"

# Контрольные суммы миграций в базе должны совпадать с файлами репозитория:
# иначе восстановленная база не соответствует коду этой версии.
MISMATCH=0
while read -r filename checksum; do
  [[ -z "$filename" ]] && continue
  if [[ -f "$MIGRATIONS_DIR/$filename" ]]; then
    actual="$(sha256_of "$MIGRATIONS_DIR/$filename")"
    if [[ "$actual" != "$checksum" ]]; then
      log "Предупреждение: миграция $filename в базе отличается от файла репозитория."
      MISMATCH=1
    fi
  else
    log "Предупреждение: миграции $filename нет в репозитории (база новее кода)."
    MISMATCH=1
  fi
done <<<"$MIGRATIONS"
[[ "$MISMATCH" -eq 0 ]] || log "Проверьте версию кода перед восстановлением."

# Очистка старых локальных копий. Дамп незашифрован, поэтому «полежит и ладно» —
# не вариант: срок задаётся явно, а не подразумевается.
if [[ -n "${BACKUP_DELETE_AFTER_SECONDS:-}" ]]; then
  NOW_EPOCH="$(date -u +%s)"
  REMOVED=0
  for old in "$OUT_DIR"/*.dump "$OUT_DIR"/*.log; do
    [[ -e "$old" ]] || continue
    [[ "$old" == "$DUMP_FILE" || "$old" == "$BASE.log" ]] && continue
    # BSD и GNU stat принимают разные флаги; берём тот, что сработал.
    mtime="$(stat -f %m "$old" 2>/dev/null || stat -c %Y "$old" 2>/dev/null || echo "$NOW_EPOCH")"
    if ((NOW_EPOCH - mtime > BACKUP_DELETE_AFTER_SECONDS)); then
      rm -f "$old"
      REMOVED=$((REMOVED + 1))
      # Манифест удаляется вместе со своим дампом: иначе в каталоге остаются
      # манифесты без дампов, и restore.sh рядом с новым дампом может подобрать
      # чужой манифест, а оператор — принять осиротевший набор за копию.
      [[ "$old" == *.dump ]] && rm -f "${old%.dump}.manifest"
    fi
  done
  log "Удалено локальных копий старше ${BACKUP_DELETE_AFTER_SECONDS} с: $REMOVED"
fi

log "Готово."
log "  дамп:     $DUMP_FILE ($DUMP_BYTES байт, sha256 $DUMP_SHA)"
log "  манифест: $MANIFEST_FILE"
log "  дамп незашифрован: после проверки удалите его или переложите в зашифрованное хранилище."
printf '%s\n' "$DUMP_FILE"
