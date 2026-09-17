import { expect, test } from '@playwright/test';

import { ApiActor, expectOk } from '../support/api-client';
import { requireRoles } from '../support/env';
import { SCORING_KEY_PATTERN, containsText, findKeys } from '../support/leaks';
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
 * Сквозной путь P0 на уровне API (ТЗ 12, строка E2E):
 * руководитель назначает → участник проходит → worker готовит черновик →
 * рецензент публикует → руководитель читает заключение и фиксирует решение.
 */
test.describe('Сквозной путь трёх ролей', () => {
  test('назначение → прохождение → черновик → публикация → решение', async ({ baseURL }) => {
    requireRoles('managerA', 'reviewerA');
    const marker = runMarker();
    // Метка текста ответов отличается от метки сотрудника: иначе совпадение
    // в имени участника нельзя отличить от попадания ответа в заключение.
    const answerMarker = runMarker();

    const manager = await ApiActor.login(baseURL!, 'managerA');
    const reviewer = await ApiActor.login(baseURL!, 'reviewerA');
    const orgId = orgIdOf(manager);
    expect(orgIdOf(reviewer), 'рецензент и руководитель должны быть в одной организации').toBe(
      orgId,
    );

    const created: { assignmentId?: string; employeeId?: string } = {};
    let participant: ApiActor | undefined;

    try {
      const assignment = await test.step('руководитель создаёт назначение', async () => {
        const result = await createAssignment(manager, orgId, marker);
        Object.assign(created, result);
        return result;
      });

      const invitation = await test.step('руководитель выпускает ссылку', () =>
        issueInvitation(manager, orgId, assignment.assignmentId));

      participant = await test.step('участник открывает приглашение', () =>
        exchangeAsParticipant(baseURL!, invitation.token));
      const participantCookies = await participant.cookieNames();
      expect(participantCookies.some((name) => name.endsWith('participant_session'))).toBe(true);
      expect(
        participantCookies.some((name) => name.endsWith('app_session')),
        'обмен приглашения не должен выдавать сессию кабинета',
      ).toBe(false);

      await test.step('участник даёт согласие, отвечает и отправляет', async () => {
        await completeParticipation(participant!, answerMarker);
        const completion = expectOk<any>(
          await participant!.get('/participant/completion'),
          'экран завершения',
        );
        expect(completion).toBeTruthy();
      });

      const reportId = await test.step('worker готовит черновик', () =>
        waitForDraftReport(manager, reviewer, orgId, assignment.assignmentId));

      await test.step('до публикации руководитель без reports.review черновик не видит', async () => {
        const unpublished = await manager.get(`/orgs/${orgId}/reports/${reportId}`);
        expect(unpublished.status).toBe(404);
      });

      await test.step('рецензент читает черновик и публикует', async () => {
        const draft = expectOk<any>(
          await reviewer.get(`/orgs/${orgId}/reviews/${reportId}`),
          'черновик для рецензии',
        );
        expect(draft.content.limitations.length).toBeGreaterThan(0);

        const published = expectOk<any>(
          await reviewer.post(`/orgs/${orgId}/reviews/${reportId}/publish`, {
            checklist: fullChecklist(),
            comment: 'Синтетическая проверка E2E',
          }),
          'публикация',
        );
        // Успех подтверждён сервером: в ответе опубликованная ревизия, а не эхо запроса.
        expect(published.reportId).toBe(reportId);
        expect(published.publishedAt).toBeTruthy();
        expect(published.preparation.reviewedAt).toBeTruthy();
      });

      await test.step('руководитель читает опубликованное заключение', async () => {
        const detail = expectOk<any>(
          await manager.get(`/orgs/${orgId}/assignments/${assignment.assignmentId}`),
          'карточка назначения после публикации',
        );
        // Идентификатор заключения появляется у руководителя только после публикации.
        expect(detail.reportId).toBe(reportId);

        const list = expectOk<any[]>(
          await manager.get(`/orgs/${orgId}/reports?pageSize=100`),
          'список заключений',
        );
        expect(list.some((item) => item.reportId === reportId)).toBe(true);

        const report = expectOk<any>(
          await manager.get(`/orgs/${orgId}/reports/${reportId}`),
          'опубликованное заключение',
        );
        expect(report.assignmentId).toBe(assignment.assignmentId);
        expect(report.content.limitations.length).toBeGreaterThan(0);
        expect(report.decisions).toHaveLength(0);

        // Ключи подсчёта не выходят наружу и после публикации.
        expect(
          findKeys(report, SCORING_KEY_PATTERN),
          'опубликованное заключение отдаёт ключи подсчёта',
        ).toEqual([]);

        /*
         * Граница выдачи текста участника.
         *
         * По замыслу (участник предупреждён об этом до начала) дословный
         * свободный ответ виден руководителю только как свидетельство со слов
         * сотрудника: элемент evidence с kind = self_report и построенное на нём
         * утверждение того же вида. Проверка фиксирует именно это: если текст
         * появится где-то ещё (в summary, в решениях, в подготовке), тест упадёт.
         */
        const selfReportEvidence = report.evidence.filter(
          (item: any) => item.kind === 'self_report',
        );
        expect(
          selfReportEvidence.some((item: any) => String(item.content).includes(answerMarker)),
          'ответ участника должен попадать в свидетельства со слов сотрудника',
        ).toBe(true);

        const withoutSelfReport = JSON.parse(JSON.stringify(report));
        withoutSelfReport.evidence = withoutSelfReport.evidence.map((item: any) =>
          item.kind === 'self_report' ? { ...item, content: '' } : item,
        );
        withoutSelfReport.content.findings = withoutSelfReport.content.findings.map((item: any) =>
          item.kind === 'self_report' ? { ...item, statement: '' } : item,
        );
        expect(
          containsText(withoutSelfReport, answerMarker),
          'текст участника допустим только в свидетельствах и утверждениях вида self_report',
        ).toBe(false);
      });

      await test.step('руководитель фиксирует решение', async () => {
        const ack = expectOk<any>(
          await manager.post(`/orgs/${orgId}/reports/${reportId}/decisions`, {
            actionCode: 'discussed_with_employee',
            comment: 'Синтетическое решение E2E',
          }),
          'запись решения',
        );
        expect(ack.acknowledged).toBe(true);

        const report = expectOk<any>(
          await manager.get(`/orgs/${orgId}/reports/${reportId}`),
          'заключение после решения',
        );
        expect(report.decisions.map((item: any) => item.actionCode)).toContain(
          'discussed_with_employee',
        );
      });
    } finally {
      await cleanup(manager, orgId, created, reviewer);
      await participant?.dispose();
      await manager.dispose();
      await reviewer.dispose();
    }
  });
});
