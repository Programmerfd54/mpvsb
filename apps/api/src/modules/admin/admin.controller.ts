import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import {
  adminAuditFilterSchema,
  adminDepartmentListQuerySchema,
  adminJobFilterSchema,
  saveAdminMailSettingsSchema,
  saveAdminMailTemplateSchema,
  archiveAdminDepartmentSchema,
  assignDepartmentManagerSchema,
  createAdminDepartmentSchema,
  inviteAdminUserSchema,
  updateAdminWorkspaceSchema,
  updateAdminDepartmentSchema,
  transferEmployeeSchema,
  suspendOrganizationSchema,
  updateReadinessSchema,
  type AdminAuditDetails,
  type AdminAuditEvent,
  type AdminDepartment,
  type AdminDepartmentDetail,
  type AdminJob,
  type AdminJobDetails,
  type AdminMailSettings,
  type AdminMailTemplate,
  type AdminMailTest,
  type AdminOperationsFacets,
  type AdminOrganization,
  type AdminOverview,
  type AdminWorkspace,
  type AdminUser,
  type AdminUserInvitation,
  type TransferEmployeeResult,
  type Envelope,
  type ReadinessCheck,
} from '@context/contracts';
import { z } from 'zod';

import { Actor } from '../../platform/auth/decorators';
import { AdminGuard } from '../../platform/auth/guards/admin.guard';
import { currentRequestId, type RequestActor } from '../../platform/request/request-context';
import { parseInput } from '../../platform/validation/zod.pipe';
import { uuidParam } from '../../platform/validation/uuid-param';
import { AuthService } from '../auth/auth.service';
import { AdminOperationsService } from './admin-operations.service';
import { AdminOrganizationsService } from './admin-organizations.service';
import { AdminWorkspaceService } from './admin-workspace.service';
import { AdminUsersService } from './admin-users.service';
import { AdminDepartmentsService } from './admin-departments.service';
import { AdminMailService } from './admin-mail.service';

function envelope<T>(data: T): Envelope<T> {
  return { data, meta: { requestId: currentRequestId() } };
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly organizations: AdminOrganizationsService,
    private readonly operations: AdminOperationsService,
    private readonly workspace: AdminWorkspaceService,
    private readonly departments: AdminDepartmentsService,
    private readonly users: AdminUsersService,
    private readonly auth: AuthService,
    private readonly mail: AdminMailService,
  ) {}

  @Get('overview')
  async overview(): Promise<Envelope<AdminOverview>> {
    return envelope(await this.operations.overview());
  }

  @Get('workspace')
  async getWorkspace(): Promise<Envelope<AdminWorkspace>> {
    return envelope(await this.workspace.get());
  }

  @Patch('workspace')
  async updateWorkspace(@Body() body: unknown): Promise<Envelope<AdminWorkspace>> {
    return envelope(await this.workspace.update(parseInput(updateAdminWorkspaceSchema, body)));
  }

  @Get('mail')
  async getMail(): Promise<Envelope<AdminMailSettings | null>> {
    return envelope(await this.mail.getSettings());
  }

  @Patch('mail')
  async saveMail(
    @Actor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<Envelope<AdminMailSettings>> {
    return envelope(
      await this.mail.saveSettings(parseInput(saveAdminMailSettingsSchema, body), actor.userId!),
    );
  }

  @Post('mail/test')
  async testMail(@Actor() actor: RequestActor): Promise<Envelope<AdminMailTest>> {
    return envelope(await this.mail.test(actor.userId!));
  }

  @Get('mail-template')
  async getMailTemplate(): Promise<Envelope<AdminMailTemplate>> {
    return envelope(await this.mail.getTemplate());
  }

  @Patch('mail-template')
  async saveMailTemplate(
    @Actor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<Envelope<AdminMailTemplate>> {
    return envelope(
      await this.mail.saveTemplate(
        parseInput(saveAdminMailTemplateSchema, body),
        actor.userId!,
      ),
    );
  }

  @Get('departments')
  async listDepartments(@Query() query: unknown): Promise<Envelope<AdminDepartment[]>> {
    return envelope(await this.departments.list(parseInput(adminDepartmentListQuerySchema, query)));
  }

  @Post('departments')
  async createDepartment(@Body() body: unknown): Promise<Envelope<AdminDepartmentDetail>> {
    return envelope(await this.departments.create(parseInput(createAdminDepartmentSchema, body)));
  }

  @Get('departments/:departmentId')
  async getDepartment(
    @Param('departmentId') departmentId: string,
  ): Promise<Envelope<AdminDepartmentDetail>> {
    return envelope(await this.departments.get(uuidParam(departmentId, 'departmentId')));
  }

  @Patch('departments/:departmentId')
  async updateDepartment(
    @Param('departmentId') departmentId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AdminDepartmentDetail>> {
    return envelope(
      await this.departments.update(
        uuidParam(departmentId, 'departmentId'),
        parseInput(updateAdminDepartmentSchema, body),
      ),
    );
  }

  @Post('departments/:departmentId/archive')
  async archiveDepartment(
    @Param('departmentId') departmentId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AdminDepartmentDetail>> {
    const input = parseInput(archiveAdminDepartmentSchema, body);
    return envelope(
      await this.departments.archive(
        uuidParam(departmentId, 'departmentId'),
        input.expectedRevision,
      ),
    );
  }

  @Post('departments/:departmentId/managers')
  async assignDepartmentManager(
    @Param('departmentId') departmentId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AdminDepartmentDetail>> {
    const input = parseInput(assignDepartmentManagerSchema, body);
    return envelope(
      await this.departments.assignManager(uuidParam(departmentId, 'departmentId'), input.userId),
    );
  }

  @Post('departments/:departmentId/managers/:userId/revoke')
  async revokeDepartmentManager(
    @Param('departmentId') departmentId: string,
    @Param('userId') userId: string,
  ): Promise<Envelope<AdminDepartmentDetail>> {
    return envelope(
      await this.departments.revokeManager(
        uuidParam(departmentId, 'departmentId'),
        uuidParam(userId, 'userId'),
      ),
    );
  }

  @Post('departments/:departmentId/employees/:employeeId/transfer')
  async transferDepartmentEmployee(
    @Actor() actor: RequestActor,
    @Param('departmentId') departmentId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<Envelope<TransferEmployeeResult>> {
    return envelope(
      await this.departments.transferEmployee(
        uuidParam(departmentId, 'departmentId'),
        uuidParam(employeeId, 'employeeId'),
        actor.userId!,
        parseInput(transferEmployeeSchema, body),
      ),
    );
  }

  @Get('users')
  async listUsers(): Promise<Envelope<AdminUser[]>> {
    return envelope(await this.users.list());
  }

  @Post('users')
  async inviteUser(
    @Actor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<Envelope<AdminUserInvitation>> {
    const input = parseInput(inviteAdminUserSchema, body);
    const created = await this.users.invite(input, actor.userId!);
    const token = await this.auth.issueAccountToken(created.userId, 'activation');
    return envelope({
      user: await this.users.get(created.userId),
      activation: {
        url: `/activate#token=${token.token}`,
        expiresAt: token.expiresAt.toISOString(),
        secretAvailable: true,
      },
      deliveryStatus: 'pending',
      deliveryMessage: 'SMTP ещё не настроен. Передайте одноразовую ссылку вручную.',
    });
  }

  @Get('organizations')
  async listOrganizations(): Promise<Envelope<AdminOrganization[]>> {
    return envelope(await this.organizations.list());
  }

  @Get('organizations/:orgId')
  async getOrganization(@Param('orgId') orgId: string): Promise<Envelope<AdminOrganization>> {
    return envelope(await this.organizations.get(orgId));
  }

  @Post('organizations/:orgId/suspend')
  async suspend(
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AdminOrganization>> {
    const input = parseInput(suspendOrganizationSchema, body);
    return envelope(await this.organizations.setStatus(orgId, 'suspended', input.reason));
  }

  @Post('organizations/:orgId/resume')
  async resume(@Param('orgId') orgId: string): Promise<Envelope<AdminOrganization>> {
    return envelope(await this.organizations.setStatus(orgId, 'active', undefined));
  }

  @Get('organizations/:orgId/readiness')
  async readiness(@Param('orgId') orgId: string): Promise<Envelope<ReadinessCheck[]>> {
    return envelope(await this.organizations.readiness(orgId));
  }

  @Patch('organizations/:orgId/readiness')
  async updateReadiness(
    @Actor() actor: RequestActor,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ): Promise<Envelope<ReadinessCheck[]>> {
    const input = parseInput(updateReadinessSchema, body);
    return envelope(await this.organizations.updateReadiness(orgId, input, actor.userId!));
  }

  @Get('operations/facets')
  async facets(): Promise<Envelope<AdminOperationsFacets>> {
    return envelope(await this.operations.facets());
  }

  @Get('jobs')
  async jobs(@Query() query: unknown): Promise<Envelope<AdminJob[]>> {
    return envelope(await this.operations.jobs(parseInput(adminJobFilterSchema, query)));
  }

  @Get('jobs/:jobId')
  async jobDetails(
    @Actor() actor: RequestActor,
    @Param('jobId') jobId: string,
  ): Promise<Envelope<AdminJobDetails>> {
    return envelope(await this.operations.jobDetails(jobId, actor.userId!));
  }

  @Post('jobs/:jobId/retry')
  async retryJob(
    @Actor() actor: RequestActor,
    @Param('jobId') jobId: string,
  ): Promise<Envelope<AdminJobDetails>> {
    return envelope(await this.operations.retryJob(jobId, actor.userId!));
  }

  @Post('jobs/:jobId/retries')
  async setRetries(
    @Actor() actor: RequestActor,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AdminJobDetails>> {
    const input = parseInput(z.object({ stopped: z.boolean() }), body);
    return envelope(await this.operations.setRetriesStopped(jobId, input.stopped, actor.userId!));
  }

  @Get('audit')
  async audit(@Query() query: unknown): Promise<Envelope<AdminAuditEvent[]>> {
    return envelope(await this.operations.auditEvents(parseInput(adminAuditFilterSchema, query)));
  }

  @Get('audit/:eventId')
  async auditDetails(
    @Actor() actor: RequestActor,
    @Param('eventId') eventId: string,
  ): Promise<Envelope<AdminAuditDetails>> {
    return envelope(await this.operations.auditDetails(eventId, actor.userId!));
  }
}
