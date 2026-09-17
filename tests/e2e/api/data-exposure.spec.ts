import { expect, test } from '@playwright/test';

import { ApiActor, expectOk } from '../support/api-client';
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
import {
  RAW_ANSWER_KEY_PATTERN,
  SCORING_KEY_PATTERN,
  containsText,
  findKeys,
} from '../support/leaks';

/**
 * Что не выходит за backend (ТЗ 07.4, 09.4, 10.3):
 *   * ключи подсчёта не попадают в проекции сценариев и методик;
 *   * сырые ответы участника не выдаются руководителю ни одним маршрутом;
 *   * до публикации текст ответов вообще недоступен руководителю.
 */
test.describe('Границы выдачи данных', () => {
  test('ключи подсчёта отсутствуют в проекциях сценариев и методик', async ({ baseURL }) => {
    requireRoles('managerA');
    const manager = await ApiActor.login(baseURL!, 'managerA');
    const orgId = orgIdOf(manager);

    try {
      const scenarios = expectOk<any[]>(
        await manager.get(`/orgs/${orgId}/scenarios`),
        'список сценариев',
      );
      expect(scenarios.length).toBeGreaterThan(0);
      expect(findKeys(scenarios, SCORING_KEY_PATTERN)).toEqual([]);

      for (const scenario of scenarios) {
        const detail = expectOk<any>(
          await manager.get(`/orgs/${orgId}/scenarios/${scenario.scenarioVersionId}`),
          'карточка сценария',
        );
        expect(
          findKeys(detail, SCORING_KEY_PATTERN),
          `сценарий ${scenario.code} отдаёт поля подсчёта`,
        ).toEqual([]);
        // Формулировки вопросов методик руководителю тоже не выдаются.
        expect(findKeys(detail, /^(items|questions|prompt)$/i)).toEqual([]);
      }
    } finally {
      await manager.dispose();
    }
  });

  test('ответы участника не выдаются руководителю', async ({ baseURL }) => {
    requireRoles('managerA', 'reviewerA');
    const marker = runMarker();
    // Метка текста ответов отличается от метки сотрудника: иначе совпадение
    // в карточке назначения нельзя отличить от утечки ответа.
    const answerMarker = runMarker();
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

      let markerStored = false;

      await test.step('участник не видит ключей подсчёта в своих вопросах', async () => {
        await completeParticipation(participant!, answerMarker);
        const attempts = expectOk<any[]>(
          await participant!.get('/participant/attempts'),
          'список попыток участника',
        );
        expect(findKeys(attempts, SCORING_KEY_PATTERN)).toEqual([]);
        for (const attempt of attempts) {
          const detail = expectOk<any>(
            await participant!.get(`/participant/attempts/${attempt.attemptId}`),
            'попытка участника',
          );
          // Сканируется весь ответ, а не только items: поля подсчёта могли бы
          // оказаться и в метаданных методики, и в корне попытки.
          expect(
            findKeys(detail, SCORING_KEY_PATTERN),
            'ответ попытки содержит поля подсчёта',
          ).toEqual([]);
          markerStored = markerStored || containsText(detail, answerMarker);
        }
      });

      /*
       * Положительный контроль. Проверка «текст участника не виден
       * руководителю» строится на отсутствии метки, поэтому сначала нужно
       * убедиться, что метка вообще попала в данные: у сценария без
       * свободнотекстовых вопросов метка не появилась бы нигде, и все
       * утверждения ниже стали бы истинными вхолостую.
       */
      expect(
        markerStored,
        'метка ответа не сохранилась у участника: в выбранном сценарии нет свободнотекстовых вопросов, проверка утечки текста вырождается — выберите сценарий с коротким ответом или ситуацией со свободным ответом',
      ).toBe(true);

      await test.step('руководитель не получает ни ответов, ни их текста', async () => {
        // Черновик уже подготовлен, но ещё не опубликован.
        await waitForDraftReport(manager, reviewer, orgId, assignment.assignmentId);

        const routes = [
          `/orgs/${orgId}/assignments/${assignment.assignmentId}`,
          `/orgs/${orgId}/assignments?pageSize=100&employeeId=${assignment.employeeId}`,
          `/orgs/${orgId}/employees/${assignment.employeeId}`,
          `/orgs/${orgId}/employees/${assignment.employeeId}/timeline`,
          `/orgs/${orgId}/dashboard`,
          `/orgs/${orgId}/reports?pageSize=100`,
          `/orgs/${orgId}/notifications?filter=all&pageSize=100`,
          `/orgs/${orgId}/notifications/unread-count`,
        ];

        for (const route of routes) {
          const result = await manager.get(route);
          // Именно expectOk: ответ без данных (например, 204) прошёл бы и
          // проверку статуса, и все проверки на утечки — «зелено» без данных
          // неотличимо от корректного ответа.
          expectOk(result, route);
          expect(
            findKeys(result.body, RAW_ANSWER_KEY_PATTERN),
            `${route} отдаёт структуру ответов участника`,
          ).toEqual([]);
          expect(
            findKeys(result.body, SCORING_KEY_PATTERN),
            `${route} отдаёт ключи подсчёта`,
          ).toEqual([]);
          expect(
            containsText(result.body, answerMarker),
            `${route} отдаёт текст ответа участника до публикации`,
          ).toBe(false);
        }

        // Карточка назначения действительно содержит запрошенный объект,
        // а не пустой ответ, прошедший проверки утечек.
        const card = expectOk<any>(
          await manager.get(`/orgs/${orgId}/assignments/${assignment.assignmentId}`),
          'карточка назначения',
        );
        expect(card.id).toBe(assignment.assignmentId);
      });
    } finally {
      /*
       * Тест доводит назначение до готового черновика и не публикует его.
       * Уборка обязана закрыть черновик рецензентом, иначе он навсегда
       * останется в очереди рецензента общей dev-базы.
       */
      await cleanup(manager, orgId, created, reviewer);
      await participant?.dispose();
      await manager.dispose();
      await reviewer.dispose();
    }
  });

  /**
   * Уведомление — это факт события и ссылка, а не содержание (ТЗ 01.7, M14).
   *
   * Заключение здесь публикуется намеренно: уведомление `report_published`
   * создаётся только публикацией, и проверить его на утечку иначе нельзя.
   * Опубликованное заключение продуктового способа удаления не имеет, поэтому
   * тест использует собственного синтетического сотрудника и архивирует его.
   */
  test('уведомление о готовом заключении не содержит его текста', async ({ baseURL }) => {
    requireRoles('managerA', 'reviewerA');
    const marker = runMarker();
    const answerMarker = runMarker();
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
      await completeParticipation(participant, answerMarker);

      const reportId = await waitForDraftReport(manager, reviewer, orgId, assignment.assignmentId);
      const published = expectOk<any>(
        await reviewer.post(`/orgs/${orgId}/reviews/${reportId}/publish`, {
          checklist: fullChecklist(),
          comment: 'Синтетическая проверка E2E',
        }),
        'публикация заключения',
      );

      const notificationId = await findPublishedNotification(manager, orgId, reportId);

      const inbox = expectOk<any[]>(
        await manager.get(`/orgs/${orgId}/notifications?filter=all&pageSize=100`),
        'ящик уведомлений',
      );
      const notification = inbox.find((item) => item.id === notificationId);
      expect(notification, 'уведомление о публикации должно быть в списке').toBeTruthy();

      // Положительный контроль: записка заключения непустая, иначе проверка
      // «текста нет в уведомлении» была бы истинной вхолостую.
      expect(
        typeof published.summary === 'string' && published.summary.length > 10,
        'у опубликованного заключения нет записки: проверка утечки вырождается',
      ).toBe(true);

      const serialized = JSON.stringify(inbox);
      expect(serialized, 'уведомление отдаёт записку заключения').not.toContain(published.summary);
      expect(serialized, 'уведомление отдаёт текст ответа участника').not.toContain(answerMarker);
      expect(serialized, 'уведомление отдаёт имя сотрудника').not.toContain(marker);
      expect(findKeys(inbox, RAW_ANSWER_KEY_PATTERN)).toEqual([]);
      expect(findKeys(inbox, SCORING_KEY_PATTERN)).toEqual([]);

      // Открытие возвращает только путь и пояснение, без содержания.
      const target = expectOk<any>(
        await manager.post(`/orgs/${orgId}/notifications/${notificationId}/open`, {}),
        'открытие ресурса по уведомлению',
      );
      expect(target.status).toBe('available');
      expect(target.path).toBe(`/app/reports/${reportId}`);
      const openSerialized = JSON.stringify(target);
      expect(openSerialized, 'открытие отдаёт записку заключения').not.toContain(published.summary);
      expect(openSerialized, 'открытие отдаёт текст ответа участника').not.toContain(answerMarker);
    } finally {
      await cleanup(manager, orgId, created, reviewer);
      await participant?.dispose();
      await manager.dispose();
      await reviewer.dispose();
    }
  });
});
