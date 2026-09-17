import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { REVIEW_CHECKLIST_ITEMS, type NotificationView } from '@context/contracts';
import { SCENARIO_CODES, caseCodeFor } from '@context/domain';

import { ApiActor, describe, expectOk, type ApiResult } from './api-client';
import { credentialsFor } from './env';

/**
 * Шаги сквозного пути на уровне API.
 *
 * Каждый тест создаёт собственного синтетического сотрудника: тесты не зависят
 * от того, сколько активных назначений накопилось в dev-базе, и не трогают
 * записи seed. Все имена явно помечены как синтетические.
 */

/** Уникальная метка запуска. Попадает в имена синтетических сотрудников и ответы. */
export function runMarker(): string {
  return `e2e${randomBytes(4).toString('hex')}`;
}

export function orgIdOf(actor: ApiActor & { profile: { defaultOrganizationId: string | null } }) {
  const orgId = actor.profile.defaultOrganizationId;
  expect(orgId, `${actor.label}: у учётной записи нет организации по умолчанию`).toBeTruthy();
  return orgId!;
}

export interface CreatedAssignment {
  readonly employeeId: string;
  readonly assignmentId: string;
  readonly scenarioVersionId: string;
}

export async function createSyntheticEmployee(
  manager: ApiActor,
  orgId: string,
  marker: string,
): Promise<string> {
  const employee = expectOk<{ id: string }>(
    await manager.post(`/orgs/${orgId}/employees`, {
      displayName: `Синтетический участник E2E ${marker}`,
      externalCode: `E2E-${marker}`,
      jobTitle: 'Синтетическая должность',
    }),
    'создание синтетического сотрудника',
  );
  expect(employee.id).toBeTruthy();
  return employee.id;
}

/** Значения контекста по схеме сценария. Только синтетический текст. */
export function syntheticContext(
  fields: ReadonlyArray<{
    key: string;
    type: string;
    minLength?: number;
    maxLength?: number;
    options?: ReadonlyArray<{ value: string }>;
  }>,
): Record<string, string | number | null> {
  const context: Record<string, string | number | null> = {};
  for (const field of fields) {
    if (field.type === 'date') {
      context[field.key] = '2026-12-01';
    } else if (field.type === 'select') {
      context[field.key] = field.options?.[0]?.value ?? null;
    } else if (field.type === 'money' || field.type === 'number') {
      context[field.key] = 1000;
    } else {
      context[field.key] = 'Синтетический контекст для проверки E2E'
        .padEnd(field.minLength ?? 0, '.')
        .slice(0, field.maxLength ?? 500);
    }
  }
  return context;
}

/** Создаёт сотрудника и назначение по первому доступному сценарию организации. */
export async function createAssignment(
  manager: ApiActor,
  orgId: string,
  marker: string,
): Promise<CreatedAssignment> {
  const scenarios = expectOk<any[]>(
    await manager.get(`/orgs/${orgId}/scenarios`),
    'список сценариев',
  );
  expect(
    scenarios.length,
    'в организации нет опубликованных сценариев: выполните seed',
  ).toBeGreaterThan(0);
  /*
   * Сценарий с наименьшим числом методик — быстрее проходить. Берутся только коды
   * из SCENARIO_CODES: сценарий с кодом вне доменного перечня подготовку заключения
   * не проходит (см. «Известные дефекты» в tests/e2e/README.md).
   */
  const supported = scenarios.filter((item) =>
    (SCENARIO_CODES as readonly string[]).includes(item.code),
  );
  expect(
    supported.length,
    'нет сценариев с кодом из SCENARIO_CODES: выполните npm run db:seed:demo',
  ).toBeGreaterThan(0);
  const scenario = [...supported].sort((a, b) => a.methods.length - b.methods.length)[0];
  const employeeId = await createSyntheticEmployee(manager, orgId, marker);

  const created = expectOk<{ created: Array<{ assignmentId: string }>; rejected: unknown[] }>(
    await manager.post(`/orgs/${orgId}/assignments/batch`, {
      scenarioVersionId: scenario.scenarioVersionId,
      employeeIds: [employeeId],
      context: syntheticContext(scenario.contextSchema.fields),
      dueDays: 14,
    }),
    'создание назначения',
  );
  expect(created.rejected, 'назначение отклонено сервером').toHaveLength(0);
  expect(created.created).toHaveLength(1);

  return {
    employeeId,
    assignmentId: created.created[0]!.assignmentId,
    scenarioVersionId: scenario.scenarioVersionId,
  };
}

/** Выпуск (или перевыпуск) ссылки. Возвращает токен из fragment. */
export async function issueInvitation(
  manager: ApiActor,
  orgId: string,
  assignmentId: string,
): Promise<{ token: string; replacedPrevious: boolean }> {
  const link = expectOk<{ url: string; replacedPrevious: boolean }>(
    await manager.post(`/orgs/${orgId}/assignments/${assignmentId}/invitations`, {}),
    'выпуск ссылки',
  );
  const url = new URL(link.url);
  // Токен живёт только во fragment: в query и path он не должен попадать.
  expect(url.search, 'токен приглашения не должен быть в query').toBe('');
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  expect(token, 'ссылка должна содержать токен во fragment').toBeTruthy();
  return { token: token!, replacedPrevious: link.replacedPrevious };
}

/** Новый анонимный контекст участника, обменявший токен на сессию. */
export async function exchangeAsParticipant(baseURL: string, token: string): Promise<ApiActor> {
  const participant = await ApiActor.anonymous(baseURL, 'participant');
  const result = await participant.post('/participant/exchange', { token });
  if (result.status < 200 || result.status >= 300) {
    await participant.dispose();
    throw new Error(`Обмен приглашения не выполнен: ${describe(result)}`);
  }
  return participant;
}

export async function giveConsent(participant: ApiActor): Promise<void> {
  const terms = expectOk<{ documentVersionId: string; contentHash: string }>(
    await participant.get('/participant/terms'),
    'текст информирования',
  );
  expectOk(
    await participant.post('/participant/consents', {
      documentVersionId: terms.documentVersionId,
      documentHash: terms.contentHash,
      accepted: true,
    }),
    'согласие участника',
  );
}

/** Синтетический ответ на вопрос любого поддержанного типа. */
export function syntheticResponse(item: any, marker: string): unknown {
  switch (item.type) {
    case 'single_choice':
      return { type: 'single_choice', optionId: item.options[0].id };
    case 'multiple_choice':
      return {
        type: 'multiple_choice',
        optionIds: item.options
          .slice(0, Math.max(1, item.minSelected ?? 1))
          .map((option: any) => option.id),
      };
    case 'likert':
      return { type: 'likert', value: item.labels[Math.floor(item.labels.length / 2)].value };
    case 'numeric':
      return { type: 'numeric', value: item.min };
    case 'short_text':
      return { type: 'short_text', text: `Синтетический ответ ${marker}` };
    case 'situational':
      return item.response.kind === 'single_choice'
        ? { type: 'situational', optionId: item.response.options[0].id }
        : { type: 'situational', text: `Синтетический ответ ${marker}` };
    default:
      throw new Error(`Неизвестный тип вопроса ${String(item.type)}`);
  }
}

export interface StartedAttempt {
  readonly attemptId: string;
  readonly revision: number;
  readonly items: any[];
}

export async function listAttempts(participant: ApiActor): Promise<any[]> {
  return expectOk<any[]>(await participant.get('/participant/attempts'), 'список попыток');
}

export async function startAttempt(participant: ApiActor, attemptId: string) {
  const detail = expectOk<any>(
    await participant.post(`/participant/attempts/${attemptId}/start`, {}),
    'начало попытки',
  );
  return { attemptId, revision: detail.revision as number, items: detail.items as any[] };
}

/** Отвечает на все вопросы попытки и возвращает итоговую ревизию. */
export async function answerAll(
  participant: ApiActor,
  attempt: StartedAttempt,
  marker: string,
): Promise<number> {
  let revision = attempt.revision;
  for (const item of attempt.items) {
    const saved = expectOk<{ attemptRevision: number }>(
      await participant.put(`/participant/attempts/${attempt.attemptId}/answers/${item.id}`, {
        response: syntheticResponse(item, marker),
        expectedRevision: revision,
      }),
      `сохранение ответа ${item.id}`,
    );
    // Сохранение подтверждено сервером: ревизия выросла.
    expect(saved.attemptRevision).toBeGreaterThan(revision);
    revision = saved.attemptRevision;
  }
  return revision;
}

export async function submitAttempt(
  participant: ApiActor,
  attemptId: string,
  revision: number,
): Promise<any> {
  return expectOk<any>(
    await participant.post(`/participant/attempts/${attemptId}/submit`, {
      expectedRevision: revision,
    }),
    'отправка попытки',
  );
}

/** Полное прохождение участником: согласие, все попытки, отправка. */
export async function completeParticipation(
  participant: ApiActor,
  marker: string,
): Promise<string[]> {
  await giveConsent(participant);
  const attempts = await listAttempts(participant);
  expect(attempts.length, 'у назначения нет методик').toBeGreaterThan(0);
  const ids: string[] = [];
  for (const summary of attempts) {
    const attempt = await startAttempt(participant, summary.attemptId);
    const revision = await answerAll(participant, attempt, marker);
    await submitAttempt(participant, attempt.attemptId, revision);
    ids.push(attempt.attemptId);
  }
  return ids;
}

/**
 * Ожидание черновика заключения от worker.
 *
 * Черновик появляется асинхронно (подсчёт → свидетельства → подготовка текста).
 * Руководителю идентификатор черновика не выдаётся (только состояние), поэтому
 * reportId берётся из очереди рецензента по коду случая — он выводится из
 * идентификатора назначения и персональных данных не содержит.
 */
export async function waitForDraftReport(
  manager: ApiActor,
  reviewer: ApiActor,
  orgId: string,
  assignmentId: string,
  timeoutMs = Number(process.env.E2E_WORKER_TIMEOUT_MS ?? 180_000),
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const caseCode = caseCodeFor(assignmentId);
  let lastState = 'нет данных';
  let lastStatus = 0;

  while (Date.now() < deadline) {
    const result = await manager.get(`/orgs/${orgId}/assignments/${assignmentId}`);
    lastStatus = result.status;
    if (isTransientProxyFailure(result)) {
      // Прокси web между попытками: API перезапускается под node --watch.
      lastState = `API временно недоступен (HTTP ${result.status})`;
      await sleep(2_000);
      continue;
    }
    if (result.status >= 500) {
      /*
       * Настоящая ошибка сервера. Списывать её на «перезапуск» нельзя: иначе
       * 500 в карточке назначения превратится в жалобу на worker. В сообщении
       * только статус, код и requestId — тела ответов не печатаются.
       */
      throw new Error(
        `Карточка назначения ответила ошибкой сервера: ${describe(result)}. ` +
          'Причина ищется в журнале API по requestId.',
      );
    }
    const detail = expectOk<any>(result, 'карточка назначения');
    lastState = `state=${detail.state}, reportStatus=${detail.reportStatus ?? 'null'}`;

    if (detail.reportStatus === 'generation_failed') {
      throw new Error(
        `Подготовка заключения завершилась ошибкой (${lastState}). ` +
          'Причина видна администратору в /admin/operations (журнал заданий).',
      );
    }

    if (detail.reportStatus === 'pending_review' || detail.reportStatus === 'published') {
      const pending = expectOk<any[]>(
        await reviewer.get(`/orgs/${orgId}/reviews`),
        'очередь рецензента',
      );
      const item = pending.find((entry) => entry.caseCode === caseCode);
      if (item) {
        return item.reportId as string;
      }
    }

    await sleep(2_000);
  }

  throw new Error(
    `Черновик заключения не появился за ${Math.round(timeoutMs / 1000)} с ` +
      `(последний ответ HTTP ${lastStatus}, ${lastState}). ` +
      'Проверьте, что worker запущен (npm run dev:worker) и очередь заданий не содержит ошибок ' +
      '(/admin/operations). Лимит ожидания задаётся E2E_WORKER_TIMEOUT_MS.',
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ответ, который означает «сервис сейчас недоступен», а не ошибку обработки:
 *   * 502/503/504 — прокси web не достучался до API (перезапуск под node --watch)
 *     либо сам API сообщает о недоступной зависимости с retryable;
 *   * любой 5xx, отданный не в JSON (страница ошибки прокси).
 *
 * 500 сюда не входит: внутреннюю ошибку API нельзя молча ретраить, иначе
 * она будет списана на медленный worker.
 */
function isTransientProxyFailure(result: ApiResult): boolean {
  if (result.status < 500) {
    return false;
  }
  if (result.status === 502 || result.status === 503 || result.status === 504) {
    return true;
  }
  const contentType = result.response.headers()['content-type'] ?? '';
  return !/^application\/([\w.+-]+\+)?json/i.test(contentType);
}

export function fullChecklist(): Record<string, true> {
  return Object.fromEntries(REVIEW_CHECKLIST_ITEMS.map((key) => [key, true as const]));
}

/**
 * Уведомление о публикации заключения в ящике автора назначения.
 *
 * Создаётся той же транзакцией, что и публикация, поэтому ждать его не нужно.
 * Возвращается идентификатор: по нему проверяется и граница организации,
 * и то, что в самом уведомлении нет содержания заключения.
 */
export async function findPublishedNotification(
  manager: ApiActor,
  orgId: string,
  reportId: string,
): Promise<string> {
  const items = expectOk<NotificationView[]>(
    await manager.get(`/orgs/${orgId}/notifications?filter=all&pageSize=100`),
    'ящик уведомлений руководителя',
  );

  const item = items.find(
    (entry) => entry.type === 'report_published' && entry.resourceId === reportId,
  );

  // Типизированный поиск, а не `any`: при пустом ящике тест обязан сказать,
  // что уведомления нет, а не упасть на обращении к полю несуществующего
  // объекта.
  if (!item) {
    throw new Error(
      `публикация заключения ${reportId} должна была создать уведомление автору назначения, ` +
        `но в ящике ${items.length} уведомлений и подходящего среди них нет`,
    );
  }

  return item.id;
}

export interface CleanupTarget {
  readonly employeeId?: string | undefined;
  /**
   * Назначение, доведённое тестом до состояния, в котором worker готовит
   * заключение. Без него черновик остался бы в очереди рецензента навсегда.
   */
  readonly assignmentId?: string | undefined;
}

/**
 * Уборка после теста.
 *
 * Убирается всё, что тест создал и может закрыть сам:
 *   1) черновик заключения — рецензент возвращает его на доработку
 *      (`request-revision`), и он уходит из очереди рецензента;
 *   2) сотрудник — архивируется вместе со своими активными назначениями.
 *
 * Удалить опубликованное заключение E2E не может: продуктового способа нет
 * (см. «Что НЕ покрыто» в README). Поэтому тесты, которым публикация не нужна,
 * её не выполняют.
 *
 * Ошибка уборки не подменяет результат теста, но и не теряется: она попадает
 * в аннотации прогона (`test.info().annotations`) и в stderr — иначе остатки
 * E2E-* в dev-базе накапливаются незаметно. Ручная зачистка описана в README.
 */
export async function cleanup(
  manager: ApiActor,
  orgId: string,
  created: CleanupTarget,
  reviewer?: ApiActor,
): Promise<void> {
  const failures: string[] = [];

  if (created.assignmentId) {
    const failure = await closeDraftReport(manager, orgId, created.assignmentId, reviewer);
    if (failure) {
      failures.push(
        `черновик заключения назначения ${created.assignmentId} не закрыт (${failure})`,
      );
    }
  }

  if (created.employeeId) {
    const failure = await archiveEmployee(manager, orgId, created.employeeId);
    if (failure) {
      failures.push(`сотрудник ${created.employeeId} остался в организации (${failure})`);
    }
  }

  if (failures.length === 0) {
    return;
  }
  const message = `Уборка E2E не завершена: ${failures.join('; ')}.`;
  console.warn(message);
  try {
    test.info().annotations.push({ type: 'cleanup-failed', description: message });
  } catch {
    // Вне теста (например, в сторожевой проверке) аннотаций нет — хватает stderr.
  }
}

/**
 * Закрывает черновик, созданный тестом: рецензент возвращает его на доработку.
 *
 * Если заключение по назначению ещё готовится, уборка ждёт ограниченное время:
 * иначе черновик появится уже после теста и останется в очереди. Отсутствие
 * черновика (назначение не дошло до completed) — не ошибка.
 */
async function closeDraftReport(
  manager: ApiActor,
  orgId: string,
  assignmentId: string,
  reviewer?: ApiActor,
): Promise<string | null> {
  const waitMs = Number(process.env.E2E_CLEANUP_WAIT_MS ?? 45_000);
  const deadline = Date.now() + waitMs;
  let status: string | null = null;

  while (Date.now() < deadline) {
    const result = await manager.get(`/orgs/${orgId}/assignments/${assignmentId}`);
    if (result.status < 200 || result.status >= 300) {
      return describe(result);
    }
    status = ((result.body as any)?.data?.reportStatus ?? null) as string | null;
    if (status !== 'queued' && status !== 'generating') {
      break;
    }
    await sleep(2_000);
  }

  if (status !== 'pending_review') {
    // Черновика нет (назначение не завершено) либо он уже закрыт публикацией
    // или доработкой — убирать нечего.
    return null;
  }

  let ownReviewer: ApiActor | undefined;
  try {
    const actor = reviewer ?? (ownReviewer = await reviewerActor());
    if (!actor) {
      return 'нет учётных данных рецензента (E2E_REVIEWER_A_PASSWORD)';
    }
    const queue = await actor.get(`/orgs/${orgId}/reviews`);
    if (queue.status < 200 || queue.status >= 300) {
      return describe(queue);
    }
    const caseCode = caseCodeFor(assignmentId);
    const item = ((queue.body as any).data as any[]).find((entry) => entry.caseCode === caseCode);
    if (!item) {
      return null;
    }
    const closed = await actor.post(`/orgs/${orgId}/reviews/${item.reportId}/request-revision`, {
      comment: 'Уборка после автоматической проверки: синтетический черновик закрыт.',
    });
    return closed.status >= 200 && closed.status < 300 ? null : describe(closed);
  } catch (error) {
    return (error as Error).message;
  } finally {
    await ownReviewer?.dispose();
  }
}

/** Рецензент для уборки, если тест своего не передал. */
async function reviewerActor(): Promise<ApiActor | undefined> {
  if (!credentialsFor('reviewerA')) {
    return undefined;
  }
  const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  return ApiActor.login(baseURL, 'reviewerA');
}

/** Возвращает описание неудачи или null, если сотрудник архивирован. */
async function archiveEmployee(
  manager: ApiActor,
  orgId: string,
  employeeId: string,
): Promise<string | null> {
  try {
    const result = await manager.post(`/orgs/${orgId}/employees/${employeeId}/archive`, {
      cancelActiveAssignments: true,
    });
    if (result.status >= 200 && result.status < 300) {
      return null;
    }
    return describe(result);
  } catch (error) {
    return (error as Error).message;
  }
}
