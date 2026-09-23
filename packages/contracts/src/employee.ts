import { z } from 'zod';

import { uuidSchema } from './common';

export const employeeAssessmentStatusSchema = z.enum([
  'new',
  'in_progress',
  'submitted',
  'report_preparing',
  'completed',
  'expired',
  'cancelled',
]);

export const employeeAssessmentSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  status: employeeAssessmentStatusSchema,
  statusLabel: z.string(),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
  methodCount: z.number().int().nonnegative(),
  submittedCount: z.number().int().nonnegative(),
  consentGiven: z.boolean(),
  canOpen: z.boolean(),
  actionLabel: z.enum(['Начать', 'Продолжить']).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type EmployeeAssessment = z.infer<typeof employeeAssessmentSchema>;

export const employeeAssessmentDetailSchema = employeeAssessmentSchema.extend({
  organizationName: z.string(),
  organizationContact: z.string().nullable(),
  participantVisibility: z.enum(['completion_receipt', 'participant_summary']),
  mode: z.enum(['demo', 'research', 'validated_use']),
  stages: z.array(
    z.object({
      id: uuidSchema,
      title: z.string(),
      state: z.string(),
      itemCount: z.number().int().nonnegative(),
      answeredCount: z.number().int().nonnegative(),
    }),
  ),
});
export type EmployeeAssessmentDetail = z.infer<typeof employeeAssessmentDetailSchema>;

export const employeeProfileSchema = z.object({
  employeeId: uuidSchema,
  displayName: z.string(),
  email: z.string().nullable(),
  jobTitle: z.string().nullable(),
  departmentName: z.string().nullable(),
  organizationName: z.string(),
  organizationContact: z.string().nullable(),
});
export type EmployeeProfile = z.infer<typeof employeeProfileSchema>;

export const employeeParticipationSessionSchema = z.object({
  nextPath: z.literal('/participant/welcome'),
});
export type EmployeeParticipationSession = z.infer<typeof employeeParticipationSessionSchema>;
