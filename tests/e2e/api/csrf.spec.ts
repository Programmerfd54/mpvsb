import { expect, test } from '@playwright/test';

import { ERROR_TITLES } from '@context/contracts';

import { ApiActor, expectOk, expectProblem } from '../support/api-client';
import { mustCredentials, requireRoles } from '../support/env';
import {
  cleanup,
  createAssignment,
  exchangeAsParticipant,
  giveConsent,
  issueInvitation,
  listAttempts,
  orgIdOf,
  runMarker,
  startAttempt,
  syntheticResponse,
} from '../support/flows';

/**
 * Double-submit CSRF и проверка Origin (ТЗ 10.2).
 *
 * Изменяющий запрос без токена, с чужим токеном или с чужого источника
 * отклоняется, состояние не меняется, а клиент не считает действие выполненным
 * до ответа сервера: успех подтверждается серверными полями (идентификатор,
 * requestId, отметка времени).
 *
 * Все три отказа дают 403 FORBIDDEN, поэтому статуса мало: проверка сверяет
 * точный текст. Отказ по источнику и отказ по токену различаются между собой —
 * иначе проба Origin прошла бы и в случае, когда Origin вообще не проверяется,
 * а 403 пришёл из-за неприложенного заголовка (например, при поломке csrfToken()).
 *
 * Тексты — копия из apps/api/src/platform/security/csrf.ts. Расхождение с API
 * ловится этими же пробами: изменили текст в API — обновите константу.
 */
const CSRF_REFUSAL = {
  origin: 'Запрос пришёл с недопустимого источника',
  token: 'Проверка защиты формы не пройдена. Обновите страницу и повторите',
} as const;

function expectCsrfRefusal(
  problem: { title: string },
  expected: (typeof CSRF_REFUSAL)[keyof typeof CSRF_REFUSAL],
  what: string,
): void {
  expect(
    problem.title,
    `${what}: отказ выглядит как обычный отказ по правам, а не как защита формы`,
  ).not.toBe(ERROR_TITLES.FORBIDDEN);
  expect(problem.title, `${what}: отказ объясняет не ту причину`).toBe(expected);
}

test.describe('Защита изменяющих запросов', () => {
  test('запрос без CSRF-токена отклоняется и ничего не меняет', async ({ baseURL }) => {
    requireRoles('managerA');
    const marker = runMarker();
    const manager = await ApiActor.login(baseURL!, 'managerA');
    const orgId = orgIdOf(manager);
    const created: { employeeId?: string; assignmentId?: string; originEmployeeId?: string } = {};

    try {
      await test.step('создание сотрудника без токена', async () => {
        const result = await manager.post(
          `/orgs/${orgId}/employees`,
          { displayName: `Без токена ${marker}`, externalCode: `NOCSRF-${marker}` },
          { csrf: false },
        );
        const problem = expectProblem(result, [403], 'создание сотрудника без CSRF-токена');
        expectCsrfRefusal(problem, CSRF_REFUSAL.token, 'запрос без токена');

        const found = expectOk<any[]>(
          await manager.get(`/orgs/${orgId}/employees?query=NOCSRF-${marker}&status=all`),
          'поиск сотрудника после отклонённого запроса',
        );
        expect(found, 'отклонённый запрос не должен создавать запись').toHaveLength(0);
      });

      await test.step('чужое значение токена не принимается', async () => {
        const result = await manager.post(
          `/orgs/${orgId}/employees`,
          { displayName: `Чужой токен ${marker}`, externalCode: `BADCSRF-${marker}` },
          { csrfValue: 'd3adb33f000000000000000000000000' },
        );
        const problem = expectProblem(result, [403], 'создание сотрудника с чужим CSRF-токеном');
        expectCsrfRefusal(problem, CSRF_REFUSAL.token, 'запрос с чужим токеном');

        const found = expectOk<any[]>(
          await manager.get(`/orgs/${orgId}/employees?query=BADCSRF-${marker}&status=all`),
          'поиск сотрудника после запроса с чужим токеном',
        );
        expect(found).toHaveLength(0);
      });

      await test.step('запрос с чужого источника отклоняется даже с верным токеном', async () => {
        /*
         * Вторая половина защиты: cookie и double-submit токен у такого запроса
         * корректные, отличается только Origin. Контрольный повтор того же
         * запроса с правильным Origin должен пройти — иначе отказ нельзя
         * приписать проверке источника.
         */
        const body = {
          displayName: `Синтетический участник E2E ${marker} origin`,
          externalCode: `E2E-ORIGIN-${marker}`,
          jobTitle: 'Синтетическая должность',
        };
        const rejected = await manager.post(`/orgs/${orgId}/employees`, body, {
          headers: { origin: 'https://evil.invalid' },
        });
        const problem = expectProblem(rejected, [403], 'создание сотрудника с чужого источника');
        expectCsrfRefusal(problem, CSRF_REFUSAL.origin, 'запрос с чужого источника');

        const afterReject = expectOk<any[]>(
          await manager.get(`/orgs/${orgId}/employees?query=E2E-ORIGIN-${marker}&status=all`),
          'поиск сотрудника после запроса с чужого источника',
        );
        expect(afterReject, 'запрос с чужого источника не должен создавать запись').toHaveLength(0);

        const allowed = expectOk<{ id: string }>(
          await manager.post(`/orgs/${orgId}/employees`, body, {
            headers: { origin: new URL(baseURL!).origin },
          }),
          'контрольный повтор с правильным источником',
        );
        expect(allowed.id, 'контрольный повтор должен создать запись').toBeTruthy();
        /*
         * Запись сразу берётся на учёт: если шаг упадёт между созданием и
         * архивированием, активный сотрудник остался бы в dev-базе, а уборка
         * в finally о нём не знала бы.
         */
        created.originEmployeeId = allowed.id;
        // Контрольная запись убирается сразу: в dev-базе остатков быть не должно.
        expectOk(
          await manager.post(`/orgs/${orgId}/employees/${allowed.id}/archive`, {
            cancelActiveAssignments: true,
          }),
          'уборка контрольной записи',
        );
        delete created.originEmployeeId;
      });

      await test.step('успех подтверждается серверными полями', async () => {
        const assignment = await createAssignment(manager, orgId, marker);
        Object.assign(created, assignment);
        const link = expectOk<any>(
          await manager.post(
            `/orgs/${orgId}/assignments/${assignment.assignmentId}/invitations`,
            {},
          ),
          'выпуск ссылки',
        );
        // Сервер возвращает собственные значения, а не эхо запроса.
        expect(link.assignmentId).toBe(assignment.assignmentId);
        expect(link.expiresAt).toBeTruthy();
        expect(link.secretAvailable).toBe(true);
      });
    } finally {
      if (created.originEmployeeId) {
        await cleanup(manager, orgId, { employeeId: created.originEmployeeId });
      }
      await cleanup(manager, orgId, created);
      await manager.dispose();
    }
  });

  test('вход и участие тоже требуют CSRF-токен', async ({ baseURL }) => {
    requireRoles('managerA');
    const marker = runMarker();
    const manager = await ApiActor.login(baseURL!, 'managerA');
    const orgId = orgIdOf(manager);
    const created: { employeeId?: string; assignmentId?: string } = {};
    let participant: ApiActor | undefined;

    try {
      await test.step('вход без токена', async () => {
        const anonymous = await ApiActor.anonymous(baseURL!, 'login-without-csrf');
        try {
          const { email, password } = mustCredentials('managerA');
          const result = await anonymous.post('/auth/login', { email, password }, { csrf: false });
          expectCsrfRefusal(
            expectProblem(result, [403], 'вход без CSRF-токена'),
            CSRF_REFUSAL.token,
            'вход без токена',
          );
          const cookies = await anonymous.cookieNames();
          expect(
            cookies.some((name) => name.endsWith('app_session')),
            'отклонённый вход не должен выдавать cookie сессии',
          ).toBe(false);
        } finally {
          await anonymous.dispose();
        }
      });

      await test.step('сохранение ответа участником без токена', async () => {
        const assignment = await createAssignment(manager, orgId, marker);
        Object.assign(created, assignment);
        const invitation = await issueInvitation(manager, orgId, assignment.assignmentId);
        participant = await exchangeAsParticipant(baseURL!, invitation.token);
        await giveConsent(participant);

        const summaries = await listAttempts(participant);
        const attempt = await startAttempt(participant, summaries[0]!.attemptId);
        const item = attempt.items[0]!;

        const result = await participant.put(
          `/participant/attempts/${attempt.attemptId}/answers/${item.id}`,
          { response: syntheticResponse(item, marker), expectedRevision: attempt.revision },
          { csrf: false },
        );
        expectCsrfRefusal(
          expectProblem(result, [403], 'сохранение ответа без CSRF-токена'),
          CSRF_REFUSAL.token,
          'сохранение ответа без токена',
        );

        // Ревизия попытки не изменилась: отклонённый запрос ничего не записал.
        const detail = expectOk<any>(
          await participant.get(`/participant/attempts/${attempt.attemptId}`),
          'попытка после отклонённого сохранения',
        );
        expect(detail.revision).toBe(attempt.revision);
      });
    } finally {
      await cleanup(manager, orgId, created);
      await participant?.dispose();
      await manager.dispose();
    }
  });
});
