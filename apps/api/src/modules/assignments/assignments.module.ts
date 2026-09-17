import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [ScenariosModule, OrganizationsModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService, InvitationsService],
  exports: [AssignmentsService, InvitationsService],
})
export class AssignmentsModule {}
