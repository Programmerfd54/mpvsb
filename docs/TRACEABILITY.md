# Связь страниц и задач

Каждая строка — страница или семейство состояний, требующее реализации. Наличие строки не означает готовность.

| ID | Страница/состояние | Задачи | Спецификация |
|---|---|---|---|
| M01 | Вход и активация — `/login`, `/activate`, `/password-reset` | F-04 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M02 | Обзор — `/app` | M-07 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M03 | Сотрудники — `/app/employees` | M-02 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M04 | Карточка сотрудника — `/app/employees/[employeeId]` | M-02 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M05 | Создание назначения — `/app/assessments/new` | M-04, M-05 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M06 | Все оценки — `/app/assessments` | M-06 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M07 | Детали оценки — `/app/assessments/[assignmentId]` | M-06 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M08 | Заключения — `/app/reports` | R-08 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M09 | Заключение — `/app/reports/[reportId]` | R-08, R-09 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M10 | Исследования — `/app/studies`, `/app/studies/new` | S-01, S-05 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M11 | Исследование — `/app/studies/[studyId]` | S-03, S-04, S-05 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M12 | База знаний — `/app/knowledge`, `/app/knowledge/[slug]` | R-12 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M13 | Настройки — `/app/settings` | M-01, R-16, Q-01 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M14 | Профиль и уведомления — `/app/profile`, `/app/notifications` | F-04, M-07 | [03-manager-pages.md](spec/03-manager-pages.md) |
| M15 | Рецензия руководителем — `/app/reviews`, `/app/reviews/[reportId]` | R-07 | [03-manager-pages.md](spec/03-manager-pages.md) |
| E01 | Открытие персональной ссылки — `/participate#token=...` | E-01 | [04-employee-pages.md](spec/04-employee-pages.md) |
| E02 | Приглашение и информирование — `/participant/welcome` | E-02 | [04-employee-pages.md](spec/04-employee-pages.md) |
| E03 | Мои тесты — `/participant` | E-03 | [04-employee-pages.md](spec/04-employee-pages.md) |
| E04 | Инструкция к методике — `/participant/tests/[attemptId]/intro` | E-03 | [04-employee-pages.md](spec/04-employee-pages.md) |
| E05 | Вопрос — `/participant/tests/[attemptId]` | E-04, E-05 | [04-employee-pages.md](spec/04-employee-pages.md) |
| E06 | Проверка и отправка — `/participant/tests/[attemptId]/review` | E-06 | [04-employee-pages.md](spec/04-employee-pages.md) |
| E07 | Завершение — `/participant/done` | E-06 | [04-employee-pages.md](spec/04-employee-pages.md) |
| E08 | Управление участием — `/participant/privacy` | E-02, Q-01 | [04-employee-pages.md](spec/04-employee-pages.md) |
| E09 | Общие исключительные экраны | E-06 | [04-employee-pages.md](spec/04-employee-pages.md) |
| A01 | Обзор — `/admin` | R-11 | [05-admin-pages.md](spec/05-admin-pages.md) |
| A02 | Организации — `/admin/organizations` | M-01 | [05-admin-pages.md](spec/05-admin-pages.md) |
| A03 | Организация — `/admin/organizations/[orgId]` | M-01, R-16, Q-03 | [05-admin-pages.md](spec/05-admin-pages.md) |
| A04 | Методики — `/admin/methods` | R-02 | [05-admin-pages.md](spec/05-admin-pages.md) |
| A05 | Редактор методики — `/admin/methods/[methodId]/versions/[versionId]` | R-02 | [05-admin-pages.md](spec/05-admin-pages.md) |
| A06 | Сценарии — `/admin/scenarios`, `/admin/scenarios/[scenarioId]/versions/[versionId]` | R-03 | [05-admin-pages.md](spec/05-admin-pages.md) |
| A07 | AI и шаблоны — `/admin/ai` | R-10 | [05-admin-pages.md](spec/05-admin-pages.md) |
| A08 | Проверка заключений — `/admin/reviews`, `/admin/reviews/[reportId]` | R-07 | [05-admin-pages.md](spec/05-admin-pages.md) |
| A09 | Обработка — `/admin/jobs` | R-11 | [05-admin-pages.md](spec/05-admin-pages.md) |
| A10 | Статьи — `/admin/knowledge`, `/admin/knowledge/[articleId]` | R-12 | [05-admin-pages.md](spec/05-admin-pages.md) |
| A11 | Аудит — `/admin/audit` | R-11 | [05-admin-pages.md](spec/05-admin-pages.md) |
| A12 | Данные и запросы — `/admin/data-requests` | Q-01 | [05-admin-pages.md](spec/05-admin-pages.md) |
| A13 | Настройки платформы — `/admin/settings` | Q-02, Q-03 | [05-admin-pages.md](spec/05-admin-pages.md) |
| A14 | Системные страницы | U-03 | [05-admin-pages.md](spec/05-admin-pages.md) |
