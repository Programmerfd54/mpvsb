import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import {
  assignmentListQuerySchema,
  cancelAssignmentRequestSchema,
  changeDeadlineRequestSchema,
  createAssignmentsRequestSchema,
  type AssignmentDetail,
  type AssignmentSummary,
  type CreateAssignmentsResult,
  type Envelope,
  type InvitationLink,
  type ListEnvelope,
} from '@context/contracts';

import { Actor, OrgId, RequirePermissions } from '../../platform/auth/decorators';
import { ManagerGuard } from '../../platform/auth/guards/manager.guard';
import { currentRequestId, type RequestActor } from '../../platform/request/request-context';
import { parseInput } from '../../platform/validation/zod.pipe';
import { AssignmentsService } from './assignments.service';
import { InvitationsService } from './invitations.service';

function envelope<T>(data: T): Envelope<T> {
  return { data, meta: { requestId: currentRequestId() } };
}

@Controller('orgs/:orgId/assignments')
@UseGuards(ManagerGuard)
export class AssignmentsController {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get()
  @RequirePermissions('assessments.manage')
  async list(
    @OrgId() organizationId: string,
    @Query() query: unknown,
  ): Promise<ListEnvelope<AssignmentSummary>> {
    const parsed = parseInput(assignmentListQuerySchema, query);
    const result = await this.assignments.list(organizationId, parsed);
    return {
      data: result.items,
      meta: {
        requestId: currentRequestId(),
        page: parsed.page,
        pageSize: parsed.pageSize,
        total: result.total,
      },
    };
  }

  @Post('batch')
  @RequirePermissions('assessments.manage')
  async createBatch(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<Envelope<CreateAssignmentsResult>> {
    const input = parseInput(createAssignmentsRequestSchema, body);
    return envelope(await this.assignments.createBatch(organizationId, actor.userId!, input));
  }

  @Get(':assignmentId')
  @RequirePermissions('assessments.manage')
  async get(
    @OrgId() organizationId: string,
    @Param('assignmentId') assignmentId: string,
  ): Promise<Envelope<AssignmentDetail>> {
    return envelope(await this.assignments.get(organizationId, assignmentId));
  }

  /**
   * Выпуск персональной ссылки. Открытое значение возвращается один раз;
   * повторный вызов выпускает новую ссылку и отзывает прежнюю.
   */
  @Post(':assignmentId/invitations')
  @RequirePermissions('assessments.manage')
  async issueInvitation(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
    @Param('assignmentId') assignmentId: string,
  ): Promise<Envelope<InvitationLink>> {
    return envelope(await this.invitations.issue(organizationId, assignmentId, actor.userId!));
  }

  @Patch(':assignmentId/deadline')
  @RequirePermissions('assessments.manage')
  async changeDeadline(
    @OrgId() organizationId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AssignmentDetail>> {
    const input = parseInput(changeDeadlineRequestSchema, body);
    return envelope(
      await this.assignments.changeDeadline(organizationId, assignmentId, input.dueDays),
    );
  }

  @Post(':assignmentId/cancel')
  @RequirePermissions('assessments.manage')
  async cancel(
    @OrgId() organizationId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AssignmentDetail>> {
    const input = parseInput(cancelAssignmentRequestSchema, body);
    return envelope(await this.assignments.cancel(organizationId, assignmentId, input.reason));
  }
}
