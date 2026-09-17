# syntax=docker/dockerfile:1
#
# Образ фоновой обработки (очередь pg-boss, подсчёт, подготовка заключений).
# Публичного порта нет; схему очереди создаёт миграция, worker работает с migrate: false.
#
# Сборка из корня репозитория:
#   docker build -f infra/docker/worker.Dockerfile --build-arg NODE_VERSION=$(cat .nvmrc) -t context-worker .
#
# Секретов в образе и build args нет: DATABASE_URL_WORKER передаётся окружением.

ARG NODE_VERSION=24.21.0

# --- База: точная версия Node из .nvmrc ------------------------------------------
FROM node:${NODE_VERSION}-trixie-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Манифесты всех рабочих пространств: npm ci проверяет lockfile целиком.
FROM base AS manifests
COPY package.json package-lock.json .nvmrc ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/database/package.json packages/database/
COPY packages/scoring/package.json packages/scoring/
COPY packages/ai/package.json packages/ai/
COPY packages/testing/package.json packages/testing/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/evaluator/package.json apps/evaluator/
COPY apps/web/package.json apps/web/
RUN test "v$(cat .nvmrc)" = "$(node --version)" \
  || { echo "Node $(node --version) не совпадает с .nvmrc ($(cat .nvmrc)). Передайте --build-arg NODE_VERSION=\$(cat .nvmrc)." >&2; exit 1; }

# --- Сборка ----------------------------------------------------------------------
FROM manifests AS build
RUN --mount=type=cache,target=/root/.npm npm ci
COPY packages/config packages/config
COPY packages/domain packages/domain
COPY packages/contracts packages/contracts
COPY packages/scoring packages/scoring
COPY packages/testing packages/testing
COPY packages/ai packages/ai
COPY packages/database packages/database
COPY apps/worker apps/worker
RUN npm run build \
      --workspace @context/domain \
      --workspace @context/contracts \
      --workspace @context/scoring \
      --workspace @context/testing \
      --workspace @context/ai \
      --workspace @context/database \
      --workspace @context/worker

# --- Production-зависимости только worker ----------------------------------------
FROM manifests AS prod
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace @context/worker --include-workspace-root=false
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/scoring/dist packages/scoring/dist
COPY --from=build /app/packages/testing/dist packages/testing/dist
COPY --from=build /app/packages/ai/dist packages/ai/dist
COPY --from=build /app/packages/database/dist packages/database/dist
COPY --from=build /app/packages/database/generated packages/database/generated
COPY --from=build /app/apps/worker/dist apps/worker/dist
RUN find packages apps -path '*/dist/*' \( -name '*.map' -o -name '*.d.ts' \) -delete

# --- Рантайм ----------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    APP_ENV=production
COPY --from=prod /app /app
USER node
WORKDIR /app/apps/worker
# HTTP-проверки у worker нет: живость контролирует оркестратор по коду выхода процесса
# (при потере очереди bootstrap завершается с ошибкой), а задержку очереди видно
# на экране обработки администратора.
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]
