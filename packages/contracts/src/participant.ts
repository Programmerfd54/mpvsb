import { z } from 'zod';

import { uuidSchema } from './common';
import { answerResponseSchema, methodItemSchema } from './methods';

/** Обмен токена из ссылки на сессию участия. Выполняется только по действию человека. */
export const exchangeInvitationRequestSchema = z.object({
  token: z.string().min(16).max(256),
});

export type ExchangeInvitationRequest = z.infer<typeof exchangeInvitationRequestSchema>;

/**
 * Что участник видит о своём назначении.
 * Ни имени сотрудника, ни идентификаторов других людей, ни ключей методик.
 */
export const participantSessionSchema = z.object({
  organizationName: z.string(),
  organizationContact: z.string().nullable(),
  scenarioTitle: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
  /** Согласие подтверждено и можно приступать. */
  consentGiven: z.boolean(),
  declined: z.boolean(),
  methodCount: z.number().int(),
  submittedCount: z.number().int(),
  /** Что участник получит по завершении. */
  participantVisibility: z.enum(['completion_receipt', 'participant_summary']),
  /** Демонстрационный режим показывается участнику явно. */
  mode: z.enum(['demo', 'research', 'validated_use']),
});

export type ParticipantSession = z.infer<typeof participantSessionSchema>;

export const participantTermsSchema = z.object({
  documentVersionId: uuidSchema,
  title: z.string(),
  bodyMarkdown: z.string(),
  /** draft означает образец: реальные оценки на нём запускать нельзя. */
  status: z.enum(['draft', 'approved', 'retired']),
  contentHash: z.string(),
  purpose: z.string(),
});

export type ParticipantTerms = z.infer<typeof participantTermsSchema>;

export const giveConsentRequestSchema = z.object({
  documentVersionId: uuidSchema,
  documentHash: z.string().length(64),
  /** Флажок не предвыбран в интерфейсе; сервер принимает только явное true. */
  accepted: z.literal(true),
});

export type GiveConsentRequest = z.infer<typeof giveConsentRequestSchema>;

export const participantAttemptSummarySchema = z.object({
  attemptId: uuidSchema,
  title: z.string(),
  participantIntro: z.string(),
  orderIndex: z.number().int(),
  required: z.boolean(),
  state: z.enum(['not_started', 'in_progress', 'submitted', 'scored', 'scoring_failed']),
  stateLabel: z.string(),
  itemCount: z.number().int(),
  answeredCount: z.number().int(),
  /** null означает «время пока не измерено», а не ноль. */
  estimatedMinutes: z.number().int().nullable(),
  limitations: z.array(z.string()),
});

export type ParticipantAttemptSummary = z.infer<typeof participantAttemptSummarySchema>;

/** Вопросы и собственные ответы участника. Ключи подсчёта в ответе отсутствуют. */
export const participantAttemptDetailSchema = z.object({
  attemptId: uuidSchema,
  title: z.string(),
  participantIntro: z.string(),
  state: z.enum(['not_started', 'in_progress', 'submitted', 'scored', 'scoring_failed']),
  revision: z.number().int(),
  activeItemId: z.string().nullable(),
  items: z.array(methodItemSchema),
  answers: z.record(z.string(), answerResponseSchema),
  canEdit: z.boolean(),
});

export type ParticipantAttemptDetail = z.infer<typeof participantAttemptDetailSchema>;

export const saveAnswerRequestSchema = z.object({
  response: answerResponseSchema,
  /** Оптимистичная блокировка: несовпадение означает работу из другой вкладки. */
  expectedRevision: z.number().int().min(0),
});

export type SaveAnswerRequest = z.infer<typeof saveAnswerRequestSchema>;

export const saveAnswerResultSchema = z.object({
  attemptRevision: z.number().int(),
  savedAt: z.iso.datetime({ offset: true }),
  answeredCount: z.number().int(),
});

export type SaveAnswerResult = z.infer<typeof saveAnswerResultSchema>;

export const submitAttemptRequestSchema = z.object({
  expectedRevision: z.number().int().min(0),
});

export type SubmitAttemptRequest = z.infer<typeof submitAttemptRequestSchema>;

export const submitAttemptResultSchema = z.object({
  attemptId: uuidSchema,
  submittedAt: z.iso.datetime({ offset: true }),
  /** Следующая незавершённая методика, если она есть. */
  nextAttemptId: uuidSchema.nullable(),
  allSubmitted: z.boolean(),
});

export type SubmitAttemptResult = z.infer<typeof submitAttemptResultSchema>;

export const participantCompletionSchema = z.object({
  allSubmitted: z.boolean(),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Фактическая стадия без выдуманного срока готовности. */
  stageLabel: z.string(),
  organizationContact: z.string().nullable(),
  feedbackAvailable: z.boolean(),
  explanation: z.string(),
});

export type ParticipantCompletion = z.infer<typeof participantCompletionSchema>;

export const privacyRequestInputSchema = z.object({
  requestType: z.enum(['correction', 'access', 'withdrawal']),
  description: z.string().trim().min(5).max(2000),
});

export type PrivacyRequestInput = z.infer<typeof privacyRequestInputSchema>;

export const privacyReceiptSchema = z.object({
  receiptCode: z.string(),
  requestType: z.enum(['correction', 'access', 'withdrawal', 'deletion']),
  state: z.string(),
  submittedAt: z.iso.datetime({ offset: true }),
  explanation: z.string(),
});

export type PrivacyReceipt = z.infer<typeof privacyReceiptSchema>;
