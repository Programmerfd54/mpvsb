#!/usr/bin/env bash
# Проверка восстановленной базы: соответствие манифесту резервной копии,
# права ролей, RLS, схема очереди и ограды удаления.
#
#   RESTORE_TARGET_URL=postgresql://context_owner:...@127.0.0.1:55443/context_restore_check \
#   PG_CONTAINER=context-postgres-test \
#   scripts/ops/verify-restore.sh backups/context-20260917T060000Z.manifest
#
# Ненулевой код возврата означает, что базу открывать нельзя.
#
# РОЛЬ: только роль с BYPASSRLS (эксплуатационная роль восстановления,
# см. RUNBOOK § 6.0). Под ролью без него политики FORCE RLS скрывают строки, и
# проверки оград прошли бы на пустом наборе; verify-restore.sql этого не допустит
# и завершится с ошибкой. Роль миграций не подходит: ей BYPASSRLS в production
# запрещён.
#
# Что считается нормой:
#   • количества строк совпадают с манифестом ТОЧНО (манифест снимает их в снимке
#     самого дампа); исключение — platform.audit_events, где ограды удаления
#     дописывают по одной записи на организацию: допустимый прирост ограничен
#     числом записей 'restore.deletion_fences_applied' в самой копии;
#   • число политик, число таблиц с FORCE RLS и мажорная версия сервера совпадают
#     с манифестом ТОЧНО;
#   • список миграций и контрольные суммы совпадают с базой-источником и с
#     файлами репозитория: восстановленная база соответствует этой версии кода;
#   • структурные проверки из verify-restore.sql пройдены.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ops/lib.sh
. "$SCRIPT_DIR/lib.sh"

MANIFEST="${1:-}"
[[ -n "$MANIFEST" ]] || fail "Укажите манифест копии: scripts/ops/verify-restore.sh <файл.manifest>"
[[ -f "$MANIFEST" ]] || fail "Манифест не найден: $MANIFEST"
[[ -n "${RESTORE_TARGET_URL:-}" ]] ||
  fail "Не задана RESTORE_TARGET_URL — подключение к проверяемой восстановленной базе."

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/packages/database/migrations"
FENCE_IDS="${RESTORE_FENCE_IDS:-}"
[[ -n "$FENCE_IDS" ]] || FENCE_IDS='{}'

pg_env "$RESTORE_TARGET_URL"

FAILURES=0
ok() { printf '  [ок]     %s\n' "$*"; }
bad() {
  printf '  [ОШИБКА] %s\n' "$*"
  FAILURES=$((FAILURES + 1))
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

section_of() { sed -n "/^\[$1\]$/,/^\[/p" "$MANIFEST" | sed '1d;/^\[/d' | sed '/^$/d'; }
value_of() { sed -n "s/^$1=//p" "$MANIFEST" | head -n 1; }

# Манифесты, снятые до перехода на снимок транзакции, сравнивать строго нельзя:
# их количества брались двумя отдельными запросами вокруг дампа.
COUNTS_SOURCE="$(value_of counts_source)"
[[ "$COUNTS_SOURCE" == "dump_snapshot" ]] ||
  fail "Манифест снят старой версией backup.sh (counts_source=${COUNTS_SOURCE:-нет}). Количества строк в нём не относятся к снимку дампа, строгая сверка полноты невозможна. Снимите копию заново."

# Ожидаемые значения границы изоляции берутся ИЗ МАНИФЕСТА и сверяются точным
# равенством. Пороги «не меньше N» пропустили бы потерю части политик или FORCE RLS
# при восстановлении — то есть ровно то, ради чего эта проверка существует.
EXPECTED_POLICIES="$(value_of policies)"
EXPECTED_RLS_FORCED="$(value_of rls_forced_tables)"
EXPECTED_SERVER_VERSION="$(value_of server_version)"
EXPECTED_SERVER_MAJOR="${EXPECTED_SERVER_VERSION%%.*}"
for pair in "policies:$EXPECTED_POLICIES" "rls_forced_tables:$EXPECTED_RLS_FORCED" \
  "server_version:$EXPECTED_SERVER_VERSION"; do
  [[ -n "${pair#*:}" ]] ||
    fail "В манифесте нет ключа ${pair%%:*}: сверять границу изоляции восстановленной базы не с чем. Снимите копию текущей версией backup.sh."
done

echo "Проверка восстановленной базы $PGDATABASE по манифесту $(basename "$MANIFEST")"

# --- 1. Миграции -----------------------------------------------------------------
echo "Миграции:"
EXPECTED_MIGRATIONS="$(section_of migrations)"
ACTUAL_MIGRATIONS="$(psql_quiet -c "select filename || ' ' || checksum from public.schema_migrations order by filename")"
if [[ "$EXPECTED_MIGRATIONS" == "$ACTUAL_MIGRATIONS" ]]; then
  ok "список и контрольные суммы совпадают с источником ($(wc -l <<<"$ACTUAL_MIGRATIONS" | tr -d ' ') шт.)"
else
  bad "список миграций отличается от манифеста:"
  diff <(echo "$EXPECTED_MIGRATIONS") <(echo "$ACTUAL_MIGRATIONS") | sed 's/^/      /' || true
fi

while read -r filename checksum; do
  [[ -z "$filename" ]] && continue
  if [[ ! -f "$MIGRATIONS_DIR/$filename" ]]; then
    bad "миграции $filename нет в репозитории: база новее кода"
    continue
  fi
  actual="$(sha256_of "$MIGRATIONS_DIR/$filename")"
  [[ "$actual" == "$checksum" ]] ||
    bad "миграция $filename в базе не совпадает с файлом репозитория"
done <<<"$ACTUAL_MIGRATIONS"

# --- 2. Количества строк ---------------------------------------------------------
echo "Количества строк ключевых таблиц:"
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
ACTUAL_COUNTS="$(psql_quiet -c "$COUNTS_SQL")"
EXPECTED_COUNTS="$(section_of counts)"

# Допустимый прирост platform.audit_events считается ДО цикла: любой вызов psql
# внутри `while read` съел бы остаток here-string вместе с оставшимися таблицами
# (docker exec -i и psql читают stdin), и сверка молча оборвалась бы на середине.
AUDIT_FENCE_ROWS="$(psql_quiet -c "select count(*) from platform.audit_events where action = 'restore.deletion_fences_applied'")"

MISMATCHES=0
while read -r table expected; do
  [[ -z "$table" ]] && continue
  actual="$(awk -v t="$table" '$1 == t { print $2 }' <<<"$ACTUAL_COUNTS")"
  if [[ -z "$actual" ]]; then
    bad "таблицы $table нет в восстановленной базе"
    continue
  fi
  if [[ "$actual" == "$expected" ]]; then
    continue
  fi
  if [[ "$table" == "platform.audit_events" ]]; then
    # Ограды пишут строго одну запись на организацию, по которой что-то изменили.
    # Поэтому допустимый прирост не «любой», а ровно число таких записей в самой
    # восстановленной базе: лишние строки из чужого источника или частично
    # применённый дамп должны оставаться ошибкой.
    if [[ "$actual" -ge "$expected" && $((actual - expected)) -le "$AUDIT_FENCE_ROWS" ]]; then
      ok "$table: $actual (в манифесте $expected; записей оград: $AUDIT_FENCE_ROWS)"
      continue
    fi
    bad "$table: $actual строк вместо $expected; записей оград — $AUDIT_FENCE_ROWS, такой прирост ими не объясняется"
    MISMATCHES=$((MISMATCHES + 1))
    continue
  fi
  # Сверка строгая: количества в манифесте сняты в снимке самого дампа, поэтому
  # любое расхождение — потеря или лишние данные, а не «база менялась».
  MISMATCHES=$((MISMATCHES + 1))
  bad "$table: $actual строк вместо $expected"
done <<<"$EXPECTED_COUNTS"

EXTRA="$(comm -13 <(awk '{print $1}' <<<"$EXPECTED_COUNTS" | sort) <(awk '{print $1}' <<<"$ACTUAL_COUNTS" | sort) || true)"
[[ -z "$EXTRA" ]] || bad "в восстановленной базе есть лишние таблицы: $(tr '\n' ' ' <<<"$EXTRA")"

[[ "$MISMATCHES" -eq 0 ]] &&
  ok "совпадают по всем таблицам ($(wc -l <<<"$EXPECTED_COUNTS" | tr -d ' ') шт.)"

# --- 3. Структура, права, RLS, ограды --------------------------------------------
echo "Права, RLS и ограды удаления:"
CHECKS="$(pg_run psql --no-psqlrc --set=ON_ERROR_STOP=1 --set=fence_ids="$FENCE_IDS" \
  --set=expected_policies="$EXPECTED_POLICIES" \
  --set=expected_rls_forced="$EXPECTED_RLS_FORCED" \
  --set=expected_server_major="$EXPECTED_SERVER_MAJOR" \
  <"$SCRIPT_DIR/verify-restore.sql")"

while IFS='|' read -r name status detail; do
  [[ -z "$name" ]] && continue
  case "$status" in
    ok) ok "$name — $detail" ;;
    fail) bad "$name — $detail" ;;
    *) continue ;;
  esac
done <<<"$CHECKS"

echo
if [[ "$FAILURES" -eq 0 ]]; then
  echo "Проверка пройдена: базу можно открывать приложению."
  echo "Перед подключением приложения задайте пароли runtime-ролей (npm run db:migrate с окружением этой базы)."
else
  echo "Проверка НЕ пройдена: $FAILURES замечаний. Базу открывать нельзя."
  exit 1
fi
