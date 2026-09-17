import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import {
  archiveEmployeeRequestSchema,
  bulkArchiveRequestSchema,
  employeeInputSchema,
  employeeListQuerySchema,
  type BatchResult,
  type EmployeeDetail,
  type EmployeeSummary,
  type EmployeeTimelineEntry,
  type Envelope,
  type ListEnvelope,
} from '@context/contracts';

import { OrgId, RequirePermissions } from '../../platform/auth/decorators';
import { ManagerGuard } from '../../platform/auth/guards/manager.guard';
import { currentRequestId } from '../../platform/request/request-context';
import { parseInput } from '../../platform/validation/zod.pipe';
import { EmployeesService } from './employees.service';

@Controller('orgs/:orgId/employees')
@UseGuards(ManagerGuard)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermissions('employees.manage')
  async list(
    @OrgId() organizationId: string,
    @Query() query: unknown,
  ): Promise<ListEnvelope<EmployeeSummary>> {
    const parsed = parseInput(employeeListQuerySchema, query);
    const result = await this.employees.list(organizationId, parsed);
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

  @Post()
  @RequirePermissions('employees.manage')
  async create(
    @OrgId() organizationId: string,
    @Body() body: unknown,
  ): Promise<Envelope<EmployeeDetail>> {
    const input = parseInput(employeeInputSchema, body);
    return {
      data: await this.employees.create(organizationId, input),
      meta: { requestId: currentRequestId() },
    };
  }

  @Get(':employeeId')
  @RequirePermissions('employees.manage')
  async get(
    @OrgId() organizationId: string,
    @Param('employeeId') employeeId: string,
  ): Promise<Envelope<EmployeeDetail>> {
    return {
      data: await this.employees.get(organizationId, employeeId),
      meta: { requestId: currentRequestId() },
    };
  }

  @Patch(':employeeId')
  @RequirePermissions('employees.manage')
  async update(
    @OrgId() organizationId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<Envelope<EmployeeDetail>> {
    const input = parseInput(employeeInputSchema, body);
    return {
      data: await this.employees.update(organizationId, employeeId, input),
      meta: { requestId: currentRequestId() },
    };
  }

  @Post(':employeeId/archive')
  @RequirePermissions('employees.manage')
  async archive(
    @OrgId() organizationId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<Envelope<{ archived: boolean; cancelledAssignments: number }>> {
    const input = parseInput(archiveEmployeeRequestSchema, body ?? {});
    return {
      data: await this.employees.archive(organizationId, employeeId, input.cancelActiveAssignments),
      meta: { requestId: currentRequestId() },
    };
  }

  @Post('bulk-archive')
  @RequirePermissions('employees.manage')
  async bulkArchive(
    @OrgId() organizationId: string,
    @Body() body: unknown,
  ): Promise<Envelope<BatchResult>> {
    const input = parseInput(bulkArchiveRequestSchema, body);
    return {
      data: await this.employees.bulkArchive(
        organizationId,
        input.employeeIds,
        input.cancelActiveAssignments,
      ),
      meta: { requestId: currentRequestId() },
    };
  }

  @Get(':employeeId/timeline')
  @RequirePermissions('employees.manage')
  async timeline(
    @OrgId() organizationId: string,
    @Param('employeeId') employeeId: string,
  ): Promise<Envelope<EmployeeTimelineEntry[]>> {
    return {
      data: await this.employees.timeline(organizationId, employeeId),
      meta: { requestId: currentRequestId() },
    };
  }
}
