import { expect, test } from '@playwright/test';

import { ApiActor, expectOk, expectProblem } from '../support/api-client';
import { requireRoles } from '../support/env';
import {
  cleanup,
  completeParticipation,
  createAssignment,
  exchangeAsParticipant,
  fullChecklist,
  issueInvitation,
  orgIdOf,
  runMarker,
  waitForDraftReport,
} from '../support/flows';

/**
 * Доступ к черновику и к опубликованному заключению (ТЗ A08, 10.3).
 *
 * Черновик виден только с разрешением reports.review. Руководитель без него
 * не получает ни черновик, ни очередь рецензии, ни право публикации.
 */
test.describe('Черновик и публикация', () => {
  test('черновик недоступен без reports.review, публикация — только рецензенту', async ({
    baseURL,
  }) => {
    requireRoles('managerA', 'reviewerA');
    const marker = runMarker();

    const manager = await ApiActor.login(baseURL!, 'managerA');
    const reviewer = await ApiActor.login(baseURL!, 'reviewerA');
    const orgId = orgIdOf(manager);
    const created: { assignmentId?: string; employeeId?: string } = {};
    let participant: ApiActor | undefined;

    try {
      const assignment = await createAssignment(manager, orgId, marker);
      Object.assign(created, assignment);
      const invitation = await issueInvitation(manager, orgId, assignment.assignmentId);
      participant = await exchangeAsParticipant(baseURL!, invitation.token);
      await completeParticipation(participant, marker);
      const reportId = await waitForDraftReport(manager, reviewer, orgId, assignment.assignmentId);

      await test.step('руководитель без reports.review не видит черновик', async () => {
        expectProblem(
          await manager.get(`/orgs/${orgId}/reviews`),
          [403],
          'очередь рецензии без права',
        );
        expectProblem(
          await manager.get(`/orgs/${orgId}/reviews/${reportId}`),
          [403],
          'черновик без права',
        );
        expectProblem(
          await manager.post(`/orgs/${orgId}/reviews/${reportId}/publish`, {
            checklist: fullChecklist(),
          }),
          [403],
          'публикация без права',
        );
        // Маршрут опубликованных заключений черновик не отдаёт.
        expectProblem(
          await manager.get(`/orgs/${orgId}/reports/${reportId}`),
          [404],
          'неопубликованное заключение по маршруту reports',
        );
        expectProblem(
          await manager.get(`/orgs/${orgId}/reports/${reportId}/print`),
          [404],
          'печатная форма неопубликованного заключения',
        );
        expectProblem(
          await manager.post(`/orgs/${orgId}/reports/${reportId}/decisions`, {
            actionCode: 'no_action',
          }),
          [404],
          'решение по неопубликованному заключению',
        );

        const list = expectOk<any[]>(
          await manager.get(`/orgs/${orgId}/reports?pageSize=100`),
          'список опубликованных заключений',
        );
        expect(
          list.some((item) => item.reportId === reportId),
          'черновик не должен попадать в список заключений руководителя',
        ).toBe(false);
      });

      await test.step('неполный чек-лист не публикует', async () => {
        const partial = { ...fullChecklist(), no_invented_numbers: false };
        const result = await reviewer.post(`/orgs/${orgId}/reviews/${reportId}/publish`, {
          checklist: partial,
        });
        /*
         * Неполный чек-лист отклоняется дважды: схемой запроса (каждый пункт —
         * литерал true, VALIDATION_FAILED) и правилом публикации в сервисе
         * (BUSINESS_RULE_VIOLATION). До сервиса запрос сейчас не доходит,
         * поэтому допускаются оба кода, но не «любая ошибка»: 401 и 500
         * проверку не проходят.
         */
        const problem = expectProblem(result, [400, 409, 422], 'публикация с неполным чек-листом');
        expect(
          ['VALIDATION_FAILED', 'BUSINESS_RULE_VIOLATION'],
          `отказ должен объяснять нарушенное правило, получено ${problem.code}`,
        ).toContain(problem.code);
        // Отказ называет неподтверждённый пункт: рецензент видит, что исправить.
        expect(
          problem.fieldErrors.some((item) => item.field.includes('no_invented_numbers')),
          'отказ должен называть неподтверждённый пункт чек-листа',
        ).toBe(true);
        const stillDraft = await manager.get(`/orgs/${orgId}/reports/${reportId}`);
        expect(stillDraft.status, 'после отказа заключение не опубликовано').toBe(404);
      });

      await test.step('после публикации рецензентом заключение доступно руководителю', async () => {
        expectOk(
          await reviewer.post(`/orgs/${orgId}/reviews/${reportId}/publish`, {
            checklist: fullChecklist(),
            comment: 'Синтетическая проверка E2E',
          }),
          'публикация рецензентом',
        );
        const report = expectOk<any>(
          await manager.get(`/orgs/${orgId}/reports/${reportId}`),
          'опубликованное заключение',
        );
        expect(report.publishedAt).toBeTruthy();
        expect(report.preparation.reviewerName).toBeTruthy();
      });
    } finally {
      await cleanup(manager, orgId, created, reviewer);
      await participant?.dispose();
      await manager.dispose();
      await reviewer.dispose();
    }
  });
});
