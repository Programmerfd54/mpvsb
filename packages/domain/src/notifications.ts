/**
 * Входящие уведомления кабинета (ТЗ 01.7, M14).
 *
 * Уведомление — это факт события и ссылка на ресурс, а не его содержание:
 * текст заключения, ответы участника, имена и свободный текст запроса сюда
 * не попадают. Право открыть ресурс проверяется заново в момент открытия,
 * поэтому уведомление не является кэшем доступа.
 */

export const NOTIFICATION_TYPES = [
  'report_published',
  'assignment_expiring',
  'revision_requested',
  'export_ready',
  'deletion_completed',
  'access_grant_requested',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Readonly<Record<NotificationType, string>> = {
  report_published: 'Заключение опубликовано',
  assignment_expiring: 'Срок оценки истекает',
  revision_requested: 'Запрос на исправление',
  export_ready: 'Экспорт готов',
  deletion_completed: 'Удаление завершено',
  access_grant_requested: 'Обращение за временным доступом',
};

/**
 * Заголовок пишет сервер по типу события: произвольный текст в уведомление
 * не попадает, поэтому заголовок нельзя использовать как канал утечки.
 */
export const NOTIFICATION_TITLES: Readonly<Record<NotificationType, string>> = {
  report_published: 'Заключение готово',
  assignment_expiring: 'Срок оценки скоро истекает',
  revision_requested: 'Поступил запрос на исправление заключения',
  export_ready: 'Экспорт данных готов',
  deletion_completed: 'Удаление данных завершено',
  access_grant_requested: 'Поступило обращение за временным доступом',
};

/**
 * Ресурсы, на которые уведомление может ссылаться.
 *
 * Список закрыт check-constraint миграции 0019: значение вне его означает
 * расхождение схемы и кода, а не пользовательский ввод. Идентификатор ресурса
 * без распознанного типа наружу не уходит — вести по нему всё равно некуда.
 */
export const NOTIFICATION_RESOURCE_TYPES = ['report', 'assignment', 'access_grant'] as const;

export type NotificationResourceType = (typeof NOTIFICATION_RESOURCE_TYPES)[number];

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

export function isNotificationResourceType(value: string): value is NotificationResourceType {
  return (NOTIFICATION_RESOURCE_TYPES as readonly string[]).includes(value);
}

/**
 * За сколько до срока предупреждать руководителя о незавершённой оценке.
 * Значение согласовано с часовым расписанием фонового задания: окно шире шага
 * расписания, поэтому предупреждение не теряется между запусками.
 */
export const ASSIGNMENT_EXPIRY_NOTICE_HOURS = 48;

/**
 * Ключ дедупликации «событие + адресат»: уникальность обеспечивает индекс
 * `notifications (recipient_user_id, event_key)`, повторная обработка того же
 * события второго уведомления не создаёт.
 */
export function notificationEventKey(type: NotificationType, eventId: string): string {
  return `${type}:${eventId}`;
}

/**
 * Ключ предупреждения о сроке оценки.
 *
 * Событие — «истекает вот этот срок», а не «существует вот это назначение»:
 * после продления срока приближается новый срок, и о нём руководителя нужно
 * предупредить снова. Ключ по одному идентификатору назначения дал бы ровно
 * одно предупреждение за всю его жизнь — продливший срок не получил бы
 * ничего. Срок берётся с точностью до миллисекунды: продление всегда двигает
 * `due_at`, поэтому новая отметка даёт новый ключ.
 *
 * Назначение без срока в выборку задания не попадает; `null` обрабатывается
 * только чтобы ключ оставался определённым при любом входе.
 */
export function assignmentExpiryEventKey(assignmentId: string, dueAt: Date | null): string {
  const due = dueAt === null ? 'none' : dueAt.toISOString();
  return notificationEventKey('assignment_expiring', `${assignmentId}:${due}`);
}
