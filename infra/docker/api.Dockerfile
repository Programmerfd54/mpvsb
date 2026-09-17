# syntax=docker/dockerfile:1
#
# Образ API (NestJS + Fastify). Тот же образ выполняет миграции отдельной одноразовой
# командой под ролью владельца схемы (см. infra/compose.app.yaml, сервис migrate).
#
# Сборка из корня репозитория:
#   docker build -f infra/docker/api.Dockerfile --build-arg NODE_VERSION=$(cat .nvmrc) -t context-api .
#
# Секретов в образе и build args нет: подключения, пароли ролей и TOKEN_HASH_SECRET
# передаются окружением при запуске контейнера.

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
# Версия Node в образе обязана совпадать с закреплённой в репозитории.
RUN test "v$(cat .nvmrc)" = "$(node --version)" \
  || { echo "Node $(node --version) не совпадает с .nvmrc ($(cat .nvmrc)). Передайте --build-arg NODE_VERSION=\$(cat .nvmrc)." >&2; exit 1; }

# --- Сборка: полные зависимости, компиляция TypeScript, генерация Prisma ----------
FROM manifests AS build
RUN --mount=type=cache,target=/root/.npm npm ci
COPY packages/config packages/config
COPY packages/domain packages/domain
COPY packages/contracts packages/contracts
COPY packages/scoring packages/scoring
COPY packages/testing packages/testing
COPY packages/ai packages/ai
COPY packages/database packages/database
COPY apps/api apps/api
RUN npm run build \
      --workspace @context/domain \
      --workspace @context/contracts \
      --workspace @context/scoring \
      --workspace @context/testing \
      --workspace @context/ai \
      --workspace @context/database \
      --workspace @context/api

# --- Production-зависимости только нужного рабочего пространства ------------------
FROM manifests AS prod
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace @context/api --include-workspace-root=false
# Только результаты сборки: исходники TypeScript и тесты в образ не попадают.
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/scoring/dist packages/scoring/dist
COPY --from=build /app/packages/testing/dist packages/testing/dist
COPY --from=build /app/packages/ai/dist packages/ai/dist
COPY --from=build /app/packages/database/dist packages/database/dist
COPY --from=build /app/packages/database/generated packages/database/generated
COPY --from=build /app/packages/database/migrations packages/database/migrations
COPY --from=build /app/apps/api/dist apps/api/dist
# Карты исходников и декларации типов в рантайме не нужны.
RUN find packages apps -path '*/dist/*' \( -name '*.map' -o -name '*.d.ts' \) -delete

# --- Рантайм ----------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    APP_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001
# Код принадлежит root и только читается: процесс node не может его изменить.
COPY --from=prod /app /app
USER node
WORKDIR /app/apps/api
EXPOSE 3001
# /health/live не обращается к БД: перезапуск контейнера не зависит от доступности базы.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]
