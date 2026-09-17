# 08. HTTP API и правила взаимодействия

## 08.1. Общий контракт

Base `/api/v1`, JSON UTF-8, ISO timestamps, request ID. Same-origin cookies; mutating requests проверяют CSRF token и Origin. OpenAPI генерируется из тех же DTO/schemas, по которым валидирует сервер. Внешний DTO не содержит Prisma model или secret keys.

Success: `{ "data": ..., "meta": { "requestId": "..." } }`.

List: `{ "data": [], "meta": { "page": 1, "pageSize": 20, "total": 0, "requestId": "..." } }`. Сортировка стабильная с id tie-breaker. Page size max100. Unknown query fields reject/strip по явной схеме, never forward to ORM.

Error `application/problem+json`:

```json
{
  "type": "urn:context:error:revision-conflict",
  "title": "Ответ был изменён в другом окне",
  "status": 409,
  "code": "REVISION_CONFLICT",
  "requestId": "req_demo",
  "fieldErrors": [],
  "retryable": false
}
```

400 invalid schema; 401 missing/expired session; 403 capability denied; 404 unknown or чужой объект; 409 state/revision conflict; 410 expired invitation без PII; 422 business validation; 429 rate limit + Retry-After; 503 dependency unavailable. Не использовать 200 для бизнес-ошибки.

Запись с optimistic concurrency: `If-Match: "revision"`, ответ ETag. Не совпало → 409/412 по единому решению (в этом ТЗ default 409). Создание/submit/publish/freeze/evaluate с `Idempotency-Key`; срок dedup минимум24h для бизнес-операций. Повтор с тем же key и другим payload →409.

Для API с `expectedRevision` в body заголовок может быть опущен; если переданы оба, они должны совпадать. Итоговая ошибка stale revision всегда409. Auth/участник/manager guards выбирают только соответствующий тип cookie: одновременно открытые два кабинета не объединяют permissions.

## 08.2. Контракты ключевых операций

### Создать назначения

`POST /orgs/:orgId/assignments/batch`

```json
{
  "scenarioVersionId": "uuid",
  "employeeIds": ["uuid"],
  "context": { "decisionQuestion": "Синтетический пример", "targetRole": "Координатор" },
  "perEmployeeContext": {},
  "dueAt": "2026-10-01T12:00:00Z",
  "mode": "demo",
  "duplicatePolicy": "reject"
}
```

201 возвращает assignment IDs/status; секретные ссылки выдаются отдельной issue-операцией. Для batch max50: предварительная валидация всего списка; по умолчанию атомарная запись всех назначений. Если продуктовая bulk-операция допускает частичный результат (например archive), ответ содержит per-item success/error и явный общий status; никаких невидимых пропусков.

### Сохранить ответ

`PUT /participant/attempts/:id/answers/:itemId`

```json
{ "response": { "type": "single_choice", "optionId": "option_demo_2" }, "expectedRevision": 4 }
```

Ответ: `{ data: { attemptRevision: 5, savedAt: "...", activeItemId: "item_demo_3" } }`. Attempt/item принадлежит participant session, schema проверяется по pinned version. Rate limit не должен ломать нормальный autosave.

### Отправить тест

`POST /participant/attempts/:id/submit` body `{ expectedRevision: 5 }`. Транзакция проверяет completeness, consent, deadline, state, сохраняет snapshot и outbox. 200/201 с submitted state; score выполняется асинхронно.

### Публикация отчёта

`POST /orgs/:orgId/reports/:reportId/revisions/:revisionId/publish` body `{ checklist: {...}, expectedRevision: 2 }`. Проверить review permission/grant, evidence integrity, live consent, study separation. Успех возвращает immutable published revision и notification reference.

## 08.3. Авторизация и профиль

| Method/path | Назначение / доступ |
|---|---|
| POST `/auth/login` | manager/admin; email/password; rate limited |
| POST `/auth/logout` | revoke session, expire cookie |
| GET `/auth/me` | безопасный профиль, memberships и разрешения |
| POST `/auth/activate` | одноразовый activation token + password |
| POST `/auth/recovery-requests` | единый ответ без enumeration |
| POST `/auth/password-reset` | reset token + password; revoke прежние сессии |
| POST `/auth/password/change` | текущий пароль/re-auth + новый |
| GET `/auth/sessions` | собственные sessions без hashes |
| DELETE `/auth/sessions/:id` | своя сессия или все остальные отдельным endpoint |
| POST `/auth/mfa/setup`, `/verify`, `/recovery` | только owner учётки, re-auth; rate limited |
| POST `/auth/organization-context` | выбор существующего активного membership |

## 08.4. Организации и сотрудники

| Method/path | Действие |
|---|---|
| GET/PATCH `/orgs/:orgId` | настройки в доступном scope |
| GET `/orgs/:orgId/dashboard` | счётчики и attention items |
| GET/POST `/orgs/:orgId/members` | список/приглашение manager |
| PATCH/DELETE `/orgs/:orgId/members/:id` | permissions/revoke; last owner protected |
| POST `/orgs/:orgId/members/:id/invitation` | issue/rotate activation URL once |
| GET `/orgs/:orgId/access-grants` | scoped запросы и выданные гранты для owner; страничный ответ (`meta.page/pageSize/total`, не плоский массив) |
| POST `/orgs/:orgId/access-grants/:id/approve` | owner разрешает конкретный scope/срок (1–24 ч; `useRequestedHours` — выдать запрошенный срок без изменения) |
| POST `/orgs/:orgId/access-grants/:id/reject` | owner отклоняет с причиной |
| POST `/orgs/:orgId/access-grants/:id/revoke` | owner отзывает; закрывает всю цепочку продлений; немедленный эффект |
| GET/POST `/orgs/:orgId/employees` | список/create |
| GET/PATCH `/orgs/:orgId/employees/:id` | карточка/edit |
| POST `/orgs/:orgId/employees/:id/archive` | archive и явная политика активных назначений |
| POST `/orgs/:orgId/employees/bulk-archive` | max50, per-item results |
| GET `/orgs/:orgId/employees/:id/timeline` | безопасная история |

## 08.5. Назначения и отчёты

| Method/path | Действие |
|---|---|
| GET `/orgs/:orgId/scenarios` | только доступные published projections |
| GET `/orgs/:orgId/scenarios/:versionId` | context schema + method public metadata |
| POST/GET/PATCH `/orgs/:orgId/assignment-drafts[/:id]` | wizard draft, revision |
| DELETE `/orgs/:orgId/assignment-drafts/:id` | свой draft |
| POST `/orgs/:orgId/assignments/batch` | атомарно создать назначения |
| GET `/orgs/:orgId/assignments` | фильтруемый список |
| GET `/orgs/:orgId/assignments/:id` | context + status, no raw answers |
| POST `/orgs/:orgId/assignments/:id/invitations` | issue/rotate; вернуть plaintext URL once; no-store |
| PATCH `/orgs/:orgId/assignments/:id/deadline` | валидное продление, audit |
| POST `/orgs/:orgId/assignments/:id/cancel` | invalidate sessions/jobs |
| GET `/orgs/:orgId/reports` | только published unless review scope |
| GET `/orgs/:orgId/reports/:id` | разрешённая projection конкретной revision |
| GET `/orgs/:orgId/reports/:id/print` | данные печатной формы с тем же auth |
| POST `/orgs/:orgId/reports/:id/decisions` | действие руководителя |
| GET `/orgs/:orgId/reports/:id/corrections` | список запросов на исправление (`reports.review`); без имени заявителя, чтение пишется в аудит |
| POST `/orgs/:orgId/reports/:id/corrections` | запрос на исправление |
| GET `/orgs/:orgId/reviews` | permissioned pending drafts |
| GET `/orgs/:orgId/reviews/:id/evidence` | источник по scope, без исходов |
| PATCH `/orgs/:orgId/reviews/:id/draft` | новая draft revision/optimistic revision |
| POST `/orgs/:orgId/reviews/:id/request-revision` | замечания и новая задача |
| POST `/orgs/:orgId/reports/:id/revisions/:revisionId/publish` | publish |

## 08.6. Сотрудник

| Method/path | Действие |
|---|---|
| POST `/participant/exchange` | invitation token → scoped session |
| GET `/participant/session` | assignment brief/expiry, без ключей |
| GET `/participant/terms` | зафиксированные условия/документы |
| POST `/participant/consents` | подтверждение document hashes/purposes |
| POST `/participant/decline` | нейтральный отказ |
| GET `/participant/attempts` | список разрешённых попыток |
| GET `/participant/attempts/:id` | вопросы/варианты + свои текущие ответы |
| POST `/participant/attempts/:id/start` | state/started_at/lease |
| PUT `/participant/attempts/:id/answers/:itemId` | autosave |
| PATCH `/participant/attempts/:id/position` | текущий вопрос после сохранения |
| POST `/participant/attempts/:id/submit` | неизменяемая отправка |
| GET `/participant/completion` | receipt/stage |
| GET `/participant/feedback` | только разрешённый опубликованный participant summary |
| POST `/participant/privacy-requests` | correction/access/withdrawal |
| POST `/participant/logout` | revoke participant session |

## 08.7. Исследования

GET/POST `/orgs/:orgId/studies`; GET/PATCH `/:id`; POST `/:id/lock`; GET/POST `/:id/cases`; POST `/:id/snapshots/import-preview`; POST `/:id/snapshots/import-confirm`; POST `/:id/cases/:caseId/baseline`; POST `/:id/freeze-predictions`; POST `/:id/open-outcomes`; GET/POST `/:id/outcomes`; POST `/:id/evaluate`; GET `/:id/evaluations`; GET `/:id/export`.

Outcomes/evaluate используют отдельный evaluation service/credentials, проверяют phase, role conflict и protocol. Raw endpoint не даёт score worker обойти blind flag. Импорт snapshots не принимает outcome columns; preview перечисляет unknown/forbidden fields. Исходы до freeze не принимаются вообще.

## 08.8. Администрирование

Prefix `/admin`; отдельный guard platform_admin, additional scoped grants для содержания.

- `/organizations` GET/POST; `/:id` GET/PATCH; `/:id/suspend`, `/resume` POST; `/:id/readiness` GET/PATCH.
- `/recovery-requests` GET; `/:id/verify`, `/issue-reset-link`, `/reject` POST, только допустимые manager account scope; platform admin recovery вне публичного API.
- `/access-grants` GET (все свои обращения по организациям); `/organizations/:orgId/access-grants` GET/POST (запрос гранта на назначения этой организации) и `/:grantId/extend` POST (продление своим же обращением — новая запись, прежний срок не меняется); `/access-grants/:grantId/revoke` POST (владелец отзывает или сам запрашивающий снимает нерешённое обращение — решение по вызывающему); `/access-grants/:grantId/cases` GET и `/cases/:assignmentId/report` GET — чтение в объёме действующего гранта, каждое чтение аудируется. Решение (`approve`/`reject`/`revoke`) принимает исключительно owner организации через org-scoped `/orgs/:orgId/access-grants/*` (08.4) — самому запросившему администратору approve/reject недоступны.
- `/organizations/:orgId/assignments` GET — узкий перечень назначений организации для составления объёма обращения: только `assignmentId/caseCode/scenarioTitle/scenarioCode/createdAt`, без состояния назначения и признаков заключения; каждое чтение аудируется отдельно от чтения по гранту (ADR-030).
- `/methods` GET/POST; `/:id/versions` POST; `/method-versions/:id` GET/PATCH; `/validate`, `/preview`, `/request-review`, `/publish`, `/retire`, `/suspend` POST.
- `/scenarios` GET/POST; `/scenario-versions/:id` GET/PATCH и validate/review/publish/retire.
- `/ai/providers` GET (без keys); `/ai/prompt-versions` GET/POST; `/:id/test`, `/publish`, `/activate` POST.
- `/reviews` GET и операции по тем же org-scoped application services, без обхода policy.
- `/jobs` GET; `/:id` GET redacted; `/:id/retry`, `/cancel-retries` POST.
- `/knowledge/articles` GET/POST; `/:id/versions` POST/PATCH draft; `/:id/publish`, `/archive` POST.
- `/audit` GET; `/audit/export` POST ограниченный export.
- `/privacy-requests` GET; `/:id` GET; `/approve`, `/reject`, `/execute`, `/complete` POST с state machine.
- `/settings` GET/PATCH allowlist; `/readiness` GET.

## 08.9. Справка и уведомления

GET `/knowledge?audience=...&query=...`; GET `/knowledge/:slug` с server audience policy.

Уведомления вложены в организацию, а не плоские: организацию подтверждает членство (`ManagerGuard`), внутри RLS отсекает чужой tenant, чужой ящик закрыт явным фильтром по получателю.

- `GET /orgs/:orgId/notifications?filter=unread|all&page&pageSize` — страничный список своих уведомлений.
- `GET /orgs/:orgId/notifications/unread-count` — счётчик для колокольчика.
- `POST /orgs/:orgId/notifications/:notificationId/read`, `POST /orgs/:orgId/notifications/read-all` — отметка прочитанным, возвращают пересчитанный `unread`.
- `POST /orgs/:orgId/notifications/:notificationId/open` — открытие ресурса как отдельная операция сервера: заново проверяет разрешение и наличие ресурса, помечает прочитанным только подтверждённое открытие, отвечает `{status: available|unavailable, path, message, unread}`; не различает «ресурс удалён» и «доступ отозван» (ADR-031).

## 08.10. Ограничения payload и client handling

Default JSON body ≤256KB, отдельный method/snapshot import ≤2MB и ≤500 records за preview; числа и limits конфигурируемы с верхней границей. CSV если включён — UTF-8, preview, защита от formula injection при export (`= + - @` и control prefixes), без raw HTML.

TanStack mutation invalidates только затронутые query keys. 401 → session expired flow без потери несохранённого текста где возможно; 403/404 → безопасный экран; 409 → reload/merge только для допустимого draft, никогда silent overwrite; 422 → inline fields; 429 → Retry-After; 5xx → retry только идемпотентного действия. Не retry автоматически операцию выдачи новой ссылки с неизвестным результатом: сначала проверить metadata и показать безопасное перевыпускание.
