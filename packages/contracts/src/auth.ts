import { z } from 'zod';

import { ORG_PERMISSIONS } from '@context/domain';

import { TEXT_LIMITS, uuidSchema } from './common';

/** Нормализация email: обрезка пробелов и нижний регистр. Пароль не обрезается. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(320)
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: 'Укажите адрес электронной почты',
  });

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Пароль должен быть не короче ${PASSWORD_MIN} символов`)
  .max(PASSWORD_MAX, `Пароль должен быть не длиннее ${PASSWORD_MAX} символов`);

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Введите пароль').max(PASSWORD_MAX),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const membershipSummarySchema = z.object({
  organizationId: uuidSchema,
  organizationCode: z.string(),
  organizationName: z.string(),
  organizationMode: z.enum(['demo', 'research', 'validated_use']),
  permissions: z.array(z.enum(ORG_PERMISSIONS)),
});
export type MembershipSummary = z.infer<typeof membershipSummarySchema>;

export const authProfileSchema = z.object({
  userId: uuidSchema,
  displayName: z.string(),
  email: z.string(),
  isPlatformAdmin: z.boolean(),
  memberships: z.array(membershipSummarySchema),
  /** Организация по умолчанию: одна — открываем сразу, несколько — просим выбрать. */
  defaultOrganizationId: uuidSchema.nullable(),
});
export type AuthProfile = z.infer<typeof authProfileSchema>;

export const activateRequestSchema = z.object({
  token: z.string().min(16).max(256),
  password: passwordSchema,
  acceptedDocumentVersionIds: z.array(uuidSchema).default([]),
});
export type ActivateRequest = z.infer<typeof activateRequestSchema>;

export const recoveryRequestSchema = z.object({ email: emailSchema });
export type RecoveryRequest = z.infer<typeof recoveryRequestSchema>;

export const passwordResetRequestSchema = z.object({
  token: z.string().min(16).max(256),
  password: passwordSchema,
});
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const sessionSummarySchema = z.object({
  id: uuidSchema,
  current: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  lastSeenAt: z.iso.datetime({ offset: true }),
  /** Минимальная подсказка об устройстве. Полного отпечатка не храним. */
  deviceHint: z.string().nullable(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const organizationContextRequestSchema = z.object({
  organizationId: uuidSchema,
});
export type OrganizationContextRequest = z.infer<typeof organizationContextRequestSchema>;

/**
 * Единый ответ на запрос восстановления. Не раскрывает, существует ли учётная запись
 * (ТЗ M01, OWASP forgot-password).
 */
export const genericAcknowledgementSchema = z.object({
  acknowledged: z.literal(true),
  message: z.string(),
});
export type GenericAcknowledgement = z.infer<typeof genericAcknowledgementSchema>;

export const inviteManagerRequestSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1).max(TEXT_LIMITS.displayName.max),
  permissions: z.array(z.enum(ORG_PERMISSIONS)).min(1),
});
export type InviteManagerRequest = z.infer<typeof inviteManagerRequestSchema>;
