import { Injectable } from '@nestjs/common';

import {
  answerResponseSchema,
  methodItemSchema,
  methodPassportSchema,
  type AnswerResponse,
  type MethodItem,
  type ParticipantAttemptDetail,
  type ParticipantAttemptSummary,
  type ParticipantCompletion,
  type ParticipantSession,
  type ParticipantTerms,
  type SaveAnswerResult,
  type SubmitAttemptResult,
} from '@context/contracts';
import { resolveInvitation, toJson, type TenantTransaction } from '@context/database';
import {
  ATTEMPT_STATE_LABELS,
  SESSION_POLICY,
  acceptsAnswers,
  acceptsParticipation,
  assignmentStateMachine,
  attemptStateMachine,
  type AssignmentState,
  type AttemptState,
} from '@context/domain';
import { contentHash } from '@context/scoring';
import { z } from 'zod';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';
import { OutboxService } from '../../platform/outbox/outbox.service';
import type { RequestActor } from '../../platform/request/request-context';
import { generateSecret, hashSecret } from '../../platform/security/hashing';

const itemsSchema = z.array(methodItemSchema);

export interface IssuedParticipantSession {
  readonly secret: string;
  readonly maxAgeSeconds: number;
}

@Injectable()
export class ParticipationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Обмен токена приглашения на сессию участия.
   *
   * Вызывается только POST-запросом после действия человека: предварительный
   * просмотр ссылки почтовым сканером не активирует приглашение и не расходует его.
   * Недействительный, отозванный и истёкший токен дают один и тот же ответ,
   * чтобы по нему нельзя было судить о существовании оценки.
   */
  async exchangeInvitation(token: string): Promise<IssuedParticipantSession> {
    const invitation = await resolveInvitation(this.prisma.preContext, hashSecret(token));
    const now = new Date();

    if (!invitation || invitation.revoked_at !== null || invitation.expires_at <= now) {
      throw new AppError('INVITATION_EXPIRED', {
        title: 'Ссылка недействительна или срок участия истёк',
      });
    }

    const organizationId = invitation.organization_id;

    return this.prisma.tenant({ organizationId }, async (tx) => {
      const assignment = await tx.assignments.findFirst({
        where: { id: invitation.assignment_id, organization_id: organizationId },
        select: { id: true, state: true, due_at: true },
      });

      if (!assignment || !acceptsParticipation(assignment.state as AssignmentState)) {
        throw new AppError('INVITATION_EXPIRED', {
          title: 'Ссылка недействительна или срок участия истёк',
        });
      }

      // Новый вход закрывает прежнюю сессию: одновременно активна одна (ТЗ E03).
      await tx.participant_sessions.updateMany({
        where: {
          organization_id: organizationId,
          assignment_id: assignment.id,
          revoked_at: null,
        },
        data: { revoked_at: now },
      });

      const secret = generateSecret();
      const policy = SESSION_POLICY.participant;
      const absoluteExpiry = new Date(now.getTime() + policy.absoluteMinutes * 60_000);
      // Сессия не переживает срок приглашения.
      const cappedExpiry =
        assignment.due_at && assignment.due_at < absoluteExpiry
          ? assignment.due_at
          : absoluteExpiry;

      await tx.participant_sessions.create({
        data: {
          organization_id: organizationId,
          assignment_id: assignment.id,
          invitation_id: invitation.invitation_id,
          session_hash: hashSecret(secret),
          idle_expires_at: new Date(now.getTime() + policy.idleMinutes * 60_000),
          absolute_expires_at: cappedExpiry,
        },
      });

      await tx.invitations.update({
        where: { id: invitation.invitation_id },
        data: { last_exchanged_at: now, exchange_count: { increment: 1 } },
      });

      await this.audit.recordIn(tx, {
        action: 'participation.session_opened',
        outcome: 'success',
        organizationId,
        resourceType: 'assignment',
        resourceId: assignment.id,
      });

      return {
        secret,
        maxAgeSeconds: Math.max(60, Math.floor((cappedExpiry.getTime() - now.getTime()) / 1000)),
      };
    });
  }

  async session(actor: RequestActor): Promise<ParticipantSession> {
    const { organizationId, assignmentId } = requireScope(actor);

    return this.prisma.tenant({ organizationId }, async (tx) => {
      const assignment = await tx.assignments.findFirstOrThrow({
        where: { id: assignmentId, organization_id: organizationId },
        select: {
          mode: true,
          due_at: true,
          organizations: { select: { name: true, participant_contact: true } },
          scenario_versions: {
            select: {
              participant_visibility: true,
              scenario: { select: { title: true } },
            },
          },
          attempts: { select: { state: true } },
          consent_records: { select: { withdrawn_at: true } },
          participation_declines: { select: { id: true } },
        },
      });

      const consentGiven = assignment.consent_records.some((row) => row.withdrawn_at === null);

      return {
        organizationName: assignment.organizations.name,
        organizationContact: assignment.organizations.participant_contact,
        scenarioTitle: assignment.scenario_versions.scenario.title,
        expiresAt: (assignment.due_at ?? new Date()).toISOString(),
        consentGiven,
        declined: assignment.participation_declines !== null,
        methodCount: assignment.attempts.length,
        submittedCount: assignment.attempts.filter(
          (attempt) => attempt.state === 'submitted' || attempt.state === 'scored',
        ).length,
        participantVisibility: assignment.scenario_versions
          .participant_visibility as ParticipantSession['participantVisibility'],
        mode: assignment.mode as ParticipantSession['mode'],
      };
    });
  }

  async terms(actor: RequestActor): Promise<ParticipantTerms> {
    const { organizationId } = requireScope(actor);

    return this.prisma.tenant({ organizationId }, async (tx) => {
      const document = await tx.legal_document_versions.findFirst({
        where: { key: 'participation_notice', locale: 'ru' },
        orderBy: [{ status: 'asc' }, { semantic_version: 'desc' }],
        select: {
          id: true,
          title: true,
          body: true,
          status: true,
          content_hash: true,
          purpose: true,
        },
      });

      if (!document) {
        throw AppError.conflict(
          'Документ информирования не настроен. Обратитесь к ответственному за оценку.',
        );
      }

      return {
        documentVersionId: document.id,
        title: document.title,
        bodyMarkdown: document.body,
        status: document.status as ParticipantTerms['status'],
        contentHash: document.content_hash,
        purpose: document.purpose,
      };
    });
  }

  /**
   * Подтверждение участия. Сохраняется версия и хэш документа: позже нельзя
   * будет утверждать, что человек соглашался с другим текстом.
   */
  async giveConsent(
    actor: RequestActor,
    documentVersionId: string,
    documentHash: string,
  ): Promise<void> {
    const { organizationId, assignmentId } = requireScope(actor);

    await this.prisma.tenant({ organizationId }, async (tx) => {
      const document = await tx.legal_document_versions.findUnique({
        where: { id: documentVersionId },
        select: { id: true, content_hash: true, purpose: true, status: true },
      });

      if (!document || document.content_hash !== documentHash) {
        throw AppError.conflict(
          'Текст условий изменился. Откройте страницу заново и прочитайте актуальную версию.',
        );
      }

      const assignment = await tx.assignments.findFirstOrThrow({
        where: { id: assignmentId, organization_id: organizationId },
        select: { state: true, mode: true },
      });

      // Реальные участники не допускаются к образцу документа.
      if (assignment.mode !== 'demo' && document.status !== 'approved') {
        throw AppError.businessRule(
          'Документ информирования не утверждён: запуск реальной оценки заблокирован.',
        );
      }

      if (!acceptsParticipation(assignment.state as AssignmentState)) {
        throw AppError.conflict('Оценка больше не принимает ответы');
      }

      await tx.consent_records.upsert({
        where: {
          organization_id_assignment_id_document_version_id: {
            organization_id: organizationId,
            assignment_id: assignmentId,
            document_version_id: documentVersionId,
          },
        },
        create: {
          organization_id: organizationId,
          assignment_id: assignmentId,
          document_version_id: documentVersionId,
          document_hash: documentHash,
          purpose: document.purpose,
          confirmation_metadata: toJson({ method: 'checkbox', locale: 'ru' }),
        },
        update: { withdrawn_at: null, accepted_at: new Date() },
      });

      await this.audit.recordIn(tx, {
        action: 'participation.consent_given',
        outcome: 'success',
        organizationId,
        resourceType: 'assignment',
        resourceId: assignmentId,
        metadata: { documentVersionId, documentStatus: document.status },
      });
    });
  }

  /** Отказ от участия. Фиксируется нейтрально, без психологической интерпретации. */
  async decline(actor: RequestActor): Promise<void> {
    const { organizationId, assignmentId } = requireScope(actor);

    await this.prisma.tenant({ organizationId }, async (tx) => {
      await tx.participation_declines.upsert({
        where: {
          organization_id_assignment_id: {
            organization_id: organizationId,
            assignment_id: assignmentId,
          },
        },
        create: { organization_id: organizationId, assignment_id: assignmentId },
        update: {},
      });

      await tx.participant_sessions.updateMany({
        where: { organization_id: organizationId, assignment_id: assignmentId, revoked_at: null },
        data: { revoked_at: new Date() },
      });

      await this.audit.recordIn(tx, {
        action: 'participation.declined',
        outcome: 'success',
        organizationId,
        resourceType: 'assignment',
        resourceId: assignmentId,
      });
    });
  }

  async listAttempts(actor: RequestActor): Promise<ParticipantAttemptSummary[]> {
    const { organizationId, assignmentId } = requireScope(actor);

    return this.prisma.tenant({ organizationId }, async (tx) => {
      await this.assertConsent(tx, organizationId, assignmentId);

      const attempts = await tx.attempts.findMany({
        where: { organization_id: organizationId, assignment_id: assignmentId },
        orderBy: { order_index: 'asc' },
        select: {
          id: true,
          order_index: true,
          required: true,
          state: true,
          method_versions: { select: { passport_json: true, items_json: true } },
          answers: { select: { id: true } },
        },
      });

      return attempts.map((attempt) => {
        const passport = methodPassportSchema.parse(attempt.method_versions.passport_json);
        const items = itemsSchema.parse(attempt.method_versions.items_json);
        const state = attempt.state as AttemptState;
        return {
          attemptId: attempt.id,
          title: passport.title,
          participantIntro: passport.participantIntro,
          orderIndex: attempt.order_index,
          required: attempt.required,
          state,
          stateLabel: ATTEMPT_STATE_LABELS[state],
          itemCount: items.length,
          answeredCount: attempt.answers.length,
          estimatedMinutes: passport.estimatedMinutes,
          limitations: passport.limitations,
        };
      });
    });
  }

  async getAttempt(actor: RequestActor, attemptId: string): Promise<ParticipantAttemptDetail> {
    const { organizationId, assignmentId } = requireScope(actor);

    return this.prisma.tenant({ organizationId }, async (tx) => {
      await this.assertConsent(tx, organizationId, assignmentId);
      const attempt = await this.loadAttempt(tx, organizationId, assignmentId, attemptId);

      const passport = methodPassportSchema.parse(attempt.method_versions.passport_json);
      const items = itemsSchema.parse(attempt.method_versions.items_json);

      const answers: Record<string, AnswerResponse> = {};
      for (const answer of attempt.answers) {
        answers[answer.item_id] = answerResponseSchema.parse(answer.response_json);
      }

      const state = attempt.state as AttemptState;

      return {
        attemptId: attempt.id,
        title: passport.title,
        participantIntro: passport.participantIntro,
        state,
        revision: attempt.revision,
        activeItemId: attempt.active_item_id,
        items,
        answers,
        canEdit: acceptsAnswers(state),
      };
    });
  }

  /** Начало прохождения: фиксируется серверное время старта. */
  async startAttempt(actor: RequestActor, attemptId: string): Promise<ParticipantAttemptDetail> {
    const { organizationId, assignmentId } = requireScope(actor);

    await this.prisma.tenant({ organizationId }, async (tx) => {
      await this.assertConsent(tx, organizationId, assignmentId);
      const attempt = await this.loadAttempt(tx, organizationId, assignmentId, attemptId);
      const state = attempt.state as AttemptState;

      if (state !== 'not_started') {
        return;
      }

      const items = itemsSchema.parse(attempt.method_versions.items_json);
      attemptStateMachine.assert(state, 'in_progress');

      await tx.attempts.update({
        where: { id: attemptId },
        data: {
          state: 'in_progress',
          started_at: new Date(),
          // Порядок вопросов фиксируется здесь: номер «вопрос N из M»
          // не меняется при обновлении страницы.
          question_order_json: toJson(items.map((item) => item.id)),
          active_item_id: items[0]?.id ?? null,
          revision: { increment: 1 },
        },
      });

      await this.markAssignmentInProgress(tx, organizationId, assignmentId);
    });

    return this.getAttempt(actor, attemptId);
  }

  /**
   * Сохранение ответа.
   *
   * Ответ проверяется по закреплённой версии методики: вариант из другой версии
   * или значение вне шкалы не сохраняются. Ревизия защищает от тихой перезаписи
   * из второй вкладки.
   */
  async saveAnswer(
    actor: RequestActor,
    attemptId: string,
    itemId: string,
    response: AnswerResponse,
    expectedRevision: number,
  ): Promise<SaveAnswerResult> {
    const { organizationId, assignmentId } = requireScope(actor);

    return this.prisma.tenant({ organizationId }, async (tx) => {
      await this.assertConsent(tx, organizationId, assignmentId);
      const attempt = await this.loadAttempt(tx, organizationId, assignmentId, attemptId);
      const state = attempt.state as AttemptState;

      if (!acceptsAnswers(state)) {
        throw AppError.conflict('Ответы этого теста уже отправлены и изменению не подлежат');
      }

      if (attempt.revision !== expectedRevision) {
        throw AppError.revisionConflict(
          'Тест открыт в другом окне. Обновите страницу, чтобы увидеть последние ответы.',
        );
      }

      const items = itemsSchema.parse(attempt.method_versions.items_json);
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item) {
        throw AppError.notFound(`Вопрос ${itemId} не принадлежит этой версии методики`);
      }

      const errors = validateResponseAgainstItem(item, response);
      if (errors.length > 0) {
        throw AppError.validation(errors, 'Проверьте ответ');
      }

      await tx.answers.upsert({
        where: {
          organization_id_attempt_id_item_id: {
            organization_id: organizationId,
            attempt_id: attemptId,
            item_id: itemId,
          },
        },
        create: {
          organization_id: organizationId,
          attempt_id: attemptId,
          item_id: itemId,
          response_json: toJson(response),
        },
        update: {
          response_json: toJson(response),
          saved_at: new Date(),
          revision: { increment: 1 },
        },
      });

      const updated = await tx.attempts.update({
        where: { id: attemptId },
        data: { revision: { increment: 1 }, active_item_id: itemId },
        select: { revision: true, updated_at: true },
      });

      const answeredCount = await tx.answers.count({
        where: { organization_id: organizationId, attempt_id: attemptId },
      });

      return {
        attemptRevision: updated.revision,
        savedAt: updated.updated_at.toISOString(),
        answeredCount,
      };
    });
  }

  /**
   * Отправка теста.
   *
   * В одной транзакции проверяются согласие, состояние назначения, ревизия и
   * полнота обязательных ответов, сохраняется неизменяемый снимок и ставится
   * событие обработки. Частичной фиксации не бывает.
   */
  async submitAttempt(
    actor: RequestActor,
    attemptId: string,
    expectedRevision: number,
  ): Promise<SubmitAttemptResult> {
    const { organizationId, assignmentId } = requireScope(actor);

    return this.prisma.tenant({ organizationId }, async (tx) => {
      const consentHash = await this.assertConsent(tx, organizationId, assignmentId);

      const attempt = await this.loadAttempt(tx, organizationId, assignmentId, attemptId);
      const state = attempt.state as AttemptState;

      // Повторная отправка возвращает тот же факт, а не ошибку: клиент мог
      // потерять ответ из-за обрыва связи и не знать, что отправка прошла.
      // Проверка идёт до состояния назначения: последняя отправка переводит
      // назначение в `completed`, и иначе повтор выглядел бы как отказ.
      if (state === 'submitted' || state === 'scored' || state === 'scoring_failed') {
        return this.buildSubmitResult(
          tx,
          organizationId,
          assignmentId,
          attempt.id,
          attempt.submitted_at,
        );
      }

      const assignment = await tx.assignments.findFirstOrThrow({
        where: { id: assignmentId, organization_id: organizationId },
        select: { state: true, due_at: true, data_generation: true },
      });

      if (!acceptsParticipation(assignment.state as AssignmentState)) {
        throw AppError.conflict('Оценка больше не принимает ответы');
      }
      if (assignment.due_at && assignment.due_at <= new Date()) {
        throw new AppError('INVITATION_EXPIRED', { title: 'Срок участия закончился' });
      }

      if (attempt.revision !== expectedRevision) {
        throw AppError.revisionConflict(
          'Тест открыт в другом окне. Обновите страницу перед отправкой.',
        );
      }

      const items = itemsSchema.parse(attempt.method_versions.items_json);
      const answersByItem = new Map(
        attempt.answers.map((answer) => [
          answer.item_id,
          answerResponseSchema.parse(answer.response_json),
        ]),
      );

      const missingRequired = items
        .filter((item) => item.required && !answersByItem.has(item.id))
        .map((item) => item.id);

      if (missingRequired.length > 0) {
        throw AppError.businessRule(
          `Не отвечено обязательных вопросов: ${missingRequired.length}. Вернитесь и заполните их.`,
          missingRequired.map((itemId) => ({ field: itemId, message: 'Нужен ответ' })),
        );
      }

      const now = new Date();
      const snapshot = Object.fromEntries(answersByItem);

      attemptStateMachine.assert(state, 'submitted');

      await tx.attempts.update({
        where: { id: attemptId },
        data: { state: 'submitted', submitted_at: now, revision: { increment: 1 } },
      });

      await tx.submission_snapshots.create({
        data: {
          organization_id: organizationId,
          attempt_id: attemptId,
          answers_snapshot_json: toJson(snapshot),
          input_hash: contentHash(snapshot),
          consent_hash: consentHash,
          submitted_at: now,
        },
      });

      // Событие в той же транзакции: подсчёт не потеряется и не сработает,
      // если транзакция откатится.
      await this.outbox.enqueue(tx, {
        eventType: 'attempt.submitted',
        organizationId,
        entityType: 'attempt',
        entityId: attemptId,
        payload: { assignmentId },
        dataGeneration: assignment.data_generation,
      });

      const result = await this.buildSubmitResult(tx, organizationId, assignmentId, attemptId, now);

      if (result.allSubmitted) {
        assignmentStateMachine.assert(assignment.state as AssignmentState, 'completed');
        await tx.assignments.update({
          where: { id: assignmentId },
          data: { state: 'completed', completed_at: now, revision: { increment: 1 } },
        });
        await this.outbox.enqueue(tx, {
          eventType: 'assignment.completed',
          organizationId,
          entityType: 'assignment',
          entityId: assignmentId,
          dataGeneration: assignment.data_generation,
        });
      }

      await this.audit.recordIn(tx, {
        action: 'participation.attempt_submitted',
        outcome: 'success',
        organizationId,
        resourceType: 'attempt',
        resourceId: attemptId,
        metadata: { allSubmitted: result.allSubmitted },
      });

      return result;
    });
  }

  async completion(actor: RequestActor): Promise<ParticipantCompletion> {
    const { organizationId, assignmentId } = requireScope(actor);

    return this.prisma.tenant({ organizationId }, async (tx) => {
      const assignment = await tx.assignments.findFirstOrThrow({
        where: { id: assignmentId, organization_id: organizationId },
        select: {
          completed_at: true,
          organizations: { select: { participant_contact: true } },
          scenario_versions: { select: { participant_visibility: true } },
          attempts: { select: { state: true, required: true } },
          reports: { select: { status: true } },
        },
      });

      const allSubmitted = assignment.attempts
        .filter((attempt) => attempt.required)
        .every((attempt) => attempt.state !== 'not_started' && attempt.state !== 'in_progress');

      const reportStatus = assignment.reports?.status ?? null;
      const stageLabel = !allSubmitted
        ? 'Тесты ещё не завершены'
        : reportStatus === 'published'
          ? 'Заключение подготовлено и передано руководителю'
          : reportStatus === 'pending_review'
            ? 'Результат готовится и проходит проверку'
            : 'Ответы получены, результат обрабатывается';

      const feedbackAvailable =
        assignment.scenario_versions.participant_visibility === 'participant_summary';

      return {
        allSubmitted,
        submittedAt: assignment.completed_at?.toISOString() ?? null,
        stageLabel,
        organizationContact: assignment.organizations.participant_contact,
        feedbackAvailable,
        explanation: feedbackAvailable
          ? 'После проверки вам будет доступна согласованная краткая обратная связь.'
          : 'Развёрнутое заключение предназначено руководителю. Вам доступно подтверждение участия; срок подготовки заранее не назван, потому что он зависит от проверки человеком.',
      };
    });
  }

  async logout(actor: RequestActor): Promise<void> {
    if (!actor.sessionId) {
      return;
    }
    const { organizationId } = requireScope(actor);
    await this.prisma.tenant({ organizationId }, async (tx) => {
      await tx.participant_sessions.updateMany({
        where: { id: actor.sessionId, revoked_at: null },
        data: { revoked_at: new Date() },
      });
    });
  }

  /** Согласие обязательно до любого доступа к вопросам. */
  private async assertConsent(
    tx: TenantTransaction,
    organizationId: string,
    assignmentId: string,
  ): Promise<string> {
    const consent = await tx.consent_records.findFirst({
      where: {
        organization_id: organizationId,
        assignment_id: assignmentId,
        withdrawn_at: null,
      },
      select: { document_hash: true },
      orderBy: { accepted_at: 'desc' },
    });

    if (!consent) {
      throw AppError.forbidden(
        'Сначала прочитайте условия участия и подтвердите согласие',
        'consent_missing',
      );
    }

    return consent.document_hash;
  }

  private async loadAttempt(
    tx: TenantTransaction,
    organizationId: string,
    assignmentId: string,
    attemptId: string,
  ) {
    const attempt = await tx.attempts.findFirst({
      // Попытка обязана принадлежать назначению этой сессии: чужой attemptId
      // возвращает 404, а не чужие вопросы.
      where: { id: attemptId, organization_id: organizationId, assignment_id: assignmentId },
      select: {
        id: true,
        state: true,
        revision: true,
        active_item_id: true,
        submitted_at: true,
        method_versions: { select: { passport_json: true, items_json: true } },
        answers: { select: { item_id: true, response_json: true } },
      },
    });

    if (!attempt) {
      throw AppError.notFound(`Попытка ${attemptId} не относится к вашему участию`);
    }

    return attempt;
  }

  private async markAssignmentInProgress(
    tx: TenantTransaction,
    organizationId: string,
    assignmentId: string,
  ): Promise<void> {
    const assignment = await tx.assignments.findFirstOrThrow({
      where: { id: assignmentId, organization_id: organizationId },
      select: { state: true },
    });

    if (assignment.state === 'invited') {
      await tx.assignments.update({
        where: { id: assignmentId },
        data: { state: 'in_progress', revision: { increment: 1 } },
      });
    }
  }

  private async buildSubmitResult(
    tx: TenantTransaction,
    organizationId: string,
    assignmentId: string,
    attemptId: string,
    submittedAt: Date | null,
  ): Promise<SubmitAttemptResult> {
    const attempts = await tx.attempts.findMany({
      where: { organization_id: organizationId, assignment_id: assignmentId },
      orderBy: { order_index: 'asc' },
      select: { id: true, state: true, required: true },
    });

    const pending = attempts.filter(
      (attempt) => attempt.state === 'not_started' || attempt.state === 'in_progress',
    );

    return {
      attemptId,
      submittedAt: (submittedAt ?? new Date()).toISOString(),
      nextAttemptId: pending[0]?.id ?? null,
      allSubmitted: attempts
        .filter((attempt) => attempt.required)
        .every((attempt) => attempt.state !== 'not_started' && attempt.state !== 'in_progress'),
    };
  }
}

function requireScope(actor: RequestActor): { organizationId: string; assignmentId: string } {
  if (actor.type !== 'participant' || !actor.organizationId || !actor.assignmentId) {
    throw AppError.forbidden('Доступ участника недействителен', 'participant scope missing');
  }
  return { organizationId: actor.organizationId, assignmentId: actor.assignmentId };
}

/** Проверка ответа по конкретному вопросу закреплённой версии методики. */
export function validateResponseAgainstItem(
  item: MethodItem,
  response: AnswerResponse,
): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = [];
  const field = `response`;

  if (item.type !== response.type) {
    return [{ field, message: 'Тип ответа не соответствует вопросу' }];
  }

  switch (item.type) {
    case 'single_choice': {
      const answer = response as Extract<AnswerResponse, { type: 'single_choice' }>;
      if (!item.options.some((option) => option.id === answer.optionId)) {
        errors.push({ field, message: 'Выбран вариант, которого нет в этом вопросе' });
      }
      break;
    }
    case 'multiple_choice': {
      const answer = response as Extract<AnswerResponse, { type: 'multiple_choice' }>;
      const unique = new Set(answer.optionIds);
      if (unique.size !== answer.optionIds.length) {
        errors.push({ field, message: 'Вариант выбран дважды' });
      }
      for (const optionId of answer.optionIds) {
        if (!item.options.some((option) => option.id === optionId)) {
          errors.push({ field, message: 'Выбран вариант, которого нет в этом вопросе' });
          break;
        }
      }
      if (unique.size < item.minSelected) {
        errors.push({ field, message: `Выберите не меньше ${item.minSelected} вариантов` });
      }
      if (unique.size > item.maxSelected) {
        errors.push({ field, message: `Выберите не больше ${item.maxSelected} вариантов` });
      }
      break;
    }
    case 'likert': {
      const answer = response as Extract<AnswerResponse, { type: 'likert' }>;
      if (answer.value < item.min || answer.value > item.max) {
        errors.push({ field, message: 'Значение вне шкалы' });
      }
      break;
    }
    case 'numeric': {
      const answer = response as Extract<AnswerResponse, { type: 'numeric' }>;
      if (answer.value < item.min || answer.value > item.max) {
        errors.push({ field, message: `Укажите число от ${item.min} до ${item.max}` });
      }
      break;
    }
    case 'short_text': {
      const answer = response as Extract<AnswerResponse, { type: 'short_text' }>;
      if (item.required && answer.text.trim().length === 0) {
        errors.push({ field, message: 'Введите ответ' });
      }
      if (answer.text.length > item.maxLength) {
        errors.push({ field, message: `Не больше ${item.maxLength} символов` });
      }
      break;
    }
    case 'situational': {
      const answer = response as Extract<AnswerResponse, { type: 'situational' }>;
      if (item.response.kind === 'single_choice') {
        if (!answer.optionId) {
          errors.push({ field, message: 'Выберите вариант' });
        } else if (!item.response.options.some((option) => option.id === answer.optionId)) {
          errors.push({ field, message: 'Выбран вариант, которого нет в этом вопросе' });
        }
      } else {
        const text = answer.text ?? '';
        if (item.required && text.trim().length === 0) {
          errors.push({ field, message: 'Введите ответ' });
        }
        if (text.length > item.response.maxLength) {
          errors.push({ field, message: `Не больше ${item.response.maxLength} символов` });
        }
      }
      break;
    }
  }

  return errors;
}
