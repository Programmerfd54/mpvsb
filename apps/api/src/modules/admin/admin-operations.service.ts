import { Injectable } from '@nestjs/common';

import type {
  AdminAuditDetails,
  AdminAuditEvent,
  AdminAuditFilter,
  AdminJob,
  AdminJobDetails,
  AdminJobFilter,
  AdminOperationsFacets,
  AdminOverview,
  JobState,
} from '@context/contracts';
import { resolveJobTarget } from '@context/database';
import { caseCodeFor } from '@context/domain';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';

/**
 * Техническое состояние платформы.
 *
 * Показываются эксплуатационные количества и коды ошибок. Полезная нагрузка
 * заданий, ответы участников и тексты заключений на эти экраны не попадают
 * (ТЗ A09, A11).
 */

/** Сколько раз имеет смысл повторять одно задание. Дальше чинят причину. */
const MAX_ATTEMPTS = 5;

/**
 * Ошибки, повтор которых имеет смысл: причина внешняя и может пройти сама.
 * Расхождение содержимого или схемы повтором не лечится.
 */
const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'provider_error',
  'provider_timeout',
  'database_error',
  'unexpected_error',
]);

/** Событие → очередь. Повторять имеет смысл только то, что куда-то доставляется. */
const QUEUE_BY_EVENT: Readonly<Record<string, string | null>> = {
  'attempt.submitted': 'score-attempt',
  'report.generation_requested': 'generate-report',
  'assignment.completed': null,
  'assignment.cancelled': null,
  'report.published': null,
  'privacy.deletion_requested': null,
};

/**
 * Ключи метаданных аудита, значения которых не показываются даже администратору.
 * Санитайзер записи уже их прячет; это вторая линия для старых записей.
 */
const REDACTED_METADATA_KEYS: ReadonlySet<string> = new Set([
  'password',
  'token',
  'tokenHash',
  'secret',
  'sessionHash',
  'answers',
  'response',
  'content',
  'body',
  'email',
  'displayName',
  'reason',
  'note',
  'comment',
]);

/** Поля строки очереди, которые вообще покидают сервер. Payload — только имена полей. */
const OUTBOX_SELECT = {
  id: true,
  event_type: true,
  entity_type: true,
  entity_id: true,
  organization_id: true,
  attempts: true,
  created_at: true,
  published_at: true,
  completed_at: true,
  failed_at: true,
  last_error_code: true,
  retries_stopped_at: true,
  retried_at: true,
  data_generation: true,
  payload: true,
  organizations: { select: { code: true } },
} as const;

interface OutboxRow {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  organization_id: string | null;
  attempts: number;
  created_at: Date;
  published_at: Date | null;
  completed_at: Date | null;
  failed_at: Date | null;
  last_error_code: string | null;
  retries_stopped_at: Date | null;
  retried_at: Date | null;
  data_generation: bigint;
  payload: unknown;
  organizations: { code: string } | null;
}

@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async overview(): Promise<AdminOverview> {
    return this.prisma.platformOps(async (tx) => {
      const now = new Date();

      const [active, suspended, failedJobs] = await Promise.all([
        tx.organizations.count({ where: { status: 'active' } }),
        tx.organizations.count({ where: { status: 'suspended' } }),
        // Реальный счётчик: строка отмечается упавшей самим обработчиком.
        tx.outbox_events.count({ where: { failed_at: { not: null } } }),
      ]);

      // Счётчики по всем организациям: эксплуатационная сводка, без содержания.
      const [assignmentsInProcessing, reportsPendingReview] = await Promise.all([
        tx.$queryRaw<Array<{ count: bigint }>>`
          select count(*)::bigint as count from core.assignments where state = 'completed'
        `,
        tx.$queryRaw<Array<{ count: bigint }>>`
          select count(*)::bigint as count from core.reports where status = 'pending_review'
        `,
      ]);

      const failedReports = await tx.$queryRaw<Array<{ updated_at: Date; code: string | null }>>`
        select r.updated_at, o.code
        from core.reports r
        join core.organizations o on o.id = r.organization_id
        where r.status = 'generation_failed'
        order by r.updated_at desc
        limit 5
      `;

      const suspendedMethods = await tx.method_versions.findMany({
        where: { status: 'suspended_for_new_assignments' },
        select: { updated_at: true, method: { select: { stable_code: true } } },
        take: 5,
      });

      const expiringGrants = await tx.$queryRaw<Array<{ expires_at: Date; code: string }>>`
        select g.expires_at, o.code
        from core.access_grants g
        join core.organizations o on o.id = g.organization_id
        where g.state = 'approved' and g.revoked_at is null and g.expires_at > now()
        order by g.expires_at asc
        limit 5
      `;

      const pendingRecovery = await tx.recovery_requests.findMany({
        where: { state: 'received' },
        select: { created_at: true },
        take: 5,
      });

      const attention: AdminOverview['attention'] = [
        ...failedReports.map((row) => ({
          kind: 'generation_failed' as const,
          title: 'Подготовка заключения завершилась ошибкой',
          organizationCode: row.code,
          occurredAt: row.updated_at.toISOString(),
        })),
        ...suspendedMethods.map((row) => ({
          kind: 'suspended_method' as const,
          title: `Методика «${row.method.stable_code}» приостановлена для новых назначений`,
          organizationCode: null,
          occurredAt: row.updated_at.toISOString(),
        })),
        ...expiringGrants.map((row) => ({
          kind: 'expiring_grant' as const,
          title: 'Истекает временный доступ к данным организации',
          organizationCode: row.code,
          occurredAt: row.expires_at.toISOString(),
        })),
        ...pendingRecovery.map((row) => ({
          kind: 'pending_recovery' as const,
          title: 'Заявка на восстановление доступа ожидает проверки личности',
          organizationCode: null,
          occurredAt: row.created_at.toISOString(),
        })),
      ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

      return {
        organizations: { active, suspended },
        assignmentsInProcessing: Number(assignmentsInProcessing[0]?.count ?? 0n),
        reportsPendingReview: Number(reportsPendingReview[0]?.count ?? 0n),
        failedJobs,
        attention: attention.slice(0, 10),
        generatedAt: now.toISOString(),
      };
    });
  }

  /** Список заданий. Строка не содержит полезной нагрузки и имени сотрудника. */
  async jobs(filter: AdminJobFilter): Promise<AdminJob[]> {
    return this.prisma.platformOps(async (tx) => {
      const rows = await tx.outbox_events.findMany({
        where: {
          ...(filter.eventType ? { event_type: filter.eventType } : {}),
          ...(filter.organizationCode ? { organizations: { code: filter.organizationCode } } : {}),
          ...(filter.periodHours
            ? { created_at: { gt: new Date(Date.now() - filter.periodHours * 3_600_000) } }
            : {}),
          ...jobStateWhere(filter.state),
        },
        orderBy: { created_at: 'desc' },
        take: filter.limit,
        select: OUTBOX_SELECT,
      });

      return rows.map(toJob);
    });
  }

  /**
   * Технические детали задания.
   *
   * Обращение к деталям само записывается в аудит: чтение технической карточки
   * — это доступ, а не бесплатное действие (ТЗ A11).
   */
  async jobDetails(jobId: string, actorId: string): Promise<AdminJobDetails> {
    const row = await this.prisma.platformOps(async (tx) => {
      return tx.outbox_events.findUnique({ where: { id: jobId }, select: OUTBOX_SELECT });
    });

    if (!row) {
      throw AppError.notFound(`Задание ${jobId} не найдено`);
    }

    const guard = await this.retryBlockers(row);

    await this.audit.record({
      action: 'job.details_read',
      outcome: 'success',
      organizationId: row.organization_id,
      resourceType: 'outbox_event',
      resourceId: row.id,
      purpose: 'operations',
      metadata: { eventType: row.event_type, actorId },
    });

    return {
      job: toJob(row),
      entityId: row.entity_id,
      dataGeneration: row.data_generation.toString(),
      // Только имена полей: значения полезной нагрузки на технический экран не идут.
      payloadKeys: payloadKeys(row.payload),
      queueName: QUEUE_BY_EVENT[row.event_type] ?? null,
      retriedAt: row.retried_at?.toISOString() ?? null,
      retriesStoppedAt: row.retries_stopped_at?.toISOString() ?? null,
      retryBlockers: guard,
    };
  }

  /**
   * Повтор задания.
   *
   * Повтор не обходит ни ограду поколения данных, ни отмену назначения, ни отзыв
   * согласия: строка возвращается в очередь только если задание действительно
   * можно выполнить сейчас (ТЗ A09, 10.8).
   */
  async retryJob(jobId: string, actorId: string): Promise<AdminJobDetails> {
    const row = await this.prisma.platformOps(async (tx) => {
      return tx.outbox_events.findUnique({ where: { id: jobId }, select: OUTBOX_SELECT });
    });

    if (!row) {
      throw AppError.notFound(`Задание ${jobId} не найдено`);
    }

    const blockers = await this.retryBlockers(row);
    if (blockers.length > 0) {
      await this.audit.record({
        action: 'job.retry',
        outcome: 'denied',
        organizationId: row.organization_id,
        resourceType: 'outbox_event',
        resourceId: row.id,
        purpose: 'operations',
        metadata: { eventType: row.event_type, blocker: blockers[0] ?? null, actorId },
      });

      throw AppError.conflict(blockers[0] ?? 'Повтор этого задания сейчас невозможен');
    }

    await this.prisma.platformOps(async (tx) => {
      // Возврат в очередь: отметка доставки снимается, исход обнуляется.
      // Счётчик попыток не сбрасывается — лимит повторов должен работать.
      await tx.outbox_events.update({
        where: { id: row.id },
        data: {
          published_at: null,
          completed_at: null,
          failed_at: null,
          last_error_code: null,
          retried_at: new Date(),
          retried_by: actorId,
        },
      });

      await this.audit.recordIn(tx, {
        action: 'job.retry',
        outcome: 'success',
        organizationId: row.organization_id,
        resourceType: 'outbox_event',
        resourceId: row.id,
        purpose: 'operations',
        metadata: {
          eventType: row.event_type,
          attempts: row.attempts,
          previousErrorCode: row.last_error_code,
          actorId,
        },
      });
    });

    return this.jobDetails(jobId, actorId);
  }

  /** Остановка будущих повторов: диспетчер такую строку больше не берёт. */
  async setRetriesStopped(
    jobId: string,
    stopped: boolean,
    actorId: string,
  ): Promise<AdminJobDetails> {
    await this.prisma.platformOps(async (tx) => {
      const existing = await tx.outbox_events.findUnique({
        where: { id: jobId },
        select: { id: true, organization_id: true, event_type: true, retries_stopped_at: true },
      });

      if (!existing) {
        throw AppError.notFound(`Задание ${jobId} не найдено`);
      }

      await tx.outbox_events.update({
        where: { id: jobId },
        data: {
          retries_stopped_at: stopped ? new Date() : null,
          retries_stopped_by: stopped ? actorId : null,
        },
      });

      await this.audit.recordIn(tx, {
        action: stopped ? 'job.retries_stopped' : 'job.retries_resumed',
        outcome: 'success',
        organizationId: existing.organization_id,
        resourceType: 'outbox_event',
        resourceId: jobId,
        purpose: 'operations',
        metadata: { eventType: existing.event_type, actorId },
      });
    });

    return this.jobDetails(jobId, actorId);
  }

  /**
   * Почему повтор сейчас невозможен. Пустой список — повтор допустим.
   *
   * Состояние назначения и согласие читаются узким резолвером: строгая
   * tenant-политика не открывается администратору ради этой проверки.
   */
  private async retryBlockers(row: OutboxRow): Promise<string[]> {
    const blockers: string[] = [];

    if (row.retries_stopped_at !== null) {
      blockers.push('Повторы этого задания остановлены. Сначала снимите остановку.');
    }
    if (QUEUE_BY_EVENT[row.event_type] == null) {
      blockers.push('Это событие не отправляется в очередь: повторять нечего.');
    }
    if (row.failed_at === null) {
      blockers.push('Задание не завершалось ошибкой: повторять нечего.');
    } else if (!RETRYABLE_ERROR_CODES.has(row.last_error_code ?? '')) {
      blockers.push(
        `Ошибка «${row.last_error_code ?? 'без кода'}» повтором не устраняется: нужно исправить содержимое или схему.`,
      );
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      blockers.push(`Исчерпан лимит повторов (${MAX_ATTEMPTS}). Нужно разобраться с причиной.`);
    }

    if (!row.organization_id) {
      return blockers;
    }

    const target = await resolveJobTarget(
      this.prisma.preContext,
      row.organization_id,
      row.entity_type,
      row.entity_id,
    );

    if (!target) {
      blockers.push('Назначение не найдено: вероятно, данные удалены.');
      return blockers;
    }

    // Ограда поколения данных: после отзыва или удаления старое задание
    // не воскрешает данные.
    if (target.data_generation !== row.data_generation) {
      blockers.push('Поколение данных изменилось после постановки задачи: повтор запрещён.');
    }
    if (target.assignment_state === 'cancelled') {
      blockers.push('Назначение отменено.');
    }
    if (target.assignment_state === 'expired') {
      blockers.push('Срок назначения истёк.');
    }
    if (target.processing_hold) {
      blockers.push('Обработка приостановлена по запросу о данных.');
    }
    if (target.declined) {
      blockers.push('Участник отказался от участия.');
    }
    if (!target.consent_active) {
      blockers.push('Согласие участника не действует: обработка невозможна.');
    }

    return blockers;
  }

  async auditEvents(filter: AdminAuditFilter): Promise<AdminAuditEvent[]> {
    return this.prisma.platformOps(async (tx) => {
      const rows = await tx.audit_events.findMany({
        where: {
          ...(filter.action ? { action: filter.action } : {}),
          ...(filter.actorType ? { actor_type: filter.actorType } : {}),
          ...(filter.actorId ? { actor_id: filter.actorId } : {}),
          ...(filter.resourceType ? { resource_type: filter.resourceType } : {}),
          ...(filter.organizationCode ? { organizations: { code: filter.organizationCode } } : {}),
          ...(filter.periodHours
            ? { occurred_at: { gt: new Date(Date.now() - filter.periodHours * 3_600_000) } }
            : {}),
        },
        orderBy: { occurred_at: 'desc' },
        take: filter.limit,
        select: {
          id: true,
          occurred_at: true,
          actor_type: true,
          actor_id: true,
          action: true,
          resource_type: true,
          outcome: true,
          request_id: true,
          organizations: { select: { code: true } },
        },
      });

      return rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurred_at.toISOString(),
        actorType: row.actor_type,
        actorId: row.actor_id,
        action: row.action,
        resourceType: row.resource_type,
        outcome: row.outcome as AdminAuditEvent['outcome'],
        organizationCode: row.organizations?.code ?? null,
        requestId: row.request_id,
      }));
    });
  }

  /**
   * Развёрнутая запись аудита с allowlist метаданных.
   *
   * Фильтр по организации не превращает администратора в читателя персональных
   * сведений: значения скрытых полей не возвращаются, показывается только имя
   * поля (ТЗ A11).
   */
  async auditDetails(eventId: string, actorId: string): Promise<AdminAuditDetails> {
    const row = await this.prisma.platformOps(async (tx) =>
      tx.audit_events.findUnique({
        where: { id: eventId },
        select: {
          id: true,
          occurred_at: true,
          actor_type: true,
          actor_id: true,
          action: true,
          resource_type: true,
          resource_id: true,
          outcome: true,
          request_id: true,
          purpose: true,
          metadata: true,
          organization_id: true,
          organizations: { select: { code: true } },
        },
      }),
    );

    if (!row) {
      throw AppError.notFound(`Событие аудита ${eventId} не найдено`);
    }

    const { metadata, redactedKeys } = redactMetadata(row.metadata);

    await this.audit.record({
      action: 'audit.details_read',
      outcome: 'success',
      organizationId: row.organization_id,
      resourceType: 'audit_event',
      resourceId: row.id,
      purpose: 'operations',
      metadata: { readAction: row.action, actorId },
    });

    return {
      event: {
        id: row.id,
        occurredAt: row.occurred_at.toISOString(),
        actorType: row.actor_type,
        actorId: row.actor_id,
        action: row.action,
        resourceType: row.resource_type,
        outcome: row.outcome as AdminAuditEvent['outcome'],
        organizationCode: row.organizations?.code ?? null,
        requestId: row.request_id,
      },
      resourceId: row.resource_id,
      purpose: row.purpose,
      metadata,
      redactedKeys,
    };
  }

  /** Значения для фильтров: только то, что действительно встречается в журналах. */
  async facets(): Promise<AdminOperationsFacets> {
    return this.prisma.platformOps(async (tx) => {
      const [eventTypes, actions, resourceTypes, organizations] = await Promise.all([
        tx.$queryRaw<Array<{ value: string }>>`
          select distinct event_type as value from platform.outbox_events order by value
        `,
        tx.$queryRaw<Array<{ value: string }>>`
          select distinct action as value from platform.audit_events order by value
        `,
        tx.$queryRaw<Array<{ value: string }>>`
          select distinct resource_type as value from platform.audit_events
          where resource_type is not null order by value
        `,
        tx.organizations.findMany({ select: { code: true }, orderBy: { code: 'asc' } }),
      ]);

      return {
        eventTypes: eventTypes.map((row) => row.value),
        actions: actions.map((row) => row.value),
        resourceTypes: resourceTypes.map((row) => row.value),
        organizationCodes: organizations.map((row) => row.code),
      };
    });
  }
}

/** Состояние строки очереди выводится из отметок, отдельного поля состояния нет. */
function jobStateOf(row: OutboxRow): JobState {
  if (row.retries_stopped_at !== null) {
    return 'stopped';
  }
  if (row.failed_at !== null) {
    return 'failed';
  }
  if (row.completed_at !== null) {
    return 'done';
  }
  return row.published_at === null ? 'queued' : 'running';
}

/** Фильтр по состоянию повторяет вывод jobStateOf, только в обратную сторону. */
function jobStateWhere(state: JobState | undefined): Record<string, unknown> {
  const live = { retries_stopped_at: null };
  switch (state) {
    case 'stopped':
      return { retries_stopped_at: { not: null } };
    case 'failed':
      return { ...live, failed_at: { not: null } };
    case 'done':
      return { ...live, failed_at: null, completed_at: { not: null } };
    case 'queued':
      return { ...live, failed_at: null, completed_at: null, published_at: null };
    case 'running':
      return { ...live, failed_at: null, completed_at: null, published_at: { not: null } };
    default:
      return {};
  }
}

function toJob(row: OutboxRow): AdminJob {
  const finished = row.completed_at ?? row.failed_at;

  return {
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    organizationCode: row.organizations?.code ?? null,
    // Код случая вместо сведений о человеке: для задания по назначению он
    // выводится из идентификатора, для остальных не показывается.
    assignmentCode: row.entity_type === 'assignment' ? caseCodeFor(row.entity_id) : null,
    state: jobStateOf(row),
    attempts: row.attempts,
    createdAt: row.created_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    failedAt: row.failed_at?.toISOString() ?? null,
    lastErrorCode: row.last_error_code,
    latencyMs: finished ? finished.getTime() - row.created_at.getTime() : null,
    retryable: row.failed_at !== null && RETRYABLE_ERROR_CODES.has(row.last_error_code ?? ''),
  };
}

/** Имена полей полезной нагрузки без значений: значения на экран не идут. */
function payloadKeys(payload: unknown): string[] {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }
  return Object.keys(payload as Record<string, unknown>).sort();
}

function redactMetadata(raw: unknown): {
  metadata: Array<{ key: string; value: string }>;
  redactedKeys: string[];
} {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { metadata: [], redactedKeys: [] };
  }

  const metadata: Array<{ key: string; value: string }> = [];
  const redactedKeys: string[] = [];

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (REDACTED_METADATA_KEYS.has(key)) {
      redactedKeys.push(key);
      continue;
    }
    if (value === null) {
      metadata.push({ key, value: '—' });
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const text = String(value);
      metadata.push({ key, value: text.length > 200 ? `${text.slice(0, 200)}…` : text });
      continue;
    }
    redactedKeys.push(key);
  }

  return { metadata, redactedKeys: redactedKeys.sort() };
}
