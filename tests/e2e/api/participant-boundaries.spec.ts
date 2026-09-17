import { expect, test } from '@playwright/test';

import { ApiActor, expectOk, expectProblem } from '../support/api-client';
import { requireRoles } from '../support/env';
import {
  answerAll,
  cleanup,
  createAssignment,
  exchangeAsParticipant,
  giveConsent,
  issueInvitation,
  listAttempts,
  orgIdOf,
  runMarker,
  startAttempt,
  submitAttempt,
  syntheticResponse,
} from '../support/flows';

/**
 * Границы сессии участника (ТЗ 07, 10.2):
 *   * сессия участия относится к одному назначению и к кабинету не даёт доступа;
 *   * отозванная (перевыпущенная) ссылка не обменивается;
 *   * после отправки ответы неизменяемы.
 */
test.describe('Границы сессии участника', () => {
  test('сессия участника не открывает чужую попытку и кабинет руководителя', async ({
    baseURL,
  }) => {
    requireRoles('managerA');
    const markerOne = runMarker();
    const markerTwo = runMarker();
    const manager = await ApiActor.login(baseURL!, 'managerA');
    const orgId = orgIdOf(manager);
    const createdOne: { employeeId?: string; assignmentId?: string } = {};
    const createdTwo: { employeeId?: string; assignmentId?: string } = {};
    let participantOne: ApiActor | undefined;
    let participantTwo: ApiActor | undefined;

    try {
      const assignmentOne = await createAssignment(manager, orgId, markerOne);
      Object.assign(createdOne, assignmentOne);
      const assignmentTwo = await createAssignment(manager, orgId, markerTwo);
      Object.assign(createdTwo, assignmentTwo);

      const inviteOne = await issueInvitation(manager, orgId, assignmentOne.assignmentId);
      const inviteTwo = await issueInvitation(manager, orgId, assignmentTwo.assignmentId);
      participantOne = await exchangeAsParticipant(baseURL!, inviteOne.token);
      participantTwo = await exchangeAsParticipant(baseURL!, inviteTwo.token);

      await giveConsent(participantOne);
      await giveConsent(participantTwo);
      const attemptsTwo = await listAttempts(participantTwo);
      const foreignAttemptId = attemptsTwo[0]!.attemptId as string;

      await test.step('чужая попытка недоступна', async () => {
        expectProblem(
          await participantOne!.get(`/participant/attempts/${foreignAttemptId}`),
          [403, 404],
          'чтение чужой попытки',
        );
        expectProblem(
          await participantOne!.post(`/participant/attempts/${foreignAttemptId}/start`, {}),
          [403, 404],
          'начало чужой попытки',
        );
        /*
         * Только 403/404 и только эти коды. 409 сюда допускать нельзя: его дают
         * и STATE_CONFLICT, и REVISION_CONFLICT, поэтому при поломке изоляции
         * (loadAttempt перестал ограничиваться назначением сессии) запрос к
         * чужой неначатой попытке всё равно вернул бы 409 и проба осталась бы
         * зелёной. Фактически сервер отвечает 404.
         */
        const foreignSubmit = expectProblem(
          await participantOne!.post(`/participant/attempts/${foreignAttemptId}/submit`, {
            expectedRevision: 1,
          }),
          [403, 404],
          'отправка чужой попытки',
        );
        expect(
          ['NOT_FOUND', 'FORBIDDEN'],
          `отказ должен быть отказом доступа, получено ${foreignSubmit.code}`,
        ).toContain(foreignSubmit.code);

        const own = await listAttempts(participantOne!);
        expect(own.map((item: any) => item.attemptId)).not.toContain(foreignAttemptId);
      });

      await test.step('кабинет руководителя недоступен по сессии участника', async () => {
        const probes: Array<[string, string]> = [
          ['GET', '/auth/me'],
          ['GET', `/orgs/${orgId}/employees`],
          ['GET', `/orgs/${orgId}/assignments`],
          ['GET', `/orgs/${orgId}/reports`],
          ['GET', `/orgs/${orgId}/dashboard`],
          ['GET', '/admin/overview'],
        ];
        for (const [method, path] of probes) {
          expectProblem(
            await participantOne!.call(method as 'GET', path),
            [401, 403, 404],
            `${path} по сессии участника`,
          );
        }
      });
    } finally {
      await cleanup(manager, orgId, createdOne);
      await cleanup(manager, orgId, createdTwo);
      await participantOne?.dispose();
      await participantTwo?.dispose();
      await manager.dispose();
    }
  });

  test('перевыпуск ссылки отзывает прежнюю, после отправки ответ не меняется', async ({
    baseURL,
  }) => {
    requireRoles('managerA');
    const marker = runMarker();
    const manager = await ApiActor.login(baseURL!, 'managerA');
    const orgId = orgIdOf(manager);
    const created: { employeeId?: string; assignmentId?: string } = {};
    let participant: ApiActor | undefined;

    try {
      const assignment = await createAssignment(manager, orgId, marker);
      Object.assign(created, assignment);

      const first = await issueInvitation(manager, orgId, assignment.assignmentId);
      const second = await issueInvitation(manager, orgId, assignment.assignmentId);
      expect(second.replacedPrevious, 'повторный выпуск заменяет прежнюю ссылку').toBe(true);
      expect(second.token).not.toBe(first.token);

      await test.step('отозванная ссылка не обменивается', async () => {
        const stale = await ApiActor.anonymous(baseURL!, 'participant-stale');
        try {
          const result = await stale.post('/participant/exchange', { token: first.token });
          expectProblem(result, [401, 403, 404, 410], 'обмен отозванной ссылки');
          const cookies = await stale.cookieNames();
          expect(
            cookies.some((name) => name.endsWith('participant_session')),
            'отклонённый обмен не должен выдавать cookie участия',
          ).toBe(false);
        } finally {
          await stale.dispose();
        }
      });

      participant = await exchangeAsParticipant(baseURL!, second.token);
      await giveConsent(participant);

      await test.step('после отправки изменение ответа отклоняется', async () => {
        const summaries = await listAttempts(participant!);
        const attempt = await startAttempt(participant!, summaries[0]!.attemptId);
        const revision = await answerAll(participant!, attempt, marker);
        const submitted = await submitAttempt(participant!, attempt.attemptId, revision);
        expect(submitted, 'отправка подтверждается сервером').toBeTruthy();

        const item = attempt.items[0]!;
        /*
         * Ревизия передаётся заведомо верная: submit увеличивает ревизию на
         * единицу, поэтому revision + 1 — текущее значение. Иначе проверялось бы
         * не правило «ответы отправлены», а защита от второй вкладки: оба
         * отказа дают 409, и подмена одного другим прошла бы незамеченной.
         * Поэтому сверяется код, а не только статус.
         */
        const result = await participant!.put(
          `/participant/attempts/${attempt.attemptId}/answers/${item.id}`,
          { response: syntheticResponse(item, `${marker}second`), expectedRevision: revision + 1 },
        );
        const refusal = expectProblem(result, [409], 'изменение ответа после отправки');
        expect(
          refusal.code,
          'отказ должен объяснять, что ответы уже отправлены, а не конфликт ревизий',
        ).toBe('STATE_CONFLICT');

        /*
         * Повторная отправка идемпотентна по решению сервера: клиент мог
         * потерять ответ из-за обрыва связи. Важно, что она не открывает
         * попытку заново и не меняет отметку времени.
         */
        const repeated = expectOk<any>(
          await participant!.post(`/participant/attempts/${attempt.attemptId}/submit`, {
            expectedRevision: revision,
          }),
          'повторная отправка',
        );
        expect(repeated.submittedAt).toBe(submitted.submittedAt);

        const detail = expectOk<any>(
          await participant!.get(`/participant/attempts/${attempt.attemptId}`),
          'попытка после отправки',
        );
        expect(detail.state ?? detail.status).not.toBe('in_progress');
      });
    } finally {
      await cleanup(manager, orgId, created);
      await participant?.dispose();
      await manager.dispose();
    }
  });
});
