import { Injectable } from '@nestjs/common';

import type {
  NotificationCounter,
  NotificationReadAllResult,
  NotificationReadResult,
  NotificationTarget,
  NotificationView,
  NotificationsQuery,
} from '@context/contracts';
import type { TenantTransaction } from '@context/database';
import {
  NOTIFICATION_TITLES,
  NOTIFICATION_TYPE_LABELS,
  hasPermission,
  isNotificationResourceType,
  isNotificationType,
  type NotificationResourceType,
  type NotificationType,
  type OrgPermission,
} from '@context/domain';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';

/**
 * Поля уведомления, которые вообще покидают сервер.
 *
 * Колонка `title` не читается: заголовок собирается по типу события
 * (см. `toView`). Сама колонка остаётся в схеме для совместимости.
 */
const notificationSelect = {
  id: true,
  type: true,
  resource_type: true,
  resource_id: true,
  read_at: true,
  created_at: true,
} as const;

type NotificationRow = {
  id: string;
  type: string;
  resource_type: string | null;
  resource_id: string | null;
  read_at: Date | null;
  created_at: Date;
};

/**
 * Сообщение об отказе одно на все причины, по которым ресурс не открывается:
 * удалённый ресурс и отозванный доступ должны быть неотличимы, иначе
 * уведомление начнёт подтверждать существование того, что смотреть уже нельзя.
 */
const UNAVAILABLE_MESSAGE =
  'Материал больше не открывается: он удалён или доступ к нему отозван. ' +
  'Уведомление не хранит содержание — если доступ нужен, обратитесь к владельцу организации.';

/**
 * Уведомление без ресурса — отдельный случай, а не отказ в доступе.
 *
 * Неразличимыми обязаны быть «удалено» и «доступ отозван»: обе причины
 * говорили бы о существовании материала. У события, для которого страницы не
 * предусмотрено (готовый экспорт, завершённое удаление), скрывать нечего, и
 * сообщать об удалении или отзыве доступа было бы прямой дезинформацией.
 */
const NO_TARGET_MESSAGE =
  'У этого уведомления нет отдельной страницы: оно сообщает о событии, ' +
  'а не открывает материал. Ничего не удалено и доступ не отозван.';

const AVAILABLE_MESSAGE = 'Доступ подтверждён: откройте страницу ресурса.';

/**
 * Входящие уведомления пользователя в выбранной организации (ТЗ 01.7, M14).
 *
 * Границы: RLS отсекает чужой tenant, явный фильтр по `recipient_user_id` —
 * чужие уведомления внутри своей организации. Право открыть ресурс
 * проверяется в момент открытия, а не в момент создания уведомления.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Список своих уведомлений: непрочитанные или все, страницами. */
  async list(
    organizationId: string,
    recipientUserId: string,
    query: NotificationsQuery,
  ): Promise<{ items: NotificationView[]; total: number }> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const where = {
        organization_id: organizationId,
        recipient_user_id: recipientUserId,
        ...(query.filter === 'unread' ? { read_at: null } : {}),
      };

      const [rows, total] = await Promise.all([
        tx.notifications.findMany({
          where,
          // Вторичная сортировка по id: уведомления одной транзакции имеют
          // одинаковое время создания, и без неё страницы перемешивались бы.
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: notificationSelect,
        }),
        tx.notifications.count({ where }),
      ]);

      return { items: rows.map((row) => toView(row)), total };
    });
  }

  /** Счётчик для колокольчика. Считается сервером, клиент его не подменяет. */
  async unreadCount(organizationId: string, recipientUserId: string): Promise<NotificationCounter> {
    return this.prisma.tenant({ organizationId }, async (tx) => ({
      unread: await this.unreadCountIn(tx, organizationId, recipientUserId),
    }));
  }

  /**
   * Отметка прочитанным. Идемпотентна: повторный вызов не меняет момент
   * прочтения и не уводит счётчик в минус.
   */
  async markRead(
    organizationId: string,
    recipientUserId: string,
    notificationId: string,
  ): Promise<NotificationReadResult> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const notification = await this.markReadIn(tx, organizationId, recipientUserId, {
        id: notificationId,
      });

      const unread = await this.unreadCountIn(tx, organizationId, recipientUserId);

      return { notification: toView(notification), unread };
    });
  }

  /** Отметить прочитанными все свои уведомления в этой организации. */
  async markAllRead(
    organizationId: string,
    recipientUserId: string,
  ): Promise<NotificationReadAllResult> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const result = await tx.notifications.updateMany({
        where: {
          organization_id: organizationId,
          recipient_user_id: recipientUserId,
          read_at: null,
        },
        data: { read_at: new Date() },
      });

      /*
       * Счётчик пересчитывается, а не выставляется в ноль: уведомление,
       * закоммиченное другой транзакцией уже после updateMany, видно в этой
       * транзакции с уровнем Read Committed, и «ноль» показал бы пустой
       * колокольчик при непустом ящике до следующего обновления страницы.
       */
      const unread = await this.unreadCountIn(tx, organizationId, recipientUserId);

      return { updated: result.count, unread };
    });
  }

  /**
   * Открытие ресурса по уведомлению.
   *
   * Доступ проверяется заново: уведомление, созданное при публикации, не
   * является разрешением на чтение сегодня. Если ресурса больше нет или право
   * отозвано, ответ один и тот же и не содержит ничего из ресурса.
   *
   * Порядок важен: сначала разрешается цель, и только подтверждённое открытие
   * отмечает уведомление прочитанным. Иначе неудачная попытка «съедала» бы
   * пометку — пользователь терял бы непрочитанное, ничего не получив, и
   * вернуться к уведомлению после восстановления доступа было бы нечем.
   * Уведомление без страницы так и остаётся непрочитанным: закрыть его можно
   * отметкой прочитанным (в том числе «отметить все»).
   */
  async open(
    organizationId: string,
    actor: { userId: string; permissions: readonly OrgPermission[] },
    notificationId: string,
  ): Promise<NotificationTarget> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const found = await this.findOwnIn(tx, organizationId, actor.userId, {
        id: notificationId,
      });

      const type = notificationTypeOf(found.type);
      const resourceType = notificationResourceTypeOf(found.resource_type);

      // Цель уведомления либо есть, либо её не предполагалось: это разные
      // случаи, и пояснения у них разные.
      const target =
        resourceType !== null && found.resource_id !== null
          ? { type, resourceType, resourceId: found.resource_id }
          : null;

      const path =
        target === null
          ? null
          : await this.resolveTargetPath(tx, organizationId, actor.permissions, target);

      const notification =
        path === null
          ? found
          : await this.markReadIn(tx, organizationId, actor.userId, { id: notificationId });

      /*
       * Отказом считается только неудачная проверка доступа: цель у
       * уведомления была, а открыть её не дали. Уведомление без ресурса
       * (готовый экспорт, завершённое удаление) ничего не открывает и ничего
       * не запрещает — записывать по нему `denied` значило бы копить в журнале
       * безопасности ложные отказы, среди которых настоящие перестанут быть
       * заметны.
       */
      const denied = target !== null && path === null;

      await this.audit.recordIn(tx, {
        action: 'notification.opened',
        outcome: denied ? 'denied' : 'success',
        organizationId,
        resourceType: notification.resource_type ?? 'notification',
        resourceId: notification.resource_id ?? notification.id,
        metadata: { notificationType: notification.type, hasTarget: target !== null },
      });

      const unread = await this.unreadCountIn(tx, organizationId, actor.userId);
      const unavailableMessage = target === null ? NO_TARGET_MESSAGE : UNAVAILABLE_MESSAGE;

      return {
        notificationId: notification.id,
        type,
        resourceType,
        resourceId: notification.resource_id,
        status: path === null ? 'unavailable' : 'available',
        path,
        message: path === null ? unavailableMessage : AVAILABLE_MESSAGE,
        unread,
      };
    });
  }

  /**
   * Путь к ресурсу или null, если открывать нечего.
   *
   * Проверяются оба условия: разрешение у пользователя сейчас и наличие
   * самого ресурса в этой организации. Ни текст, ни признаки содержания
   * наружу не выносятся.
   */
  private async resolveTargetPath(
    tx: TenantTransaction,
    organizationId: string,
    permissions: readonly OrgPermission[],
    target: {
      type: NotificationType;
      resourceType: NotificationResourceType;
      resourceId: string;
    },
  ): Promise<string | null> {
    if (target.resourceType === 'report') {
      // Запрос на исправление разбирает рецензент, готовое заключение читает
      // руководитель: разрешения и страницы разные.
      const forReview = target.type === 'revision_requested';
      const permission: OrgPermission = forReview ? 'reports.review' : 'reports.read';

      if (!hasPermission(permissions, permission)) {
        return null;
      }

      const report = await tx.reports.findFirst({
        where: {
          id: target.resourceId,
          organization_id: organizationId,
          ...(forReview ? {} : { status: 'published' }),
        },
        select: { id: true },
      });

      if (!report) {
        return null;
      }

      if (!forReview) {
        return `/app/reports/${report.id}`;
      }

      /*
       * Для запроса на исправление мало существования заключения: открывать
       * нужно сам запрос. Если его больше нет, вести рецензента некуда, и
       * ответ такой же, как при удалённом ресурсе.
       */
      /*
       * Фильтр повторяет фактическое содержимое таблицы: продюсер запроса
       * пишет `resource_type = 'report_revision'`, но кладёт в `resource_id`
       * идентификатор заключения, а не ревизии. Расхождение известно и
       * приводится к одному значению отдельной задачей с миграцией данных;
       * до тех пор «правильный» фильтр дал бы пустую выборку.
       */
      const correction = await tx.correction_requests.findFirst({
        where: {
          organization_id: organizationId,
          resource_type: 'report_revision',
          resource_id: report.id,
        },
        select: { id: true },
      });

      return correction ? `/app/reviews/${report.id}` : null;
    }

    if (target.resourceType === 'assignment') {
      if (!hasPermission(permissions, 'assessments.manage')) {
        return null;
      }

      const assignment = await tx.assignments.findFirst({
        where: { id: target.resourceId, organization_id: organizationId },
        select: { id: true },
      });

      return assignment ? `/app/assessments/${assignment.id}` : null;
    }

    if (target.resourceType === 'access_grant') {
      /*
       * Решение по обращению за временным доступом принимает владелец
       * организации, поэтому и уведомление ведёт туда, где обращение видно
       * целиком: цель, объём, срок и кнопки решения. Само уведомление ни цели,
       * ни причины не содержит — свободный текст обращения выдаётся только на
       * странице доступов, за правом `org.manage`.
       */
      if (!hasPermission(permissions, 'org.manage')) {
        return null;
      }

      const grant = await tx.access_grants.findFirst({
        where: { id: target.resourceId, organization_id: organizationId },
        select: { id: true },
      });

      return grant ? '/app/settings' : null;
    }

    return null;
  }

  /**
   * Своё уведомление или отказ. Чужое уведомление неотличимо от
   * несуществующего: ответ не подтверждает существование чужого ящика.
   */
  private async findOwnIn(
    tx: TenantTransaction,
    organizationId: string,
    recipientUserId: string,
    where: { id: string },
  ): Promise<NotificationRow> {
    const notification = await tx.notifications.findFirst({
      where: {
        id: where.id,
        organization_id: organizationId,
        recipient_user_id: recipientUserId,
      },
      select: notificationSelect,
    });

    if (!notification) {
      throw AppError.notFound(
        `Уведомление ${where.id} не принадлежит получателю или не существует`,
      );
    }

    return notification;
  }

  /**
   * Общая часть отметки прочитанным: повторная отметка момент прочтения не
   * переписывает (условие `read_at: null` в updateMany).
   */
  private async markReadIn(
    tx: TenantTransaction,
    organizationId: string,
    recipientUserId: string,
    where: { id: string },
  ): Promise<NotificationRow> {
    await tx.notifications.updateMany({
      where: {
        id: where.id,
        organization_id: organizationId,
        recipient_user_id: recipientUserId,
        read_at: null,
      },
      data: { read_at: new Date() },
    });

    return this.findOwnIn(tx, organizationId, recipientUserId, where);
  }

  /** Непрочитанные получателя внутри уже открытой транзакции. */
  private async unreadCountIn(
    tx: TenantTransaction,
    organizationId: string,
    recipientUserId: string,
  ): Promise<number> {
    return tx.notifications.count({
      where: {
        organization_id: organizationId,
        recipient_user_id: recipientUserId,
        read_at: null,
      },
    });
  }
}

/**
 * Тип события из базы. Список типов ограничен check-constraint, поэтому
 * несовпадение означает расхождение кода и схемы, а не пользовательский ввод:
 * молча подставлять «какой-нибудь» тип нельзя — уведомление будет подписано
 * неверно.
 */
function notificationTypeOf(value: string): NotificationType {
  if (!isNotificationType(value)) {
    throw new AppError('INTERNAL_ERROR', {
      internalDetail: `Неизвестный тип уведомления «${value}»: схема базы и @context/domain разошлись`,
    });
  }
  return value;
}

/**
 * Тип ресурса из базы. Список закрыт check-constraint миграции 0019, поэтому
 * нераспознанное значение — такое же расхождение схемы и кода, как неизвестный
 * тип события. Отдавать при этом `resourceId` без типа нельзя: клиент получил
 * бы идентификатор, вести по которому некуда, а открытие такого уведомления
 * сообщало бы «страницы нет», ничего о ресурсе не проверив.
 */
function notificationResourceTypeOf(value: string | null): NotificationResourceType | null {
  if (value === null) {
    return null;
  }

  if (!isNotificationResourceType(value)) {
    throw new AppError('INTERNAL_ERROR', {
      internalDetail: `Неизвестный тип ресурса уведомления «${value}»: схема базы и @context/domain разошлись`,
    });
  }

  return value;
}

/**
 * Проекция уведомления наружу.
 *
 * Заголовок берётся из словаря по типу события, а не из колонки `title`:
 * тогда гарантия «в уведомлении нет пользовательского текста» держится кодом
 * чтения, а не дисциплиной всех будущих продюсеров. На саму колонку в схеме
 * стоит только ограничение длины, и продюсер, записавший туда свободный
 * текст, через этот метод ничего наружу не отдаст.
 */
function toView(row: NotificationRow): NotificationView {
  const type = notificationTypeOf(row.type);

  return {
    id: row.id,
    type,
    typeLabel: NOTIFICATION_TYPE_LABELS[type],
    title: NOTIFICATION_TITLES[type],
    resourceType: notificationResourceTypeOf(row.resource_type),
    resourceId: row.resource_id,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null,
  };
}
