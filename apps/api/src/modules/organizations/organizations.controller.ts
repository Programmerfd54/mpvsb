import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';

import {
  inviteManagerRequestSchema,
  updateMemberRequestSchema,
  updateOrganizationRequestSchema,
  type Envelope,
  type GenericAcknowledgement,
  type IssuedLink,
  type DashboardSummary,
  type MemberSummary,
  type OrganizationSummary,
  type ReadinessSummary,
} from '@context/contracts';

import { OrgId, RequirePermissions } from '../../platform/auth/decorators';
import { ManagerGuard } from '../../platform/auth/guards/manager.guard';
import { currentRequestId } from '../../platform/request/request-context';
import { parseInput } from '../../platform/validation/zod.pipe';
import { AuthService } from '../auth/auth.service';
import { DashboardService } from './dashboard.service';
import { OrganizationsService } from './organizations.service';

function envelope<T>(data: T): Envelope<T> {
  return { data, meta: { requestId: currentRequestId() } };
}

@Controller('orgs/:orgId')
@UseGuards(ManagerGuard)
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly dashboard: DashboardService,
    private readonly auth: AuthService,
  ) {}

  /** Сводка обзорной страницы: реальные количества и объекты, требующие внимания. */
  @Get('dashboard')
  async dashboardSummary(@OrgId() organizationId: string): Promise<Envelope<DashboardSummary>> {
    return envelope(await this.dashboard.summary(organizationId));
  }

  @Get()
  async get(@OrgId() organizationId: string): Promise<Envelope<OrganizationSummary>> {
    return envelope(await this.organizations.get(organizationId));
  }

  @Patch()
  @RequirePermissions('org.manage')
  async update(
    @OrgId() organizationId: string,
    @Body() body: unknown,
  ): Promise<Envelope<OrganizationSummary>> {
    const input = parseInput(updateOrganizationRequestSchema, body);
    return envelope(await this.organizations.update(organizationId, input));
  }

  @Get('members')
  @RequirePermissions('org.manage')
  async listMembers(@OrgId() organizationId: string): Promise<Envelope<MemberSummary[]>> {
    return envelope(await this.organizations.listMembers(organizationId));
  }

  /**
   * Приглашение руководителя. Открытая ссылка активации возвращается
   * единственный раз — повторно её получить нельзя, только выпустить новую.
   */
  @Post('members')
  @RequirePermissions('org.manage')
  async inviteMember(
    @OrgId() organizationId: string,
    @Body() body: unknown,
  ): Promise<Envelope<{ membershipId: string; activation: IssuedLink }>> {
    const input = parseInput(inviteManagerRequestSchema, body);
    const result = await this.organizations.inviteMember(organizationId, input);
    const token = await this.auth.issueAccountToken(result.userId, 'activation');

    return envelope({
      membershipId: result.membershipId,
      activation: {
        url: `/activate#token=${token.token}`,
        expiresAt: token.expiresAt.toISOString(),
        secretAvailable: true,
      },
    });
  }

  @Patch('members/:membershipId')
  @RequirePermissions('org.manage')
  async updateMember(
    @OrgId() organizationId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ): Promise<Envelope<MemberSummary[]>> {
    const input = parseInput(updateMemberRequestSchema, body);
    return envelope(
      await this.organizations.updateMemberPermissions(
        organizationId,
        membershipId,
        input.permissions,
      ),
    );
  }

  @Delete('members/:membershipId')
  @RequirePermissions('org.manage')
  async revokeMember(
    @OrgId() organizationId: string,
    @Param('membershipId') membershipId: string,
  ): Promise<Envelope<GenericAcknowledgement>> {
    await this.organizations.revokeMember(organizationId, membershipId);
    return envelope({ acknowledged: true as const, message: 'Доступ отозван' });
  }

  /** Выпуск новой ссылки активации взамен утраченной. Прежняя отзывается. */
  @Post('members/:membershipId/invitation')
  @RequirePermissions('org.manage')
  async reissueInvitation(
    @OrgId() organizationId: string,
    @Param('membershipId') membershipId: string,
  ): Promise<Envelope<IssuedLink>> {
    const members = await this.organizations.listMembers(organizationId);
    const member = members.find((item) => item.membershipId === membershipId);
    if (!member) {
      return envelope({ url: '', expiresAt: new Date().toISOString(), secretAvailable: false });
    }
    const token = await this.auth.issueAccountToken(member.userId, 'activation');
    return envelope({
      url: `/activate#token=${token.token}`,
      expiresAt: token.expiresAt.toISOString(),
      secretAvailable: true,
    });
  }

  @Get('readiness')
  async readiness(@OrgId() organizationId: string): Promise<Envelope<ReadinessSummary>> {
    return envelope(await this.organizations.readiness(organizationId));
  }
}
