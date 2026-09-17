import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import {
  notificationsQuerySchema,
  type Envelope,
  type ListEnvelope,
  type NotificationCounter,
  type NotificationReadAllResult,
  type NotificationReadResult,
  type NotificationTarget,
  type NotificationView,
} from '@context/contracts';

import { Actor, OrgId } from '../../platform/auth/decorators';
import { ManagerGuard } from '../../platform/auth/guards/manager.guard';
import { currentRequestId, type RequestActor } from '../../platform/request/request-context';
import { uuidParam } from '../../platform/validation/uuid-param';
import { parseInput } from '../../platform/validation/zod.pipe';
import { NotificationsService } from './notifications.service';

function envelope<T>(data: T): Envelope<T> {
  return { data, meta: { requestId: currentRequestId() } };
}

/**
 * Входящие уведомления текущего пользователя в выбранной организации (ТЗ M14, 01.7).
 *
 * Отдельного разрешения у уведомлений нет: адресат читает только своё, и
 * членства в организации для этого достаточно. Право открыть ресурс — другое
 * дело, оно проверяется при открытии.
 */
@Controller('orgs/:orgId/notifications')
@UseGuards(ManagerGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
    @Query() query: unknown,
  ): Promise<ListEnvelope<NotificationView>> {
    const parsed = parseInput(notificationsQuerySchema, query ?? {});
    const result = await this.notifications.list(organizationId, actor.userId!, parsed);

    return {
      data: result.items,
      meta: {
        requestId: currentRequestId(),
        page: parsed.page,
        pageSize: parsed.pageSize,
        total: result.total,
      },
    };
  }

  /** Счётчик для колокольчика в шапке. */
  @Get('unread-count')
  async unreadCount(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
  ): Promise<Envelope<NotificationCounter>> {
    return envelope(await this.notifications.unreadCount(organizationId, actor.userId!));
  }

  @Post(':notificationId/read')
  async markRead(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
    @Param('notificationId') notificationId: string,
  ): Promise<Envelope<NotificationReadResult>> {
    return envelope(
      await this.notifications.markRead(
        organizationId,
        actor.userId!,
        uuidParam(notificationId, 'notificationId'),
      ),
    );
  }

  @Post('read-all')
  async markAllRead(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
  ): Promise<Envelope<NotificationReadAllResult>> {
    return envelope(await this.notifications.markAllRead(organizationId, actor.userId!));
  }

  /**
   * Открытие ресурса: сервер заново проверяет право и наличие ресурса и
   * возвращает путь либо отказ. Уведомление при этом считается прочитанным.
   */
  @Post(':notificationId/open')
  async open(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
    @Param('notificationId') notificationId: string,
  ): Promise<Envelope<NotificationTarget>> {
    return envelope(
      await this.notifications.open(
        organizationId,
        { userId: actor.userId!, permissions: actor.permissions ?? [] },
        uuidParam(notificationId, 'notificationId'),
      ),
    );
  }
}
