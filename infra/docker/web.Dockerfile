# syntax=docker/dockerfile:1
#
# Образ веб-интерфейса (Next.js App Router): обычная `next build` + `next start`.
#
# Сборка из корня репозитория:
#   docker build -f infra/docker/web.Dockerfile --build-arg NODE_VERSION=$(cat .nvmrc) \
#     --build-arg API_INTERNAL_URL=http://api:3001 -t context-web .
#
# API_INTERNAL_URL — не секрет, а внутренний адрес API для rewrites same-origin
# (/api/v1/*, /health/*). Next записывает rewrites в манифест при сборке, поэтому
# адрес задаётся build arg и совпадает с именем сервиса API в сети оркестратора.
# Секретов у web нет: сессии и права проверяет API.
#
# Компактный вариант (output: 'standalone') требует правки apps/web/next.config.ts;
# до неё в образ попадают production-зависимости рабочего пространства web.

ARG NODE_VERSION=24.21.0

# --- База: точная версия Node из .nvmrc ------------------------------------------
FROM node:${NODE_VERSION}-trixie-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NEXT_TELEMETRY_DISABLED=1

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
ARG API_INTERNAL_URL=http://api:3001
RUN --mount=type=cache,target=/root/.npm npm ci
COPY packages/config packages/config
COPY packages/domain packages/domain
COPY packages/contracts packages/contracts
COPY apps/web apps/web
# NODE_ENV выставляет сама next build; значение development в окружении ломает сборку.
RUN npm run build --workspace @context/domain --workspace @context/contracts \
 && API_INTERNAL_URL="${API_INTERNAL_URL}" npm run build --workspace @context/web \
 && rm -rf apps/web/.next/cache

# --- Production-зависимости только web -------------------------------------------
FROM manifests AS prod
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace @context/web --include-workspace-root=false
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/web/.next apps/web/.next
COPY --from=build /app/apps/web/next.config.ts apps/web/next.config.ts
RUN find packages -path '*/dist/*' \( -name '*.map' -o -name '*.d.ts' \) -delete

# --- Рантайм ----------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=prod /app /app
USER node
WORKDIR /app/apps/web
EXPOSE 3000
# Проверяется сам сервер страниц, а не API за rewrites: живость web не зависит от БД.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "--port", "3000"]
