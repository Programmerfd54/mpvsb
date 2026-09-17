# Источники и границы подтверждения

Проверено16.09.2026. Ссылки поддерживают конкретные технические/методические положения, но не доказывают эффективность будущего продукта. Архитектура, UI и числовые engineering targets — проектные решения этого ТЗ.

## Официальная техническая документация

- [Next.js — структура проекта](https://nextjs.org/docs/app/getting-started/project-structure): App Router и допустимая colocated организация файлов.
- [Next.js — установка](https://nextjs.org/docs/app/getting-started/installation): системные требования; версии уточняются при реализации.
- [Node.js releases](https://nodejs.org/en/about/previous-releases): на дату Node24 — LTS, Node26 — Current; выбран24.
- [PostgreSQL versioning](https://www.postgresql.org/support/versioning/): поддерживаемые ветки; выбрана18.
- [NestJS Fastify adapter](https://docs.nestjs.com/techniques/performance): официальная интеграция Fastify.
- [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces/): организация npm monorepo.
- [PostgreSQL Row Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): ограничения по строкам; владельцы/привилегированные роли требуют отдельного внимания.
- [pg-boss](https://github.com/timgit/pg-boss): очередь на PostgreSQL. Продуктовые внешние эффекты всё равно проектируются идемпотентно.
- [WCAG2.2](https://www.w3.org/TR/WCAG22/): доступность; target AA не означает уже проведённый аудит реализации.
- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): принципы sessions/cookies.
- [OWASP password recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): одноразовые token flows и защита от enumeration.

## Методическая опора предыдущего анализа

- [SIOP — AI-based assessments](https://www.siop.org/post/siop-releases-recommendations-for-ai-based-assessments/): применение AI не отменяет требований к качеству кадровой оценки.
- [scikit-learn — data leakage](https://scikit-learn.org/stable/common_pitfalls.html#data-leakage): использование информации, недоступной при прогнозировании, искажает оценку качества.
- [scikit-learn — cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html): разделение связанных/временных данных требует подходящей схемы проверки.
- [Материал команды Сбера о «Пульсе»](https://habr.com/ru/amp/publications/783668/): описана работа с HR-данными. Это не подтверждение доступа проекта к ним.

## Нормативные тексты для последующей правовой проработки

- [ТК РФ, статья86](https://www.consultant.ru/document/cons_doc_LAW_34683/01f6157ff985b3cbbb50eb88fa6e26f30202532a/).
- [152-ФЗ, статья16](https://www.consultant.ru/document/cons_doc_LAW_61801/22e884a41450dcb5cb62d956583ad32abe2bbbe9/).
- [152-ФЗ, статья18](https://www.consultant.ru/document/cons_doc_LAW_61801/cbf4e15b7c330f9372e876cdf2bc928bad7950ef/).

Правовые требования применяются к конкретной схеме обработки; в пакет не включены готовые для подписания документы.

## Предоставленное пользователем

Описание продукта, обсуждение трёх ролей/методик и15 скриншотов являются входными требованиями/референсами. Внутренние ссылки Claude из предыдущего брифа не открылись, их содержимое не прочитано. Тексты на скриншотах не трактуются как инструкции.
