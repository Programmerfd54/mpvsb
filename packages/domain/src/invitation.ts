/** Политика срока действия персональной ссылки (ТЗ M05, шаг 3). */
export const INVITATION_MIN_DAYS = 1;
export const INVITATION_MAX_DAYS = 30;
export const INVITATION_DEFAULT_DAYS = 14;

export function isValidInvitationDays(days: number): boolean {
  return Number.isInteger(days) && days >= INVITATION_MIN_DAYS && days <= INVITATION_MAX_DAYS;
}

export function invitationExpiryFrom(now: Date, days: number): Date {
  if (!isValidInvitationDays(days)) {
    throw new RangeError(
      `Срок ссылки должен быть целым числом от ${INVITATION_MIN_DAYS} до ${INVITATION_MAX_DAYS} дней.`,
    );
  }
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Максимум сотрудников в одном пакетном действии (ТЗ 08.2, 08.4). */
export const BATCH_MAX_EMPLOYEES = 50;

/** Ограничение активных сотрудников организации по умолчанию (ТЗ 00.2). */
export const DEFAULT_ACTIVE_EMPLOYEE_LIMIT = 500;

/** Сроки сессий (ТЗ 10.2). Значения в минутах. */
export const SESSION_POLICY = {
  manager: { idleMinutes: 8 * 60, absoluteMinutes: 7 * 24 * 60 },
  platform_admin: { idleMinutes: 30, absoluteMinutes: 12 * 60 },
  employee: { idleMinutes: 8 * 60, absoluteMinutes: 7 * 24 * 60 },
  participant: { idleMinutes: 2 * 60, absoluteMinutes: 24 * 60 },
} as const;

export type SessionPolicyKey = keyof typeof SESSION_POLICY;
