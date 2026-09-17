import type { PrismaClient } from '../generated/prisma/index';

/**
 * Резолверы контекста доступа. Единственный разрешённый обход RLS: узкие
 * SECURITY DEFINER функции, каждая принимает уже проверенный идентификатор
 * и возвращает минимум полей (миграция 0009).
 */

export interface ResolvedMembership {
  readonly organization_id: string;
  readonly organization_code: string;
  readonly organization_name: string;
  readonly organization_mode: 'demo' | 'research' | 'validated_use';
  readonly organization_status: 'active' | 'suspended';
  readonly membership_id: string;
  readonly permissions: string[];
  readonly membership_status: 'invited' | 'active' | 'revoked';
}

export async function resolveUserMemberships(
  prisma: PrismaClient,
  userId: string,
): Promise<ResolvedMembership[]> {
  return prisma.$queryRaw<ResolvedMembership[]>`
    select * from app.resolve_user_memberships(${userId}::uuid)
  `;
}

export interface ResolvedParticipantSession {
  readonly session_id: string;
  readonly organization_id: string;
  readonly assignment_id: string;
  readonly invitation_id: string;
  readonly lease_version: number;
  readonly idle_expires_at: Date;
  readonly absolute_expires_at: Date;
  readonly revoked_at: Date | null;
}

export async function resolveParticipantSession(
  prisma: PrismaClient,
  sessionHash: string,
): Promise<ResolvedParticipantSession | null> {
  const rows = await prisma.$queryRaw<ResolvedParticipantSession[]>`
    select * from app.resolve_participant_session(${sessionHash})
  `;
  return rows[0] ?? null;
}

export interface ResolvedInvitation {
  readonly invitation_id: string;
  readonly organization_id: string;
  readonly assignment_id: string;
  readonly expires_at: Date;
  readonly revoked_at: Date | null;
}

export async function resolveInvitation(
  prisma: PrismaClient,
  tokenHash: string,
): Promise<ResolvedInvitation | null> {
  const rows = await prisma.$queryRaw<ResolvedInvitation[]>`
    select * from app.resolve_invitation(${tokenHash})
  `;
  return rows[0] ?? null;
}

export interface ResolvedAccessGrant {
  readonly grant_id: string;
  readonly purpose: string;
  readonly permissions: string[];
  readonly resource_scope: unknown;
  readonly expires_at: Date;
}

export async function resolveAccessGrant(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<ResolvedAccessGrant | null> {
  const rows = await prisma.$queryRaw<ResolvedAccessGrant[]>`
    select * from app.resolve_access_grant(${userId}::uuid, ${organizationId}::uuid)
  `;
  return rows[0] ?? null;
}

/**
 * Признаки состояния назначения, стоящего за фоновым заданием (миграция 0012).
 *
 * Нужны экрану обработки, чтобы отказать в повторе отменённого назначения,
 * отозванного согласия или устаревшего поколения данных. Содержания ответов
 * и заключения резолвер не возвращает.
 */
export interface ResolvedJobTarget {
  readonly assignment_id: string;
  readonly assignment_state: string;
  readonly processing_hold: boolean;
  readonly data_generation: bigint;
  readonly consent_active: boolean;
  readonly declined: boolean;
}

export async function resolveJobTarget(
  prisma: PrismaClient,
  organizationId: string,
  entityType: string,
  entityId: string,
): Promise<ResolvedJobTarget | null> {
  const rows = await prisma.$queryRaw<ResolvedJobTarget[]>`
    select * from app.resolve_job_target(${organizationId}::uuid, ${entityType}, ${entityId}::uuid)
  `;
  return rows[0] ?? null;
}
