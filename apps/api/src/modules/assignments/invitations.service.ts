import { Injectable } from '@nestjs/common';

import type { InvitationLink } from '@context/contracts';
import { ASSIGNMENT_STATE_LABELS, canIssueInvitation, type AssignmentState } from '@context/domain';

import { AuditService } from '../../platform/audit/audit.service';
import { loadConfig } from '../../platform/config/env';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';
import { generateSecret, hashSecret } from '../../platform/security/hashing';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Выпуск персональной ссылки.
   *
   * Секрет — 32 случайных байта; в БД попадает только HMAC-хэш. Открытое значение
   * возвращается ровно один раз, в этом ответе, и больше нигде не сохраняется:
   * ни в журнале, ни в записи идемпотентности, ни в уведомлении.
   *
   * Идентификатор сотрудника или назначения секретом не является и никогда
   * не используется как токен доступа.
   */
  async issue(
    organizationId: string,
    assignmentId: string,
    issuedBy: string,
  ): Promise<InvitationLink> {
    const config = loadConfig();

    return this.prisma.tenant({ organizationId }, async (tx) => {
      const assignment = await tx.assignments.findFirst({
        where: { id: assignmentId, organization_id: organizationId },
        select: { id: true, state: true, due_at: true },
      });

      if (!assignment) {
        throw AppError.notFound(`Назначение ${assignmentId} недоступно`);
      }

      const state = assignment.state as AssignmentState;
      if (!canIssueInvitation(state)) {
        throw AppError.conflict(
          `Ссылку нельзя выпустить в состоянии «${ASSIGNMENT_STATE_LABELS[state]}»`,
        );
      }

      // Прежняя ссылка и открытая сессия участника закрываются: одновременно
      // действует только одно приглашение на назначение (ТЗ 10.3).
      const revokedInvitations = await tx.invitations.updateMany({
        where: { organization_id: organizationId, assignment_id: assignmentId, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await tx.participant_sessions.updateMany({
        where: { organization_id: organizationId, assignment_id: assignmentId, revoked_at: null },
        data: { revoked_at: new Date() },
      });

      const secret = generateSecret();
      const expiresAt = assignment.due_at ?? new Date(Date.now() + 14 * 24 * 3_600_000);

      await tx.invitations.create({
        data: {
          organization_id: organizationId,
          assignment_id: assignmentId,
          token_hash: hashSecret(secret),
          expires_at: expiresAt,
          issued_by: issuedBy,
        },
      });

      if (state === 'draft') {
        await tx.assignments.update({
          where: { id: assignmentId },
          data: { state: 'invited', revision: { increment: 1 } },
        });
      }

      await this.audit.recordIn(tx, {
        action: 'invitation.issued',
        outcome: 'success',
        organizationId,
        resourceType: 'assignment',
        resourceId: assignmentId,
        // Токен и ссылка в аудит не попадают.
        metadata: { replacedPrevious: revokedInvitations.count > 0 },
      });

      return {
        assignmentId,
        url: `${config.WEB_ORIGIN}/participate#token=${secret}`,
        expiresAt: expiresAt.toISOString(),
        secretAvailable: true,
        replacedPrevious: revokedInvitations.count > 0,
      };
    });
  }
}
