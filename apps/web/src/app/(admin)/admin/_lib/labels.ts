import { CONTENT_VERSION_STATE_LABELS } from '@context/domain';

/**
 * Подписи состояний версии для кабинета администратора.
 * Берутся из предметного модуля: одно и то же состояние должно называться
 * одинаково везде.
 */
export const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(CONTENT_VERSION_STATE_LABELS).map(([key, label]) => [
    key,
    label.charAt(0).toUpperCase() + label.slice(1),
  ]),
);

/**
 * Проверенность применимости отделена от факта публикации: «опубликована»
 * означает доступность в системе, а не доказанную пригодность (ТЗ 00.3).
 */
export const VALIDATION_LABELS: Record<string, string> = {
  not_validated: 'Применимость не проверялась',
  validated: 'Применимость подтверждена',
};

/** Подписи режимов организации (`APPLICABILITY_MODES`), одинаковые во всех таблицах. */
export const ORG_MODE_LABELS: Record<string, string> = {
  demo: 'Демонстрация',
  research: 'Исследование',
  validated_use: 'Проверенное применение',
};

/** Подписи состояний пункта готовности к запуску (`READINESS_STATES`). */
export const READINESS_STATE_LABELS: Record<string, string> = {
  pending: 'Не закрыто',
  verified: 'Подтверждено',
  not_applicable: 'Неприменимо',
};

/** Подписи видов пунктов обзорного списка «Требует внимания» (`AdminOverview.attention`). */
export const ATTENTION_KIND_LABELS: Record<string, string> = {
  generation_failed: 'Сбой подготовки заключения',
  suspended_method: 'Методика приостановлена',
  expiring_grant: 'Истекает временный доступ',
  pending_recovery: 'Запрос на восстановление доступа',
  pending_privacy_request: 'Запрос по персональным данным',
};

/**
 * Подписи известных действий журнала аудита (`AdminAuditEvent.action`) для
 * организации. Список — только то, что реально пишет сервис организаций
 * (`admin-organizations.service.ts`); неизвестное действие показывается
 * исходным кодом, а не придуманным текстом.
 */
export const ORG_AUDIT_ACTION_LABELS: Record<string, string> = {
  'organization.created': 'Организация создана',
  'organization.suspended': 'Организация приостановлена',
  'organization.resumed': 'Организация возобновлена',
  'organization.readiness_changed': 'Изменён пункт готовности',
};

/** Подписи исхода записи аудита (`AdminAuditEvent.outcome`). */
export const AUDIT_OUTCOME_LABELS: Record<string, string> = {
  success: 'Выполнено',
  denied: 'Отклонено правами',
  failed: 'Не выполнено',
};
