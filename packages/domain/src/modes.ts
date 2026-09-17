import type { ApplicabilityMode } from './content-version';

/** Режим работы организации. Определяет, допустимы ли реальные участники. */
export const ORGANIZATION_MODES = ['demo', 'research', 'validated_use'] as const;
export type OrganizationMode = (typeof ORGANIZATION_MODES)[number];

export const ORGANIZATION_MODE_LABELS: Readonly<Record<OrganizationMode, string>> = {
  demo: 'Демонстрация',
  research: 'Исследование',
  validated_use: 'Проверенное применение',
};

/** Режим, в котором разрешены только синтетические участники. */
export function isSyntheticOnly(mode: OrganizationMode): boolean {
  return mode === 'demo';
}

/**
 * Пункты готовности организации к реальному запуску (ТЗ 05/A03, 10.10).
 * Формальная отметка не заменяет правовую оценку; проверку ставит уполномоченный человек.
 */
export const READINESS_CHECK_KEYS = [
  'method_content_rights',
  'method_scope_reviewed',
  'consent_documents_approved',
  'retention_policy_approved',
  'processing_agreement',
  'infrastructure_location',
  'ai_provider_policy',
  'reviewer_assigned',
  'isolation_tests_passed',
  'backup_restore_verified',
  'support_contact',
] as const;

export type ReadinessCheckKey = (typeof READINESS_CHECK_KEYS)[number];

export const READINESS_CHECK_LABELS: Readonly<Record<ReadinessCheckKey, string>> = {
  method_content_rights: 'Право использования содержимого методик',
  method_scope_reviewed: 'Границы применения методик проверены методологом',
  consent_documents_approved: 'Документы информирования и согласия утверждены',
  retention_policy_approved: 'Политика сроков хранения утверждена',
  processing_agreement: 'Договорная схема обработки данных оформлена',
  infrastructure_location: 'Контур размещения и хранения определён',
  ai_provider_policy: 'Условия AI-провайдера проверены либо выбран template-режим',
  reviewer_assigned: 'Назначен квалифицированный рецензент заключений',
  isolation_tests_passed: 'Тесты изоляции и прав доступа пройдены',
  backup_restore_verified: 'Восстановление из резервной копии проверено',
  support_contact: 'Указан контакт поддержки и порядок инцидента',
};

export const READINESS_STATES = ['pending', 'verified', 'not_applicable'] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

/**
 * Реальный режим доступен только если все обязательные пункты закрыты.
 * Возвращает список незакрытых ключей — сервер отвечает конкретной причиной,
 * а не общим «недоступно».
 */
export function missingReadinessChecks(
  states: Readonly<Partial<Record<ReadinessCheckKey, ReadinessState>>>,
): readonly ReadinessCheckKey[] {
  return READINESS_CHECK_KEYS.filter((key) => {
    const state = states[key];
    return state !== 'verified' && state !== 'not_applicable';
  });
}

/**
 * Можно ли запускать оценку реальных участников.
 * `demo` доступен всегда; `research`/`validated_use` требуют закрытых пунктов.
 */
export function canRunInMode(
  mode: OrganizationMode,
  states: Readonly<Partial<Record<ReadinessCheckKey, ReadinessState>>>,
): { readonly allowed: boolean; readonly missing: readonly ReadinessCheckKey[] } {
  if (mode === 'demo') {
    return { allowed: true, missing: [] };
  }
  const missing = missingReadinessChecks(states);
  return { allowed: missing.length === 0, missing };
}

/** Режим содержимого, требуемый для запуска организации в этом режиме. */
export function requiredContentMode(mode: OrganizationMode): ApplicabilityMode {
  return mode;
}
