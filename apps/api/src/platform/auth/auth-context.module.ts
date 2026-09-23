import { Global, Module } from '@nestjs/common';

import { AdminGuard } from './guards/admin.guard';
import { ManagerGuard } from './guards/manager.guard';
import { ManagerOrAdminGuard } from './guards/manager-or-admin.guard';
import { ParticipantGuard } from './guards/participant.guard';
import { EmployeeGuard } from './guards/employee.guard';
import { SessionService } from './session.service';

@Global()
@Module({
  providers: [
    SessionService,
    ManagerGuard,
    ManagerOrAdminGuard,
    AdminGuard,
    ParticipantGuard,
    EmployeeGuard,
  ],
  exports: [
    SessionService,
    ManagerGuard,
    ManagerOrAdminGuard,
    AdminGuard,
    ParticipantGuard,
    EmployeeGuard,
  ],
})
export class AuthContextModule {}
