import { NOTIFICATION_RESOURCE_TYPES, NOTIFICATION_TYPES } from '@context/domain';
import { z } from 'zod';

import { isoDateTimeSchema, paginationQuerySchema, uuidSchema } from './common';

/**
 * Входящие уведомления руководителя (ТЗ 01.7, M14, 08.6).
 *
 * В ответе нет ни текста заключения, ни описания запроса на исправление:
 * уведомление сообщает о событии и ссылается на ресурс, а решение о доступе
 * принимается сервером заново при открытии.
 */
export const notificationSchema = z.object({
  id: uuidSchema,
  type: z.enum(NOTIFICATION_TYPES),
  /** Подпись типа для интерфейса: клиент не собирает текст сам. */
  typeLabel: z.string(),
  title: z.string(),
  resourceType: z.enum(NOTIFICATION_RESOURCE_TYPES).nullable(),
  resourceId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  readAt: isoDateTimeSchema.nullable(),
});

export type NotificationView = z.infer<typeof notificationSchema>;

export const NOTIFICATION_FILTERS = ['unread', 'all'] as const;

export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

export const NOTIFICATION_FILTER_LABELS: Readonly<Record<NotificationFilter, string>> = {
  unread: 'Непрочитанные',
  all: 'Все',
};

export const notificationsQuerySchema = paginationQuerySchema.extend({
  filter: z.enum(NOTIFICATION_FILTERS).default('unread'),
});

export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;

/** Счётчик для колокольчика в шапке. Считается на сервере по своим уведомлениям. */
export const notificationCounterSchema = z.object({
  unread: z.number().int().nonnegative(),
});

export type NotificationCounter = z.infer<typeof notificationCounterSchema>;

/** Результат отметки прочитанным: уведомление и пересчитанный счётчик. */
export const notificationReadResultSchema = z.object({
  notification: notificationSchema,
  unread: z.number().int().nonnegative(),
});

export type NotificationReadResult = z.infer<typeof notificationReadResultSchema>;

export const notificationReadAllResultSchema = z.object({
  updated: z.number().int().nonnegative(),
  unread: z.number().int().nonnegative(),
});

export type NotificationReadAllResult = z.infer<typeof notificationReadAllResultSchema>;

/**
 * Итог открытия ресурса. Состояния всего два: причина недоступности не
 * раскрывается, чтобы удалённый ресурс и отозванный доступ отвечали одинаково.
 */
export const NOTIFICATION_TARGET_STATUSES = ['available', 'unavailable'] as const;

export type NotificationTargetStatus = (typeof NOTIFICATION_TARGET_STATUSES)[number];

export const notificationTargetSchema = z.object({
  notificationId: uuidSchema,
  type: z.enum(NOTIFICATION_TYPES),
  resourceType: z.enum(NOTIFICATION_RESOURCE_TYPES).nullable(),
  resourceId: uuidSchema.nullable(),
  status: z.enum(NOTIFICATION_TARGET_STATUSES),
  /** Путь в кабинете. Заполняется только при подтверждённом доступе. */
  path: z.string().nullable(),
  /** Пояснение на русском: что произошло и что можно сделать дальше. */
  message: z.string(),
  /**
   * Пересчитанный счётчик непрочитанных. Открытие меняет его, поэтому значение
   * возвращается здесь же: иначе шапке пришлось бы отдельно запрашивать
   * счётчик и гонка двух ответов показывала бы неверное число.
   */
  unread: z.number().int().nonnegative(),
});

export type NotificationTarget = z.infer<typeof notificationTargetSchema>;
