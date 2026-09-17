#!/usr/bin/env bash
# Общие функции скриптов эксплуатации: разбор строки подключения и запуск
# клиентских утилит PostgreSQL.
#
# Подключается через `. "$(dirname "$0")/lib.sh"`. Самостоятельно ничего не делает.
#
# Пароль никогда не передаётся аргументом команды: он уходит в PGPASSWORD и
# пробрасывается в контейнер по имени переменной (docker exec -e PGPASSWORD),
# поэтому не попадает в список процессов хоста и в журналы.

set -euo pipefail

# Версия клиентских утилит должна совпадать с версией сервера. Если на машине
# psql/pg_dump другой версии, укажите контейнер с нужной: PG_CONTAINER=context-postgres.
PG_CONTAINER="${PG_CONTAINER:-}"

# Утилиты, запущенные ВНУТРИ контейнера, видят сервер по внутреннему адресу, а не
# по опубликованному порту хоста из строки подключения. Поэтому при заданном
# PG_CONTAINER host/port подменяются на внутренние; при необходимости их можно
# переопределить (например, когда сервер в соседнем контейнере той же сети).
PG_CONTAINER_HOST="${PG_CONTAINER_HOST:-127.0.0.1}"
PG_CONTAINER_PORT="${PG_CONTAINER_PORT:-5432}"

log() { printf '%s\n' "$*" >&2; }
fail() {
  printf 'Ошибка: %s\n' "$*" >&2
  exit 1
}

# Разбор postgresql://user:password@host:port/dbname в переменные libpq.
# Пример: pg_env "$DATABASE_URL_MIGRATOR"  →  PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
pg_env() {
  local url="$1" rest userinfo hostinfo user password host port database
  case "$url" in
    postgresql://* | postgres://*) ;;
    *) fail "Строка подключения должна начинаться с postgresql://. Получено: ${url%%:*}..." ;;
  esac

  rest="${url#*://}"
  rest="${rest%%\?*}" # параметры запроса в libpq-переменные не переносятся

  if [[ "$rest" == *@* ]]; then
    userinfo="${rest%%@*}"
    hostinfo="${rest#*@}"
  else
    userinfo=""
    hostinfo="$rest"
  fi

  user="${userinfo%%:*}"
  password=""
  [[ "$userinfo" == *:* ]] && password="${userinfo#*:}"

  database="${hostinfo#*/}"
  hostinfo="${hostinfo%%/*}"
  host="${hostinfo%%:*}"
  port="5432"
  [[ "$hostinfo" == *:* ]] && port="${hostinfo##*:}"

  PGHOST="$(url_decode "$host")"
  PGPORT="$port"
  PGUSER="$(url_decode "$user")"
  PGPASSWORD="$(url_decode "$password")"
  PGDATABASE="$(url_decode "$database")"

  if [[ -n "$PG_CONTAINER" ]]; then
    # Клиентские утилиты запускаются внутри контейнера: адрес из строки
    # подключения (опубликованный порт хоста) оттуда недоступен.
    if [[ "$PGHOST" != "$PG_CONTAINER_HOST" || "$PGPORT" != "$PG_CONTAINER_PORT" ]]; then
      log "Подключение внутри контейнера $PG_CONTAINER: адрес $PGHOST:$PGPORT заменён на $PG_CONTAINER_HOST:$PG_CONTAINER_PORT."
      log "Если сервер доступен контейнеру по другому адресу, задайте PG_CONTAINER_HOST и PG_CONTAINER_PORT."
    fi
    PGHOST="$PG_CONTAINER_HOST"
    PGPORT="$PG_CONTAINER_PORT"
  fi

  export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
}

# Процентное декодирование значений строки подключения (RFC 3986).
#
# Только %XX: правило «+ означает пробел» действует в query string, но не в
# userinfo, а пароли из `openssl rand -base64 24` регулярно содержат '+'.
# Обратные слэши в значении остаются собой: интерпретировать их нельзя.
url_decode() {
  local value="$1" out='' chunk hex
  local -i i=0 length=${#value}

  while ((i < length)); do
    chunk="${value:i:1}"
    hex="${value:i+1:2}"
    if [[ "$chunk" == '%' && "$hex" =~ ^[0-9A-Fa-f]{2}$ ]]; then
      # Формат %b получает ровно '\xHH' и ничего другого не интерпретирует.
      printf -v chunk '%b' "\\x$hex"
      i+=3
    else
      i+=1
    fi
    out+="$chunk"
  done

  printf '%s' "$out"
}

# Запуск клиентской утилиты: локально или внутри контейнера с нужной версией.
# Переменные подключения передаются по имени, значения остаются в окружении.
pg_run() {
  if [[ -n "$PG_CONTAINER" ]]; then
    docker exec -i \
      -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE \
      -e PGCONNECT_TIMEOUT -e PGOPTIONS \
      "$PG_CONTAINER" "$@"
  else
    "$@"
  fi
}

# psql для служебных запросов: без заголовков, без выравнивания, падает на первой ошибке.
psql_quiet() {
  pg_run psql --no-psqlrc --quiet --no-align --tuples-only --set=ON_ERROR_STOP=1 "$@"
}

# Проверка доступности клиентских утилит нужной версии.
require_tools() {
  local server client
  server="$(psql_quiet -c 'show server_version' | cut -d. -f1)"
  client="$(pg_run pg_dump --version | sed 's/[^0-9]*\([0-9]*\).*/\1/')"
  [[ "$server" == "$client" ]] ||
    fail "Версия pg_dump ($client) не совпадает с версией сервера ($server). Задайте PG_CONTAINER с контейнером нужной версии."
}
