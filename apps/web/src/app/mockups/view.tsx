'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';

import { MOCK_ROLES, MOCK_SCREENS, mockHref, type MockScreen } from './catalog';
import { articleByScreen, demo, detailByScreen, formValues, rowsByScreen } from './fixtures';

const demoFlow: Record<string, Record<string, string>> = {
  login: { Войти: 'manager-overview' },
  'manager-overview': { 'Назначить оценку': 'assessment-new-question' },
  employees: {
    'Добавить сотрудника': 'employee-detail',
    'Назначить выбранным': 'assessment-new-question',
  },
  'employee-detail': { 'Назначить оценку': 'assessment-new-question' },
  'assessment-new-question': { Далее: 'assessment-new-context' },
  'assessment-new-context': { Назад: 'assessment-new-question', Далее: 'assessment-new-people' },
  'assessment-new-people': { Назад: 'assessment-new-context', Далее: 'assessment-new-review' },
  'assessment-new-review': { Назад: 'assessment-new-people', 'Создать назначения': 'assessments' },
  assessments: { 'Назначить оценку': 'assessment-new-question' },
  'assessment-detail': { 'Открыть заключение': 'report-detail' },
  reports: { Открыть: 'report-detail' },
  'participant-tests': { Продолжить: 'test-intro' },
  participate: { 'Открыть приглашение': 'welcome' },
  welcome: { 'Согласен, начать': 'participant-tests' },
  'test-intro': { 'Начать тест': 'question' },
  question: { Далее: 'test-review', 'К списку тестов': 'participant-tests' },
  'test-review': { 'Вернуться к вопросу': 'question', 'Отправить ответы': 'participant-done' },
  'participant-done': { 'Информация об участии': 'privacy' },
  'admin-organizations': { 'Создать организацию': 'admin-organization' },
  'admin-methods': { 'Создать методику': 'admin-method-editor' },
  'admin-scenarios': { 'Создать сценарий': 'admin-scenario-editor' },
  'admin-reviews': { 'Открыть проверку': 'admin-review-detail' },
};

export function MockupView({ screen }: { screen: MockScreen }) {
  const [activeTab, setActiveTab] = useState(screen.tabs?.[0] ?? '');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const index = MOCK_SCREENS.findIndex((item) => item.id === screen.id);
  const previous = MOCK_SCREENS[index - 1];
  const next = MOCK_SCREENS[index + 1];

  function showAction(action: string): void {
    setNotice(`«${action}» — действие показано только как макет. Реальные данные не изменены.`);
  }

  return (
    <main id="main" className="min-h-dvh bg-[var(--bg-app)]">
      <div className="border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 py-3 sm:px-7">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
          <Link href="/mockups" className="font-semibold text-[var(--text-primary)] no-underline">
            ← Все макеты
          </Link>
          <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent-ink)]">
            Только макет · без API · синтетические данные
          </span>
        </div>
      </div>
      <div className="mx-auto grid max-w-[1440px] gap-8 px-4 py-7 sm:px-7 lg:grid-cols-[255px_minmax(0,1fr)]">
        <nav
          aria-label="Экраны полного ТЗ"
          className="hidden max-h-[calc(100dvh-80px)] overflow-y-auto rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-3 lg:sticky lg:top-5 lg:block"
        >
          {MOCK_ROLES.filter((role) => role === screen.role).map((role) => (
            <div key={role} className="mb-4">
              <p className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
                {role}
              </p>
              {MOCK_SCREENS.filter((item) => item.role === role).map((item) => (
                <Link
                  key={item.id}
                  href={mockHref(item.id)}
                  aria-current={screen.id === item.id ? 'page' : undefined}
                  className={`block rounded-[10px] px-3 py-2 text-sm no-underline ${screen.id === item.id ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-ink)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
                >
                  {item.code} · {item.title}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0">
          <header className="mb-6">
            <p className="text-sm font-semibold text-[var(--accent)]">
              {screen.role} · {screen.code} · {screen.path}
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{screen.title}</h1>
            <p className="mt-3 max-w-[760px] leading-relaxed text-[var(--text-secondary)]">
              {screen.description}
            </p>
            <p className="mt-3 text-sm text-[var(--text-tertiary)]">
              Демонстрационный кейс: {demo.organization} · данные и люди вымышлены
            </p>
          </header>

          {notice ? (
            <div
              role="status"
              className="mb-5 rounded-[var(--radius-nested)] border border-[var(--accent-soft-border)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent-ink)]"
            >
              {notice}
            </div>
          ) : null}

          {screen.tabs ? (
            <div role="tablist" aria-label="Разделы макета" className="mb-5 flex flex-wrap gap-2">
              {screen.tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-[var(--radius-control)] border px-4 py-2 text-sm font-semibold ${activeTab === tab ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]' : 'border-[var(--border-control)] bg-[var(--bg-surface)]'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
          ) : null}

          {screen.kind === 'overview' ? <Overview screen={screen} /> : null}
          {screen.kind === 'list' ? (
            <ListView screen={screen} query={query} onQuery={setQuery} />
          ) : null}
          {screen.kind === 'form' ? <FormView screen={screen} /> : null}
          {screen.kind === 'detail' ? <DetailView screen={screen} activeTab={activeTab} /> : null}
          {screen.kind === 'editor' ? <EditorView screen={screen} activeTab={activeTab} /> : null}
          {screen.kind === 'article' ? <ArticleView screen={screen} /> : null}
          {screen.kind === 'state' ? <StateView screen={screen} /> : null}

          {screen.id === 'test-review' ? (
            <p className="mt-4 rounded-[var(--radius-nested)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-5 py-4 text-sm leading-relaxed text-[var(--text-secondary)]">
              Это готовый пример проверки. Для обсуждения состояния с пропуском откройте{' '}
              <Link href={mockHref('question')}>макет вопроса</Link>. Отправка здесь лишь переводит
              на следующий демонстрационный экран.
            </p>
          ) : null}

          {screen.actions?.length ? (
            <div className="mt-5 flex flex-wrap gap-3 rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4 sm:p-5">
              {screen.actions.map((action, actionIndex) =>
                demoFlow[screen.id]?.[action] ? (
                  <ButtonLink
                    key={action}
                    href={mockHref(demoFlow[screen.id][action])}
                    variant={actionIndex === 0 ? 'primary' : 'secondary'}
                  >
                    {action}
                  </ButtonLink>
                ) : (
                  <Button
                    key={action}
                    variant={actionIndex === 0 ? 'primary' : 'secondary'}
                    onClick={() => showAction(action)}
                  >
                    {action}
                  </Button>
                ),
              )}
            </div>
          ) : null}

          <div className="mt-8 flex items-center justify-between gap-4 border-t border-[var(--border-hairline)] pt-5 text-sm">
            {previous ? (
              <Link href={mockHref(previous.id)} className="inline-flex items-center gap-2">
                <ArrowLeft className="size-4" />
                {previous.title}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={mockHref(next.id)} className="inline-flex items-center gap-2">
                {next.title}
                <ArrowRight className="size-4" />
              </Link>
            ) : (
              <span />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)] sm:p-6">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Overview({ screen }: { screen: MockScreen }) {
  const isAdmin = screen.role === 'Администратор';
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {(screen.items ?? []).slice(0, 4).map((item, index) => (
        <div
          key={item}
          className="rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)]"
        >
          <p className="text-sm text-[var(--text-secondary)]">{item}</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums">
            {(isAdmin ? [3, 2, 1, 4] : [12, 3, 5, 2])[index]}
          </p>
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">
            {isAdmin ? 'В демонстрационной системе' : demo.organization}
          </p>
        </div>
      ))}
      <div className="md:col-span-2 xl:col-span-4">
        <Panel title="Требуют внимания">
          <ul className="space-y-3">
            {(screen.items ?? []).slice(4).map((item) => (
              <li key={item} className="rounded-[var(--radius-nested)] bg-[var(--bg-inset)] p-3">
                {item} · {isAdmin ? 'АО «Северный маяк»' : 'Алина Соколова · CX-1042'}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function ListView({
  screen,
  query,
  onQuery,
}: {
  screen: MockScreen;
  query: string;
  onQuery: (value: string) => void;
}) {
  const rows = rowsByScreen[screen.id] ?? [
    [screen.items?.[0] ?? screen.title, demo.organization, 'В работе'],
    [screen.items?.[1] ?? 'Следующая запись', demo.date, 'Ожидает проверки'],
  ];
  const filteredRows = rows.filter((row) =>
    row.some((cell) => cell.toLowerCase().includes(query.toLowerCase())),
  );
  return (
    <div className="space-y-4">
      <Panel title="Поиск и фильтры">
        <div className="flex flex-wrap gap-3">
          <label className="relative block min-w-56 flex-1">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-3 size-4 text-[var(--text-secondary)]"
            />
            <span className="sr-only">Поиск в макете</span>
            <input
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder={screen.fields?.[0] ?? 'Поиск'}
              className="h-11 w-full rounded-[var(--radius-control)] border border-[var(--border-control)] bg-white pl-10 pr-3"
            />
          </label>
          {screen.fields?.slice(1).map((field) => (
            <label key={field} className="text-sm">
              <span className="sr-only">{field}</span>
              <select className="h-11 rounded-[var(--radius-control)] border border-[var(--border-control)] bg-white px-3">
                <option>{field}: все</option>
                <option>Активные</option>
                <option>Архив</option>
              </select>
            </label>
          ))}
        </div>
      </Panel>
      <Panel title={`${screen.title} · ${filteredRows.length} из ${rows.length}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-hairline)] text-[var(--text-secondary)]">
                <th className="py-3 pr-4">№</th>
                {(screen.items ?? ['Название', 'Состояние']).slice(0, 3).map((item) => (
                  <th key={item} className="py-3 pr-4 font-medium">
                    {item}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, index) => (
                <tr key={`${row[0]}-${index}`} className="border-b border-[var(--border-hairline)]">
                  <td className="py-4 pr-4">{index + 1}</td>
                  <td className="py-4 pr-4 font-medium">{row[0]}</td>
                  <td className="py-4 pr-4">{row[1]}</td>
                  <td className="py-4 pr-4">
                    <Badge tone="neutral">{row[2]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredRows.length === 0 ? (
            <p className="py-6 text-sm text-[var(--text-secondary)]">
              По запросу ничего не найдено. Попробуйте другое имя или слово.
            </p>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function FormView({ screen }: { screen: MockScreen }) {
  return (
    <Panel title="Данные макета">
      <div className="grid gap-4 sm:grid-cols-2">
        {(screen.fields ?? []).map((field, index) => (
          <label
            key={field}
            className={`flex flex-col gap-1.5 text-sm font-semibold ${index > 1 ? 'sm:col-span-2' : ''}`}
          >
            <span>{field}</span>
            {index > 1 ? (
              <textarea
                rows={3}
                className="rounded-[var(--radius-control)] border border-[var(--border-control)] bg-white p-3 font-normal"
                defaultValue={
                  formValues[field] ?? `${demo.organization}: пример для поля «${field}»`
                }
              />
            ) : (
              <input
                className="h-11 rounded-[var(--radius-control)] border border-[var(--border-control)] bg-white px-3 font-normal"
                defaultValue={
                  field.toLowerCase().includes('пароль')
                    ? undefined
                    : (formValues[field] ?? `${demo.organization}: ${field.toLowerCase()}`)
                }
                placeholder={field.toLowerCase().includes('пароль') ? 'Введите пароль' : undefined}
                type={field.toLowerCase().includes('пароль') ? 'password' : 'text'}
              />
            )}
          </label>
        ))}
      </div>
      {screen.items?.length ? (
        <div className="mt-6 space-y-2">
          {screen.items.map((item) => (
            <label
              key={item}
              className="flex min-h-11 items-center gap-3 rounded-[var(--radius-nested)] border border-[var(--border-hairline)] px-3"
            >
              <input type="checkbox" className="size-4 accent-[var(--accent)]" />
              {item}
            </label>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function DetailView({ screen, activeTab }: { screen: MockScreen; activeTab: string }) {
  const details = detailByScreen[screen.id] ?? {};
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
      <Panel title={activeTab || 'Основные сведения'}>
        <div className="space-y-3">
          {screen.items?.map((item, index) => (
            <div key={item} className="rounded-[var(--radius-nested)] bg-[var(--bg-inset)] p-4">
              <p className="text-sm text-[var(--text-secondary)]">{item}</p>
              <p className="mt-1 font-medium">
                {details[item] ??
                  (index === 0
                    ? `${demo.organization} · ${demo.participant}`
                    : `${demo.scenario} · ${demo.date}`)}
              </p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Следующий шаг">
        <Badge tone="info">{screen.role === 'Участник' ? 'Сохранено' : 'В работе'}</Badge>
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          {screen.role === 'Участник'
            ? 'Проверьте ответы и вернитесь к пропущенному обязательному вопросу.'
            : 'Проверьте сведения и выберите следующий шаг для этого случая. В макете изменения не отправляются.'}
        </p>
      </Panel>
    </div>
  );
}

function EditorView({ screen, activeTab }: { screen: MockScreen; activeTab: string }) {
  const readOnly = screen.id === 'admin-ai' && activeTab === 'Провайдеры';
  return (
    <div className="grid gap-4 xl:grid-cols-[210px_minmax(0,1fr)_260px]">
      <Panel title="Структура">
        <ul className="space-y-2 text-sm">
          {screen.tabs?.map((tab) => (
            <li
              key={tab}
              className={
                activeTab === tab
                  ? 'font-semibold text-[var(--accent)]'
                  : 'text-[var(--text-secondary)]'
              }
            >
              {tab}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title={activeTab || 'Редактор'}>
        <div className="space-y-4">
          {(screen.fields ?? screen.items ?? []).map((item) => (
            <label key={item} className="flex flex-col gap-1.5 text-sm font-semibold">
              <span>{item}</span>
              {readOnly ? (
                <span className="rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-inset)] p-3 font-normal text-[var(--text-secondary)]">
                  Модель: demo-model · режим проверки · ключи и секреты скрыты
                </span>
              ) : (
                <textarea
                  rows={2}
                  className="rounded-[var(--radius-control)] border border-[var(--border-control)] bg-white p-3 font-normal"
                  defaultValue={`${item}: ${screen.id === 'review-detail' || screen.id === 'admin-review-detail' ? 'Проверьте связь вывода с рабочими фактами и отметьте ограничения.' : `${demo.scenario} · версия 1.2 · ${demo.organization}.`}`}
                />
              )}
            </label>
          ))}
        </div>
      </Panel>
      <Panel title="Проверка">
        <Badge tone="warning">Не опубликовано</Badge>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          В реальном продукте публикация зависит от серверной проверки версии и полномочий.
        </p>
      </Panel>
    </div>
  );
}

function ArticleView({ screen }: { screen: MockScreen }) {
  const content = articleByScreen[screen.id] ?? {};
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
      <Panel title={screen.title}>
        <div className="space-y-6">
          {(screen.items ?? []).map((item) => (
            <section key={item}>
              <h3 className="text-lg font-semibold">{item}</h3>
              <p className="mt-2 max-w-prose leading-relaxed text-[var(--text-secondary)]">
                {content[item] ??
                  `${demo.organization}: ${item.toLowerCase()} в сценарии «${demo.scenario}». Текст демонстрационный и требует согласования перед запуском.`}
              </p>
            </section>
          ))}
        </div>
      </Panel>
      <Panel title="На этой странице">
        <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
          {(screen.items ?? []).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function StateView({ screen }: { screen: MockScreen }) {
  return (
    <Panel title={screen.title}>
      <Badge tone="info">Демонстрационное состояние</Badge>
      <p className="mt-4 max-w-prose leading-relaxed">{screen.description}</p>
      {screen.items?.length ? (
        <ul className="mt-5 list-disc space-y-2 pl-6 text-[var(--text-secondary)]">
          {screen.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
