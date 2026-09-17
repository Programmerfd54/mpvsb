# 12. Приёмка, производительность и эксплуатация

## 12.1. Definition of Done задачи

1. Поведение соответствует странице/контракту и работает с БД.
2. Права, tenant scope и переходы проверяются сервером.
3. Есть нужные состояния loading/empty/error/forbidden/expired/conflict.
4. Подходящие риску проверки выполнены; команды и результаты записаны.
5. Интерфейс проверен визуально на относящихся к сценарию размерах.
6. Нет реальных данных/секретов и console errors.
7. Roadmap/HANDOFF/ADR обновлены; сводный prompt пересобран.

Не писать бессодержательные тесты каждого цвета или snapshot всех компонентов. Тестировать реальные правила, границы доступа, сложные формы и восстановление.

## 12.2. Матрица проверок

| Группа | Обязательные случаи |
|---|---|
| Unit | scoring fixtures, state transitions, missingness, permissions, report schema, metric denominators |
| DB integration | RLS under runtime role, composite FK, immutable versions, transaction-local tenant, конкурентный submit, outbox atomicity |
| API integration | auth/CSRF, IDOR across tenants, participant scopes, validation, idempotency, publish grant, token rotation |
| AI contract | fake/template/timeout/bad JSON/unknown evidence/prompt injection/unsupported probability |
| E2E | admin creates org → manager creates employee/assignment → participant completes → reviewer publishes → manager reads/records decision |
| E2E research | protocol → snapshots → frozen predictions → outcomes → metrics; blind invariants |
| E2E resilience | refresh, network outage, duplicate clicks, expired/revoked link, second tab, partial batch feedback |
| Privacy | revoke while job running; derived data deletion; no resurrection; export access; restore fence |
| A11y | axe on representative routes + keyboard/focus + 200% zoom + reduced motion |
| Visual | dashboard, table/drawer, wizard, mobile test, long report, admin editor; русский текст |

DB-тесты под owner не заменяют RLS-тесты под runtime user. Mock auth не заменяет реальный end-to-end вход. Fake AI допустим для продуктового пути, но real provider capability проверяется отдельно после настройки.

## 12.3. Синтетический демонстрационный сценарий

- Две компании A/B, по manager; platform admin; reviewer scoped к A.
- Компания A: 10 synthetic employees, три базовых сценария; одна completed, одна expired, одна revoked, остальные разных статусов.
- Три synthetic метода с ясной маркировкой и детерминированным подсчётом; никаких претензий на прогноз человека.
- Набор отчётов с partial/insufficient, противоречием и отсутствующим фактом; один superseded.
- Synthetic study10 cases только для проверки сравнительного механизма, без вывода «модель точна».
- Все аккаунты/пароли выдаются dev seed локально, не hardcoded production. Значения выводятся в локальном запуске только для synthetic fixtures, не коммитятся реальные credentials.

## 12.4. Целевые показатели качества — не измеренные факты

Пилотный профиль для измерения:10 организаций по500 employees,50 одновременных participant sessions,10 manager sessions; infrastructure profile обязательно записать. Это инженерная цель тестирования, не обещанная ёмкость уже готового продукта.

Targets: обычный GET p95<400ms, autosave p95<500ms, dashboard data p95<700ms при указанном профиле без external AI. Client interaction feedback<100ms, сохранение не вызывает layout shift. Web vitals на целевом mobile profile: LCP≤2.5s, INP≤200ms, CLS≤0.1. Проверять лабораторно и при доступности real monitoring без PII. Генерация AI не включается в HTTP request latency и не имеет выдуманного SLA.

Не грузить charts/editor/AI tooling в participant bundle. Lazy-load admin editor, virtualize только если нужно после измерения. Списки paginated; нет N+1 queries; индексы проверены EXPLAIN на synthetic load. Не оптимизировать посредством общего кэша персональных отчётов.

## 12.5. CI

На PR: npm ci → format/lint/typecheck → unit → DB migrate/test under runtime role → production build → targeted E2E → docs check. Dependency/security scanning с triage; не отключать проверки ради зелёного статуса. Артефакты screenshot только synthetic. Скриншоты ошибок реальных клиентов в CI запрещены.

Если CI runner не имеет нужных secrets, real-provider test явно skipped с причиной, а не pass. Секретные provider tests не запускаются на недоверенных внешних PR.

## 12.6. Локальный запуск, который должен появиться при реализации

```sh
npm ci
cp .env.example .env
docker compose -f infra/compose.yaml up -d postgres
npm run db:migrate
npm run db:seed:demo
npm run dev
```

Эти команды — целевой интерфейс будущего приложения; на стадии этого пакета package.json/Compose ещё отсутствуют. README реализации должен указать web/API URLs, synthetic login способ и как остановить процессы. One-command demo после setup желательно через `npm run demo`.

## 12.7. Эксплуатационные инструкции

Документировать: обязательные env, migrations, start/stop, readiness, rollback, rotate secrets, создать первого admin, восстановить доступ, приостановить tenant, обработать failed job, отозвать ссылку, удалить данные, backup/restore, обрабатывать incident.

Health `/health/live` не читает БД, `/health/ready` проверяет необходимые зависимости и миграции; public output без версий/секретов. Метрики: request latency/error, queue delay, job retries, report pending age, autosave errors, consent processing holds, deletion failures. Не включать сотрудника/название организации как high-cardinality metric labels.

Backups: default engineering target RPO24h/RTO8h до уточнения; это цель, не достигнутый SLA. Проверить восстановление на staging с synthetic данными и documented duration. Restore не открывать пользователям до применения deletion fences.

## 12.8. Финальная приёмка платформы

- Все P0 пользовательские пути реализованы, не осталось видимых неработающих buttons.
- Установка на чистом окружении воспроизводима.
- Три доступа и две компании работают; foreign-tenant requests отвергаются.
- Несколько тестов назначаются и проходятся на телефоне с восстановлением последнего сохранённого шага.
- Report review/publish работает; unsupported методика/AI claim блокируется.
- Слепое сравнение synthetic examples работает и не представлено как доказательство научной точности.
- Реальные методики/правовые зависимости честно имеют незакрытые статусы до получения материалов.
- Визуальная приёмка и доступность пройдены с описанием исключений.
- Handoff содержит фактические команды, результаты и незавершённые требования.

## 12.9. Разные критерии успеха пилота

**Технический:** всё работает. **Продуктовый:** руководитель понимает и использует результат. **Коммерческий:** компания оплатила пилот на согласованных условиях. **Методический:** проверка поддерживает конкретный заявленный вывод. Не объединять эти четыре статуса одной галочкой «готово». Приложение без биллинга не может само подтвердить оплату — evidence о ней фиксируется ответственным вне автоматического scoring.
