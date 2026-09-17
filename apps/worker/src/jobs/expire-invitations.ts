import {
  withPlatformOps,
  withTenant,
  type PrismaClient,
  type TenantTransaction,
} from '@context/database';
import {
  ASSIGNMENT_EXPIRY_NOTICE_HOURS,
  NOTIFICATION_TITLES,
  assignmentExpiryEventKey,
} from '@context/domain';

import { workerLogger } from '../logger.js';

/** Сколько назначений обрабатывается за один проход по организации. */
const BATCH_LIMIT = 500;

/**
 * Организации, по которым идёт обход.
 *
 * Назначения — строгая tenant-таблица: политика RLS требует организацию в
 * контексте транзакции, и эксплуатационный режим её не заменяет. Поэтому
 * список организаций читается отдельно, а работа идёт по одной организации.
 */
async function organizationIds(prisma: PrismaClient): Promise<string[]> {
  return withPlatformOps(prisma, async (tx) => {
    const rows = await tx.organizations.findMany({ select: { id: true } });
    return rows.map((row) => row.id);
  });
}

/** Обход всех организаций: ошибка в одной не останавливает остальные. */
async function forEachOrganization(
  prisma: PrismaClient,
  work: (tx: TenantTransaction, organizationId: string) => Promise<number>,
): Promise<number> {
  let total = 0;

  for (const organizationId of await organizationIds(prisma)) {
    try {
      total += await withTenant(prisma, { organizationId }, (tx) => work(tx, organizationId));
    } catch (error: unknown) {
      workerLogger().error(
        { err: error, organizationId },
        'Обработка сроков назначений организации не выполнена',
      );
    }
  }

  return total;
}

/**
 * Перевод просроченных назначений в состояние «срок истёк».
 *
 * Сохранённые ответы при этом не удаляются: срок закончился у ссылки, а не у
 * данных. Политика хранения обрабатывается отдельными заданиями.
 */
export async function runExpireInvitations(prisma: PrismaClient): Promise<number> {
  const now = new Date();

  const expired = await forEachOrganization(prisma, async (tx, organizationId) => {
    const candidates = await tx.assignments.findMany({
      where: {
        organization_id: organizationId,
        state: { in: ['invited', 'in_progress'] },
        due_at: { lte: now },
      },
      select: { id: true },
      // Порядок строк в PostgreSQL не определён: без сортировки при числе
      // кандидатов больше лимита набор от прогона к прогону произволен, и
      // часть назначений могла бы систематически не попадать в выборку.
      orderBy: [{ due_at: 'asc' }, { id: 'asc' }],
      take: BATCH_LIMIT,
    });

    for (const assignment of candidates) {
      await tx.assignments.update({
        where: { id: assignment.id },
        data: { state: 'expired', revision: { increment: 1 } },
      });
      await tx.participant_sessions.updateMany({
        where: { assignment_id: assignment.id, revoked_at: null },
        data: { revoked_at: now },
      });
    }

    return candidates.length;
  });

  if (expired > 0) {
    workerLogger().info({ expired }, 'Назначения переведены в состояние «срок истёк»');
  }

  return expired;
}

/**
 * Предупреждение о скором истечении срока оценки (ТЗ 01.7).
 *
 * Адресат — руководитель, создавший назначение: он решает, продлить ссылку
 * или напомнить сотруднику. Уведомление содержит только факт и ссылку на
 * назначение; ни ответов, ни имени сотрудника в нём нет. Повторный запуск
 * задания второго уведомления не создаёт: ключ события уникален для пары
 * «событие + адресат». Событие включает сам срок, поэтому после продления
 * назначения новый приближающийся срок даёт новое предупреждение.
 */
export async function runAssignmentExpiryNotices(
  prisma: PrismaClient,
  options: { noticeHours?: number } = {},
): Promise<number> {
  const noticeHours = options.noticeHours ?? ASSIGNMENT_EXPIRY_NOTICE_HOURS;
  const now = new Date();
  const until = new Date(now.getTime() + noticeHours * 60 * 60 * 1000);

  const created = await forEachOrganization(prisma, async (tx, organizationId) => {
    const soon = await tx.assignments.findMany({
      where: {
        organization_id: organizationId,
        state: { in: ['invited', 'in_progress'] },
        due_at: { gt: now, lte: until },
      },
      select: { id: true, created_by: true, due_at: true },
      // Детерминированный порядок: см. runExpireInvitations.
      orderBy: [{ due_at: 'asc' }, { id: 'asc' }],
      take: BATCH_LIMIT,
    });

    if (soon.length === 0) {
      return 0;
    }

    /*
     * Адресат должен быть действующим участником организации: пользователю с
     * отозванным membership любой маршрут уведомлений ответит 404, и строка
     * стала бы мёртвой записью. Та же проверка есть у продюсеров в API.
     */
    const authorIds = [...new Set(soon.map((assignment) => assignment.created_by))];

    const members = await tx.memberships.findMany({
      // Проверяются только авторы найденных назначений, а не весь состав
      // организации: фоновому заданию незачем каждый час вычитывать поимённый
      // перечень участников — ровно от этого отгораживались колоночные права
      // миграции 0018.
      where: {
        organization_id: organizationId,
        status: 'active',
        user_id: { in: authorIds },
      },
      select: { user_id: true },
    });
    const active = new Set(members.map((member) => member.user_id));

    const recipients = soon.filter((assignment) => active.has(assignment.created_by));

    if (recipients.length < soon.length) {
      // Без персональных данных: только количество пропущенных назначений.
      workerLogger().info(
        { organizationId, skipped: soon.length - recipients.length },
        'Предупреждения о сроке пропущены: автор назначения не состоит в организации',
      );
    }

    if (recipients.length === 0) {
      return 0;
    }

    // `createMany` не возвращает строк: у роли worker нет права чтения
    // уведомлений, и дедупликация выполняется уникальным индексом в базе.
    const result = await tx.notifications.createMany({
      data: recipients.map((assignment) => ({
        organization_id: organizationId,
        recipient_user_id: assignment.created_by,
        type: 'assignment_expiring',
        resource_type: 'assignment',
        resource_id: assignment.id,
        title: NOTIFICATION_TITLES.assignment_expiring,
        event_key: assignmentExpiryEventKey(assignment.id, assignment.due_at),
      })),
      skipDuplicates: true,
    });

    return result.count;
  });

  if (created > 0) {
    workerLogger().info({ created, noticeHours }, 'Созданы предупреждения об истечении срока');
  }

  return created;
}
