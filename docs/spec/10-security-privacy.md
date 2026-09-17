# 10. Безопасность, доступ и обращение с данными

## 10.1. Модель угроз продукта

Реальные угрозы для этой задачи: доступ другой компании; утёкшая ссылка; участник меняет чужую попытку; менеджер получает ключи теста; исход проникает в прогноз; AI получает лишние данные; повторный job восстанавливает удалённые сведения; отчёт доступен из shared cache; администратор читает всё без причины. Проверки должны быть привязаны к этим рискам.

## 10.2. Аутентификация

Пароли Argon2id с параметрами по актуальным OWASP рекомендациям и измерением на окружении; default минимум12 символов, максимум128, разрешены password managers/paste. Не навязывать бессмысленную периодическую смену. Rate limit login по сочетанию аккаунта/IP с защитой от массовой блокировки жертвы. Сообщения без enumeration.

Opaque sessions: 256-bit random secret; в БД только hash. Production cookies `__Host-app_session` / `__Host-participant_session`, Secure, HttpOnly, SameSite=Lax, Path=/, без Domain. SameSite не заменяет CSRF. Dev HTTP использует отдельное неконфликтующее имя cookie, не ослабляет production defaults.

Если оба cookie присутствуют, каждый route принимает только свой тип principal. Participant token не даёт manager доступ и наоборот; permissions не объединяются. Background worker работает по отдельной service identity, не по сохранённой пользовательской cookie.

Default manager idle8h/absolute7d; admin idle30min/absolute12h и TOTP перед реальным пилотом; participant idle2h, absolute24h и не позже invitation dueAt. Touch activity ограниченно обновляет last_seen, без write на каждый asset. Logout/revoke/password reset немедленно инвалидирует соответствующие sessions. Доступ к отчёту требует действующей сессии, даже по сохранённому URL.

## 10.3. Ссылки участника

Token криптографический random ≥32 bytes, base64url; хранить SHA-256/HMAC hash, срок, revoke. Не применять employeeId/UUID как секрет. URL fragment; GET не раскрывает PII и не активирует. POST exchange after user action, origin validation, short rate limits. Одновременно одна действующая invitation version и одна active session на назначение; rotation отзывает предыдущую сессию.

Ссылка может быть переслана; технически доказанной идентификации личности в P0 нет. На invitation screen нужно прямо говорить, кому предназначено приглашение после exchange, без обвинений при ошибке. Identity verification отдельной механикой — только при необходимости/новом scope.

## 10.4. Авторизация

Server policy deny by default. У каждого endpoint есть actor type, tenant scope, capability, state requirements. Не принимать role/org из JSON как доверенные. Защита от IDOR проверяется для всех сущностей, включая nested itemId, report revision, knowledge audience, export job и notification.

Admin по умолчанию видит эксплуатационные метаданные. Доступ к evidence/raw answer только по временной цели/объёму, записывается чтение. Аудит гранта не хранит содержание прочитанного. UI masking дополняет, но не заменяет отсутствие данных в DTO.

## 10.5. Изоляция инфраструктуры

TLS, parameterized queries, strict schemas, CSP с nonce при необходимости, `frame-ancestors 'none'`, no unsafe embedded HTML. Участник: Referrer-Policy no-referrer, no third-party analytics, no sensitive service-worker cache. Same-origin API; CORS закрыт внешним origins. Helmet/Fastify-compatible middleware по официальной документации.

Runtime DB roles с минимальными правами; отдельный migration owner. RLS FORCE, tenant transaction-local settings. Identity и evaluation schemas имеют дополнительные grants. Не давать worker credentials schema evaluation. Network restrictions/secret rotation/backup encryption описать в deploy runbook. Env/keys никогда не `NEXT_PUBLIC_*`.

## 10.6. Согласие и правовая готовность

Пакет — техническая спецификация, не готовое юридическое заключение. Учитывать 152-ФЗ и трудовые нормы по конкретной схеме с ответственным специалистом. Статьи 16 закона и 86 ТК РФ влияют на кадровые решения на основе автоматизированной обработки; статья18 — на инфраструктуру сбора данных. Не утверждать, что галочка согласия или присутствие человека автоматически закрывает все требования.

До real participant mode должны быть конкретизированы: оператор/обработчик; цели; правовые основания; документы; права/запросы; сроки; круг получателей; использование AI-провайдера и трансграничные вопросы; место хранения; применимость трудовых ограничений. Согласие на участие не означает согласие на обучение модели.

Demo может работать с образцами документов при видимой надписи «Образец, не для реальных данных». Real launch server gate требует approved document versions и verified readiness. Разработчик не должен самостоятельно проставлять verified правовым пунктам.

## 10.7. Минимизация и retention

Реальных людей нет в repo, fixtures, CI screenshots и публичном bug tracker. Идентификаторы участников для разработки синтетические. В AI передавать только необходимый контекст/evidence. Свободный текст может содержать PII — маскирование не считается гарантированным обезличиванием.

Пример **технических demo defaults**, не правовая норма: synthetic attempts/answers/reports90d; invitations14d; expired session secrets purge30d; technical logs14d; idempotency records24h; audit без контента90d; encrypted backups30d. В реальном режиме используются утверждённые purpose-specific сроки. Приложение отказывается считать demo defaults согласованной политикой реальной организации.

Raw answers, evidence, summaries, exports и provider copies имеют согласованный жизненный цикл. Нельзя удалять только имя, оставляя легко идентифицируемый текст. Логи не являются архивом ответов.

## 10.8. Отзыв/удаление: защита от гонок

1. Privacy request получает receipt и scope.
2. Где основание — отзываемое согласие, установить processing_hold, увеличить data_generation, revoke invitation/session.
3. Остановить pending jobs и будущие публикации; running worker обязан проверить generation после внешнего вызова.
4. После подтверждения объёма удалить/обезличить допустимым способом source + derived records + exports. Сохранить только минимальный tombstone/receipt без исходного содержания, если это обосновано.
5. Provider deletion/retention учитывается отдельно; не обещать то, чего API провайдера не обеспечивает.
6. Backup policy: удалённые данные не восстанавливаются в обслуживаемый продукт при restore. Перед открытием восстановленной БД применить журнал deletion fences; срок исчезновения из backup сообщается корректно.

Восстановление из backup тестируется. Нельзя пометить request completed только по `DELETE FROM answers`.

## 10.9. Аудит

События: auth, membership/permission change, invitation issue/revoke, consent, submit, score, AI run metadata, review/publish, study locks, outcome access, exports, privacy execution, admin grant. Отдельно unsuccessful privileged attempts с rate limits.

Audit append-only для runtime; ограниченный retention с подписанным/хэшированным export где требуется. Не утверждать абсолютную tamper-proof защиту без отдельной реализации. На запросах токены/authorization/cookies redacted; free text body logging выключен.

## 10.10. Production gate

Real mode доступен только когда: содержимое разрешено; документы/retention утверждены; выбран инфраструктурный контур; provider разрешён или template mode; reviewers назначены; RBAC/RLS/blind/submit/deletion тесты проходят; backup restore проверен; support/incident контакт задан. Gate отображает конкретный незакрытый пункт, а разработка synthetic функций продолжается.
