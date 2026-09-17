import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import type { Envelope, PublicScenario } from '@context/contracts';

import { OrgId } from '../../platform/auth/decorators';
import { ManagerGuard } from '../../platform/auth/guards/manager.guard';
import { currentRequestId } from '../../platform/request/request-context';
import { ScenariosService } from './scenarios.service';

@Controller('orgs/:orgId/scenarios')
@UseGuards(ManagerGuard)
export class ScenariosController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Get()
  async list(@OrgId() organizationId: string): Promise<Envelope<PublicScenario[]>> {
    return {
      data: await this.scenarios.list(organizationId),
      meta: { requestId: currentRequestId() },
    };
  }

  @Get(':scenarioVersionId')
  async get(
    @OrgId() organizationId: string,
    @Param('scenarioVersionId') scenarioVersionId: string,
  ): Promise<Envelope<PublicScenario>> {
    return {
      data: await this.scenarios.get(organizationId, scenarioVersionId),
      meta: { requestId: currentRequestId() },
    };
  }
}
