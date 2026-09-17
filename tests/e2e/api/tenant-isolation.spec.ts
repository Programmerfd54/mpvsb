import { expect, test } from '@playwright/test';

import type { NotificationView } from '@context/contracts';

import { ApiActor, expectOk, expectProblem } from '../support/api-client';
import { requireRoles } from '../support/env';
import {
  cleanup,
  completeParticipation,
  createAssignment,
  exchangeAsParticipant,
  findPublishedNotification,
  fullChecklist,
  issueInvitation,
  orgIdOf,
  runMarker,
  waitForDraftReport,
} from '../support/flows';

/**
 * Изоляция организаций (ТЗ 06.5, 10.3).
 *
 * Руководитель организации Б знает идентификаторы объектов организации А
 * и обращается к ним напрямую. Ответ не должен ни выдавать данные,
 * ни подтверждать существование объекта.
 */
test.describe('Изоляция организаций', () => {
  test('руководитель Б не получает объекты организации А по известным id', async ({ baseURL }) => {
    requireRoles('managerA', 'managerB', 'reviewerA');
    const marker = runMarker();

    const managerA = await ApiActor.login(baseURL!, 'managerA');
    const managerB = await ApiActor.login(baseURL!, 'managerB');
    const reviewerA = await ApiActor.login(baseURL!, 'reviewerA');
    const orgA = orgIdOf(managerA);
    const orgB = orgIdOf(managerB);
    expect(orgA, 'организации A и Б должны различаться').not.toBe(orgB);

    const created: { assignmentId?: string; employeeId?: string } = {};
    let participant: ApiActor | undefined;

    try {
      // Объекты организации А, идентификаторы которых узнаёт «нарушитель».
      const assignment = await createAssignment(managerA, orgA, marker);
      Object.assign(created, assignment);
      const invitation = await issueInvitation(managerA, orgA, assignment.assignmentId);
      participant = await exchangeAsParticipant(baseURL!, invitation.token);
      await completeParticipation(participant, marker);
      const reportId = await waitForDraftReport(managerA, reviewerA, orgA, assignment.assignmentId);
      expectOk(
        await reviewerA.post(`/orgs/${orgA}/reviews/${reportId}/publish`, {
          checklist: fullChecklist(),
          comment: 'Синтетическая проверка E2E',
        }),
        'публикация заключения организации А',
      );

      /*
       * Уведомление организации А: публикация уведомляет автора назначения.
       * Его идентификатор — такой же «известный нарушителю» ключ, как и
       * остальные, поэтому он попадает и в probes, и в набор секретов.
       */
      const notificationId = await findPublishedNotification(managerA, orgA, reportId);

      const secrets = [
        assignment.employeeId,
        assignment.assignmentId,
        reportId,
        notificationId,
        orgA,
      ];

      await test.step('чтение объектов А из пути организации А', async () => {
        const probes: Array<[string, string]> = [
          ['GET', `/orgs/${orgA}/employees/${assignment.employeeId}`],
          ['GET', `/orgs/${orgA}/employees/${assignment.employeeId}/timeline`],
          ['GET', `/orgs/${orgA}/assignments/${assignment.assignmentId}`],
          ['GET', `/orgs/${orgA}/reports/${reportId}`],
          ['GET', `/orgs/${orgA}/reports/${reportId}/print`],
          ['GET', `/orgs/${orgA}/dashboard`],
          ['GET', `/orgs/${orgA}/employees`],
          ['GET', `/orgs/${orgA}/assignments`],
          // Ящик уведомлений чужой организации: ни списка, ни счётчика.
          ['GET', `/orgs/${orgA}/notifications`],
          ['GET', `/orgs/${orgA}/notifications?filter=all`],
          ['GET', `/orgs/${orgA}/notifications/unread-count`],
        ];
        for (const [method, path] of probes) {
          const result = await managerB.call(method as 'GET', path);
          // Ровно 404: отсутствие membership не должно отличаться от отсутствия организации.
          expectProblem(result, [404], `${method} ${path} для чужой организации`);
          const serialized = JSON.stringify(result.body);
          for (const secret of secrets.filter((value) => value !== orgA)) {
            expect(
              serialized,
              `${method} ${path}: ответ не должен содержать идентификаторы чужих объектов`,
            ).not.toContain(secret);
          }
        }
      });

      await test.step('изменение объектов А', async () => {
        const mutations: Array<[string, string, unknown]> = [
          ['PATCH', `/orgs/${orgA}/employees/${assignment.employeeId}`, { displayName: 'Взлом' }],
          ['POST', `/orgs/${orgA}/employees/${assignment.employeeId}/archive`, {}],
          [
            'POST',
            `/orgs/${orgA}/assignments/${assignment.assignmentId}/cancel`,
            { reason: 'Попытка из другой организации' },
          ],
          ['POST', `/orgs/${orgA}/assignments/${assignment.assignmentId}/invitations`, {}],
          [
            'POST',
            `/orgs/${orgA}/reports/${reportId}/decisions`,
            { actionCode: 'no_action', comment: 'Попытка из другой организации' },
          ],
          // Отметка и открытие чужого уведомления меняют состояние: 404 и здесь.
          ['POST', `/orgs/${orgA}/notifications/${notificationId}/read`, {}],
          ['POST', `/orgs/${orgA}/notifications/${notificationId}/open`, {}],
          ['POST', `/orgs/${orgA}/notifications/read-all`, {}],
        ];
        for (const [method, path, body] of mutations) {
          const result = await managerB.call(method as 'POST', path, { body });
          expectProblem(result, [404], `${method} ${path} для чужой организации`);
          const serialized = JSON.stringify(result.body);
          for (const secret of secrets.filter((value) => value !== orgA)) {
            expect(
              serialized,
              `${method} ${path}: ответ не должен содержать идентификаторы чужих объектов`,
            ).not.toContain(secret);
          }
        }

        // Уведомление организации А осталось непрочитанным: попытка не сработала.
        const inbox = expectOk<NotificationView[]>(
          await managerA.get(`/orgs/${orgA}/notifications?filter=unread&pageSize=100`),
          'непрочитанные уведомления организации А',
        );
        expect(
          inbox.some((item) => item.id === notificationId),
          'чужая отметка прочитанным не должна срабатывать',
        ).toBe(true);

        // Состояние организации А не изменилось.
        const detail = expectOk<any>(
          await managerA.get(`/orgs/${orgA}/assignments/${assignment.assignmentId}`),
          'назначение организации А после попыток',
        );
        expect(detail.state).not.toBe('cancelled');
        const employee = expectOk<any>(
          await managerA.get(`/orgs/${orgA}/employees/${assignment.employeeId}`),
          'сотрудник организации А после попыток',
        );
        expect(employee.displayName).toContain(marker);
        expect(employee.archivedAt).toBeNull();
      });

      await test.step('в собственной организации чужой объект неотличим от несуществующего', async () => {
        /*
         * Оракул перечисления возможен только в пути организации самого
         * нарушителя: там запрос доходит до сервиса, и разница между «объект
         * есть, но чужой» и «объекта нет» была бы видна по статусу или коду.
         * В пути чужой организации ManagerGuard отвечает раньше сервиса,
         * поэтому такое сравнение ничего не проверяло бы.
         */
        const absentId = '00000000-0000-4000-8000-000000000000';
        const probes: Array<[string, string, string]> = [
          [
            'сотрудник',
            `/orgs/${orgB}/employees/${assignment.employeeId}`,
            `/orgs/${orgB}/employees/${absentId}`,
          ],
          [
            'назначение',
            `/orgs/${orgB}/assignments/${assignment.assignmentId}`,
            `/orgs/${orgB}/assignments/${absentId}`,
          ],
          ['заключение', `/orgs/${orgB}/reports/${reportId}`, `/orgs/${orgB}/reports/${absentId}`],
        ];

        for (const [what, foreignPath, absentPath] of probes) {
          const foreign = await managerB.get(foreignPath);
          const absent = await managerB.get(absentPath);
          const foreignProblem = expectProblem(
            foreign,
            [404],
            `${what}: чужой id в собственной организации`,
          );
          const absentProblem = expectProblem(absent, [404], `${what}: несуществующий id`);

          expect(
            foreign.status,
            `${what}: статус чужого объекта отличается от несуществующего`,
          ).toBe(absent.status);
          expect(foreignProblem.code, `${what}: код ответа раскрывает существование объекта`).toBe(
            absentProblem.code,
          );
          expect(
            foreignProblem.title,
            `${what}: текст ответа раскрывает существование объекта`,
          ).toBe(absentProblem.title);
          expect(
            foreignProblem.fieldErrors,
            `${what}: подробности ответа раскрывают существование объекта`,
          ).toEqual(absentProblem.fieldErrors);

          /*
           * Здесь проверяется полный набор, включая идентификатор организации А:
           * запрос идёт по пути организации Б, поэтому появление orgA в теле
           * было бы утечкой, а не следствием пути (в первом шаге orgA есть в
           * самом пути, и там он из набора исключён).
           */
          const serialized = JSON.stringify(foreign.body);
          for (const secret of secrets) {
            expect(
              serialized,
              `${what}: в ответе не должно быть идентификаторов организации А`,
            ).not.toContain(secret);
          }
        }

        /*
         * Уведомление отдельным шагом: читается оно не GET-маршрутом, а
         * отметкой прочитанным, и сравнить «чужое» с «несуществующим» можно
         * только через неё.
         */
        const foreignNotification = await managerB.post(
          `/orgs/${orgB}/notifications/${notificationId}/read`,
          {},
        );
        const absentNotification = await managerB.post(
          `/orgs/${orgB}/notifications/${absentId}/read`,
          {},
        );

        const foreignProblem = expectProblem(
          foreignNotification,
          [404],
          'уведомление: чужой id в собственной организации',
        );
        const absentProblem = expectProblem(
          absentNotification,
          [404],
          'уведомление: несуществующий id',
        );

        expect(foreignNotification.status).toBe(absentNotification.status);
        expect(foreignProblem.code, 'код ответа раскрывает существование уведомления').toBe(
          absentProblem.code,
        );
        expect(foreignProblem.title, 'текст ответа раскрывает существование уведомления').toBe(
          absentProblem.title,
        );

        const serializedNotification = JSON.stringify(foreignNotification.body);
        for (const secret of secrets) {
          expect(
            serializedNotification,
            'уведомление: в ответе не должно быть идентификаторов организации А',
          ).not.toContain(secret);
        }
      });
    } finally {
      await cleanup(managerA, orgA, created, reviewerA);
      await participant?.dispose();
      await managerA.dispose();
      await managerB.dispose();
      await reviewerA.dispose();
    }
  });
});
