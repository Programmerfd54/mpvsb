/**
 * Разрешения внутри организации. Это permissions внутри доступа `manager`,
 * а не отдельные пользовательские кабинеты (ТЗ 01.1).
 */
export const ORG_PERMISSIONS = [
  'org.manage',
  'employees.manage',
  'assessments.manage',
  'reports.read',
  'reports.review',
  'study.manage',
  'study.custodian',
  'study.evaluate',
] as const;

export type OrgPermission = (typeof ORG_PERMISSIONS)[number];

export const ORG_PERMISSION_LABELS: Readonly<Record<OrgPermission, string>> = {
  'org.manage': 'Управление организацией и доступами',
  'employees.manage': 'Ведение списка сотрудников',
  'assessments.manage': 'Создание и отзыв оценок',
  'reports.read': 'Чтение опубликованных заключений',
  'reports.review': 'Проверка черновиков заключений',
  'study.manage': 'Ведение исследований и протоколов',
  'study.custodian': 'Внесение исходов после заморозки',
  'study.evaluate': 'Расчёт сравнения прогнозов и исходов',
};

/** Набор по умолчанию для приглашённого руководителя. */
export const DEFAULT_MANAGER_PERMISSIONS: readonly OrgPermission[] = [
  'employees.manage',
  'assessments.manage',
  'reports.read',
];

/** Набор владельца организации. */
export const OWNER_PERMISSIONS: readonly OrgPermission[] = [
  'org.manage',
  'employees.manage',
  'assessments.manage',
  'reports.read',
];

export function isOrgPermission(value: string): value is OrgPermission {
  return (ORG_PERMISSIONS as readonly string[]).includes(value);
}

export function hasPermission(granted: readonly string[], required: OrgPermission): boolean {
  return granted.includes(required);
}

/**
 * Несовместимые роли внутри одного исследования (ТЗ 11.4).
 * Один человек не может одновременно рецензировать прогнозы и вносить исходы.
 */
const STUDY_ROLE_CONFLICTS: ReadonlyArray<readonly [OrgPermission, OrgPermission]> = [
  ['reports.review', 'study.custodian'],
  ['study.evaluate', 'study.custodian'],
];

export function findStudyRoleConflict(
  granted: readonly string[],
): { readonly a: OrgPermission; readonly b: OrgPermission } | null {
  for (const [a, b] of STUDY_ROLE_CONFLICTS) {
    if (granted.includes(a) && granted.includes(b)) {
      return { a, b };
    }
  }
  return null;
}

/** Тип действующего лица запроса. Типы не объединяются между собой (ТЗ 10.2). */
export const ACTOR_TYPES = ['manager', 'platform_admin', 'participant', 'service'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/**
 * Временный целевой доступ администратора к содержанию организации (ТЗ 05/A03).
 * Максимальный срок задан политикой: сутки для production support.
 */
export const ACCESS_GRANT_PURPOSES = ['report_review', 'incident_support', 'data_request'] as const;

export type AccessGrantPurpose = (typeof ACCESS_GRANT_PURPOSES)[number];

export const ACCESS_GRANT_PURPOSE_LABELS: Readonly<Record<AccessGrantPurpose, string>> = {
  report_review: 'Проверка черновика заключения',
  incident_support: 'Разбор технического инцидента',
  data_request: 'Обработка запроса по данным',
};

export const ACCESS_GRANT_DEFAULT_TTL_MINUTES = 60;
export const ACCESS_GRANT_MAX_TTL_MINUTES = 24 * 60;
